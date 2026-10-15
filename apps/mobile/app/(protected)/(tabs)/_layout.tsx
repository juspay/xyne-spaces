import React, { ReactElement, useMemo } from 'react';
import { type ColorValue, DynamicColorIOS, Platform, StyleSheet, View } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCSSVariable, useUniwind } from 'uniwind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatTabBadgeLabel, useTabNavBadges } from '@/src/hooks/useTabNavBadges';
import { haptics } from '@/src/utils/haptics';
import { getTabBadgeMinWidth } from '@/src/utils/tabBadge';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import {
  beginTabTransition,
  isTabName,
} from '@/src/observability/logging/navigation/tabTransition';
import { TabPager } from '@/src/components/tab-pager/tab-pager';
import { useTabPager } from '@/src/components/tab-pager/tab-pager-context';
import { WorkspaceDrawer } from '@/src/components/workspace-drawer';
import { isFlagOn } from '@/src/flags';
import { tabRoute } from '@/src/navigation/routes';

type AndroidTabIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
type AndroidTabIconProps = {
  color: ColorValue;
  name: AndroidTabIconName;
  size: number;
};
type AndroidTabIconRenderer = (props: { color: ColorValue; size: number }) => ReactElement;

const getIosMajorVersion = (): number => {
  if (Platform.OS !== 'ios') {
    return 0;
  }
  const version = Platform.Version;
  if (typeof version === 'string') {
    return parseInt(version.split('.')[0] ?? '0', 10);
  }
  return typeof version === 'number' ? version : 0;
};

const iosMajor = getIosMajorVersion();
const iosUsesLiquidGlass = iosMajor >= 26;

// Exactly five tabs. UITabBar collapses everything past the fifth item into its
// own system "More" tab, so nothing more can be appended here.
// eslint-disable-next-line @typescript-eslint/naming-convention -- Expo Router requires this export name.
export const unstable_settings = {
  initialRouteName: 'dms',
} as const;

/** Only applied on older iOS where the tab bar would otherwise look fully transparent. */
const legacyIosTabBarProps =
  Platform.OS === 'ios' && !iosUsesLiquidGlass
    ? {
        blurEffect: 'systemChromeMaterial' as const,
        backgroundColor: DynamicColorIOS({
          light: '#FFFFFFEB',
          dark: '#0A0A0AEE',
        }),
        disableTransparentOnScrollEdge: true,
      }
    : {};

// NativeTabs paints react-navigation `colors.background` (light gray) behind
// every tab scene. The visible pages live in TabPager, so that default would
// show through liquid glass as a whitish bar. Keep the empty route shells clear.
const iosTabContentStyle = { backgroundColor: 'transparent' } as const;

const AndroidTabIcon = ({ color, name, size }: AndroidTabIconProps): ReactElement => (
  <MaterialCommunityIcons name={name} color={color} size={size} />
);

const renderAndroidTabIcon = (name: AndroidTabIconName): AndroidTabIconRenderer => {
  const TabIcon = ({ color, size }: { color: ColorValue; size: number }): ReactElement => (
    <AndroidTabIcon name={name} color={color} size={size} />
  );
  TabIcon.displayName = `AndroidTabIcon(${name})`;
  return TabIcon;
};

const TabsLayout = (): ReactElement => {
  // This group must not render while the flag names the other shell.
  //
  // Declarative on purpose. The imperative version — remount, then
  // `router.replace` from an effect — never landed when the stale
  // `unstable_settings.anchor` named this group: module scope does not re-run
  // on a flag change, so the anchor kept pulling the stack back here. A
  // `<Redirect>` during render is the same path a cold start takes, and it is
  // re-evaluated on every render rather than once per mount.
  if (isFlagOn('ui.shell')) {
    return <Redirect href={tabRoute('dms')} />;
  }

  // The drawer wraps the tabs rather than living inside a screen: the switcher
  // is reachable from every tab, and it must cover the tab bar when open.
  return (
    <View style={styles.root}>
      <WorkspaceDrawer>
        <TabPager>
          <TabsChrome />
        </TabPager>
      </WorkspaceDrawer>
    </View>
  );
};

