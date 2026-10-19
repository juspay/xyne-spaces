import { useContext } from 'react';
import { Platform } from 'react-native';
import { BottomTabBarHeightContext } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBarMetricsContext } from './tabBarMetrics';

const IOS_TAB_BAR_HEIGHT_WITHOUT_INSET = 40;
const IOS_TAB_BAR_PADDING_BOTTOM = 16;
const ANDROID_FALLBACK_TAB_BAR_HEIGHT_WITHOUT_INSET = 68;
const ANDROID_TAB_BAR_PADDING_BOTTOM = 8;

export const useTabBarHeight = () => {
  const insets = useSafeAreaInsets();
  const stated = useContext(TabBarMetricsContext).height;
  const fromNavigator = useContext(BottomTabBarHeightContext);
  // A shell that knows its own bar wins: React Navigation measures an
  // absolutely-positioned custom bar as zero.
  const measuredTabBarHeight = stated ?? fromNavigator;

  const tabBarPaddingBottom =
    insets.bottom +
    (Platform.OS === 'android' ? ANDROID_TAB_BAR_PADDING_BOTTOM : IOS_TAB_BAR_PADDING_BOTTOM);
  const tabBarHeight =
    typeof measuredTabBarHeight === 'number'
      ? measuredTabBarHeight
      : Platform.OS === 'android'
        ? insets.bottom + ANDROID_FALLBACK_TAB_BAR_HEIGHT_WITHOUT_INSET
        : tabBarPaddingBottom + IOS_TAB_BAR_HEIGHT_WITHOUT_INSET;

  return {
    tabBarPaddingBottom,
    tabBarHeight,
  };
};
