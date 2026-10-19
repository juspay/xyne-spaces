import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ChatFilterTabs, { type ChatFilterTabOption } from '@/src/components/chat/chat-filter-tabs';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { cn } from '@/src/utils/cn';

import {
  TICKET_LIST_ESTIMATED_ITEM_SIZE,
  TICKET_LIST_ROW_HEIGHT,
  TICKET_MAILBOX_FOLDERS,
  TICKETS_LIST_DRAW_DISTANCE,
} from '../../constants';
import type { TicketListItemData, TicketMailboxFolder } from '../../types';
import { getTicketListItemPosition } from '../../utils';
import { TicketsListEmptyState } from './tickets-list-empty-state';
import { TicketsListItem } from './tickets-list-item';
import { TicketsListSkeleton } from './tickets-list-skeleton';

export type TicketsListProps = {
  items: TicketListItemData[];
  isEmpty: boolean;
  isInitialLoading: boolean;
  activeFolder: TicketMailboxFolder;
  /** EMAIL desks only — show Inbox / All Mail / … pills above the list. */
  showMailboxFolders: boolean;
  isSelecting: boolean;
  allSelected: boolean;
  /** Required so LegendList re-renders recycled rows when selection changes. */
  selectedIds: ReadonlySet<string>;
  hasActiveFilters: boolean;
  emptyTitle?: string | undefined;
  emptySubtitle?: string | undefined;
  extraBottomPadding?: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onSelectFolder: (folder: TicketMailboxFolder) => void;
  onToggleSelect: (id: string) => void;
  onEnterSelection: (id: string) => void;
  onToggleSelectAll: () => void;
};

/**
 * Layout: absolute header clearance + folder pills (siblings) + flex-1 list.
 * Pills stay sticky because they sit outside the scrolling LegendList.
 */
