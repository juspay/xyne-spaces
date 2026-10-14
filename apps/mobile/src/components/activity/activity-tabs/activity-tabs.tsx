import { FC, ReactElement, useRef, useState } from 'react';
import { View, Text, Pressable, LayoutChangeEvent } from 'react-native';
import { LegendList, LegendListRef, ViewToken } from '@legendapp/list/react-native';
import Animated, {
  interpolate,
  SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { StyleSheet } from 'react-native';
import { ActivityTab, TABS, TabConfig, actionableValues } from '@/src/types/activity';
import { cn } from '@/src/utils/cn';
import { ActivityTabsProps } from './activity-tabs.types';
import { useMeasureFlatListTabsLayout } from './activity-tabs.utils';

const AnimatedLegendList = Animated.createAnimatedComponent(LegendList<TabConfig>);

// Layout constants for tab bar spacing and visual consistency
const _sidePadding = 16; // Horizontal padding from screen edges, used in scroll positioning calculations
const _gap = 8; // Space between tab items, affects indicator positioning math
const _iconSize = 12; // Compact icon size maintains button proportions

// Color constants using CSS variables for dark mode support
const _activeColor = '#ff4f4f';
const _inactiveColor = '#A1A1A4';

const ActivityTabs = ({
  activeTab,
  onTabChange,
  // activityCounts,
  showActionableTabs = false,
}: ActivityTabsProps): ReactElement => {
  const [viewableItems, setViewableItems] = useState<ViewToken[]>([]);

  const visibleTabs = TABS.filter(tab =>
    tab.value === 'all'
      ? true
      : showActionableTabs
        ? actionableValues.has(tab.value)
        : !actionableValues.has(tab.value),
  );

  const legendRef = useRef<LegendListRef>(null);

  // Dynamic layout measurements for responsive indicator positioning
  // tabWidths: array of actual rendered tab widths for precise indicator sizing
  // tabOffsets: cumulative left positions for smooth indicator translation
  const { tabWidths, tabOffsets } = useMeasureFlatListTabsLayout({
    tabsLength: visibleTabs.length,
    sidePadding: _sidePadding,
    gap: _gap,
  });

  // Tracks horizontal scroll position for indicator compensation during scroll
  const offsetX = useSharedValue(0);

  // Worklet-optimized scroll handler runs on UI thread for 60fps indicator updates
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: event => {
      offsetX.value = event.contentOffset.x; // Drives TabIndicator translateX compensation
    },
  });

  const _renderItem = ({ item, index }: { item: TabConfig; index: number }) => (
    <TabItem
      icon={
        item.Icon && (
          <item.Icon
            size={_iconSize}
            color={activeTab === item.value ? _activeColor : _inactiveColor}
          />
        )
      }
      label={item.label}
      value={item.value}
      isActive={activeTab === item.value}
      onPress={() => {
        onTabChange(item.value);
        // Smart scroll positioning based on current viewport visibility
        const isPrevItemVisible = viewableItems.some(item => item.index === index - 1);
        const isCurrentItemVisible = viewableItems.some(item => item.index === index);

        // Position calculation: if previous item visible, align to right edge (1), else left edge (0)
        const viewPosition = isPrevItemVisible ? 1 : 0;
        // Offset ensures proper padding: negative offset pulls item inward, positive pushes outward
        const viewOffset = isPrevItemVisible ? -_sidePadding : _sidePadding;

        // Only scroll if target tab isn't already visible to avoid unnecessary animation
        if (!isCurrentItemVisible) {
          legendRef.current?.scrollToIndex({ index, viewPosition, viewOffset });
        }
      }}
      onLayout={event => {
        const { width } = event.nativeEvent.layout;
        // Update shared value array with actual rendered tab width for indicator calculations
        tabWidths.modify(value => {
          'worklet'; // Runs on UI thread for immediate indicator width updates
          value[index] = width; // Store width at tab's index position
          return value;
        });
      }}
    />
  );

  return (
    <View className='relative'>
      <TabIndicator
        activeIndex={visibleTabs.findIndex(tab => tab.value === activeTab)}
        tabBarOffsetX={offsetX}
        tabWidths={tabWidths}
        tabOffsets={tabOffsets}
      />
      <AnimatedLegendList
        ref={legendRef}
        data={visibleTabs}
        keyExtractor={item => item.value}
        renderItem={_renderItem}
        extraData={activeTab}
        horizontal
        contentContainerStyle={{ paddingHorizontal: _sidePadding, gap: _gap }}
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler} // Worklet-optimized for UI thread execution
        scrollEventThrottle={1000 / 60} // ~60fps scroll updates for smooth indicator tracking
        viewabilityConfig={{
          itemVisiblePercentThreshold: 100, // Only consider fully visible items
          minimumViewTime: 16, // ~60fps minimum visibility duration prevents flicker
        }}
        onViewableItemsChanged={({ viewableItems }) => {
          setViewableItems(viewableItems); // Tracks visible tabs for smart scroll positioning
        }}
      />
    </View>
  );
};

