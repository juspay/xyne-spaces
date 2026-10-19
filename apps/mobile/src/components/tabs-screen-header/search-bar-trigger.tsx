import { Pressable, Text } from 'react-native';

import { haptics } from '@/src/utils/haptics';
import { type ReactElement } from 'react';
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useRouter, type Href } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { SEARCH_BAR_ICON_SIZE } from '@/src/features/global-search/constants';
import { initialTabForSurface } from '@/src/features/global-search/utils/search-tabs';
import { useTabsScreenHeader, type SearchBarTriggerProps } from './context';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function TabsScreenHeaderSearchBar({
  placeholder,
  sourceSurface,
  initialTab,
}: SearchBarTriggerProps): ReactElement {
  const { scrollY, collapseDistance } = useTabsScreenHeader();
  const { searchBarHeight, searchBarGap } = useHeaderHeight();
  const router = useRouter();
  const muted = useCSSVariable('--color-secondary-text') as string;

  const barStyle = useAnimatedStyle(() => {
    const distance = Math.min(Math.max(scrollY.value, 0), collapseDistance);
    const collapseProgress = distance / collapseDistance;
    const collapsedDistance = searchBarGap + searchBarHeight;
    const translateY = -collapseProgress * collapsedDistance;

    const scrollOpacity = interpolate(
      distance,
      [0, collapseDistance / 2],
      [1, 0],
      Extrapolation.CLAMP,
    );

    return {
      transform: [{ translateY }],
      opacity: scrollOpacity,
      pointerEvents: distance >= collapseDistance / 2 ? 'none' : 'auto',
    };
  });

  const openSearchScreen = (): void => {
    const resolvedInitialTab = initialTab ?? initialTabForSurface(sourceSurface);

    // No critical window here any more. The search screen used to open one to hold
    // live queries back while it mounted, because mounting it was expensive; it is
    // not now, and an unclosed window pauses live data across the whole app.
    router.push({
      pathname: '/(protected)/global-search',
      params: {
        sourceSurface,
        initialTab: resolvedInitialTab,
      },
    } as unknown as Href);
  };

  return (
    <AnimatedPressable
      accessibilityRole='search'
      accessibilityLabel={placeholder}
      onPress={openSearchScreen}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
      className='relative z-[5] mx-4 flex-row items-center gap-2 rounded-full bg-foreground/5 px-4'
      style={[{ height: searchBarHeight, marginTop: searchBarGap }, barStyle]}
    >
      <Search size={SEARCH_BAR_ICON_SIZE} color={muted} />
      <Text className='text-base' style={{ color: muted }}>
        {placeholder}
      </Text>
    </AnimatedPressable>
  );
}
