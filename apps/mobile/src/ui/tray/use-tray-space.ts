import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TRAY_BOTTOM_OFFSET, TRAY_TOP_INSET } from './constants';

/**
 * How much room a view's scroller may take before the sheet hits its ceiling.
 *
 * Morphlet sizes the card to its content and clamps it to the window minus the
 * safe top, its top inset and its bottom offset. A drag list that measures
 * itself from its parent needs the same number to hand to its own container.
 *
 * `reservedHeight` is everything the view draws around the scroller — a
 * header, a footer, their margins.
 */
export function useTrayBodySpace(reservedHeight: number): number {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const ceiling = height - insets.top - TRAY_TOP_INSET - TRAY_BOTTOM_OFFSET;

  return Math.max(0, ceiling - reservedHeight);
}
