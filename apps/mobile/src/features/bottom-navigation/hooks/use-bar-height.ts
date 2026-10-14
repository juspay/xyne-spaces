import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PILL_HEIGHT, TAB_BAR_BOTTOM_PADDING, TAB_BAR_LIFT } from '../constants';

/**
 * How much of the screen the floating bar occupies, measured from the bottom.
 *
 * React Navigation cannot answer this for us. The bar is a custom `tabBar`
 * drawn with `StyleSheet.absoluteFill` so the menu and its backdrop can cover
 * the screen, which makes its laid-out height zero — and
 * `BottomTabBarHeightContext` reports that zero to anything asking how far to
 * sit above the bar.
 *
 * The same expression `TabBar` uses for its own padding, kept here so the two
 * cannot drift.
 */
export function useSpacesTabBarHeight(): number {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom * 0.7, TAB_BAR_BOTTOM_PADDING);
  return PILL_HEIGHT + bottomPadding + TAB_BAR_LIFT;
}