// -------------------------- TAB ITEM --------------------------

// Shared styling constants exported for TabIndicator visual consistency
const _borderRadius = 9999; // Rounded corners for modern button appearance
const _borderCurve = 'continuous'; // iOS 16+ continuous curves for premium feel

type TabItemProps = {
  icon: React.ReactNode;
  label: string;
  value: ActivityTab;
  isActive: boolean;
  onPress: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
};

const TabItem = ({ icon, label, onPress, onLayout, isActive }: TabItemProps) => {
  return (
    <Pressable
      className={cn(
        'flex-row items-center gap-1 px-3 py-2 border-[0.2px]',
        isActive ? 'border-brand/50' : 'border-foreground/60',
      )}
      style={_tabItemStyles.container}
      onLayout={onLayout} // Measures actual rendered width for indicator calculations
      onPress={onPress} // Triggers activeTab state change and scroll positioning
    >
      {/* Fixed icon container ensures consistent spacing regardless of icon complexity */}
      {icon && <View className='size-4 items-center justify-center'>{icon}</View>}
      <Text className={cn('font-medium', isActive ? 'text-brand' : 'text-foreground/60')}>
        {label}
      </Text>
    </Pressable>
  );
};

const _tabItemStyles = StyleSheet.create({
  container: {
    borderRadius: _borderRadius, // Matches TabIndicator for seamless visual integration
    borderCurve: _borderCurve, // Platform-specific enhancement for iOS premium feel
  },
});

// -------------------------- TAB INDICATOR --------------------------

// Animation timing for smooth tab transitions without feeling sluggish
const _duration = 200; // 200ms provides responsive feel while allowing users to see the movement

type TabIndicatorProps = {
  activeIndex: number;
  tabBarOffsetX: SharedValue<number>;
  tabWidths: SharedValue<number[]>;
  tabOffsets: SharedValue<number[]>;
};

export const TabIndicator: FC<TabIndicatorProps> = ({
  activeIndex,
  tabBarOffsetX,
  tabWidths,
  tabOffsets,
}) => {
  // Animated style hook drives indicator position and size changes on UI thread
  const rIndicatorStyle = useAnimatedStyle(() => {
    // Interpolate activeIndex (0,1,2...) to actual left positions in pixels
    // Input: [0, 1, 2, 3, 4, 5] (tab indices) → Output: [0, 120, 240, ...] (pixel positions)
    const left = withTiming(
      interpolate(activeIndex, Object.keys(tabOffsets.value).map(Number), tabOffsets.value),
      {
        duration: _duration, // Smooth position transition timing
      },
    );

    // Interpolate activeIndex to corresponding tab width for responsive indicator sizing
    // Input: [0, 1, 2, 3, 4, 5] (tab indices) → Output: [80, 120, 100, ...] (pixel widths)
    const width = withTiming(
      interpolate(activeIndex, Object.keys(tabWidths.value).map(Number), tabWidths.value),
      {
        duration: _duration, // Synchronized width animation with position
      },
    );

    return {
      left, // Absolute positioning from container left edge
      width, // Dynamic width matching active tab
      transform: [{ translateX: -tabBarOffsetX.value }], // Compensates for horizontal scroll offset
    };
  });

  // Absolute positioning allows indicator to slide behind tabs without affecting layout
  return (
    <Animated.View
      className='absolute h-full bg-brand/25'
      style={[rIndicatorStyle, _tabIndicatorStyles.container]}
    />
  );
};

const _tabIndicatorStyles = StyleSheet.create({
  container: {
    borderRadius: _borderRadius, // Consistent corner radius with tab items
    borderCurve: _borderCurve, // iOS 16+ continuous curves for softer appearance
  },
});

export default ActivityTabs;
