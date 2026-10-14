import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useNavigation, useRouter, useSegments } from 'expo-router';
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import { useSharedValue } from 'react-native-reanimated';

import { useTabBarHeight } from '@/src/hooks/useTabBarHeight';

import {
  beginTabTransition,
  isTabName,
  TAB_SCREEN_NAMES,
  type TabName,
} from '@/src/observability/logging/navigation/tabTransition';
import { haptics } from '@/src/utils/haptics';

import ActivityScreen from '@/src/screens/tabs/activity-screen';
import CallsScreen from '@/src/screens/tabs/calls-screen';
import ChannelsScreen from '@/src/screens/tabs/channels-screen';
import DmsScreen from '@/src/screens/tabs/dms-screen';
import MoreScreen from '@/src/screens/tabs/more-screen';

import { PortalHost } from '@/src/components/primitives/portal';

import { tabRoute } from '@/src/navigation/routes';
import { TabPageFocus, TabPagerContext } from './tab-pager-context';
import { TabPagerHeader } from './tab-pager-header';
import { TAB_OVERLAY_PORTAL_HOST } from './tab-overlay-portal';

const TAB_HREF = {
  channels: tabRoute('channels'),
  dms: tabRoute('dms'),
  calls: tabRoute('calls'),
  activity: tabRoute('activity'),
  // Safe where `overflowTabPath` is not: the pager is mounted only by
  // `(tabs)/_layout.tsx`, so this never resolves under the Spaces shell, which
  // has no `more` route.
  more: tabRoute('more'),
} as const;

const TAB_SCREENS: Record<TabName, ComponentType> = {
  channels: ChannelsScreen,
  dms: DmsScreen,
  calls: CallsScreen,
  activity: ActivityScreen,
  more: MoreScreen,
};

const indexOfTab = (tab: TabName): number => TAB_SCREEN_NAMES.indexOf(tab);

const neighborTabs = (tab: TabName): TabName[] => {
  const index = indexOfTab(tab);
  const names: TabName[] = [tab];
  const previous = TAB_SCREEN_NAMES[index - 1];
  const next = TAB_SCREEN_NAMES[index + 1];
  if (previous) names.push(previous);
  if (next) names.push(next);
  return names;
};

type TabPagerProps = {
  children: ReactNode;
};

const useStickyActiveTab = (): TabName => {
  const segments = useSegments();
  const tabFromRoute = segments.find(segment => isTabName(segment));
  const lastTabRef = useRef<TabName>(tabFromRoute ?? 'dms');
  // Pushing a stack screen (Xyne Desks, chat, …) drops the tab name from
  // segments. Keep the last tab so the pager does not snap back to DMs.
  // `find` returns `undefined` (not `null`) when nothing matches — only
  // write when we actually have a tab name.
  if (isTabName(tabFromRoute)) {
    lastTabRef.current = tabFromRoute;
  }
  return lastTabRef.current;
};

