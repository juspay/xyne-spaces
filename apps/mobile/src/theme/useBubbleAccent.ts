import { useContext } from 'react';

import { BubbleAccentContext } from '@/src/theme/bubbleAccentContext';
import { deriveBubbleAccent, type BubbleAccent } from '@/src/theme/bubbleAccent';
import { DEFAULT_CHAT_BUBBLE_OPTION } from '@/src/theme/chatBubbleTheme';

/**
 * Stand-in for trees rendered outside `BubbleAccentProvider`, derived from the
 * default bubble so it still clears the contrast floors.
 *
 * Computed on first use rather than at module load: this module is reachable from
 * the root layout, and startup should not pay for a value that a correctly
 * mounted provider never reads.
 */
let fallbackAccent: BubbleAccent | null = null;

const getFallbackAccent = (): BubbleAccent => {
  fallbackAccent ??= deriveBubbleAccent(DEFAULT_CHAT_BUBBLE_OPTION.lightColor, 'light', '#ffffff');
  return fallbackAccent;
};

/**
 * Brand accent for CTAs, following Settings → Chat theme → Bubble colour.
 *
 * A context read — no subscriptions and no colour maths per call site, so this is
 * safe inside recycled list rows. Everything it imports is pure, so pulling it
 * into a component does not drag `uniwind` along with it.
 */
export const useBubbleAccent = (): BubbleAccent =>
  useContext(BubbleAccentContext) ?? getFallbackAccent();
