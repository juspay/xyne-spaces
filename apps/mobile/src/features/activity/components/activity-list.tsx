import { useObserve, useValue } from '@legendapp/state/react';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import { type LegendListRef } from '@legendapp/list/react-native';
import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useUniwind } from 'uniwind';

import { ActivityLoadingSkeleton } from '@/src/components/activity';
import { ListEmptyState } from '@/src/components/ui/empty-state';
import { ScrollToTopButton } from '@/src/components/ui/scroll-to-top-button';
import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';
import { useFabClearance } from '@/src/features/quick-actions';
import { useReportTabReady } from '@/src/observability/logging/hooks/navigation/useReportTabReady';

import {
  ACTIVITY_AVATAR_GAP,
  ACTIVITY_DRAW_DISTANCE,
  ACTIVITY_END_REACHED_THRESHOLD,
  ACTIVITY_ROW_ESTIMATED_HEIGHT,
  ACTIVITY_SKELETON_ROW_HEIGHT,
} from '../constants';
import { useActivityRows } from '../hooks/use-activity-rows';
import { useActivityScroll } from '../hooks/use-activity-scroll';
import { resolveActivityFilter } from '../model/filter';
import { getActivityEmptyContent } from '../presentation/activityEmptyContent';
import { activityFilter$ } from '../state/filter-store';
import { activityRow$, activityRowOrder$ } from '../state/rows-store';
import { ActivityBodyEnvironment } from './activity-body';
import { ActivityFilterBar } from './activity-filter-bar';
import { ActivityRow } from './activity-row';

const keyExtractor = (id: string): string => id;

/**
 * Rows with a rich-text body and rows with a plain sentence or none have
 * different internals, so LegendList recycles within each rather than across
 * them. Read with `peek` — the type is a property of the row at the moment it
 * is placed, not something the list should subscribe to.
 */
const getItemType = (id: string): string => activityRow$(id).body.kind.peek() ?? 'none';

function renderRow({ item }: { item: string }): ReactElement {
  return (
    <ActivityRow id={item}>
      <ActivityRow.Leading />
      <View className='flex-1 min-w-0' style={{ marginLeft: ACTIVITY_AVATAR_GAP }}>
        <View className='flex-row items-center gap-2'>
          <ActivityRow.Actor />
          <ActivityRow.Time />
        </View>
        <ActivityRow.Summary />
        <ActivityRow.Body />
      </View>
    </ActivityRow>
  );
}

function ListEmpty({
  isLoading,
  viewportHeight,
}: {
  isLoading: boolean;
  viewportHeight: number;
}): ReactElement {
  const filter = useValue(activityFilter$);
  const { tab, unreadOnly } = resolveActivityFilter(filter);

  if (isLoading) {
    const rows = Math.max(4, Math.ceil(viewportHeight / ACTIVITY_SKELETON_ROW_HEIGHT));
    return <ActivityLoadingSkeleton rows={rows} minHeight={rows * ACTIVITY_SKELETON_ROW_HEIGHT} />;
  }

  const content = getActivityEmptyContent(tab);
  if (unreadOnly) {
    return (
      <ListEmptyState
        illustration={content.illustration}
        title='No unread activities'
        subtitle="You're all caught up!"
      />
    );
  }
  return <ListEmptyState {...content} />;
}

export function ActivityList(): ReactElement {
  const isFocused = useTabPageIsFocused();
  const [hasFirstLayout, setHasFirstLayout] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);

  const { loadMore, isLoading, isLoadingMore, isEmpty } = useActivityRows({
    screenReady: hasFirstLayout && isFocused,
  });

  /**
   * Ids, not rows: the list changes when an activity is added, removed or
   * reordered and at no other time. A read receipt does not touch it.
   */
  const order = useValue(activityRowOrder$);

  const listRef = useRef<LegendListRef>(null);

  // Written by the list on the UI thread; only the button reads it.
  const scrollOffset = useSharedValue(0);
  const sharedValues = useMemo(() => ({ scrollOffset }), [scrollOffset]);
  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
  }, []);

  // A new filter is a new list, so it starts at the top.
  useObserve(activityFilter$, () => {
    listRef.current?.scrollToOffset?.({ offset: 0, animated: false });
  });

  useReportTabReady('activity', !isLoading);

  const { theme } = useUniwind();
  const bottomInset = useFabClearance();
  const scroll = useActivityScroll({ loadMore, isFocused });

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setHasFirstLayout(true);
    setViewportHeight(event.nativeEvent.layout.height);
  }, []);

  const empty = useMemo(
    () => <ListEmpty isLoading={isLoading && isEmpty} viewportHeight={viewportHeight} />,
    [isEmpty, isLoading, viewportHeight],
  );

  const footer = useMemo(
    () =>
      isLoadingMore ? (
        <ActivityLoadingSkeleton rows={2} minHeight={ACTIVITY_SKELETON_ROW_HEIGHT * 2} />
      ) : null,
    [isLoadingMore],
  );

  return (
    <View className='flex-1 bg-spaces-background' onLayout={handleLayout}>
      <ActivityBodyEnvironment>
        <AnimatedLegendList
          ref={listRef}
          sharedValues={sharedValues}
          data={order}
          renderItem={renderRow}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          estimatedItemSize={ACTIVITY_ROW_ESTIMATED_HEIGHT}
          recycleItems
          drawDistance={ACTIVITY_DRAW_DISTANCE}
          // Recycled rows keep their component instance, so a theme switch
          // would otherwise leave resolved colors from the old theme on screen.
          extraData={theme}
          ListHeaderComponent={<ActivityFilterBar />}
          ListEmptyComponent={empty}
          ListFooterComponent={footer}
          onEndReached={loadMore}
          onEndReachedThreshold={ACTIVITY_END_REACHED_THRESHOLD}
          onScroll={scroll.onScroll}
          scrollEventThrottle={16}
          onScrollBeginDrag={scroll.onScrollBeginDrag}
          onScrollEndDrag={scroll.onScrollEndDrag}
          onMomentumScrollBegin={scroll.onMomentumScrollBegin}
          onMomentumScrollEnd={scroll.onMomentumScrollEnd}
          keyboardDismissMode='on-drag'
          keyboardShouldPersistTaps='handled'
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingBottom: bottomInset,
            flexGrow: order.length === 0 ? 1 : undefined,
          }}
        />
      </ActivityBodyEnvironment>
      <ScrollToTopButton offset={scrollOffset} onPress={scrollToTop} />
    </View>
  );
}
