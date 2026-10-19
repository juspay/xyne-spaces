import { useMemo, type ReactElement, type ReactNode } from 'react';
import { useSharedValue } from 'react-native-reanimated';

import {
  TabPagerContext,
  type TabPagerContextValue,
  type TabHeaderScrollYs,
} from '@/src/components/tab-pager/tab-pager-context';
import type { TabName } from '@/src/observability/logging/navigation/tabTransition';

const TAB_NAMES: readonly TabName[] = ['channels', 'dms', 'calls', 'activity', 'more'];

/**
 * Gives classic screens the pager context they still expect, inside the Spaces
 * shell.
 *
 * Scaffolding, with a deletion date. A classic tab screen renders only its list:
 * its title and header come from `TabPagerHeader`, which the Spaces shell does
 * not have. Without a provider those screens render headerless. Supplying a
 * compatible context lets them keep collapsing their own header until each one
 * is redesigned, at which point its view owns its header and this goes away with
 * the last of them.
 *
 * Scroll-to-top is a no-op: the Spaces bar has no tap-the-active-tab gesture.
 */
export function SpacesHeaderProvider({ children }: { children: ReactNode }): ReactElement {
  // One shared value per tab, created once. Hooks cannot be written in a loop,
  // so these are explicit rather than generated.
  const channels = useSharedValue(0);
  const dms = useSharedValue(0);
  const calls = useSharedValue(0);
  const activity = useSharedValue(0);
  const more = useSharedValue(0);

  const value = useMemo<TabPagerContextValue>(() => {
    const headerScrollYs: TabHeaderScrollYs = { channels, dms, calls, activity, more };
    return {
      activeTab: 'dms',
      tabsGroupFocused: true,
      scrollToTop: () => {},
      registerScrollToTop: () => () => {},
      headerScrollYs,
    };
  }, [activity, calls, channels, dms, more]);

  return <TabPagerContext.Provider value={value}>{children}</TabPagerContext.Provider>;
}

export { TAB_NAMES };
