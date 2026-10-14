import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { TabName } from '@/src/observability/logging/navigation/tabTransition';

export type TabHeaderScrollYs = Record<TabName, SharedValue<number>>;

export type TabPagerContextValue = {
  activeTab: TabName;
  tabsGroupFocused: boolean;
  scrollToTop: (tab: TabName) => void;
  registerScrollToTop: (tab: TabName, scrollToTop: () => void) => () => void;
  headerScrollYs: TabHeaderScrollYs;
};

export const TabPagerContext = createContext<TabPagerContextValue | null>(null);

export type TabPageFocusValue = {
  tabName: TabName;
  isFocused: boolean;
};

export const TabPageFocusContext = createContext<TabPageFocusValue | null>(null);

export function useTabPager(): TabPagerContextValue {
  const value = useContext(TabPagerContext);
  if (value === null) {
    throw new Error('useTabPager must be used inside TabPager');
  }
  return value;
}

/**
 * The pager when one is mounted, `null` otherwise.
 *
 * Shared components — the DM and channel lists especially — render under both
 * the pager shell and the new one. They ask for pager features optionally so a
 * missing pager degrades the feature instead of crashing the screen.
 */
export function useOptionalTabPager(): TabPagerContextValue | null {
  return useContext(TabPagerContext);
}

export function TabPageFocus({
  tabName,
  isFocused,
  children,
}: {
  tabName: TabName;
  isFocused: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ tabName, isFocused }), [isFocused, tabName]);
  return <TabPageFocusContext.Provider value={value}>{children}</TabPageFocusContext.Provider>;
}

/**
 * The shared value a tab's list writes its scroll offset into, which the shell's
 * header reads to collapse its title.
 *
 * It is a channel between two owners — the list writes, the header reads — so it
 * belongs to whichever shell renders that header. Under a shell that renders no
 * collapsing header, this returns a detached value: the list still scrolls and
 * still reports, nothing listens.
 */
export function useTabHeaderScrollY(): SharedValue<number> {
  const pager = useOptionalTabPager();
  const page = useContext(TabPageFocusContext);
  const detached = useSharedValue(0);
  return pager !== null && page !== null ? pager.headerScrollYs[page.tabName] : detached;
}
