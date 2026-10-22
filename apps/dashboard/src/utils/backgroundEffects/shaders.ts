/**
 * GLSL for the background-effect pipeline (see segmentationPipeline.ts).
 *
 * Texture-space convention: every intermediate texture is stored "image-down" — row 0
 * is the top of the picture, exactly as `texImage2D(VideoFrame)` and MediaPipe's mask
 * textures lay it out. Intermediate passes therefore sample with un-flipped UVs; only
 * the final composite into the canvas (whose framebuffer is bottom-up) flips Y.
 */

export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
uniform bool u_flipY;
out vec2 v_uv;
void main() {
  v_uv = (a_position + 1.0) * 0.5;
  if (u_flipY) v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/** Plain resample (bilinear) — used to downsample the camera frame into the guide image. */
export const COPY_SHADER = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_source;
out vec4 outColor;
void main() {
  outColor = vec4(texture(u_source, v_uv).rgb, 1.0);
}
`;

/**
 * Motion-adaptive temporal smoothing of the raw segmentation confidence.
 *
 * The model's per-frame output is noisy wherever it is unsure (dark clothing, chair,
 * floor), which reads as flicker. Pixels where the *camera image* is static get a
 * slow exponential moving average, so that noise is averaged away; pixels where the
 * image is actually changing (the person moving) take the new estimate almost
 * immediately, so the cut-out does not lag or leave a ghost trail.
 */
export const TEMPORAL_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_rawMask;
uniform sampler2D u_prevMask;
uniform sampler2D u_guide;
uniform sampler2D u_prevGuide;
uniform vec2 u_texel;
uniform bool u_reset;
uniform float u_staticAlpha;
uniform vec2 u_motionRange;
out vec4 outColor;

vec3 avg3x3(sampler2D tex, vec2 uv) {
  vec3 sum = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      sum += texture(tex, uv + vec2(float(x), float(y)) * u_texel).rgb;
    }
  }
  return sum / 9.0;
}

void main() {
  float raw = clamp(texture(u_rawMask, v_uv).r, 0.0, 1.0);

  if (u_reset) {
    outColor = vec4(raw, 0.0, 0.0, 1.0);
    return;
  }

  // Averaging a 3x3 neighbourhood keeps sensor noise from registering as motion.
  float motion = length(avg3x3(u_guide, v_uv) - avg3x3(u_prevGuide, v_uv));
  float alpha = mix(u_staticAlpha, 1.0, smoothstep(u_motionRange.x, u_motionRange.y, motion));
  float prev = texture(u_prevMask, v_uv).r;
  outColor = vec4(mix(prev, raw, alpha), 0.0, 0.0, 1.0);
}
`;

const BILATERAL_RADIUS = 6;

/**
 * One direction of a separable joint-bilateral filter: smooths the mask, but weights
 * each tap by how similar its colour in the camera image is to the centre pixel's.
 * The mask therefore spreads within regions of similar colour and stops at real
 * colour edges, snapping the low-resolution (256px) model output onto the actual
 * outline of hair, shoulders and clothing at working resolution.
 */
export const BILATERAL_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_mask;
uniform sampler2D u_guide;
uniform vec2 u_step;
uniform float u_spatialSigma;
uniform float u_rangeSigma;
out vec4 outColor;

const int RADIUS = ${BILATERAL_RADIUS};

void main() {
  vec3 centerColor = texture(u_guide, v_uv).rgb;
  float spatialDenom = 2.0 * u_spatialSigma * u_spatialSigma;
  float rangeDenom = 2.0 * u_rangeSigma * u_rangeSigma;
  float sum = 0.0;
  float weightSum = 0.0;
  for (int i = -RADIUS; i <= RADIUS; i++) {
    vec2 uv = v_uv + u_step * float(i);
    vec3 diff = texture(u_guide, uv).rgb - centerColor;
    float w = exp(-float(i * i) / spatialDenom - dot(diff, diff) / rangeDenom);
    sum += texture(u_mask, uv).r * w;
    weightSum += w;
  }
  outColor = vec4(sum / weightSum, 0.0, 0.0, 1.0);
}
`;

/**
 * First step of the background blur: write the frame premultiplied by "how much
 * background" each pixel is. Blurring that and dividing by the blurred weight (in the
 * composite) averages only background pixels, so the person's colours never smear
 * into the blurred background as a halo around them.
 */
export const BLUR_PREPARE_SHADER = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_frame;
uniform sampler2D u_mask;
out vec4 outColor;
void main() {
  float background = 1.0 - smoothstep(0.2, 0.6, texture(u_mask, v_uv).r);
  // Small floor so pixels deep inside the person still have a defined blur value.
  float w = max(background, 0.02);
  outColor = vec4(texture(u_frame, v_uv).rgb * w, w);
}
`;

export const GAUSSIAN_MAX_TAPS = 24;

/** One direction of a separable Gaussian on premultiplied RGBA. */
export const GAUSSIAN_SHADER = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform vec2 u_step;
uniform float u_weights[${GAUSSIAN_MAX_TAPS}];
uniform int u_taps;
out vec4 outColor;
void main() {
  vec4 sum = texture(u_source, v_uv) * u_weights[0];
  for (int i = 1; i < ${GAUSSIAN_MAX_TAPS}; i++) {
    if (i >= u_taps) break;
    vec2 offset = u_step * float(i);
    sum += (texture(u_source, v_uv + offset) + texture(u_source, v_uv - offset)) * u_weights[i];
  }
  outColor = sum;
}
`;

/**
 * Final composite into the output canvas.
 * `u_edge` remaps mask confidence to coverage: confidence below the low end is treated
 * as background, which drops the faint specks the model leaves on floors and walls,
 * and the band between the two values becomes a soft, anti-aliased edge.
 */
export const COMPOSITE_SHADER = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_frame;
uniform sampler2D u_mask;
uniform sampler2D u_background;
uniform int u_mode; // 0 = blur (premultiplied background), 1 = image
uniform vec2 u_bgScale;
uniform vec2 u_bgOffset;
uniform vec2 u_edge;
out vec4 outColor;
void main() {
  vec3 frame = texture(u_frame, v_uv).rgb;
  float person = smoothstep(u_edge.x, u_edge.y, texture(u_mask, v_uv).r);

  vec3 background;
  if (u_mode == 0) {
    vec4 blurred = texture(u_background, v_uv);
    background = blurred.a > 0.0001 ? blurred.rgb / blurred.a : frame;
  } else {
    background = texture(u_background, v_uv * u_bgScale + u_bgOffset).rgb;
  }

  outColor = vec4(mix(background, frame, person), 1.0);
}
`;
