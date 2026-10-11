/**
 * Deck palette and metrics.
 *
 * Fixed dark, like the login hero it follows — onboarding is a single designed moment and does not
 * track the app's light/dark setting.
 */

export const deckPalette = {
  background: '#060606',
  /** The front card. */
  card: '#1C1C1C',
  /** The rotated cards stacked behind it. */
  cardGhost: '#141414',
  /** Unselected option rows, inputs, connector rows. */
  row: '#262626',
  /** A selected option row, and the forward button. */
  selected: '#FFFFFF',
  selectedText: '#0A0A0A',
  textPrimary: '#FFFFFF',
  textSecondary: '#9A9A9A',
  textMuted: '#6E6E6E',
  accent: '#FF4F4F',
  dotInactive: '#3A3A3A',
} as const;

export const deckMetrics = {
  gutter: 24,
  cardRadius: 24,
  cardPadding: 24,
  rowRadius: 24,
  rowHeight: 48,
  /** Share of the viewport the card occupies, measured from the design. */
  cardHeightRatio: 0.46,
  cardTopRatio: 0.14,
  nextButtonSize: 56,
} as const;

/** The cards peeking out behind the front one: a little turned, a little lower, a little dimmer. */
export const DECK_GHOSTS = [
  { rotate: '2.2deg', translateX: 5, translateY: 6, opacity: 0.6 },
  { rotate: '-1.8deg', translateX: 11, translateY: 13, opacity: 0.45 },
  { rotate: '3.2deg', translateX: 15, translateY: 20, opacity: 0.3 },
] as const;
