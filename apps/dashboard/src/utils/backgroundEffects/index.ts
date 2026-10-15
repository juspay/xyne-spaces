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
    // Compile rather than validate(): a CSP without 'wasm-unsafe-eval' (e.g. older Electron
    // builds) blocks compilation but not validation, and the effect would then fail on use.
    return typeof WebAssembly !== 'undefined' && !!new WebAssembly.Module(WASM_SIMD_PROBE);
  } catch {
    return false;
  }
}

interface BackgroundEffectsSupport {
  supported: boolean;
  /** GPU renderer string, e.g. to tell hardware from SwiftShader in failure logs. */
  renderer?: string | undefined;
}

let cachedSupport: BackgroundEffectsSupport | undefined;

/**
 * Probed once: each probe creates a WebGL context and compiles a Wasm module, and this is
 * read on every picker render. The probe context is released straight away so it never
 * counts against Chrome's live-context cap (which would evict the active effect's context).
 */
function probeBackgroundEffects(): BackgroundEffectsSupport {
  if (cachedSupport) return cachedSupport;
  if (typeof document === 'undefined' || typeof VideoFrame === 'undefined') {
    return (cachedSupport = { supported: false });
  }
  if (!ProcessorWrapper.isSupported || !supportsWasmSimd()) {
    return (cachedSupport = { supported: false });
  }
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return (cachedSupport = { supported: false });
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer: unknown = gl.getParameter(
      debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
    );
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return (cachedSupport = {
      supported: true,
      renderer: typeof renderer === 'string' ? renderer : undefined,
    });
  } catch {
    return (cachedSupport = { supported: false });
  }
}

/** Whether this browser can run background effects (WebGL2, Wasm SIMD, a frame-processing path). */
export function supportsBackgroundEffects(): boolean {
  return probeBackgroundEffects().supported;
}

/** The WebGL renderer the effect runs on, when known. */
export function backgroundEffectsRenderer(): string | undefined {
  return probeBackgroundEffects().renderer;
}
