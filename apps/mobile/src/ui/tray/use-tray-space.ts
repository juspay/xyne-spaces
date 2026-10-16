import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TRAY_BOTTOM_LIFT, TRAY_GRAB_HEIGHT, TRAY_MAX_HEIGHT_RATIO } from './constants';

/**
 * How much room a view's body may take before the sheet hits its ceiling.
 *
 * A scrollable body has to be given a height — unbounded inside an auto-sizing
 * sheet it reports zero and collapses it. Computing that height from a guess is
 * what pushed the footer off the bottom: the sheet clamped, the body kept its
 * fixed height, and the footer was the part that got clipped.
 *
 * `reservedHeight` is everything the view draws around its scroller — a header,
 * a footer, their margins.
 */
export function useTrayBodySpace(reservedHeight: number): number {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const ceiling = height * TRAY_MAX_HEIGHT_RATIO - insets.top - insets.bottom - TRAY_BOTTOM_LIFT;

  return Math.max(0, ceiling - TRAY_GRAB_HEIGHT - reservedHeight);
}
