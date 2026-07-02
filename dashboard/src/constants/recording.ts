/**
 * Recording UI constants.
 *
 * Waveform animation defaults for the two recording surfaces — the floating
 * RecordingOverlay and the /recordings RecordingControlBar. Centralized here so
 * both surfaces animate identically; individual call sites may still override a
 * value per instance.
 */
export const WAVEFORM_DEFAULTS = {
  overlay: { barCount: 16, durationSec: 0.6, staggerSec: 0.04 },
  bar: { barCount: 3, durationSec: 0.5, staggerSec: 0.1 },
} as const;

export type WaveformVariant = keyof typeof WAVEFORM_DEFAULTS;
