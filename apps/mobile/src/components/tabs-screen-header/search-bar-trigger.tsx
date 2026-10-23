import { Text } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';

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

  // The bar slides with the scroll, and Reanimated writes that slide straight
  // to the native view, ahead of React's copy of the layout. React Native's
  // Pressable checks a release against that older copy and can drop the press;
  // Gesture Handler's checks it against the view as drawn.
  return (
    <Animated.View
      className='relative z-[5] mx-4 rounded-full bg-foreground/5'
      style={[{ height: searchBarHeight, marginTop: searchBarGap }, barStyle]}
    >
      <Pressable
        accessibilityRole='search'
        accessibilityLabel={placeholder}
        onPress={openSearchScreen}
        onPressIn={(): void => {
          void haptics.buttonTap();
        }}
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 16,
        }}
      >
        <Search size={SEARCH_BAR_ICON_SIZE} color={muted} />
        <Text className='text-base' style={{ color: muted }}>
          {placeholder}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
