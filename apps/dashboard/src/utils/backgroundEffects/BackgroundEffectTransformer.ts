import { ImageSegmenter } from '@mediapipe/tasks-vision';
import type {
  TrackTransformerDestroyOptions,
  VideoTransformerInitOptions,
} from '@livekit/track-processors';
import { logger, Event } from '../logger';
import { BLUR_SIGMA, SegmentationPipeline } from './segmentationPipeline';

/**
 * What the transformer draws behind the person. `disabled` passes frames through
 * untouched (used while switching to "no effect" before the processor is stopped).
 */
export type BackgroundEffectOptions = {
  mode: 'disabled' | 'blur' | 'image';
  blurStrength?: keyof typeof BLUR_SIGMA;
  imageUrl?: string;
};

/** Self-hosted MediaPipe assets (copied into the build by vite.config.ts). */
const ASSET_BASE = `${import.meta.env.BASE_URL}mediapipe`;
export const SEGMENTATION_MODEL_URL = `${ASSET_BASE}/selfie_segmenter.tflite`;

/** Only the SIMD runtime is shipped; supportsBackgroundEffects() gates on Wasm SIMD. */
const WASM_FILESET = {
  wasmLoaderPath: `${ASSET_BASE}/wasm/vision_wasm_internal.js`,
  wasmBinaryPath: `${ASSET_BASE}/wasm/vision_wasm_internal.wasm`,
};

/**
 * Decode a background image: a preset served by the API (cookie-authenticated, so
 * fetched with credentials — and CORS-readable, as WebGL requires) or a data: URL upload.
 */
async function loadImage(url: string): Promise<ImageBitmap> {
  const img = new Image();
  img.crossOrigin = 'use-credentials';
  img.src = url;
  await img.decode();
  return createImageBitmap(img);
}

/**
 * LiveKit video transformer that replaces or blurs the camera background.
 *
 * Segmentation is MediaPipe's selfie segmenter on the GPU, run on the same WebGL
 * context as {@link SegmentationPipeline} so its confidence mask is consumed as a
 * texture without a CPU round-trip. Unlike LiveKit's stock BackgroundTransformer it
 * keeps the model's soft confidence (not a hard person/background cut), and refines
 * it temporally and against image edges — see segmentationPipeline.ts.
 *
 * Shaped as LiveKit's `VideoTrackTransformer` (checked where ProcessorWrapper is
 * instantiated); not declared with `implements` because that interface types the
 * lifecycle methods as returning void, while ProcessorWrapper awaits them.
 */
export class BackgroundEffectTransformer {
  transformer?: TransformStream;

  private options: BackgroundEffectOptions;
  private canvas?: OffscreenCanvas | HTMLCanvasElement | undefined;
  private segmenter?: ImageSegmenter | undefined;
  private pipeline?: SegmentationPipeline | undefined;
  private lastTimestamp = 0;
  /** Bumped on every update so a slow image load can't overwrite a newer choice. */
  private optionsVersion = 0;
  private destroyed = false;
  private loggedFrameError = false;

  constructor(options: BackgroundEffectOptions) {
    this.options = options;
  }

  async init({ outputCanvas }: VideoTransformerInitOptions): Promise<void> {
    this.destroyed = false;
    this.canvas = outputCanvas;
    this.transformer = new TransformStream<VideoFrame, VideoFrame>({
      transform: (frame, controller) => this.transform(frame, controller),
    });

    // Create the context ourselves first; MediaPipe's getContext('webgl2') on the same
    // canvas then returns this one, which is what lets the two share textures.
    const gl = outputCanvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 is not available');

    const segmenter = await ImageSegmenter.createFromOptions(WASM_FILESET, {
      baseOptions: { modelAssetPath: SEGMENTATION_MODEL_URL, delegate: 'GPU' },
      canvas: outputCanvas,
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    if (this.destroyed) {
      segmenter.close();
      return;
    }
    this.segmenter = segmenter;
    this.pipeline = new SegmentationPipeline(gl);
    await this.update(this.options);
  }

  async restart(options: VideoTransformerInitOptions): Promise<void> {
    await this.destroy({ willProcessorRestart: true });
    await this.init(options);
  }

  destroy(_options?: TrackTransformerDestroyOptions): Promise<void> {
    this.destroyed = true;
    this.pipeline?.dispose();
    this.pipeline = undefined;
    this.segmenter?.close();
    this.segmenter = undefined;
    this.canvas = undefined;
    return Promise.resolve();
  }

  async update(options: BackgroundEffectOptions): Promise<void> {
    this.options = { ...this.options, ...options };
    const version = ++this.optionsVersion;
    const pipeline = this.pipeline;
    if (!pipeline) return; // applied at the end of init

    if (this.options.mode === 'blur') {
      pipeline.setBlur(BLUR_SIGMA[this.options.blurStrength ?? 'light']);
    } else if (this.options.mode === 'image' && this.options.imageUrl) {
      const image = await loadImage(this.options.imageUrl);
      try {
        // Ignore if a newer option or teardown happened while loading.
        if (version === this.optionsVersion && this.pipeline === pipeline) {
          pipeline.setBackgroundImage(image);
        }
      } finally {
        image.close();
      }
    }
  }

  transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>): void {
    const { segmenter, pipeline, canvas } = this;
    if (
      this.options.mode === 'disabled' ||
      !segmenter ||
      !pipeline ||
      !canvas ||
      frame.displayWidth === 0 ||
      frame.displayHeight === 0
    ) {
      controller.enqueue(frame);
      return;
    }

    try {
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
      }
      // MediaPipe requires strictly increasing timestamps in VIDEO mode.
      const timestamp = Math.max(performance.now(), this.lastTimestamp + 0.001);
      this.lastTimestamp = timestamp;

      let rendered = false;
      // Synchronous: the callback runs, and the mask is valid, only inside this call.
      segmenter.segmentForVideo(frame, timestamp, result => {
        const mask = result.confidenceMasks?.[0];
        if (mask) {
          pipeline.render(frame, mask.getAsWebGLTexture());
          rendered = true;
        }
        result.close();
      });

      if (rendered) {
        controller.enqueue(new VideoFrame(canvas, { timestamp: frame.timestamp }));
        frame.close();
      } else {
        controller.enqueue(frame);
      }
    } catch (error) {
      // Never drop the camera: on any processing error, pass the frame through.
      // Logged once per processor so a persistent failure is visible, not spammed.
      if (!this.loggedFrameError) {
        this.loggedFrameError = true;
        logger.error(Event.LIVEKIT_ROOM_EVENT, {
          eventName: 'background_effect_frame_failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      controller.enqueue(frame);
    }
  }
}
