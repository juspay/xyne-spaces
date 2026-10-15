import { DmFilterTab, useDmList } from '@/src/hooks/useDmList';
import { useDmListSwipeActions } from '@/src/hooks/useDmListSwipeActions';
import { useDeferredLiveData } from '@/src/hooks/useDeferredLiveData';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { DmListItemData } from '@/src/types/dm-list-item';
import { useSharedAuthContext } from '@xyne/shared/hooks';
import { useAuth } from '@/src/contexts/AuthContext';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import { LegendListRef } from '@legendapp/list/react-native';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useCSSVariable, useUniwind } from 'uniwind';
import type { SharedValue } from 'react-native-reanimated';

import ChatFilterTabs, { ChatFilterTabOption } from '@/src/components/chat/chat-filter-tabs';
import { useRegisterTabScrollToTop } from '@/src/hooks/useRegisterTabScrollToTop';
import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';
import { ListEmptyState, type EmptyIllustrationName } from '@/src/components/ui/empty-state';
import { DmListLoadingSkeleton } from './dm-list-item-skeleton';
import { DmListRow } from './dm-list-row';
import { dismissDmListContextMenus } from './dm-list-context-menu-events';
import { beginCriticalWindow, endCriticalWindow } from '@/src/utils/interactionCriticalWindow';
import { useReportTabReady } from '@/src/observability/logging/hooks/navigation/useReportTabReady';
import { useReportStartupReady } from '@/src/observability/logging/hooks/startup/useReportStartupReady';
import { useReportNotificationPhase } from '@/src/observability/logging/hooks/notification/useReportNotificationPhase';

type DmListProps = {
  headerTitleScrollY?: SharedValue<number> | undefined;
  onChannelSelect?: ((channelId: string) => void) | undefined;
};

type DmListItemType = 'dm';

// Half a viewport of lead time. loadMore now queues a request that lands
// mid-fetch, so onEndReached firing once per approach is enough — there is no
// need to start a full screen early to compensate for dropped fires.
const DM_END_REACHED_THRESHOLD = 0.5;
const DM_LIST_ITEM_HEIGHT = 68;
/** Below this count the list cannot scroll enough for load-more; hide footer skeletons. */
const DM_SKELETON_MIN_ROWS = 10;
const DM_SCROLL_WINDOW_TAG = 'scroll:dm';
// Momentum is bounded, and onMomentumScrollEnd normally closes the window. This
// only covers the Android scroll paths that report velocity on onScrollEndDrag
// but never deliver onMomentumScrollEnd. A drag has no bounded duration, so it
// uses beginCriticalWindow's much longer default instead.
const DM_MOMENTUM_WINDOW_TIMEOUT_MS = 2_000;

const getDmListItemType = (_item: DmListItemData): DmListItemType => 'dm';
const getDmListFixedItemSize = (
  _item: DmListItemData,
  _index: number,
  _type: string | undefined,
): number => DM_LIST_ITEM_HEIGHT;

type DmEmptyContent = {
  illustration: EmptyIllustrationName;
  title: string;
  subtitle: string;
};

function getFilterEmptyMessage(activeTab: DmFilterTab): DmEmptyContent {
  switch (activeTab) {
    case 'unread':
      return {
        illustration: 'dmUnread',
        title: 'All caught up',
        subtitle: 'You have no unread direct messages.',
      };
    case 'groups':
      return {
        illustration: 'dmGroups',
        title: 'No group chats',
        subtitle: 'Group conversations you join will appear here.',
      };
    case 'starred':
      return {
        illustration: 'channelStarred',
        title: 'No starred conversations',
        subtitle: 'Star a direct message to keep it within reach.',
      };
    case 'all':
    default:
      return {
        illustration: 'dms',
        title: 'No conversations yet',
        subtitle: 'Start a new chat with your team members.',
      };
  }
}

