import { useValue } from '@legendapp/state/react';
import { useIsFocused } from 'expo-router/react-navigation';
import { SlidersHorizontal } from 'lucide-react-native';
import { type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Portal } from '@/src/components/primitives/portal';
import { TAB_OVERLAY_PORTAL_HOST } from '@/src/components/tab-pager/tab-overlay-portal';
import { useSpacesTabBarHeight } from '@/src/features/bottom-navigation';
import {
  ICON_SIZE,
  SEARCH_BAR_RADIUS,
  SEARCH_BUTTON_SIZE,
  TAB_BAR_HORIZONTAL_PADDING,
} from '@/src/features/bottom-navigation/constants';
import { FAB_GAP } from '@/src/features/quick-actions/constants';
import { haptics } from '@/src/utils/haptics';

import { countActiveFilters } from '../model/preferences';
import { openActivityTray } from '../state/filter-tray-store';
import { activityPreferences$ } from '../state/preferences-store';

const PORTAL_NAME = 'activity-filter-button';

/** How many filters are narrowing the feed; hidden at zero. */
function ActiveCount(): ReactElement | null {
  const count = useValue(() => countActiveFilters(activityPreferences$.get()));
  if (count === 0) return null;

  return (
    <View className='absolute -right-1 -top-1 h-5 min-w-5 items-center justify-center rounded-full border-2 border-spaces-background bg-spaces-foreground px-1'>
      <Text className='text-[11px] font-semibold text-spaces-background'>{count}</Text>
    </View>
  );
}

/**
 * Opens the filter tray. Takes the place the quick-action button holds on the
 * other tabs, so it matches that button's size, corner and position exactly —
 * the same constants place both.
 *
 * Drawn through the shell's overlay host so it sits above the bottom bar, and
 * only while this tab is in front: every tab is mounted at once and they all
 * share the host.
 */
export function ActivityFilterButton(): ReactElement | null {
  const isFocused = useIsFocused();
  const barHeight = useSpacesTabBarHeight();

  if (!isFocused) return null;

  return (
    <Portal name={PORTAL_NAME} hostName={TAB_OVERLAY_PORTAL_HOST}>
      <View pointerEvents='box-none' style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Filter activity'
          onPress={() => {
            void haptics.buttonTap();
            openActivityTray();
          }}
          className='absolute items-center justify-center bg-spaces-accent'
          style={{
            width: SEARCH_BUTTON_SIZE,
            height: SEARCH_BUTTON_SIZE,
            borderRadius: SEARCH_BAR_RADIUS,
            bottom: barHeight + FAB_GAP,
            right: TAB_BAR_HORIZONTAL_PADDING,
          }}
        >
          <SlidersHorizontal size={ICON_SIZE} color='#FFFFFF' strokeWidth={2} />
          <ActiveCount />
        </Pressable>
      </View>
    </Portal>
  );
}
