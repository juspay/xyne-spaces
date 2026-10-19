import { type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';

import { AppHeader } from '@/src/components/app-header';
import { TabPageFocus, useTabHeaderScrollY } from '@/src/components/tab-pager/tab-pager-context';
import { TabsHeaderChromeContext, TabsScreenHeader } from '@/src/components/tabs-screen-header';
import { tabEntryForRoute } from '@/src/features/bottom-navigation';
import type { TabName } from '@/src/observability/logging/navigation/tabTransition';

/**
 * Header for a classic screen running inside the Spaces shell.
 *
 * In the classic shell one `TabPagerHeader` sits above the pager and serves
 * every page. The Spaces shell has no pager, so each scene brings its own —
 * which is also the direction the redesign goes: in the new design the header
 * belongs to the screen, not to the chrome.
 *
 * No search bar. Search moved into the bottom bar, so the dummy field the
 * classic header carries would be a second way to reach the same place.
 */
function SpacesHeader({ title }: { title: string }): ReactElement {
  const scrollY = useTabHeaderScrollY();

  return (
    <TabsScreenHeader scrollY={scrollY}>
      <TabsScreenHeader.Leading>
        <AppHeader.WorkspaceSwitcher />
        <AppHeader.Title>{title}</AppHeader.Title>
      </TabsScreenHeader.Leading>
      <TabsScreenHeader.Trailing>
        <AppHeader.ConnectionStatus />
        <AppHeader.UserGuide />
        <AppHeader.UserProfile />
      </TabsScreenHeader.Trailing>
    </TabsScreenHeader>
  );
}

/** Search lives in the bottom bar here, so the header carries no field. */
const NO_SEARCH_BAR = { hasSearchBar: false } as const;

export type SpacesTabScreenProps = {
  tab: TabName;
  /** Falls back to the catalog label, so the bar and the header cannot drift. */
  title?: string;
  children: ReactNode;
};

/**
 * Wraps a classic tab screen with the focus context it expects and a header.
 *
 * `TabPageFocus` is what lets the screen's own `useTabHeaderScrollY()` resolve
 * to the same shared value this header reads — the list writes its scroll
 * offset, the header collapses. Without it the screen renders headerless and
 * the collapse does nothing.
 */
export function SpacesTabScreen({ tab, title, children }: SpacesTabScreenProps): ReactElement {
  const label = title ?? tabEntryForRoute(tab)?.label ?? '';

  /**
   * React Navigation's own focus, not a hardcoded `true`.
   *
   * `useTabPageIsFocused` prefers this context over `useIsFocused()` whenever
   * the context exists — the classic pager needs that, because all five of its
   * pages are mounted and navigation considers the whole group focused. Here the
   * navigator already tracks the selected tab, so the honest answer is its own.
   *
   * Passing `true` told every preloaded screen it was in front, and each one
   * rendered its floating action button into the shared overlay host at once:
   * the Channels FAB showed up on DMs, Activity and Calls, stacked over
   * whichever one belonged there.
   */
  const isFocused = useIsFocused();

  return (
    <TabsHeaderChromeContext.Provider value={NO_SEARCH_BAR}>
      <TabPageFocus tabName={tab} isFocused={isFocused}>
        <View className='flex-1 bg-tabs-screen'>
          <SpacesHeader title={label} />
          {children}
        </View>
      </TabPageFocus>
    </TabsHeaderChromeContext.Provider>
  );
}
