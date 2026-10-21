/**
 * Pure state machine for falling back to the server's compatible (H.264 SDR)
 * video rendition when the device cannot decode the original.
 *
 * Why: iPhone HDR recordings (HEVC 10-bit HLG + Dolby Vision) fail on many
 * Android decoders (e.g. MediaTek `c2.mtk.hevc.decoder` → NO_EXCEEDS_CAPABILITIES).
 * The backend can serve `/stream?variant=compat`; this module decides when to
 * ask for it and how to react to the answer. No React / RN imports so it is
 * unit-testable under `node --test`.
 *
 * Behaviour is deliberately conservative so nothing that plays today changes:
 * - Only a `decoder_unsupported` failure of the ORIGINAL triggers a fallback.
 * - Only on Android (iOS AVPlayer decodes these files natively).
 * - Compat answers 503 while the rendition is generated → retry with backoff.
 * - Any other compat failure (feature disabled 404, not needed 409, failed
 *   422, network…) → give up and show the ORIGINAL error exactly as today.
 */

import {
  classifyVideoPlaybackError,
  toVideoErrorMessage,
} from '@/src/observability/logging/media/videoPlayback';

export type VideoVariant = 'original' | 'compat';

export type CompatFallbackPhase =
  /** Playing (or trying) the original file. */
  | 'original'
  /** Compat requested; waiting for the player to load it. */
  | 'compat'
  /** Server is generating the compat rendition; a retry is scheduled. */
  | 'preparing'
  /** Compat playing successfully. */
  | 'compat_ready'
  /** Fallback not possible; show the original error. */
  | 'unavailable';

export type CompatFallbackState = Readonly<{
  phase: CompatFallbackPhase;
  /** Number of compat load attempts made so far (0 before the first). */
  attempt: number;
  /** The original playback error, shown if the fallback gives up. */
  originalError: string | null;
}>;

export type CompatFallbackAction =
  { type: 'show_error' } | { type: 'load_compat' } | { type: 'retry_compat'; delayMs: number };

/** Backoff while the server transcodes (~3 minutes total, enough for a 100 s clip). */
export const COMPAT_RETRY_DELAYS_MS: readonly number[] = [
  5_000, 10_000, 15_000, 20_000, 30_000, 30_000, 30_000, 45_000,
];

export const INITIAL_COMPAT_STATE: CompatFallbackState = {
  phase: 'original',
  attempt: 0,
  originalError: null,
};

const PENDING_PATTERN = /Response code:\s*503\b/i;

export type FallbackPlatform = 'android' | 'ios' | 'web' | 'windows' | 'macos' | string;

export function isDecoderUnsupported(error: unknown): boolean {
  return (
    classifyVideoPlaybackError('player_status', toVideoErrorMessage(error)) ===
    'decoder_unsupported'
  );
}

/** Reduce a player error into the next state + what the viewer should do. */
export function onCompatPlayerError(
  state: CompatFallbackState,
  error: unknown,
  platform: FallbackPlatform,
): { state: CompatFallbackState; action: CompatFallbackAction } {
  const message = toVideoErrorMessage(error);

  if (state.phase === 'original') {
    if (platform === 'android' && isDecoderUnsupported(message)) {
      return {
        state: { phase: 'compat', attempt: 1, originalError: message },
        action: { type: 'load_compat' },
      };
    }
    return { state, action: { type: 'show_error' } };
  }

  if (state.phase === 'compat' || state.phase === 'preparing') {
    const retryIndex = state.attempt - 1;
    if (PENDING_PATTERN.test(message) && retryIndex < COMPAT_RETRY_DELAYS_MS.length) {
      return {
        state: { ...state, phase: 'preparing', attempt: state.attempt + 1 },
        action: { type: 'retry_compat', delayMs: COMPAT_RETRY_DELAYS_MS[retryIndex] ?? 30_000 },
      };
    }
    return { state: { ...state, phase: 'unavailable' }, action: { type: 'show_error' } };
  }

  // compat_ready (mid-playback failure of the compat file) or unavailable.
  return { state: { ...state, phase: 'unavailable' }, action: { type: 'show_error' } };
}

/** The player reached readyToPlay. */
export function onCompatPlayerReady(state: CompatFallbackState): CompatFallbackState {
  if (state.phase === 'compat' || state.phase === 'preparing') {
    return { ...state, phase: 'compat_ready' };
  }
  return state;
}

/**
 * Which source the player should hold. Once compat has been requested it stays
 * selected even if the fallback gives up, so the original is not reloaded (and
 * re-fails) behind the error screen.
 */
export function variantForState(state: CompatFallbackState): VideoVariant {
  return state.attempt > 0 ? 'compat' : 'original';
}

/** True while the viewer should show "Preparing…" instead of an error. */
export function isRecovering(phase: CompatFallbackPhase): boolean {
  return phase === 'compat' || phase === 'preparing';
}
