import { useMemo, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { AppHeader } from '@/src/components/app-header';
import { TABS_SEARCH_COLLAPSE_DISTANCE } from '@/src/features/global-search/constants';
import { cn } from '@/src/utils/cn';
import { TabsScreenHeaderContext } from './context';
import { TabsScreenHeaderSearchBar } from './search-bar-trigger';

type RootProps = {
  children: ReactNode;
  scrollY: SharedValue<number>;
  collapseDistance?: number;
  backgroundClassName?: string;
  className?: string;
};

function Leading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return <View className={cn('flex-row items-center gap-2', className)}>{children}</View>;
}

function Trailing({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return <View className={cn('flex-row items-center gap-4', className)}>{children}</View>;
}

function Root({
  children,
  scrollY,
  collapseDistance = TABS_SEARCH_COLLAPSE_DISTANCE,
  backgroundClassName = 'bg-tabs-screen',
  className,
}: RootProps): ReactElement {
  const { topSafeHeight, headerHeight, searchBarHeight, searchBarGap } = useHeaderHeight();

  // Separate children into bar row slots vs search bar slot
  const leading: ReactNode[] = [];
  const trailing: ReactNode[] = [];
  const searchSlots: ReactNode[] = [];
  const others: ReactNode[] = [];

  const arrayChildren = Array.isArray(children) ? children : [children];
  for (const child of arrayChildren) {
    if (!child || typeof child !== 'object') {
      others.push(child);
      continue;
    }
    const type = (child as { type?: unknown }).type;
    if (type === Leading) leading.push(child);
    else if (type === Trailing) trailing.push(child);
    else if (type === TabsScreenHeaderSearchBar) searchSlots.push(child);
    else others.push(child);
  }

  // Derive synchronously so the header height includes the search bar on the
  // first paint. A post-mount useState flip left overflow-hidden clipping the
  // bar until scrollY updated and reanimated re-ran the worklet.
  const hasSearchBar = searchSlots.length > 0;

  const ctx = useMemo(
    () => ({ scrollY, collapseDistance, hasSearchBar }),
    [scrollY, collapseDistance, hasSearchBar],
  );

  const containerStyle = useAnimatedStyle(() => {
    if (!hasSearchBar) {
      return { height: headerHeight };
    }
    const distance = Math.max(0, scrollY.value);
    // Title row + equal gap + search bar (bottom gap lives in list paddingTop).
    const expanded = headerHeight + searchBarGap + searchBarHeight;
    const collapsed = headerHeight;
    return {
      height: interpolate(
        distance,
        [0, collapseDistance],
        [expanded, collapsed],
        Extrapolation.CLAMP,
      ),
    };
  });

  return (
    <AppHeader.Host>
      <TabsScreenHeaderContext.Provider value={ctx}>
        <View
          className={cn('absolute left-0 right-0 overflow-hidden', backgroundClassName)}
          style={{ paddingTop: topSafeHeight, zIndex: 1000 }}
          pointerEvents='box-none'
        >
          <Animated.View className={cn(className)} style={containerStyle}>
            <View
              className='z-10 flex-row items-center justify-between px-4'
              style={{ height: headerHeight }}
            >
              <View className='flex-row items-center gap-2'>{leading}</View>
              <View className='flex-row items-center gap-4'>{trailing}</View>
            </View>
            {searchSlots}
            {others}
          </Animated.View>
        </View>
      </TabsScreenHeaderContext.Provider>
    </AppHeader.Host>
  );
}

export const TabsScreenHeader = Object.assign(Root, {
  Leading,
  Trailing,
  SearchBar: TabsScreenHeaderSearchBar,
});
