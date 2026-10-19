import { createContext } from 'react';

export type TabBarMetrics = {
  /**
   * Height of the tab bar, when the shell can state it directly.
   *
   * `null` means fall back to `BottomTabBarHeightContext`, which is right for
   * the classic shell. The Spaces bar is a custom `tabBar` drawn with
   * `StyleSheet.absoluteFill`, so React Navigation measures it as zero and
   * anything positioning itself above the bar lands inside it.
   */
  height: number | null;
};

export const TabBarMetricsContext = createContext<TabBarMetrics>({ height: null });
