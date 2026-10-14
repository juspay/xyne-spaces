import { memo, ReactElement, useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, LayoutChangeEvent, StyleSheet } from 'react-native';
import Animated, {
  interpolate,
  SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { LegendList, LegendListRef, ViewToken } from '@legendapp/list/react-native';
import { cn } from '@/src/utils/cn';
import { CallTab } from '@/src/hooks/useCalls';

interface CallLogTabsProps {
  activeTab: CallTab;
  onTabChange: (tab: CallTab) => void;
}

const AnimatedLegendList = Animated.createAnimatedComponent(LegendList<TabConfig>);

const _sidePadding = 16;
const _gap = 8;

type TabConfig = {
  id: CallTab;
  label: string;
};

const tabs: TabConfig[] = [
  { id: CallTab.ALL, label: 'All' },
  { id: CallTab.UPCOMING, label: 'Upcoming' },
  { id: CallTab.MISSED, label: 'Missed' },
];

// Animation timing for smooth tab transitions
const _duration = 200;
const _borderRadius = 9999;
const _borderCurve: 'continuous' | 'circular' = 'continuous';

const _keyExtractor = (item: TabConfig) => item.id;

export const CallLogTabs = ({ activeTab, onTabChange }: CallLogTabsProps): ReactElement => {
  const [viewableItems, setViewableItems] = useState<ViewToken[]>([]);

  const legendRef = useRef<LegendListRef>(null);

  // Shared array stores actual measured tab widths (initially 0, updated via onLayout)
  const tabWidths = useSharedValue<number[]>(new Array(tabs.length).fill(0));

  // Derived value automatically recalculates tab positions when widths change
  const tabOffsets = useDerivedValue(() => {
    return tabWidths.value.reduce<number[]>((acc, _width, index) => {
      const previousX = index === 0 ? _sidePadding : acc[index - 1];
      const previousWidth = index === 0 ? 0 : tabWidths.value[index - 1];

      acc[index] = (previousX ?? 0) + (previousWidth ?? 0) + (index === 0 ? 0 : _gap);
      return acc;
    }, []);
  });

  // Tracks horizontal scroll position for indicator compensation during scroll
  const offsetX = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: event => {
      offsetX.value = event.contentOffset.x;
    },
  });

  const _onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      setViewableItems(viewableItems);
    },
    [],
  );

  const _renderItem = useCallback(
    ({ item, index }: { item: TabConfig; index: number }) => (
      <TabItem
        label={item.label}
        isActive={activeTab === item.id}
        onPress={() => {
          onTabChange(item.id);
          const isPrevItemVisible = viewableItems.some(vi => vi.index === index - 1);
          const isCurrentItemVisible = viewableItems.some(vi => vi.index === index);

          const viewPosition = isPrevItemVisible ? 1 : 0;
          const viewOffset = isPrevItemVisible ? -_sidePadding : _sidePadding;

          if (!isCurrentItemVisible) {
            legendRef.current?.scrollToIndex({ index, viewPosition, viewOffset });
          }
        }}
        onLayout={event => {
          const { width } = event.nativeEvent.layout;
          // Update shared value array with actual rendered tab width for indicator calculations
          tabWidths.modify(value => {
            'worklet';
            value[index] = width;
            return value;
          });
        }}
      />
    ),
    [activeTab, onTabChange, viewableItems],
  );

  return (
    <View className='relative'>
      <TabIndicator
        activeIndex={tabs.findIndex(tab => tab.id === activeTab)}
        tabBarOffsetX={offsetX}
        tabWidths={tabWidths}
        tabOffsets={tabOffsets}
      />
      <AnimatedLegendList
        ref={legendRef}
        data={tabs}
        keyExtractor={_keyExtractor}
        renderItem={_renderItem}
        extraData={activeTab}
        horizontal
        contentContainerStyle={{ paddingHorizontal: _sidePadding, gap: _gap }}
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={1000 / 60}
        viewabilityConfig={{
          itemVisiblePercentThreshold: 100,
          minimumViewTime: 16,
        }}
        onViewableItemsChanged={_onViewableItemsChanged}
      />
    </View>
  );
};

// -------------------------- TAB ITEM --------------------------

type TabItemProps = {
  label: string;
  isActive: boolean;
  onPress: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
};

const TabItem = memo(({ label, onPress, onLayout, isActive }: TabItemProps) => {
  return (
    <Pressable
      className={cn(
        'flex-row items-center px-4 py-2 border-[0.2px]',
        isActive ? 'border-green-600/50' : 'border-foreground/60',
      )}
      style={_tabItemStyles.container}
      onLayout={onLayout}
      onPress={onPress}
    >
      <Text className={cn('font-medium', isActive ? 'text-green-600' : 'text-foreground/60')}>
        {label}
      </Text>
    </Pressable>
  );
});
TabItem.displayName = 'TabItem';

const _tabItemStyles = StyleSheet.create({
  container: {
    borderRadius: _borderRadius,
    borderCurve: _borderCurve,
  },
});

// -------------------------- TAB INDICATOR --------------------------

type TabIndicatorProps = {
  activeIndex: number;
  tabBarOffsetX: SharedValue<number>;
  tabWidths: SharedValue<number[]>;
  tabOffsets: SharedValue<number[]>;
};

const TabIndicator = ({ activeIndex, tabBarOffsetX, tabWidths, tabOffsets }: TabIndicatorProps) => {
  const rIndicatorStyle = useAnimatedStyle(() => {
    // Interpolate activeIndex to actual left positions in pixels
    const left = withTiming(
      interpolate(activeIndex, Object.keys(tabOffsets.value).map(Number), tabOffsets.value),
      { duration: _duration },
    );

    // Interpolate activeIndex to corresponding tab width
    const width = withTiming(
      interpolate(activeIndex, Object.keys(tabWidths.value).map(Number), tabWidths.value),
      { duration: _duration },
    );

    return {
      left,
      width,
      transform: [{ translateX: -tabBarOffsetX.value }],
    };
  });

  return (
    <Animated.View
      className='absolute h-full bg-green-600/20'
      style={[rIndicatorStyle, _tabIndicatorStyles.container]}
    />
  );
};

const _tabIndicatorStyles = StyleSheet.create({
  container: {
    borderRadius: _borderRadius,
    borderCurve: _borderCurve,
  },
});
