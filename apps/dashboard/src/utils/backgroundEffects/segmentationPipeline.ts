import {
  BILATERAL_SHADER,
  BLUR_PREPARE_SHADER,
  COMPOSITE_SHADER,
  COPY_SHADER,
  GAUSSIAN_MAX_TAPS,
  GAUSSIAN_SHADER,
  TEMPORAL_SHADER,
  VERTEX_SHADER,
} from './shaders';

/** Knobs for mask quality. Defaults are tuned for webcam footage; see `DEFAULT_TUNING`. */
export interface PipelineTuning {
  /** Longest edge (px) of the buffers the mask is refined at. */
  workingEdge: number;
  /** EMA weight given to the new mask where the image is static (lower = steadier). */
  staticAlpha: number;
  /** Image-change range (RGB distance) over which smoothing fades out to "take new mask". */
  motionRange: [number, number];
  /** Joint-bilateral spatial sigma, in working-resolution texels. */
  spatialSigma: number;
  /** Joint-bilateral colour sigma (RGB distance, 0–1). Lower = edges follow colour more tightly. */
  rangeSigma: number;
  /** Confidence band mapped to the soft edge; below the low end counts as background. */
  edge: [number, number];
}

export const DEFAULT_TUNING: PipelineTuning = {
  workingEdge: 640,
  // Tuned on noisy low-light webcam footage: the motion floor sits above sensor noise
  // so noise doesn't disable smoothing, and 0.1 cut flicker ~7x vs no smoothing
  // without visible trailing on movement.
  staticAlpha: 0.1,
  motionRange: [0.06, 0.2],
  spatialSigma: 3,
  rangeSigma: 0.1,
  edge: [0.4, 0.7],
};

/** Gaussian sigma (in blur-buffer texels, i.e. quarter resolution) per blur strength. */
export const BLUR_SIGMA = { light: 3, strong: 7 } as const;

const BLUR_DOWNSCALE = 4;

