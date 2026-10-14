import { useSpacesTabBarHeight } from '@/src/features/bottom-navigation';
import { SEARCH_BUTTON_SIZE } from '@/src/features/bottom-navigation/constants';

import { FAB_GAP } from '../constants';

/** Air between the last row and the button, so it is not flush against it. */
const FAB_CONTENT_MARGIN = 16;

/**
 * How far a list must be padded at the bottom for its last row to scroll
 * clear of the quick-action button.
 *
 * The button floats over the scene above the bar, so a list padded for the bar
 * alone ends with its final row directly under the button — covering that
 * row's timestamp and badge. This is the bar, the gap the button sits above
 * it, the button, and a margin. Derived from the same constants that place the
 * button, so the two cannot drift apart.
 */
export function useFabClearance(): number {
  const barHeight = useSpacesTabBarHeight();
  return barHeight + FAB_GAP + SEARCH_BUTTON_SIZE + FAB_CONTENT_MARGIN;
}