export function TabPager({ children }: TabPagerProps): ReactElement {
  const router = useRouter();
  const navigation = useNavigation();
  const activeTab = useStickyActiveTab();
  const { tabBarHeight } = useTabBarHeight();
  const pagerRef = useRef<PagerView>(null);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const syncFromPagerRef = useRef(false);
  const isFirstRouteSyncRef = useRef(true);
  const lastDrivenIndexRef = useRef(indexOfTab(activeTab));
  const scrollToTopByTab = useRef<Partial<Record<TabName, () => void>>>({});

  const [tabsGroupFocused, setTabsGroupFocused] = useState(() => navigation.isFocused());
  const [mountedTabs, setMountedTabs] = useState<ReadonlySet<TabName>>(
    () => new Set(neighborTabs(activeTab)),
  );

  const channelsHeaderScrollY = useSharedValue(0);
  const dmsHeaderScrollY = useSharedValue(0);
  const callsHeaderScrollY = useSharedValue(0);
  const activityHeaderScrollY = useSharedValue(0);
  const moreHeaderScrollY = useSharedValue(0);
  const headerScrollYs = useMemo(
    () => ({
      channels: channelsHeaderScrollY,
      dms: dmsHeaderScrollY,
      calls: callsHeaderScrollY,
      activity: activityHeaderScrollY,
      more: moreHeaderScrollY,
    }),
    [
      activityHeaderScrollY,
      callsHeaderScrollY,
      channelsHeaderScrollY,
      dmsHeaderScrollY,
      moreHeaderScrollY,
    ],
  );

  useEffect(() => {
    setTabsGroupFocused(navigation.isFocused());
    const unsubscribeFocus = navigation.addListener('focus', () => setTabsGroupFocused(true));
    const unsubscribeBlur = navigation.addListener('blur', () => setTabsGroupFocused(false));
    return () => {
      unsubscribeFocus();
      unsubscribeBlur();
    };
  }, [navigation]);

  const mountAround = useCallback((tab: TabName) => {
    setMountedTabs(previous => {
      const next = new Set(previous);
      let changed = false;
      for (const name of neighborTabs(tab)) {
        if (!next.has(name)) {
          next.add(name);
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, []);

  useEffect(() => {
    mountAround(activeTab);
  }, [activeTab, mountAround]);

  const jumpToPage = useCallback(
    (tab: TabName) => {
      const index = indexOfTab(tab);
      if (index < 0) return;
      mountAround(tab);
      lastDrivenIndexRef.current = index;
      activeTabRef.current = tab;
      pagerRef.current?.setPageWithoutAnimation(index);
    },
    [mountAround],
  );

  const scrollToTop = useCallback((tab: TabName) => {
    scrollToTopByTab.current[tab]?.();
  }, []);

  const registerScrollToTop = useCallback((tab: TabName, onScrollToTop: () => void) => {
    scrollToTopByTab.current[tab] = onScrollToTop;
    return (): void => {
      if (scrollToTopByTab.current[tab] === onScrollToTop) {
        delete scrollToTopByTab.current[tab];
      }
    };
  }, []);

  // Expo Router owns which tab is selected. Tab-bar presses and other
  // navigations update the route; this effect is the only place that moves
  // the pager to match. A swipe already moved the pager, then writes the
  // route — lastDrivenIndex / syncFromPagerRef skip a second jump.
  useEffect(() => {
    if (isFirstRouteSyncRef.current) {
      isFirstRouteSyncRef.current = false;
      return;
    }
    if (syncFromPagerRef.current) {
      syncFromPagerRef.current = false;
      return;
    }
    if (!tabsGroupFocused) return;

    const index = indexOfTab(activeTab);
    if (index < 0 || lastDrivenIndexRef.current === index) return;
    jumpToPage(activeTab);
  }, [activeTab, jumpToPage, tabsGroupFocused]);

  const onPageSelected = useCallback(
    (event: PagerViewOnPageSelectedEvent) => {
      const position = event.nativeEvent.position;
      const nextTab = TAB_SCREEN_NAMES[position];
      if (nextTab == null || nextTab === activeTabRef.current) return;

      mountAround(nextTab);
      lastDrivenIndexRef.current = position;
      const started = beginTabTransition(activeTabRef.current, nextTab);
      if (started) void haptics.selection();

      syncFromPagerRef.current = true;
      router.navigate(TAB_HREF[nextTab]);
    },
    [mountAround, router],
  );

  const contextValue = useMemo(
    () => ({
      activeTab,
      tabsGroupFocused,
      scrollToTop,
      registerScrollToTop,
      headerScrollYs,
    }),
    [activeTab, headerScrollYs, registerScrollToTop, scrollToTop, tabsGroupFocused],
  );

  const pages = TAB_SCREEN_NAMES.map(name => {
    const Screen = TAB_SCREENS[name];
    const isActive = name === activeTab && tabsGroupFocused;
    const mounted = mountedTabs.has(name);
    return (
      <View key={name} collapsable={false} style={styles.page}>
        {mounted ? (
          <TabPageFocus tabName={name} isFocused={isActive}>
            <Screen />
          </TabPageFocus>
        ) : (
          <View style={styles.page} />
        )}
      </View>
    );
  });

  // iOS liquid glass samples the pixels behind the bar. Insetting the pager
  // (Android) leaves NativeTabs' empty scenes as the backdrop — a solid,
  // usually light, fill. Keep the pager full-screen on iOS and constrain
  // NativeTabs to the bottom strip so the bar stays tappable.
  const pager = (
    <PagerView
      ref={pagerRef}
      style={
        Platform.OS === 'ios' ? styles.pagerFull : [styles.pagerInset, { bottom: tabBarHeight }]
      }
      initialPage={indexOfTab(activeTab)}
      offscreenPageLimit={1}
      keyboardDismissMode='on-drag'
      onPageSelected={onPageSelected}
    >
      {pages}
    </PagerView>
  );

  const header = (
    <View pointerEvents='box-none' style={styles.header}>
      <TabPagerHeader activeTab={activeTab} scrollY={headerScrollYs[activeTab]} />
    </View>
  );

  // FAB long-press scrims and create menus render from inside a pager page, which
  // cannot paint over the header or tab bar sitting above it. Portals lift those
  // overlays here instead of the app root so they still move with the drawer.
  const tabOverlayPortal = (
    <View pointerEvents='box-none' style={styles.tabOverlayPortal}>
      <PortalHost name={TAB_OVERLAY_PORTAL_HOST} />
    </View>
  );

  return (
    <TabPagerContext.Provider value={contextValue}>
      <View style={styles.root}>
        {Platform.OS === 'ios' ? (
          <>
            {pager}
            {header}
            <View collapsable={false} style={[styles.tabBarClip, { height: tabBarHeight }]}>
              {children}
            </View>
            {tabOverlayPortal}
          </>
        ) : (
          <>
            <View pointerEvents='box-none' style={styles.chrome}>
              {children}
            </View>
            {pager}
            {header}
            {tabOverlayPortal}
          </>
        )}
      </View>
    </TabPagerContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  pagerFull: {
    ...StyleSheet.absoluteFill,
    zIndex: 0,
  },
  pagerInset: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
  },
  chrome: {
    ...StyleSheet.absoluteFill,
    zIndex: 0,
  },
  header: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
  tabBarClip: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    zIndex: 2,
  },
  tabOverlayPortal: {
    ...StyleSheet.absoluteFill,
    zIndex: 3,
    elevation: 3,
  },
  page: {
    flex: 1,
  },
});
