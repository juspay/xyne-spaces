import { useCallback, useMemo, type ReactElement } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Platform, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { PortalHost } from '@/src/components/primitives/portal';
import { TAB_OVERLAY_PORTAL_HOST } from '@/src/components/tab-pager/tab-overlay-portal';
import { WorkspaceDrawer } from '@/src/components/workspace-drawer';
import { AppTabBar, TabScreens, useSpacesTabBarHeight } from '@/src/features/bottom-navigation';
import { TabBarMetricsContext } from '@/src/hooks/tabBarMetrics';
import { CustomizeTrayView } from '@/src/features/tab-customization';
import { Tray, useTray } from '@/src/ui/tray';
import { isFlagOn } from '@/src/flags';
import { SPACES_INITIAL_TAB, tabRoute } from '@/src/navigation/routes';

import { SpacesHeaderProvider } from './_header-provider';

// eslint-disable-next-line @typescript-eslint/naming-convention -- Expo Router requires this export name.
export const unstable_settings = { initialRouteName: SPACES_INITIAL_TAB } as const;

/**
 * Menu destinations are reached rarely, so their trees suspend on blur. The
 * three pill tabs and search are left unfrozen on purpose: they are the hot
 * path, and unfreezing re-renders the whole subtree inside the commit that
 * switches the tab — the very stall preloading exists to remove.
 */
const MENU_SCREEN_OPTIONS = { freezeOnBlur: Platform.OS === 'android' } as const;

type SpacesTabsProps = {
  screenOptions: { headerShown: boolean; sceneStyle: { backgroundColor: string } };
};

/**
 * The navigator, inside `<Tray>` so the bar can open it.
 *
 * Customize is a tray view now rather than a pushed route, and the thing that
 * opens it is a button in the bar — so the opener has to come from above the
 * bar. Keeping the tray in the shell is also what stops the navigation feature
 * importing the customization feature that already imports it back.
 */
function SpacesTabs({ screenOptions }: SpacesTabsProps): ReactElement {
  const { open } = useTray();
  const openCustomize = useCallback(() => open('customize'), [open]);

  /**
   * States the bar's height for anything positioning itself above it.
   *
   * React Navigation measures this bar as zero — it is a custom `tabBar` drawn
   * with `StyleSheet.absoluteFill` so the menu and its backdrop can cover the
   * screen — so `BottomTabBarHeightContext` would park every floating button
   * inside the pill.
   */
  const barHeight = useSpacesTabBarHeight();
  const metrics = useMemo(() => ({ height: barHeight }), [barHeight]);

  return (
    <TabBarMetricsContext.Provider value={metrics}>
      <Tabs
        initialRouteName={SPACES_INITIAL_TAB}
        tabBar={props => <AppTabBar {...props} onCustomize={openCustomize} />}
        screenOptions={screenOptions}
      >
        <Tabs.Screen name={TabScreens.Channels} />
        <Tabs.Screen name={TabScreens.Dms} />
        <Tabs.Screen name={TabScreens.Activity} />
        <Tabs.Screen name={TabScreens.Search} />
        <Tabs.Screen name={TabScreens.Calls} options={MENU_SCREEN_OPTIONS} />
        <Tabs.Screen name={TabScreens.Threads} options={MENU_SCREEN_OPTIONS} />
        <Tabs.Screen name={TabScreens.MorningBrief} options={MENU_SCREEN_OPTIONS} />
        <Tabs.Screen name={TabScreens.Bookmarks} options={MENU_SCREEN_OPTIONS} />
        <Tabs.Screen name={TabScreens.DraftsSent} options={MENU_SCREEN_OPTIONS} />
        <Tabs.Screen name={TabScreens.XyneDesks} options={MENU_SCREEN_OPTIONS} />
      </Tabs>
    </TabBarMetricsContext.Provider>
  );
}

export default function SpacesLayout(): ReactElement {
  // React Navigation paints every scene with its own theme background (a light
  // grey) otherwise, which shows through as a flash on any frame the screen has
  // not painted yet.
  const sceneBackground = useCSSVariable('--color-tabs-screen') as string;
  const screenOptions = useMemo(
    () => ({ headerShown: false, sceneStyle: { backgroundColor: sceneBackground } }),
    [sceneBackground],
  );
  const shellStyle = useMemo(
    () => ({ flex: 1, backgroundColor: sceneBackground }),
    [sceneBackground],
  );

  // The mirror of the guard in `(tabs)/_layout.tsx`. One flag decides, so the
  // two can never both redirect. Below the hooks, not above: an early return
  // before them changes the hook order between renders.
  if (!isFlagOn('ui.shell')) {
    return <Redirect href={tabRoute('dms')} />;
  }

  return (
    <WorkspaceDrawer>
      {/*
        Paints the shell's own background, so a frame with no scene attached
        still has something to show.

        `WorkspaceDrawer` styles its wrapper `#000` to give the drawer's rounded
        corners something to cut into, assuming the content always covers it.
        That holds in the classic shell, whose pages live in one always-mounted
        `TabPager`. Here every tab is a detachable screen with
        `animation: 'none'`, so the outgoing one detaches in the same commit the
        incoming one first renders — and the only node carrying a background is
        the scene itself, leaving one frame of bare black.

        Inside the drawer content on purpose: this translates with the content
        under 'slide', so the drawer's corners still reveal the wrapper.
      */}
      <View style={shellStyle}>
        <SpacesHeaderProvider>
          <Tray defaultView='customize'>
            <SpacesTabs screenOptions={screenOptions} />
            {/*
              List FABs and their dim render through this host so they can cover
              the header and the bar, which they cannot do from inside a scene.
              After <Tabs> so it paints above the bar — and inside <Tray>, before
              the sheet, so the sheet still covers the FABs.
            */}
            <PortalHost name={TAB_OVERLAY_PORTAL_HOST} />
            <Tray.Content>
              <CustomizeTrayView />
            </Tray.Content>
          </Tray>
        </SpacesHeaderProvider>
      </View>
    </WorkspaceDrawer>
  );
}