export function TicketsList({
  items,
  isEmpty,
  isInitialLoading,
  activeFolder,
  showMailboxFolders,
  isSelecting,
  allSelected,
  selectedIds,
  hasActiveFilters,
  emptyTitle,
  emptySubtitle,
  extraBottomPadding = 0,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onSelectFolder,
  onToggleSelect,
  onEnterSelection,
  onToggleSelectAll,
}: TicketsListProps) {
  const { channelId } = useLocalSearchParams<{ channelId: string }>();
  const { headerHeight, topSafeHeight } = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const checkColor = useCSSVariable('--color-accent-foreground') as string;
  const [listViewportHeight, setListViewportHeight] = useState(280);

  const stickyChromeHeight = topSafeHeight + headerHeight;
  const listTopPad = insets.top / 2;

  const onListViewportLayout = useCallback((e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.height);
    if (next > 0) setListViewportHeight(prev => (prev === next ? prev : next));
  }, []);

  const folderTabs = useMemo<ChatFilterTabOption<TicketMailboxFolder>[]>(
    () => TICKET_MAILBOX_FOLDERS.map(folder => ({ value: folder.id, label: folder.label })),
    [],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: TicketListItemData; index: number }) => (
      <TicketsListItem
        data={item}
        channelId={channelId}
        position={getTicketListItemPosition(index, items.length)}
        showStar={showMailboxFolders}
        isSelecting={isSelecting}
        isSelected={selectedIds.has(item.id)}
        onToggleSelect={onToggleSelect}
        onEnterSelection={onEnterSelection}
      />
    ),
    [
      channelId,
      items.length,
      showMailboxFolders,
      isSelecting,
      selectedIds,
      onToggleSelect,
      onEnterSelection,
    ],
  );

  const keyExtractor = useCallback((item: TicketListItemData) => item.id, []);
  const getFixedItemSize = useCallback(() => TICKET_LIST_ROW_HEIGHT, []);

  const bodyChrome = useMemo(() => {
    if (isSelecting) {
      return (
        <Pressable
          accessibilityRole='checkbox'
          accessibilityState={{ checked: allSelected }}
          accessibilityLabel='Select all'
          hitSlop={8}
          onPress={onToggleSelectAll}
          className='mb-1 flex-row items-center gap-3 px-4 py-2'
        >
          <View
            className={cn(
              'size-5.5 items-center justify-center rounded-md border-2',
              allSelected
                ? 'border-blue-700 bg-blue-700'
                : 'border-foreground/35 bg-card dark:border-foreground/45',
            )}
          >
            {allSelected ? <Check size={14} color={checkColor} strokeWidth={3} /> : null}
          </View>
          <Text className='text-[15px] font-medium text-foreground'>Select all</Text>
        </Pressable>
      );
    }
    if (!showMailboxFolders) return null;
    return (
      <View className='pb-1'>
        <ChatFilterTabs
          scrollable
          tabs={folderTabs}
          activeTab={activeFolder}
          onTabChange={onSelectFolder}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{
            paddingVertical: 4,
            paddingHorizontal: 12,
            paddingBottom: 8,
            gap: 8,
          }}
        />
      </View>
    );
  }, [
    isSelecting,
    allSelected,
    onToggleSelectAll,
    checkColor,
    showMailboxFolders,
    folderTabs,
    activeFolder,
    onSelectFolder,
  ]);

  const listEmpty = useMemo(() => {
    if (isInitialLoading) {
      return <TicketsListSkeleton />;
    }
    if (!isEmpty) return null;
    if (emptyTitle) {
      return (
        <TicketsListEmptyState
          minHeight={listViewportHeight}
          title={emptyTitle}
          {...(emptySubtitle ? { subtitle: emptySubtitle } : {})}
        />
      );
    }
    if (hasActiveFilters) {
      return (
        <TicketsListEmptyState
          minHeight={listViewportHeight}
          title='No tickets found'
          subtitle='Nothing matches the selected filters. Try clearing or changing them.'
        />
      );
    }
    return (
      <TicketsListEmptyState
        minHeight={listViewportHeight}
        title='No tickets yet'
        subtitle='New support emails for this desk will show up here.'
      />
    );
  }, [isEmpty, isInitialLoading, hasActiveFilters, listViewportHeight, emptyTitle, emptySubtitle]);

  const handleEndReached = useCallback(() => {
    if (hasMore && !isLoadingMore) onLoadMore();
  }, [hasMore, isLoadingMore, onLoadMore]);

  const listFooter = useMemo(() => {
    if (isEmpty || isInitialLoading) return null;
    if (isLoadingMore) {
      return (
        <View className='items-center py-4'>
          <ActivityIndicator />
        </View>
      );
    }
    return <View className='h-3' />;
  }, [isEmpty, isInitialLoading, isLoadingMore]);

  const fillRemaining = isEmpty || isInitialLoading;

  return (
    <View className='flex-1 bg-neutral-100 dark:bg-tabs-screen'>
      {/* Non-scrolling clearance for the absolute TicketsListHeader */}
      <View style={{ height: stickyChromeHeight + listTopPad }} />

      {/* Sibling of the list → stays sticky while rows scroll */}
      {bodyChrome}

      {/* Rest of the screen: only this region scrolls */}
      <View className='min-h-0 flex-1' onLayout={onListViewportLayout}>
        <LegendList
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          recycleItems
          getFixedItemSize={getFixedItemSize}
          estimatedItemSize={TICKET_LIST_ESTIMATED_ITEM_SIZE}
          drawDistance={TICKETS_LIST_DRAW_DISTANCE}
          showsVerticalScrollIndicator={false}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={listEmpty}
          ListFooterComponent={listFooter}
          extraData={selectedIds}
          style={{ flex: 1 }}
          className='bg-neutral-100 dark:bg-tabs-screen'
          contentContainerStyle={{
            paddingBottom: insets.bottom + extraBottomPadding,
            paddingHorizontal: 4,
            ...(fillRemaining ? { flexGrow: 1 } : null),
          }}
        />
      </View>
    </View>
  );
}
