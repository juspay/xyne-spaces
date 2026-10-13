import { ProcessorWrapper } from '@livekit/track-processors';
import {
  type BackgroundEffectOptions,
  BackgroundEffectTransformer,
} from './BackgroundEffectTransformer';

export type { BackgroundEffectOptions } from './BackgroundEffectTransformer';

const PROCESSOR_NAME = 'xyne-background-effect';

/**
 * LiveKit track processor for the call background picker. Attach with
 * `track.setProcessor(new BackgroundEffectProcessor(opts))`, then switch effects in
 * place with {@link setEffect} — no teardown, so no camera flicker between choices.
 */
export class BackgroundEffectProcessor extends ProcessorWrapper<
  BackgroundEffectOptions,
  BackgroundEffectTransformer
> {
  constructor(options: BackgroundEffectOptions) {
    super(new BackgroundEffectTransformer(options), PROCESSOR_NAME);
  }

  setEffect(options: BackgroundEffectOptions): Promise<void> {
    return this.updateTransformerOptions(options);
  }
}

// Smallest module using a SIMD instruction (same probe MediaPipe's isSimdSupported uses).
const WASM_SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
]);

function supportsWasmSimd(): boolean {
  try {
    return typeof WebAssembly !== 'undefined' && WebAssembly.validate(WASM_SIMD_PROBE);
  } catch {
    return false;
  }
}

/** Whether this browser can run background effects (WebGL2, Wasm SIMD, a frame-processing path). */
export function supportsBackgroundEffects(): boolean {
  if (typeof document === 'undefined' || typeof VideoFrame === 'undefined') return false;
  if (!ProcessorWrapper.isSupported || !supportsWasmSimd()) return false;
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}
