/**
 * Palette for the signed-out hero screen.
 *
 * Deliberately hard-coded rather than read from `--color-auth-*`: the design is a fixed dark
 * canvas that does not follow the app's light/dark setting, so a user on the light theme still
 * sees the same artwork.
 */
export const loginPalette = {
  /** Page canvas. */
  background: '#060606',
  /** Raised artifact card. */
  surface: '#1A1A1A',
  /** Reaction pills, provider buttons' inner chips. */
  surfaceRaised: '#242424',
  /** Channel tags. */
  chip: '#2A2A2A',
  chipText: '#CFCFCF',
  textPrimary: '#FFFFFF',
  textBody: '#E6E6E6',
  textSecondary: '#8D8D8D',
  textMuted: '#6B6B6B',
  /** `@name` pill inside a message body. */
  mentionBackground: 'rgba(255, 138, 61, 0.18)',
  mentionText: '#FFA869',
  accent: '#FF4F4F',
} as const;

/** Diagonal wash behind the highlighted headline word — red body, warm amber corner. */
export const HIGHLIGHT_COLORS = ['#FF9242', '#FF5A47', '#FF4F4F'] as const;
export const HIGHLIGHT_LOCATIONS = [0, 0.42, 1] as const;

/** Slightly larger amber layer behind the highlight, which reads as a glow on its edges. */
export const HIGHLIGHT_GLOW_COLORS = ['#FFC56B', '#FF8A3D', '#FFAE43'] as const;

/** Side gutter shared by the artwork and the footer, so the cards and the headline line up. */
export const LOGIN_GUTTER = 22;

/**
 * Inset of the headline's text from the edge of its highlight block. Plain lines carry it as
 * padding so their glyphs start on the same vertical as the highlighted line's.
 */
export const HIGHLIGHT_TEXT_INSET = 6;
