import { useValue, useObserve } from '@legendapp/state/react';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import { type LegendListRef } from '@legendapp/list/react-native';
import { useCallback, useMemo, useRef, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { useUniwind } from 'uniwind';

import { ScrollToTopButton } from '@/src/components/ui/scroll-to-top-button';

import { useFabClearance } from '@/src/features/quick-actions';
import { useReportTabReady } from '@/src/observability/logging/hooks/navigation/useReportTabReady';

import {
  DM_AVATAR_GAP,
  DM_AVATAR_SIZE,
  DM_BADGE_GAP,
  DM_META_TOP,
  DM_PREVIEW_GAP,
  DM_ROW_HEIGHT,
  DM_ROW_PADDING_LEFT,
  DM_ROW_PADDING_RIGHT,
  DM_TEXT_TOP,
} from '../constants';
import { useDmRows } from '../hooks/use-dm-rows';
import { dmFilter$ } from '../state/filter-store';
import { dmRowOrder$ } from '../state/rows-store';
import { DmRow } from './dm-row';
import { DmListSkeleton } from './dm-row-skeleton';
import { DmsFilterBar } from './dms-filter-bar';

/** Half a viewport of lead time before `onEndReached`. */
const END_REACHED_THRESHOLD = 0.5;

/** Enough placeholder rows to fill a phone screen while page 1 loads. */
const INITIAL_SKELETON_ROWS = 10;
/** Placeholder rows under the list while the next page loads. */
const LOAD_MORE_SKELETON_ROWS = 2;

const getFixedItemSize = (): number => DM_ROW_HEIGHT;
const getItemType = (): string => 'dm';
const keyExtractor = (id: string): string => id;

type DmsListProps = {
  onChannelSelect?: ((channelId: string) => void) | undefined;
};

export function DmsList({ onChannelSelect }: DmsListProps = {}): ReactElement {
  const { loadMore, hasMore, isLoading, isLoadingMore, hasLoadError, isEmpty, isFiltering } =
    useDmRows();

  /**
   * Ids, not rows.
   *
   * This is what keeps the list cheap: it changes when a conversation is
   * added, removed or reordered, and at no other time. A new message in a
   * conversation already at the top does not touch it.
   */
  const order = useValue(dmRowOrder$);

  const listRef = useRef<LegendListRef>(null);

  // Written by the list on the UI thread; only the button reads it.
  const scrollOffset = useSharedValue(0);
  const sharedValues = useMemo(() => ({ scrollOffset }), [scrollOffset]);
  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
  }, []);

  /**
   * A new filter is a new list, so it starts at the top.
   *
   * Without this, switching from All at 40 rows down into Starred keeps the
   * offset and lands the user in the middle of a shorter list — or past the
   * end of it.
   *
   * `useObserve` rather than reading the filter: the list does not need to
   * render when the chip changes. It renders when `order` changes, which th
e
   * sync does a moment later anyway.
   */
  useObserve(dmFilter$, () => {
    listRef.current?.scrollToOffset?.({ offset: 0, animated: false });
  });

  useReportTabReady('dms', !(isLoading && isEmpty));

  const { theme } = useUniwind();
  const bottomInset = useFabClearance();

  const renderItem = useCallback(
    ({ item }: { item: string }) => (
      <DmRow id={item} onSelect={onChannelSelect}>
        <View
          className='flex-row h-full'
          style={{
            paddingLeft: DM_ROW_PADDING_LEFT,
            paddingRight: DM_ROW_PADDING_RIGHT,
          }}
        >
          <View style={{ paddingTop: (DM_ROW_HEIGHT - DM_AVATAR_SIZE) / 2 }}>
            <DmRow.Avatar />
          </View>

          <View
            className='flex-1 min-w-0'
            style={{ marginLeft: DM_AVATAR_GAP, paddingTop: DM_TEXT_TOP }}
          >
            <DmRow.Title />
            <View style={{ marginTop: DM_PREVIEW_GAP }}>
              <DmRow.Preview />
            </View>
          </View>

          <View className='items-end' style={{ paddingLeft: 8, paddingTop: DM_META_TOP }}>
            <DmRow.Timestamp />
            <View className='flex-row items-center gap-1' style={{ marginTop: DM_BADGE_GAP }}>
              <DmRow.Starred />
              <DmRow.UnreadBadge />
            </View>
          </View>
        </View>
      </DmRow>
    ),
    [onChannelSelect],
  );

  const empty = useMemo(() => {
    if (isLoading && isEmpty) {
      return (
        <DmListSkeleton rows={INITIAL_SKELETON_ROWS} accessibilityLabel='Loading conversations' />
      );
    }
    if (hasLoadError && isEmpty) {
      return (
        <View className='flex-1 items-center justify-center px-8 py-16'>
          <Text className='text-base font-medium text-spaces-foreground mb-1'>
            Couldn&apos;t load conversations
          </Text>
          <Text className='text-sm text-spaces-muted text-center'>
            Check your connection and try again.
          </Text>
        </View>
      );
    }
    if (isEmpty) {
      return (
        <View className='flex-1 items-center justify-center px-8 py-16'>
          <Text className='text-base font-medium text-spaces-foreground mb-1'>
            {isFiltering ? 'Nothing here' : 'No conversations yet'}
          </Text>
          <Text className='text-sm text-spaces-muted text-center'>
            {isFiltering
              ? 'No conversations match this filter.'
              : 'Start a new chat with your team members.'}
          </Text>
        </View>
      );
    }
    return null;
  }, [hasLoadError, isEmpty, isFiltering, isLoading]);

  /**
   * Below the last row: placeholders while the next page loads, and once
   * there is nothing left to load, a quiet note pointing at the new-DM button
   * instead of the list just stopping.
   */
  const footer = useMemo(() => {
    if (order.length === 0) return null;
    if (isLoadingMore) {
      return (
        <DmListSkeleton
          rows={LOAD_MORE_SKELETON_ROWS}
          accessibilityLabel='Loading more conversations'
        />
      );
    }
    if (hasMore) return null;
    return (
      <View
        className='bg-spaces-surface justify-center'
        style={{
          minHeight: 48,
          paddingLeft: DM_ROW_PADDING_LEFT,
          paddingRight: DM_ROW_PADDING_RIGHT,
        }}
      >
        <Text className='text-sm text-spaces-muted'>Tap on the button to start a new DM</Text>
      </View>
    );
  }, [hasMore, isLoadingMore, order.length]);

  return (
    <View className='flex-1'>
      <AnimatedLegendList
        ref={listRef}
        sharedValues={sharedValues}
        data={order}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        // Fixed, so the list never measures a row and never corrects a scroll
        // position after one lands.
        estimatedItemSize={DM_ROW_HEIGHT}
        getFixedItemSize={getFixedItemSize}
        recycleItems
        drawDistance={700}
        // Recycled rows keep their component instance, so a theme switch would
        // otherwise leave resolved colors from the old theme on screen.
        extraData={theme}
        ListHeaderComponent={<DmsFilterBar />}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onEndReached={loadMore}
        onEndReachedThreshold={END_REACHED_THRESHOLD}
        keyboardDismissMode='on-drag'
        keyboardShouldPersistTaps='handled'
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingBottom: bottomInset,
          flexGrow: order.length === 0 ? 1 : undefined,
          paddingBlock: 12,
        }}
        className='bg-spaces-background'
      />
      <ScrollToTopButton offset={scrollOffset} onPress={scrollToTop} />
    </View>
  );
}