export const DmList = ({ headerTitleScrollY, onChannelSelect }: DmListProps = {}): ReactElement => {
  const { toggleStar, markAsRead, archive } = useDmListSwipeActions();
  const { userID: sharedUserID } = useSharedAuthContext();
  const { user } = useAuth();
  const userID = user?.user_id ?? sharedUserID;
  const workspaceId = user?.workspaceId ?? null;
  const isFocused = useTabPageIsFocused();
  const { theme } = useUniwind();
  const tabScreenBackgroundColor = useCSSVariable('--color-tabs-screen') as string;
  const { topSafeHeight, headerHeight, searchBarHeight, searchBarGap } = useHeaderHeight();
  const [activeTab, setActiveTab] = useState<DmFilterTab>('all');
  const didMarkFirstLayoutRef = useRef(false);
  const [hasFirstLayout, setHasFirstLayout] = useState(false);
  const listRef = useRef<LegendListRef>(null);
  const effectiveFilterTab = activeTab;

  const scrollListToTop = useCallback((animated = false) => {
    Keyboard.dismiss();
    listRef.current?.scrollToOffset?.({ offset: 0, animated });
  }, []);
  const scrollToTop = useCallback(() => scrollListToTop(true), [scrollListToTop]);
  useRegisterTabScrollToTop('dms', scrollToTop);

  const liveDataEnabled = useDeferredLiveData({
    name: 'dm_list',
    screen: 'dm_list',
    screenReady: hasFirstLayout && isFocused,
    // Keep the subscription mounted after its first activation. Switching
    // tabs should not tear it down and rematerialize the same window during
    // the next tap; screenReady still prevents the first activation off-tab.
    enabled: true,
    hasInitialData: false,
    delayMs: 700,
    noInitialDataDelayMs: 0,
    // Cached rows are already workspace-scoped and actionable. Let the first
    // live materialization wait for the current navigation/press interaction;
    // the bounded timeout in useDeferredLiveData still prevents starvation.
    preferImmediate: false,
  });

  const listPaddingTop =
    topSafeHeight + headerHeight + searchBarGap + searchBarHeight + searchBarGap;
  const listPaddingBottom = 100;
  const workspaceListKey = workspaceId ?? userID ?? 'anonymous';

  const {
    items,
    loadMore,
    hasMore,
    isLoading,
    hasLoadError,
    isSearching,
    isFiltering,
    isEmpty,
    unreadDmCount,
  } = useDmList({
    searchQuery: '',
    filterTab: effectiveFilterTab,
    liveDataEnabled,
  });

  useReportTabReady('dms', !(isLoading && isEmpty));
  useReportStartupReady('dms', !(isLoading && isEmpty));
  useReportNotificationPhase('dms_visible');

  const displayRows = items;

  useEffect(() => {
    if (isFocused) return;
    endCriticalWindow(DM_SCROLL_WINDOW_TAG);
  }, [isFocused]);

  useEffect(() => {
    return (): void => {
      endCriticalWindow(DM_SCROLL_WINDOW_TAG);
    };
  }, []);

  const keyExtractor = useCallback((item: DmListItemData) => item.id, []);

  const dismissTransientUi = useCallback(() => {
    Keyboard.dismiss();
    dismissDmListContextMenus();
  }, []);

  // A drag runs for as long as the finger is down — a slow read-as-you-scroll
  // easily passes a couple of seconds — and nothing re-arms the window while it
  // is underway. Expiring mid-gesture would let deferred live-data activation
  // run during the drag, which is the exact work this window exists to hold
  // back, so the drag takes beginCriticalWindow's long default. onScrollEndDrag
  // and onMomentumScrollEnd are what actually close it.
  const handleScrollBeginDrag = useCallback(() => {
    beginCriticalWindow(DM_SCROLL_WINDOW_TAG);
    dismissTransientUi();
  }, [dismissTransientUi]);

  // Momentum is self-limiting, so the short timeout is a safe fallback here.
  const handleMomentumScrollBegin = useCallback(() => {
    beginCriticalWindow(DM_SCROLL_WINDOW_TAG, DM_MOMENTUM_WINDOW_TIMEOUT_MS);
    dismissTransientUi();
  }, [dismissTransientUi]);

  const handleMomentumScrollEnd = useCallback(() => {
    endCriticalWindow(DM_SCROLL_WINDOW_TAG);
  }, []);

  const handleScrollEndDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // A flick is followed by momentum, and onMomentumScrollEnd closes the
    // window then. A lift with no velocity ends the interaction right here.
    if (event.nativeEvent.velocity?.y) return;
    endCriticalWindow(DM_SCROLL_WINDOW_TAG);
  }, []);

  const handleTabChange = useCallback((tab: DmFilterTab) => {
    Keyboard.dismiss();
    dismissDmListContextMenus();
    setActiveTab(tab);
  }, []);

  const dmFilterTabs = useMemo<ChatFilterTabOption<DmFilterTab>[]>(
    () => [
      { value: 'all', label: 'All' },
      { value: 'unread', label: 'Unread', count: unreadDmCount },
      { value: 'starred', label: 'Starred' },
      { value: 'groups', label: 'Groups' },
    ],
    [unreadDmCount],
  );

  const listHeader = useMemo(
    () => (
      <View className='px-3 pb-2.5'>
        <ChatFilterTabs tabs={dmFilterTabs} activeTab={activeTab} onTabChange={handleTabChange} />
      </View>
    ),
    [activeTab, dmFilterTabs, handleTabChange],
  );

  // Keep the pre-scroll skeleton for long lists (hasMore), but never under a
  // short list that cannot reach onEndReached — that left skeletons stuck.
  const listFooter = useMemo(() => {
    if (!hasMore || items.length < DM_SKELETON_MIN_ROWS || isSearching) {
      return null;
    }
    return <DmListLoadingSkeleton rows={2} />;
  }, [hasMore, items.length, isSearching]);

  const ListEmpty = useMemo(() => {
    if (isLoading && isEmpty) {
      return (
        <View className='flex-1 items-center justify-center py-16'>
          <ActivityIndicator size='large' />
        </View>
      );
    }
    if (hasLoadError && isEmpty) {
      return (
        <View className='flex-1 items-center justify-center px-8 py-16'>
          <Text className='text-lg font-medium text-white mb-2'>
            Couldn&apos;t load conversations
          </Text>
          <Text className='text-sm text-[#8E8E93] text-center'>
            Check your connection and try again.
          </Text>
        </View>
      );
    }
    if (isFiltering) {
      return <ListEmptyState {...getFilterEmptyMessage(activeTab)} />;
    }
    if (isSearching) {
      return (
        <ListEmptyState
          illustration='dms'
          title='No matching conversations'
          subtitle='Try a different name or group title.'
        />
      );
    }
    if (isEmpty) {
      return <ListEmptyState {...getFilterEmptyMessage('all')} />;
    }
    return null;
  }, [activeTab, hasLoadError, isEmpty, isFiltering, isLoading, isSearching]);

  const renderItem = useCallback(
    ({ item }: { item: DmListItemData }) => (
      <DmListRow
        item={item}
        onSelect={onChannelSelect}
        onToggleStar={toggleStar}
        onMarkAsRead={markAsRead}
        onArchive={archive}
      />
    ),
    [archive, markAsRead, onChannelSelect, toggleStar],
  );

  return (
    <View
      className='flex-1'
      style={{ backgroundColor: tabScreenBackgroundColor }}
      onLayout={() => {
        if (didMarkFirstLayoutRef.current) return;
        didMarkFirstLayoutRef.current = true;
        setHasFirstLayout(true);
      }}
    >
      <AnimatedLegendList
        ref={listRef}
        key={workspaceListKey}
        data={displayRows}
        drawDistance={700}
        estimatedItemSize={DM_LIST_ITEM_HEIGHT}
        getFixedItemSize={getDmListFixedItemSize}
        extraData={theme}
        getItemType={getDmListItemType}
        keyExtractor={keyExtractor}
        keyboardDismissMode='on-drag'
        keyboardShouldPersistTaps='handled'
        ListEmptyComponent={ListEmpty}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        recycleItems
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        {...(headerTitleScrollY ? { sharedValues: { scrollOffset: headerTitleScrollY } } : {})}
        style={{ flex: 1, backgroundColor: tabScreenBackgroundColor }}
        contentContainerStyle={{
          paddingTop: listPaddingTop,
          paddingBottom: listPaddingBottom,
          backgroundColor: tabScreenBackgroundColor,
          flexGrow: displayRows.length === 0 ? 1 : undefined,
        }}
        contentContainerClassName='bg-tabs-screen'
        onEndReached={loadMore}
        onEndReachedThreshold={DM_END_REACHED_THRESHOLD}
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
      />
    </View>
  );
};
