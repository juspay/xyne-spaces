import { useValue } from '@legendapp/state/react';
import {
  type ComponentProps,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { Tabs, useRouter, type Href } from 'expo-router';
import { ChevronsIcon } from '../icons';
import { searchField$, writeSearchQuery } from '@/src/features/global-search/search-field-bridge';

import { SPACES_INITIAL_TAB } from '@/src/navigation/routes';

import { entryHref, tabEntries, tabEntryForRoute } from '../model/catalog';
import { shouldLeaveHiddenTab } from '../model/hidden-tab-redirect';
import type { SearchFieldBinding } from './search-field';
import { tabLayout$ } from '../state/layout-store';
import { MIN_VISIBLE_TABS } from '../model/layout';
import { useTabBadgeCounts } from '../hooks/use-badge-counts';
import { formatCountLabel } from '@/src/utils/countLabel';
import { beginTabTransition } from '@/src/observability/logging/navigation/tabTransition';

import { navIcon, type NavIcon } from './nav-icon';
import { TabBar } from './tab-bar';
import { usePreloadTabs } from '../hooks/use-preload-tabs';

type TabsProps = ComponentProps<typeof Tabs>;
type TabBarRenderer = NonNullable<TabsProps['tabBar']>;
type AppTabBarProps = Parameters<TabBarRenderer>[0];

export enum TabScreens {
  Channels = 'channels',
  Dms = 'dms',
  Calls = 'calls',
  Activity = 'activity',
  Search = 'search',
  Threads = 'threads',
  MorningBrief = 'morning-brief',
  Bookmarks = 'bookmarks',
  DraftsSent = 'drafts-sent',
  XyneDesks = 'xyne-desks',
}

/** Last pill. Opens the menu rather than a screen, so it has no destination. */
const MENU_TRIGGER_ICON: NavIcon = navIcon(ChevronsIcon);

function badgeLabel(count: number): string | null {
  return count > 0 ? formatCountLabel(count) : null;
}

export type AppTabBarExtraProps = {
  /** Opens the customize surface. The shell owns it, because it owns the tray. */
  onCustomize: () => void;
};

export function AppTabBar({
  state,
  navigation,
  onCustomize,
}: AppTabBarProps & AppTabBarExtraProps): ReactElement {
  const router = useRouter();
  const currentRoute = state.routes[state.index];
  const routeName = currentRoute?.name ?? '';
  const isSearchRoute = routeName === TabScreens.Search;

  // The pill's gestures are memoised against their callbacks. Reading the route
  // through a ref keeps this identity stable, so a re-render mid-touch cannot
  // rebuild them and drop the `onFinalize` that releases the press state.
  const routeNameRef = useRef(routeName);
  routeNameRef.current = routeName;

  // Where closing search returns to, and which category it opens on. Search is
  // a destination like any other tab, so without this the close button would
  // have to guess, and `backBehavior: 'firstRoute'` would land on DMs whatever
  // the user was actually looking at.
  const lastNonSearchRouteRef = useRef<string>(TabScreens.Dms);
  if (routeName !== '' && !isSearchRoute) {
    lastNonSearchRouteRef.current = routeName;
  }

  /**
   * Everything the bar shows comes from here: the pills are the first three
   * visible destinations, and the menu lists all of them. Hidden ones keep
   * their routes — they are simply not offered.
   */
  /*
   * `useValue`, never `use$`.
   *
   * They are the same function under two names, but React only recognises a
   * hook by its name — `use` followed by an uppercase letter or digit. `$` is
   * neither, so React Compiler (enabled in `app.config.js`) compiles
   * `use$(...)` to a one-time call cached behind a memo sentinel: it runs on
   * first render, never re-subscribes, and every value derived from it freezes
   * with it. Legend State deprecated `use$` for exactly this in beta.20.
   */
  const visible = useValue(tabLayout$.visible);
  const menuItems = useMemo(() => tabEntries(visible), [visible]);
  const pillEntries = useMemo(() => menuItems.slice(0, MIN_VISIBLE_TABS), [menuItems]);

  const icons = useMemo(
    () => [...pillEntries.map(entry => entry.icon), MENU_TRIGGER_ICON],
    [pillEntries],
  );

  /**
   * Memoised because it reaches a worklet: a new array each render would
   * rebuild `commitTab`, and with it the pill's gestures, mid-touch.
   */
  const pillSwitchesTab = useMemo(
    () => pillEntries.map(entry => entry.routeName !== undefined),
    [pillEntries],
  );

  const labels = useMemo(
    () => [...pillEntries.map(entry => entry.label), 'More destinations'],
    [pillEntries],
  );

  /**
   * Mounted ahead of the first tap so a switch costs a visibility flip rather
   * than a mount. Search joins the pills because the field that drives it lives
   * in the bar, and a mount between a keystroke and its results would be the
   * one stall the user cannot miss. The menu destinations stay lazy — they are
   * reached rarely and would cost startup memory for nothing.
   */
  const preloadedRoutes = useMemo(
    () => [
      ...pillEntries.flatMap(entry => (entry.routeName ? [entry.routeName as string] : [])),
      TabScreens.Search as string,
    ],
    [pillEntries],
  );
  usePreloadTabs(navigation, preloadedRoutes);

  const counts = useTabBadgeCounts();
  const badgeLabels = useMemo(
    () => [
      ...pillEntries.map(entry => (entry.badge ? badgeLabel(counts[entry.badge]) : null)),
      // The menu trigger is never badged: it stands for every other
      // destination, and a count that could belong to any of them says nothing
      // the user can act on.
      null,
    ],
    [counts, pillEntries],
  );

  const menuBadgeLabels = useMemo(() => {
    const labels: Record<string, string | null> = {};
    for (const entry of menuItems) {
      labels[entry.id] = entry.badge ? badgeLabel(counts[entry.badge]) : null;
    }
    return labels;
  }, [counts, menuItems]);

  const activeEntry = tabEntryForRoute(routeName);
  const pillIndex = activeEntry ? pillEntries.findIndex(entry => entry.id === activeEntry.id) : -1;

  const handleMenuSelect = useCallback(
    (href: Href) => {
      router.push(href);
    },
    [router],
  );

  const handleTabChange = useCallback(
    (index: number) => {
      const entry = pillEntries[index];
      if (!entry) return;

      // Not every destination is a tab screen — Canvas, Recordings and Report
      // issue live in the stack — and any of them can be dragged into a pill.
      // Those get pushed; only a real tab route can be switched to.
      if (!entry.routeName) {
        const href = entryHref(entry);
        if (href !== null) router.push(href);
        return;
      }

      if (routeNameRef.current === entry.routeName) return;
      // T0 of the switch. `useReportTabReady` on the destination closes it, and
      // without this the pair never opens and nothing is logged.
      beginTabTransition(routeNameRef.current, entry.routeName);
      navigation.navigate(entry.routeName);
    },
    [navigation, pillEntries, router],
  );

  /**
   * Leaves a hidden tab, but only when the user did not ask to be on it.
   *
   * Hiding the tab you are standing on strands you: the route stays mounted
   * but loses its pill and its menu row, so nothing leads back to it. That is
   * worth a redirect.
   *
   * Arriving deliberately is not. This effect reruns on every route change, so
   * redirecting on "current route is hidden" alone silently swallowed every
   * link to a hidden tab — Activity from the chat header, Calls from the
   * call screens, the search result routes. The user tapped a link and nothing
   * happened.
   *
   * So the two cases are separated by comparing against the previous layout:
   * a tab that was visible a moment ago and is not now was hidden under the
   * user. Anything else is a destination they chose, and the bar copes — the
   * menu trigger still shows that tab's icon, since `activeEntry` comes from
   * the catalog rather than from `visible`.
   */
  const previousVisibleRef = useRef<readonly string[] | null>(null);
  useEffect(() => {
    const previousVisible = previousVisibleRef.current;
    previousVisibleRef.current = visible;

    if (isSearchRoute) return;

    const shouldLeave = shouldLeaveHiddenTab({
      activeId: activeEntry?.id ?? '',
      routeName,
      visible,
      previousVisible,
      initialTab: SPACES_INITIAL_TAB,
    });
    if (!shouldLeave) return;

    const fallback = pillEntries[0]?.routeName;
    if (fallback) navigation.navigate(fallback);
  }, [activeEntry?.id, isSearchRoute, navigation, pillEntries, routeName, visible]);

  const handleSearchOpen = useCallback(() => {
    // Part 1b seeds `globalSearchStore` here with the category the current tab
    // implies, and begins the search critical window, before navigating.
    navigation.navigate(TabScreens.Search);
  }, [navigation]);

  /**
   * Binds the bar's field to the search screen's query.
   *
   * Only while that screen is actually hosting — otherwise the pill would morph
   * into a field with nothing behind it, which is what made it look like an
   * input and behave like a button.
   */
  const searchHosted = useValue(searchField$.hosted);
  const searchQuery = useValue(searchField$.query);
  const searchPlaceholder = useValue(searchField$.placeholder);
  const searchBinding = useMemo<SearchFieldBinding | undefined>(
    () =>
      searchHosted
        ? {
            value: searchQuery,
            placeholder: searchPlaceholder,
            onChangeText: writeSearchQuery,
          }
        : undefined,
    [searchHosted, searchPlaceholder, searchQuery],
  );

  const handleSearchClose = useCallback(() => {
    navigation.navigate(lastNonSearchRouteRef.current);
  }, [navigation]);

  return (
    <View pointerEvents='box-none' style={StyleSheet.absoluteFill}>
      <TabBar
        activeIndex={pillIndex}
        icons={icons}
        labels={labels}
        badgeLabels={badgeLabels}
        pillSwitchesTab={pillSwitchesTab}
        menuItems={menuItems}
        menuBadgeLabels={menuBadgeLabels}
        menuDestinationIcon={pillIndex === -1 ? (activeEntry?.icon ?? null) : null}
        activeMenuId={activeEntry?.id ?? null}
        isSearchRoute={isSearchRoute}
        searchBinding={searchBinding}
        onTabChange={handleTabChange}
        onMenuSelect={handleMenuSelect}
        onSearchOpen={handleSearchOpen}
        onSearchClose={handleSearchClose}
        onCustomize={onCustomize}
      />
    </View>
  );
}
