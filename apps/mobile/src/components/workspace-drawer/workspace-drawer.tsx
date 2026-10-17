import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { BackHandler, Platform, useWindowDimensions, View } from 'react-native';
import { Drawer } from 'react-native-drawer-layout';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { WorkspaceListPanel } from './workspace-list-panel';
import { WorkspaceDrawerContext } from './workspace-drawer-context';

const DRAWER_WIDTH_RATIO = 0.84;
const DRAWER_MAX_WIDTH = 380;
/** Matches the radius `AppBottomSheet` gives its own overlay surface. */
const DRAWER_CORNER_RADIUS = 24;

/**
 * Sits behind the drawer so the rounded corners have something to cut into.
 *
 * With 'front' (Android) the corners reveal the dimmed content underneath, so
 * the rounding reads on its own. With 'slide' (iOS) the content is pushed out
 * from under the drawer entirely and the corners revealed the app's own
 * background instead — near-identical to the drawer's surface, which is why
 * the radius looked absent there. The library only exposes the wrapper via
 * `style`, and the content covers it whenever the drawer is closed, so this is
 * visible at the corners and nowhere else.
 */
const DRAWER_BACKDROP = '#000';

/**
 * What `expo-router/drawer`'s DrawerView applies before handing off to this
 * same component (DrawerView.js:62). The bare component defaults to 'front'
 * on every platform, which is why hardcoding it left iOS with the Android
 * behaviour: 'front' pins the screen at translateX 0, so it never shifts.
 */
const DRAWER_TYPE = Platform.select({ ios: 'slide', default: 'front' }) as 'slide' | 'front';

/**
 * The Slack-style workspace switcher, wrapped around the tab navigator.
 *
 * Built on `react-native-drawer-layout` — the component `expo-router/drawer`
 * uses internally — rather than the Drawer *navigator*. The switcher holds no
 * routes, so a navigator would buy nothing while forcing `(tabs)` under a new
 * group and rewriting every route path, `unstable_settings.anchor`, and the
 * segment-based tab detection that depends on them.
 *
 * `children` is the tab tree. It arrives as an already-created element, so the
 * open/close state living here re-renders only this wrapper and the context
 * consumers — never the tabs.
 */
export const WorkspaceDrawer = memo(function WorkspaceDrawer({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerBg = useCSSVariable('--color-tabs-screen') as string;

  const [isOpen, setIsOpen] = useState(false);
  /**
   * Tracks the drawer through its close animation as well as its open state,
   * so the content's rounded leading edge can be dropped once the drawer is
   * fully shut without the radius popping away as the animation starts.
   */
  const [isContentRounded, setIsContentRounded] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const contextValue = useMemo(() => ({ open, close }), [close, open]);

  useEffect(() => {
    if (isOpen) {
      setIsContentRounded(true);
    }
  }, [isOpen]);

  const handleTransitionEnd = useCallback((closing: boolean) => {
    if (closing) {
      setIsContentRounded(false);
    }
  }, []);

  /**
   * The library's own drawer view is left transparent and unrounded. It is
   * absolutely positioned and carries an animated transform, and rounding it
   * clipped the surface without rounding the panel the user actually sees.
   * The painted, rounded surface is the panel below instead, so the radius and
   * the background live on one view and the whole panel is what gets rounded.
   */
  const drawerStyle = useMemo(
    () => ({
      width: Math.min(width * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH),
      backgroundColor: 'transparent',
    }),
    [width],
  );

  const panelStyle = useMemo(
    () => ({
      flex: 1,
      backgroundColor: drawerBg,
      borderTopRightRadius: DRAWER_CORNER_RADIUS,
      borderBottomRightRadius: DRAWER_CORNER_RADIUS,
      // Without this the list rows and the footer divider square off the
      // corners the radius just rounded.
      overflow: 'hidden' as const,
    }),
    [drawerBg],
  );

  /**
   * Rounds the tab tree's leading edge to match the drawer's trailing one.
   *
   * Only under 'slide', where the content is pushed clear of the drawer and its
   * hard left edge is what left the gap between them squared off at the top and
   * bottom. Under 'front' the content never moves, so rounding it would notch
   * the screen's own corners for no reason.
   *
   * Only while the drawer is out, too. Left on permanently, the clip would
   * still be cutting the tab tree with the drawer shut — against the display
   * corner on an iPad, whose radius is smaller than this, that shows as wedges
   * beside the tab bar, and the clip can catch the native tab bar itself.
   */
  const contentStyle = useMemo(
    () =>
      DRAWER_TYPE === 'slide' && isContentRounded
        ? {
            flex: 1,
            borderTopLeftRadius: DRAWER_CORNER_RADIUS,
            borderBottomLeftRadius: DRAWER_CORNER_RADIUS,
            overflow: 'hidden' as const,
          }
        : { flex: 1 },
    [isContentRounded],
  );

  // Android back closes the drawer. `react-native-drawer-layout` registers no
  // back handler of its own. Scoped to focus so it stops competing once the
  // create-workspace modal is pushed over the tabs.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android' || !isOpen) {
        return;
      }
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        close();
        return true;
      });
      return (): void => subscription.remove();
    }, [close, isOpen]),
  );

  const renderDrawerContent = useCallback(
    (): ReactNode => (
      <View style={panelStyle}>
        <View
          className='flex-1'
          style={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom }}
        >
          <WorkspaceListPanel />
        </View>
      </View>
    ),
    [insets.bottom, insets.top, panelStyle],
  );

  return (
    <WorkspaceDrawerContext.Provider value={contextValue}>
      <Drawer
        style={{ backgroundColor: DRAWER_BACKDROP }}
        open={isOpen}
        onOpen={open}
        onClose={close}
        onTransitionEnd={handleTransitionEnd}
        drawerType={DRAWER_TYPE}
        drawerPosition='left'
        // One pan gesture drives both directions in this library, but its hitSlop
        // is the full drawer while open and only a 32px edge strip while closed.
        // Gating on `isOpen` therefore buys swipe-to-close without arming an
        // edge-swipe-to-open that would compete with the DM list's own row swipes.
        swipeEnabled={isOpen}
        drawerStyle={drawerStyle}
        renderDrawerContent={renderDrawerContent}
      >
        <View style={contentStyle}>{children}</View>
      </Drawer>
    </WorkspaceDrawerContext.Provider>
  );
});
