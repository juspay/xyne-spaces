/**
 * Design tokens for the in-call experience.
 *
 * The call surface is always dark (regardless of the app theme) — same as the
 * dashboard's call UI, whose palette these tokens mirror — so nothing here reads
 * from the uniwind theme. Keep new call UI on these tokens instead of hardcoding
 * hex values so the whole surface stays coherent.
 */

export const callColors = {
  /** Base of the call surface. */
  stage: '#131314',
  /** Sheets, popovers, tile placeholders. */
  surface: '#1e1f20',
  surfaceRaised: '#2a2b2d',
  /** Neutral control fill on the dark surface. */
  control: 'rgba(255,255,255,0.12)',
  controlPressed: 'rgba(255,255,255,0.2)',
  /** Floating control bar / chips over video. */
  hairline: 'rgba(255,255,255,0.1)',

  textPrimary: '#f2f2f3',
  textSecondary: '#c4c7c5',
  textMuted: '#9aa0a6',

  /** Toggled-on / "active" control (screen share on, speaker on). */
  active: '#a8c7fa',
  onActive: '#062e6f',
  /** Toggled-off control (mic muted, camera off) — inverted so it reads as a state. */
  inverted: '#f2f2f3',
  onInverted: '#131314',

  danger: '#dc362e',
  dangerPressed: '#e3554e',
  success: '#34c759',
  warning: '#f5a524',
  speaking: '#8ab4f8',

  ai: '#9333ea',
  aiControlled: '#d97706',
  /** Deep purple the AI agent's camera-off tile fades from. */
  aiWash: '#2b1746',

  /** Text / icons drawn on a coloured fill (buttons, badges). */
  onColor: '#FFFFFF',
  /** Disc behind the "speaking" audio bars — the dashboard's Meet blue. */
  speakingBadge: '#1A73E8',
  /** Destructive text (e.g. "Reconnecting…" failures) readable on the dark stage. */
  dangerText: '#ff6b62',
  /** The incoming-call screen's answer / decline buttons and ring (match the lock screen). */
  accept: '#22C55E',
  decline: '#EF4444',
  ringVideo: '#3B82F6',
  /** Bottom-sheet drag handle. */
  sheetHandle: 'rgba(255,255,255,0.28)',
} as const;

/** `#rrggbb` → `rgba(r,g,b,alpha)`, so tinted variants derive from a single token. */
export function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

/**
 * Frosted-glass surfaces (chips, badges, buttons, the control bar) — the dashboard's
 * `bg-black/50 backdrop-blur ring-white/15` look. Android can't blur a native video surface,
 * so it gets a denser fill to stay legible over bright video.
 */
export const callGlass = {
  intensity: 68,
  overlay: 'rgba(16,17,19,0.52)',
  overlayAndroid: 'rgba(24,25,27,0.72)',
  /** What GlassPanel amounts to on Android (the blur's fallback tint under `overlayAndroid`), as
   * one colour — for surfaces drawn as a plain fill instead of a clipped panel. */
  fillAndroid: 'rgba(24,25,27,0.87)',
  border: 'rgba(255,255,255,0.2)',
} as const;

export const callRadii = {
  tile: 16,
  tileCompact: 12,
  pip: 18,
  bar: 34,
  sheet: 24,
} as const;

/** Reanimated spring / timing presets shared across the call UI. */
export const callMotion = {
  /** Tile frames morphing between stage layouts. */
  layoutMs: 280,
  /** Chrome (header + control bar) show / hide. */
  chromeMs: 220,
  /** State-text cross-fades. */
  fadeMs: 180,
  /** A control button's fill snapping to its new state (mic muted, camera off, …). Short and
   * linear on purpose — this is a state change the user just caused by tapping, not decor, so it
   * should read as an immediate response rather than a fade. */
  controlToneMs: 90,
  /** Tap feedback on controls. */
  pressSpring: { damping: 18, stiffness: 320, mass: 0.6 },
  /** PiP snapping to a corner. */
  pipSpring: { damping: 22, stiffness: 260, mass: 0.8 },
  /** Idle time in immersive video before the chrome tucks away. */
  chromeAutoHideMs: 5000,
} as const;

export const callLayout = {
  headerHeight: 64,
  controlBarHeight: 74,
  controlBarMargin: 14,
  stageGap: 8,
  stagePadding: 10,
  pipWidth: 108,
  pipHeight: 152,
  pipMargin: 12,
  stripTileWidth: 64,
  stripTileHeight: 86,
} as const;