const TabsChrome = (): ReactElement => {
  const { activeTab, scrollToTop } = useTabPager();

  const handleTabPress = (routeName: string): void => {
    if (!isTabName(routeName)) return;
    if (routeName === activeTab) {
      scrollToTop(routeName);
      return;
    }

    const started = beginTabTransition(activeTab, routeName);
    if (!started) return;
    void haptics.selection();
    // NativeTabs / Tabs update the route. TabPager follows `activeTab` from
    // that route — do not jump the pager here.
  };

  const badges = useTabNavBadges();
  const channelsBadgeLabel = formatTabBadgeLabel(badges.channels);
  const dmsBadgeLabel = formatTabBadgeLabel(badges.dms);
  const callsBadgeLabel = formatTabBadgeLabel(badges.calls);
  const activityBadgeLabel = formatTabBadgeLabel(badges.activity);
  const androidBadgeLabels: Readonly<Record<string, string | undefined>> = {
    channels: channelsBadgeLabel,
    dms: dmsBadgeLabel,
    calls: callsBadgeLabel,
    activity: activityBadgeLabel,
    more: undefined,
  };
  // The unread counter was brand green with hardcoded white text; it now follows
  // the chosen bubble colour, and `accentFg` keeps the digits readable on the
  // pale end of the palette where white would disappear.
  const { accentBg: badgeBackgroundColor, accentFg: badgeTextColor } = useBubbleAccent();
  const androidTabBarBackground = useCSSVariable('--color-tabs-screen') as string;
  const androidTabBarBorder = useCSSVariable('--color-tab-bar-border') as string;
  const androidIconColor = useCSSVariable('--color-base-500') as string;
  const tabIconColor = useCSSVariable('--color-primary-text') as string;
  const { bottom: bottomInset } = useSafeAreaInsets();
  const { theme } = useUniwind();
  const androidTabIcons = useMemo(
    () => ({
      channels: renderAndroidTabIcon('pound'),
      dms: renderAndroidTabIcon('message'),
      calls: renderAndroidTabIcon('phone'),
      activity: renderAndroidTabIcon('bell'),
      more: renderAndroidTabIcon('dots-horizontal'),
    }),
    [],
  );

  if (Platform.OS === 'android') {
    return (
      <View pointerEvents='box-none' style={styles.androidTabsRoot}>
        <Tabs
          key={'tabs-' + theme}
          initialRouteName='dms'
          backBehavior='history'
          screenOptions={({ route }) => ({
            animation: 'none',
            freezeOnBlur: true,
            headerShown: false,
            lazy: true,
            sceneStyle: {
              backgroundColor: 'transparent',
              pointerEvents: 'none',
            },
            tabBarActiveTintColor: tabIconColor,
            tabBarBadgeStyle: [
              styles.androidTabBadge,
              {
                backgroundColor: badgeBackgroundColor,
                color: badgeTextColor,
                minWidth: getTabBadgeMinWidth(androidBadgeLabels[route.name]),
              },
            ],
            tabBarInactiveTintColor: androidIconColor,
            tabBarLabelPosition: 'below-icon',
            tabBarStyle: {
              backgroundColor: androidTabBarBackground,
              // The bar is painted in the same token the screens behind it use,
              // so without an edge of its own it reads as more of the page. A
              // hairline rule is what Material draws here, and it costs less
              // than the elevation shadow that would otherwise have to
              // separate it. Kept deliberately faint: enough to find the edge,
              // not enough to draw the eye down to it. If it ever vanishes on
              // a device, darken the token rather than thickening the rule.
              borderTopColor: androidTabBarBorder,
              borderTopWidth: 0.5,
              elevation: 0,
              height: 68 + bottomInset,
              paddingBottom: 8 + bottomInset,
              paddingTop: 6,
            },
          })}
          screenListeners={({ route }) => ({
            tabPress: (): void => {
              handleTabPress(route.name);
            },
          })}
        >
          <Tabs.Screen
            name='channels'
            options={{
              title: 'Channels',
              ...(channelsBadgeLabel
                ? {
                    tabBarBadge: channelsBadgeLabel,
                    tabBarAccessibilityLabel: `Channels, ${badges.channels} unread`,
                  }
                : {}),
              tabBarIcon: androidTabIcons.channels,
            }}
          />
          <Tabs.Screen
            name='dms'
            options={{
              title: 'DMs',
              ...(dmsBadgeLabel
                ? {
                    tabBarBadge: dmsBadgeLabel,
                    tabBarAccessibilityLabel: `DMs, ${badges.dms} unread`,
                  }
                : {}),
              tabBarIcon: androidTabIcons.dms,
            }}
          />
          <Tabs.Screen
            name='calls'
            options={{
              title: 'Calls',
              ...(callsBadgeLabel ? { tabBarBadge: callsBadgeLabel } : {}),
              tabBarIcon: androidTabIcons.calls,
            }}
          />
          <Tabs.Screen
            name='activity'
            options={{
              title: 'Activity',
              ...(activityBadgeLabel
                ? {
                    tabBarBadge: activityBadgeLabel,
                    tabBarAccessibilityLabel: `Activity, ${badges.activity} unread`,
                  }
                : {}),
              tabBarIcon: androidTabIcons.activity,
            }}
          />
          <Tabs.Screen
            name='more'
            options={{
              title: 'More',
              tabBarIcon: androidTabIcons.more,
            }}
          />
        </Tabs>
      </View>
    );
  }

  return (
    <NativeTabs
      labelVisibilityMode='labeled'
      badgeBackgroundColor={badgeBackgroundColor}
      badgeTextColor={badgeTextColor}
      iconColor={{
        default: tabIconColor,
        selected: tabIconColor,
      }}
      screenListeners={({ route }) => ({
        tabPress: (): void => {
          handleTabPress(route.name);
        },
      })}
      {...legacyIosTabBarProps}
      unstable_nativeProps={{
        nativeContainerStyle: { backgroundColor: 'transparent' },
      }}
    >
      <NativeTabs.Trigger name='channels' contentStyle={iosTabContentStyle}>
        <NativeTabs.Trigger.Label>Channels</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'number',
            selected: 'number',
          }}
          src={<NativeTabs.Trigger.VectorIcon family={MaterialCommunityIcons} name='pound' />}
        />
        {channelsBadgeLabel ? (
          <NativeTabs.Trigger.Badge>{channelsBadgeLabel}</NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name='dms' contentStyle={iosTabContentStyle}>
        <NativeTabs.Trigger.Label>DMs</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'message',
            selected: 'message.fill',
          }}
          src={<NativeTabs.Trigger.VectorIcon family={MaterialCommunityIcons} name='message' />}
        />
        {dmsBadgeLabel ? (
          <NativeTabs.Trigger.Badge>{dmsBadgeLabel}</NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name='calls' contentStyle={iosTabContentStyle}>
        <NativeTabs.Trigger.Label>Calls</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'phone',
            selected: 'phone.fill',
          }}
          src={<NativeTabs.Trigger.VectorIcon family={MaterialCommunityIcons} name='phone' />}
        />
        {callsBadgeLabel ? (
          <NativeTabs.Trigger.Badge>{callsBadgeLabel}</NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name='activity' contentStyle={iosTabContentStyle}>
        <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'bell',
            selected: 'bell.fill',
          }}
          src={<NativeTabs.Trigger.VectorIcon family={MaterialCommunityIcons} name='bell' />}
        />
        {activityBadgeLabel ? (
          <NativeTabs.Trigger.Badge>{activityBadgeLabel}</NativeTabs.Trigger.Badge>
        ) : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name='more' contentStyle={iosTabContentStyle}>
        <NativeTabs.Trigger.Label>More</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'ellipsis',
            selected: 'ellipsis',
          }}
          src={
            <NativeTabs.Trigger.VectorIcon family={MaterialCommunityIcons} name='dots-horizontal' />
          }
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  androidTabsRoot: {
    flex: 1,
  },
  androidTabBadge: {
    minWidth: 18,
    paddingHorizontal: 4,
  },
});

export default TabsLayout;