type Background =
  | { kind: 'blur'; sigma: number }
  | { kind: 'image'; texture: WebGLTexture; width: number; height: number };

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log ?? 'unknown error'}`);
  }
  return shader;
}

function gaussianWeights(sigma: number): { weights: Float32Array; taps: number } {
  const taps = Math.min(GAUSSIAN_MAX_TAPS, Math.ceil(sigma * 3) + 1);
  const weights = new Float32Array(GAUSSIAN_MAX_TAPS);
  let total = 0;
  for (let i = 0; i < taps; i++) {
    weights[i] = Math.exp(-(i * i) / (2 * sigma * sigma));
    total += i === 0 ? weights[i]! : 2 * weights[i]!;
  }
  for (let i = 0; i < taps; i++) weights[i]! /= total;
  return { weights, taps };
}

/**
 * GPU pipeline that turns (camera frame, raw segmentation mask) into the composited
 * output, on the same WebGL2 context MediaPipe renders its mask into — so the mask
 * texture is used in place, never read back to the CPU.
 *
 * Per frame:
 *  1. upload frame; downsample it to the "guide" image at working resolution
 *  2. temporal pass: motion-adaptive EMA of the raw mask (kills flicker)
 *  3. joint-bilateral pass (H then V): snap the mask to colour edges in the guide
 *  4. blur mode only: mask-weighted Gaussian of the background (no person halo)
 *  5. composite into the canvas
 *
 * MediaPipe shares this context and does not restore GL state, so every pass sets all
 * state it depends on, and `render` unbinds what it bound before returning.
 */
export class SegmentationPipeline {
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quad: WebGLBuffer;
  private readonly programs: Record<
    'copy' | 'temporal' | 'bilateral' | 'blurPrepare' | 'gaussian' | 'composite',
    Program
  >;
  private readonly frameTexture: WebGLTexture;

  private frameWidth = 0;
  private frameHeight = 0;
  private guide: [Target, Target] | null = null;
  private temporal: [Target, Target] | null = null;
  private bilateral: [Target, Target] | null = null;
  private blur: [Target, Target] | null = null;
  /** Index into the guide/temporal ping-pong pairs holding the latest result. */
  private current: 0 | 1 = 0;
  private hasHistory = false;

  private background: Background = { kind: 'blur', sigma: BLUR_SIGMA.light };
  private readonly tuning: PipelineTuning = DEFAULT_TUNING;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const vao = gl.createVertexArray();
    const quad = gl.createBuffer();
    if (!vao || !quad) throw new Error('Could not allocate WebGL buffers');
    this.vao = vao;
    this.quad = quad;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.programs = {
      copy: this.createProgram(COPY_SHADER),
      temporal: this.createProgram(TEMPORAL_SHADER),
      bilateral: this.createProgram(BILATERAL_SHADER),
      blurPrepare: this.createProgram(BLUR_PREPARE_SHADER),
      gaussian: this.createProgram(GAUSSIAN_SHADER),
      composite: this.createProgram(COMPOSITE_SHADER),
    };
    this.frameTexture = this.createTexture();
  }

  setBlur(sigma: number): void {
    this.releaseBackgroundImage();
    this.background = { kind: 'blur', sigma };
  }

  setBackgroundImage(image: ImageBitmap): void {
    const { gl } = this;
    const texture = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    // Mipmaps keep a large photo crisp, not aliased, when the camera is lower-res.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.releaseBackgroundImage();
    this.background = { kind: 'image', texture, width: image.width, height: image.height };
  }

  /**
   * Composite one frame into the canvas this context draws to.
   * `rawMask` is MediaPipe's confidence-mask texture for the same frame.
   */
  render(frame: VideoFrame, rawMask: WebGLTexture): void {
    const { gl } = this;
    const width = frame.displayWidth;
    const height = frame.displayHeight;
    if (width === 0 || height === 0) return;
    this.ensureTargets(width, height);
    const guide = this.guide!;
    const temporal = this.temporal!;
    const bilateral = this.bilateral!;

    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);

    // 1. Upload the frame and build this frame's guide image.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);

    const prev = this.current;
    const next: 0 | 1 = prev === 0 ? 1 : 0;
    this.draw(this.programs.copy, guide[next], { u_source: this.frameTexture });

    // 2. Temporal smoothing against the previous frame.
    const t = this.tuning;
    this.draw(
      this.programs.temporal,
      temporal[next],
      {
        u_rawMask: rawMask,
        u_prevMask: temporal[prev].texture,
        u_guide: guide[next].texture,
        u_prevGuide: guide[prev].texture,
      },
      program => {
        this.uniform2f(program, 'u_texel', 1 / guide[next].width, 1 / guide[next].height);
        this.uniform1i(program, 'u_reset', this.hasHistory ? 0 : 1);
        this.uniform1f(program, 'u_staticAlpha', t.staticAlpha);
        this.uniform2f(program, 'u_motionRange', t.motionRange[0], t.motionRange[1]);
      },
    );
    this.current = next;
    this.hasHistory = true;

    // 3. Edge-aware refinement, horizontal then vertical.
    const bilateralUniforms = (stepX: number, stepY: number) => (program: Program) => {
      this.uniform2f(program, 'u_step', stepX, stepY);
      this.uniform1f(program, 'u_spatialSigma', t.spatialSigma);
      this.uniform1f(program, 'u_rangeSigma', t.rangeSigma);
    };
    this.draw(
      this.programs.bilateral,
      bilateral[0],
      { u_mask: temporal[next].texture, u_guide: guide[next].texture },
      bilateralUniforms(1 / bilateral[0].width, 0),
    );
    this.draw(
      this.programs.bilateral,
      bilateral[1],
      { u_mask: bilateral[0].texture, u_guide: guide[next].texture },
      bilateralUniforms(0, 1 / bilateral[1].height),
    );
    const refinedMask = bilateral[1].texture;

    // 4. Background.
    let backgroundTexture: WebGLTexture;
    let bgScale: [number, number] = [1, 1];
    let bgOffset: [number, number] = [0, 0];
    if (this.background.kind === 'blur') {
      const blur = this.blur!;
      const { weights, taps } = gaussianWeights(this.background.sigma);
      const gaussianUniforms = (stepX: number, stepY: number) => (program: Program) => {
        this.uniform2f(program, 'u_step', stepX, stepY);
        gl.uniform1fv(program.uniforms.get('u_weights[0]') ?? null, weights);
        this.uniform1i(program, 'u_taps', taps);
      };
      this.draw(this.programs.blurPrepare, blur[0], {
        u_frame: this.frameTexture,
        u_mask: refinedMask,
      });
      this.draw(
        this.programs.gaussian,
        blur[1],
        { u_source: blur[0].texture },
        gaussianUniforms(1 / blur[1].width, 0),
      );
      this.draw(
        this.programs.gaussian,
        blur[0],
        { u_source: blur[1].texture },
        gaussianUniforms(0, 1 / blur[0].height),
      );
      backgroundTexture = blur[0].texture;
    } else {
      backgroundTexture = this.background.texture;
      // "cover" crop: scale the image's UV range down along the axis that overflows.
      const imageAspect = this.background.width / this.background.height;
      const frameAspect = width / height;
      if (imageAspect > frameAspect) {
        bgScale = [frameAspect / imageAspect, 1];
      } else {
        bgScale = [1, imageAspect / frameAspect];
      }
      bgOffset = [(1 - bgScale[0]) / 2, (1 - bgScale[1]) / 2];
    }

    // 5. Composite into the canvas (default framebuffer, bottom-up → flip).
    const mode = this.background.kind === 'blur' ? 0 : 1;
    this.draw(
      this.programs.composite,
      null,
      { u_frame: this.frameTexture, u_mask: refinedMask, u_background: backgroundTexture },
      program => {
        this.uniform1i(program, 'u_mode', mode);
        this.uniform2f(program, 'u_bgScale', bgScale[0], bgScale[1]);
        this.uniform2f(program, 'u_bgOffset', bgOffset[0], bgOffset[1]);
        this.uniform2f(program, 'u_edge', t.edge[0], t.edge[1]);
      },
      true,
    );

    // Leave the context the way MediaPipe expects to find it.
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(null);
    for (let unit = 0; unit < 4; unit++) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose(): void {
    const { gl } = this;
    this.releaseTargets();
    this.releaseBackgroundImage();
    gl.deleteTexture(this.frameTexture);
    for (const { program } of Object.values(this.programs)) gl.deleteProgram(program);
    gl.deleteBuffer(this.quad);
    gl.deleteVertexArray(this.vao);
  }

  // -------------------------------------------------------------------------

  private draw(
    program: Program,
    target: Target | null,
    textures: Record<string, WebGLTexture>,
    setUniforms?: (program: Program) => void,
    flipY = false,
  ): void {
    const { gl } = this;
    gl.useProgram(program.program);
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.frameWidth, this.frameHeight);
    }
    let unit = 0;
    for (const [name, texture] of Object.entries(textures)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(program.uniforms.get(name) ?? null, unit);
      unit++;
    }
    this.uniform1i(program, 'u_flipY', flipY ? 1 : 0);
    setUniforms?.(program);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private uniform1i(program: Program, name: string, value: number): void {
    this.gl.uniform1i(program.uniforms.get(name) ?? null, value);
  }

  private uniform1f(program: Program, name: string, value: number): void {
    this.gl.uniform1f(program.uniforms.get(name) ?? null, value);
  }

  private uniform2f(program: Program, name: string, x: number, y: number): void {
    this.gl.uniform2f(program.uniforms.get(name) ?? null, x, y);
  }

  private createProgram(fragmentSource: string): Program {
    const { gl } = this;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error('Could not create program');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program) ?? 'unknown error'}`);
    }
    const uniforms = new Map<string, WebGLUniformLocation | null>();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (info) uniforms.set(info.name, gl.getUniformLocation(program, info.name));
    }
    return { program, uniforms };
  }

  private createTexture(): WebGLTexture {
    const { gl } = this;
    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not create texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  private createTarget(width: number, height: number): Target {
    const { gl } = this;
    const texture = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('Could not create framebuffer');
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Framebuffer incomplete');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { texture, framebuffer, width, height };
  }

  private ensureTargets(width: number, height: number): void {
    if (this.guide && width === this.frameWidth && height === this.frameHeight) return;
    this.releaseTargets();
    this.frameWidth = width;
    this.frameHeight = height;
    const scale = Math.min(1, this.tuning.workingEdge / Math.max(width, height));
    const workW = Math.max(1, Math.round(width * scale));
    const workH = Math.max(1, Math.round(height * scale));
    const blurW = Math.max(1, Math.round(width / BLUR_DOWNSCALE));
    const blurH = Math.max(1, Math.round(height / BLUR_DOWNSCALE));
    const pair = (w: number, h: number): [Target, Target] => [
      this.createTarget(w, h),
      this.createTarget(w, h),
    ];
    this.guide = pair(workW, workH);
    this.temporal = pair(workW, workH);
    this.bilateral = pair(workW, workH);
    this.blur = pair(blurW, blurH);
    this.hasHistory = false;
  }

  private releaseTargets(): void {
    const { gl } = this;
    for (const pair of [this.guide, this.temporal, this.bilateral, this.blur]) {
      for (const target of pair ?? []) {
        gl.deleteFramebuffer(target.framebuffer);
        gl.deleteTexture(target.texture);
      }
    }
    this.guide = this.temporal = this.bilateral = this.blur = null;
  }

  private releaseBackgroundImage(): void {
    if (this.background.kind === 'image') this.gl.deleteTexture(this.background.texture);
  }
}
