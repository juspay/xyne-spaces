import {
  MIN_GRAPHIC_CONTRAST,
  MIN_TEXT_CONTRAST,
  contrastBetween,
  ensureContrast,
  isDarkSurface,
  readableTextOn,
  withAlpha,
} from '@/src/theme/accent-contrast';
import { deriveChatBubbleContentTokens } from '@/src/theme/chatBubbleContentTokens';

const WHITE_LABEL = '#ffffff';
const NEAR_BLACK_LABEL = '#111827';

export type BubbleAccent = {
  /** Solid fill for primary CTAs. Clears 3:1 against the surface it sits on. */
  accentBg: string;
  /** Label colour for text drawn on `accentBg`. */
  accentFg: string;
  /** Tinted background for selected chips and soft highlights. */
  accentSoft: string;
  /** Accent-coloured text or icons drawn directly on the surface. Clears 4.5:1. */
  accentText: string;
};

/**
 * Brand accent derived from the user's chosen chat bubble colour.
 *
 * The bubble palette is designed to sit *behind* message text, so several
 * entries are near-white or near-black. Used raw as a button fill they are
 * unreadable, so every value here is pinned to a contrast floor against the
 * surface it will actually be drawn on. `accentText` uses the stricter text
 * threshold because thin glyphs need more separation than solid shapes.
 */
export const deriveBubbleAccent = (
  bubbleBg: string,
  theme: string,
  surface: string,
): BubbleAccent => {
  const base = deriveChatBubbleContentTokens(bubbleBg, theme).ambientActionBg;
  let accentBg = ensureContrast(base, surface, MIN_GRAPHIC_CONTRAST);

  // Clearing the surface pins only one side: a mid-lightness fill can leave both
  // white and near-black short of the text threshold, so the fill has to move
  // away from its label too.
  //
  // The label is chosen from the *surface*, not from the fill. The fill always
  // moves away from the surface, so a label on the surface's side of the
  // lightness scale pulls it the same way and both floors converge. Picking the
  // label from the fill can pick one on the opposite side — a white label over a
  // mid-grey track darkens the fill back toward that track and silently breaks
  // the graphic floor.
  let accentFg = isDarkSurface(surface) ? NEAR_BLACK_LABEL : WHITE_LABEL;
  if (contrastBetween(accentFg, accentBg) < MIN_TEXT_CONTRAST) {
    accentBg = ensureContrast(accentBg, accentFg, MIN_TEXT_CONTRAST);
  }
  // A fill can still end up better paired with the other label once it settles.
  if (contrastBetween(readableTextOn(accentBg), accentBg) > contrastBetween(accentFg, accentBg)) {
    accentFg = readableTextOn(accentBg);
  }

  return {
    accentBg,
    accentFg,
    accentSoft: withAlpha(accentBg, theme === 'dark' ? 0.22 : 0.14),
    accentText: ensureContrast(base, surface, MIN_TEXT_CONTRAST),
  };
};
