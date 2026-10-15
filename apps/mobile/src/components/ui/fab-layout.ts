import { useContext } from 'react';
import { Platform } from 'react-native';

import { TabBarMetricsContext } from '@/src/hooks/tabBarMetrics';
import { useTabBarHeight } from '@/src/hooks/useTabBarHeight';

/** Breathing room between a FAB and the top of the tab bar. */
export const FAB_GAP_ABOVE_TAB_BAR = 18;

const ANDROID_FAB_BOTTOM_OFFSET = 30;

/**
 * Distance from the bottom of a tab's content to its floating action button.
 *
 * Android insets the pager above the tab bar, so a fixed offset is enough.
 * iOS draws tab content under the floating native tab bar, so the offset must
 * clear the full measured bar height plus a gap — same rule as the DMs menu FAB.
 */
export const useFabBottomOffset = (): number => {
  const { tabBarHeight } = useTabBarHeight();
  const statedBarHeight = useContext(TabBarMetricsContext).height;

  // A shell that states its bar height floats that bar over the content on both
  // platforms, so the Android shortcut below does not apply to it.
  if (statedBarHeight !== null) return statedBarHeight + FAB_GAP_ABOVE_TAB_BAR;

  return Platform.OS === 'ios' ? tabBarHeight + FAB_GAP_ABOVE_TAB_BAR : ANDROID_FAB_BOTTOM_OFFSET;
};

/**
 * Distance from the bottom of the screen to a FAB rendered in the tab overlay
 * portal above the header and tab bar. The pager inset no longer lifts the
 * button on Android, so the tab bar height must be included explicitly.
 */
export const useFabScreenBottomOffset = (): number => {
  const { tabBarHeight } = useTabBarHeight();
  const statedBarHeight = useContext(TabBarMetricsContext).height;

  if (statedBarHeight !== null) return statedBarHeight + FAB_GAP_ABOVE_TAB_BAR;

  const gap = Platform.OS === 'android' ? ANDROID_FAB_BOTTOM_OFFSET : FAB_GAP_ABOVE_TAB_BAR;
  return tabBarHeight + gap;
};

/**
 * Legacy helper kept for non-React call sites. Prefer `useFabBottomOffset` in
 * tab screens so iOS uses the measured tab bar height.
 */
export const getFabBottomOffset = (safeAreaBottom: number): number =>
  Platform.OS === 'ios'
    ? safeAreaBottom + 40 + 16 + FAB_GAP_ABOVE_TAB_BAR
    : ANDROID_FAB_BOTTOM_OFFSET;
