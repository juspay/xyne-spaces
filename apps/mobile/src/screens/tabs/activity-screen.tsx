import {
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useValue } from '@legendapp/state/react';
import { useUniwind } from 'uniwind';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import { LegendListRef } from '@legendapp/list/react-native';
import {
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
  View,
  InteractionManager,
  Platform,
} from 'react-native';
import {
  ActivityFiltersFloatingButton,
  ActivityFiltersSheet,
  ActivityLoadingSkeleton,
  ActivityV2,
} from '@/src/components/activity';
import { useActivities } from '@/src/hooks/useActivities';
import { ActivityWithRelated, ActivityTab, TABS, actionableValues } from '@/src/types/activity';
import { ChatFilterTabs, type ChatFilterTabOption } from '@/src/components/chat/chat-filter-tabs';
import { ListEmptyState, EMPTY_STATE_BOTTOM_INSET } from '@/src/components/ui/empty-state';
import { getActivityEmptyContent } from '@/src/features/activity/presentation/activityEmptyContent';
import { getActorFilterKey } from '@/src/features/activity/domain/activityActorFilter';
import { actorFilterFrom } from '@/src/features/activity/model/preferences';
import { appliedActivityPreferences$ } from '@/src/features/activity/state/preferences-store';
import { mentionedYouColors } from '@/src/features/activity/model/mentioned-you-colors';
import { MentionPaletteOverrideContext } from '@/src/components/conversation-composer/rich-inline-text';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { useRegisterTabScrollToTop } from '@/src/hooks/useRegisterTabScrollToTop';
import { useTabHeaderScrollY } from '@/src/components/tab-pager/tab-pager-context';
import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';
import { useTabBarHeight } from '@/src/hooks/useTabBarHeight';
import { beginCriticalWindow, endCriticalWindow } from '@/src/utils/interactionCriticalWindow';
import { useReportTabReady } from '@/src/observability/logging/hooks/navigation/useReportTabReady';

const IMMEDIATE_ACTIVITY_AVATAR_ROW_COUNT = 8;
const ACTIVITY_DEFAULT_ESTIMATED_ROW_SIZE = 132;
// ~3 extra rows. 1200px previously mounted ~9 extra rows each way; idle rows
// then inflated full markdown trees and exhausted the 256MB Android Java heap.
const ACTIVITY_DRAW_DISTANCE = 360;
const ACTIVITY_END_REACHED_THRESHOLD = 2;
const ACTIVITY_ESTIMATED_LIST_SIZE = { height: 900, width: 400 } as const;
const ACTIVITY_SCROLL_SETTLE_FALLBACK_MS = 2_000;
const ACTIVITY_SCROLL_WINDOW_TAG = 'scroll:activity';
const SKELETON_ROW_ESTIMATED_HEIGHT = 112;
const ACTIVITY_LIST_DEFAULT_BOTTOM_PADDING = 100;
const ACTIVITY_IOS_BOTTOM_CONTROL_SPACE = 68;

type ActivityListItemType =
  'thread-rich' | 'mention-rich' | 'reaction-rich' | 'ticket-medium' | 'call-medium' | 'default';

const getActivityItemType = (item: ActivityWithRelated): ActivityListItemType => {
  switch (item.actorAction) {
    case 'replied':
    case 'replied_v2':
      return 'thread-rich';
    case 'mentioned_user':
    case 'group_mention':
    case 'direct_message':
      return 'mention-rich';
    case 'added':
    case 'added_v2':
    case 'removed':
    case 'removed_v2':
      return 'reaction-rich';
    case 'ticket_status':
    case 'ticket_eta':
    case 'ticket_board':
    case 'ticket_assigned_to':
    case 'ticket_pr_created':
    case 'ticket_pr_updated':
    case 'ticket_pr_merged':
    case 'ticket_pr_declined':
    case 'ticket_pr_reviewer_assigned':
    case 'ticket_qa_assigned':
    case 'ticket_assigned':
    case 'eta_warning':
    case 'eta_breach':
    case 'stage_eta_breach':
    case 'workflow_question':
      return 'ticket-medium';
    case 'scheduled_call':
    case 'call_reminder':
    case 'call_updated':
    case 'meeting_accepted':
    case 'meeting_declined':
    case 'paused_from_assignment':
    case 'resumed_from_assignment':
      return 'call-medium';
    default:
      return 'default';
  }
};

const ActivityEmptyState = ({
  activeTab,
  showUnreadOnly,
}: {
  activeTab: ActivityTab;
  showUnreadOnly: boolean;
}): ReactElement => {
  const content = getActivityEmptyContent(activeTab);

  if (showUnreadOnly) {
    return (
      <ListEmptyState
        illustration={content.illustration}
        title='No unread activities'
        subtitle="You're all caught up!"
      />
    );
  }

  return <ListEmptyState {...content} />;
};

const ActivityScreen = (): ReactElement => {
  const { topSafeHeight, headerHeight } = useHeaderHeight();
  const { tabBarHeight } = useTabBarHeight();
  const listPaddingTop = topSafeHeight + headerHeight;
  const listPaddingBottom =
    Platform.OS === 'ios'
      ? tabBarHeight + ACTIVITY_IOS_BOTTOM_CONTROL_SPACE
      : ACTIVITY_LIST_DEFAULT_BOTTOM_PADDING;

  const isFocused = useTabPageIsFocused();
  const [hasFirstLayout, setHasFirstLayout] = useState(false);
  const [shouldLoadRemoteAvatars, setShouldLoadRemoteAvatars] = useState(false);
  const [listViewportHeight, setListViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [scrollOffsetY, setScrollOffsetY] = useState(0);
  const headerTitleScrollY = useTabHeaderScrollY();
  const listRef = useRef<LegendListRef>(null);
  const { theme } = useUniwind();
  const mentionPalette = useMemo(() => mentionedYouColors(theme), [theme]);
  const scrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollOffsetYRef = useRef(0);
  const scrollListToTop = useCallback((animated = false) => {
    scrollOffsetYRef.current = 0;
    setScrollOffsetY(0);
    listRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);
  const scrollToTop = useCallback(() => scrollListToTop(true), [scrollListToTop]);
  useRegisterTabScrollToTop('activity', scrollToTop);

  // The filters sheet edits a draft; the feed follows what has been applied —
  // the same stores the Spaces design's filter tray uses.
  const unreadOnly = useValue(appliedActivityPreferences$.unreadOnly);
  const actorKind = useValue(appliedActivityPreferences$.actorKind);
  const actorUserId = useValue(appliedActivityPreferences$.actorUserId);
  const actionable = useValue(appliedActivityPreferences$.actionable);
  const actor = useMemo(
    () => actorFilterFrom({ actorKind, actorUserId }),
    [actorKind, actorUserId],
  );
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const openFilters = useCallback(() => setIsFiltersOpen(true), []);
  const closeFilters = useCallback(() => setIsFiltersOpen(false), []);

  const {
    activities,
    isLoading,
    loadMore,
    hasMore,
    isLoadingMore,
    activeTab,
    setActiveTab,
    showUnreadOnly,
    setShowUnreadOnly,
    activityCounts,
    markAsRead,
  } = useActivities({ screenReady: hasFirstLayout && isFocused, actor });

  useReportTabReady('activity', !isLoading);

  // Layout timing, so the model asks for the narrowed slice before the frame
  // that would show the old one.
  useLayoutEffect(() => {
    setShowUnreadOnly(unreadOnly);
  }, [setShowUnreadOnly, unreadOnly]);

  // Actionable swaps the chips; a chip that is not in the new set falls back to All.
  useLayoutEffect(() => {
    if (activeTab !== 'all' && actionableValues.has(activeTab) !== actionable) {
      setActiveTab('all');
    }
  }, [actionable, activeTab, setActiveTab]);

  // A narrower or wider feed starts from its top.
  const filtersKey = `${unreadOnly}:${actionable}:${getActorFilterKey(actor)}`;
  const appliedFiltersKey = useRef(filtersKey);
  useEffect(() => {
    if (appliedFiltersKey.current === filtersKey) return;
    appliedFiltersKey.current = filtersKey;
    scrollListToTop(false);
  }, [filtersKey, scrollListToTop]);

  const handleTabChange = useCallback(
    (tab: ActivityTab) => {
      setActiveTab(tab);
      scrollListToTop(false);
    },
    [scrollListToTop, setActiveTab],
  );

  const clearScrollSettleTimer = useCallback(() => {
    if (scrollSettleTimerRef.current === null) return;
    clearTimeout(scrollSettleTimerRef.current);
    scrollSettleTimerRef.current = null;
  }, []);

  const finishScrollInteraction = useCallback(() => {
    clearScrollSettleTimer();
    endCriticalWindow(ACTIVITY_SCROLL_WINDOW_TAG);
  }, [clearScrollSettleTimer]);

  const loadMoreIfNearEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement, contentInset } = event.nativeEvent;
      const viewportHeight = layoutMeasurement.height;
      if (viewportHeight <= 0) return;

      const distanceFromEnd =
        contentSize.height - contentOffset.y - viewportHeight - (contentInset?.bottom ?? 0);
      if (distanceFromEnd <= ACTIVITY_END_REACHED_THRESHOLD * viewportHeight) {
        loadMore();
      }
    },
    [loadMore],
  );

  const scheduleScrollSettleFallback = useCallback(() => {
    clearScrollSettleTimer();
    scrollSettleTimerRef.current = setTimeout(() => {
      scrollSettleTimerRef.current = null;
      finishScrollInteraction();
    }, ACTIVITY_SCROLL_SETTLE_FALLBACK_MS);
  }, [clearScrollSettleTimer, finishScrollInteraction]);

  useEffect(() => {
    if (isFocused) return;
    clearScrollSettleTimer();
    endCriticalWindow(ACTIVITY_SCROLL_WINDOW_TAG);
  }, [clearScrollSettleTimer, isFocused]);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setHasFirstLayout(true);
    setListViewportHeight(event.nativeEvent.layout.height);
  }, []);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollOffsetYRef.current = event.nativeEvent.contentOffset.y;
      // onEndReached is one-shot: a fire consumed while a fetch is in flight
      // never re-arms. Re-checking on the throttled scroll stream keeps
      // pagination flowing; loadMore's guards make the extra calls no-ops.
      loadMoreIfNearEnd(event);
    },
    [loadMoreIfNearEnd],
  );

  const commitScrollPosition = useCallback(() => {
    const nextOffset = scrollOffsetYRef.current;
    setScrollOffsetY(currentOffset => (currentOffset === nextOffset ? currentOffset : nextOffset));
  }, []);

  const handleScrollBeginDrag = useCallback(() => {
    beginCriticalWindow(ACTIVITY_SCROLL_WINDOW_TAG);
    clearScrollSettleTimer();
  }, [clearScrollSettleTimer]);

  const handleMomentumScrollBegin = useCallback(() => {
    beginCriticalWindow(ACTIVITY_SCROLL_WINDOW_TAG);
    scheduleScrollSettleFallback();
  }, [scheduleScrollSettleFallback]);

  const handleMomentumScrollEnd = useCallback(() => {
    commitScrollPosition();
    finishScrollInteraction();
  }, [commitScrollPosition, finishScrollInteraction]);

  const handleScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (event.nativeEvent.velocity?.y) {
        scheduleScrollSettleFallback();
        return;
      }
      commitScrollPosition();
      finishScrollInteraction();
    },
    [commitScrollPosition, finishScrollInteraction, scheduleScrollSettleFallback],
  );

  useEffect(() => {
    if (!isFocused || !hasFirstLayout || shouldLoadRemoteAvatars) {
      return;
    }

    const task = InteractionManager.runAfterInteractions(() => {
      setShouldLoadRemoteAvatars(true);
    });

    return (): void => {
      task.cancel();
    };
  }, [hasFirstLayout, isFocused, shouldLoadRemoteAvatars]);

  useEffect(() => {
    return (): void => {
      clearScrollSettleTimer();
      endCriticalWindow(ACTIVITY_SCROLL_WINDOW_TAG);
    };
  }, [clearScrollSettleTimer]);

  const footerGapHeight = useMemo(() => {
    if (!hasMore || listViewportHeight <= 0) {
      return 0;
    }

    return Math.max(0, scrollOffsetY + listViewportHeight - contentHeight);
  }, [contentHeight, hasMore, listViewportHeight, scrollOffsetY]);

  const footerSkeletonRows = useMemo(() => {
    const estimatedRows = Math.ceil(
      Math.max(footerGapHeight, SKELETON_ROW_ESTIMATED_HEIGHT) / SKELETON_ROW_ESTIMATED_HEIGHT,
    );
    return Math.max(1, estimatedRows);
  }, [footerGapHeight]);

  const initialSkeletonRows = useMemo(() => {
    const estimatedRows = Math.ceil(
      Math.max(listViewportHeight, SKELETON_ROW_ESTIMATED_HEIGHT * 4) /
        SKELETON_ROW_ESTIMATED_HEIGHT,
    );
    return Math.max(4, estimatedRows);
  }, [listViewportHeight]);

  const renderItem = useCallback(
    ({ item, index }: { item: ActivityWithRelated; index: number }) => (
      <ActivityV2
        activity={item}
        compactPreviews
        shouldLoadRemoteAvatars={
          shouldLoadRemoteAvatars || index < IMMEDIATE_ACTIVITY_AVATAR_ROW_COUNT
        }
      />
    ),
    [shouldLoadRemoteAvatars],
  );

  const keyExtractor = useCallback((item: ActivityWithRelated) => item.id, []);

  const activityFilterTabs: ChatFilterTabOption<ActivityTab>[] = useMemo(
    () =>
      TABS.filter(tab => tab.value === 'all' || actionableValues.has(tab.value) === actionable).map(
        tab => ({
          value: tab.value,
          label: tab.label,
          ...(tab.value === 'all' ? { count: activityCounts.all } : {}),
        }),
      ),
    [actionable, activityCounts],
  );

  const activityToolbar = useMemo(
    () => (
      <ChatFilterTabs
        tabs={activityFilterTabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        scrollable
      />
    ),
    [activityFilterTabs, activeTab, handleTabChange],
  );

  const listEmptyComponent = useMemo(
    () =>
      isLoading ? (
        <ActivityLoadingSkeleton
          rows={initialSkeletonRows}
          minHeight={Math.max(
            listViewportHeight,
            SKELETON_ROW_ESTIMATED_HEIGHT * initialSkeletonRows,
          )}
        />
      ) : (
        <ActivityEmptyState activeTab={activeTab} showUnreadOnly={showUnreadOnly} />
      ),
    [activeTab, initialSkeletonRows, isLoading, listViewportHeight, showUnreadOnly],
  );

  const listFooterComponent = useMemo(
    () =>
      !isLoading && (isLoadingMore || footerGapHeight > 0) ? (
        <ActivityLoadingSkeleton
          rows={footerSkeletonRows}
          minHeight={Math.max(footerGapHeight + 12, SKELETON_ROW_ESTIMATED_HEIGHT)}
        />
      ) : (
        <View style={{ height: 12 }} />
      ),
    [footerGapHeight, footerSkeletonRows, isLoading, isLoadingMore],
  );

  return (
    <View className='flex-1 bg-tabs-screen' onLayout={handleLayout}>
      {/* A mention of you takes the default chat bubble's colours, as on the new screen. */}
      <MentionPaletteOverrideContext.Provider value={mentionPalette}>
        <View className='flex-1 overflow-hidden bg-tabs-screen'>
          <AnimatedLegendList
            ref={listRef}
            data={activities}
            keyExtractor={keyExtractor}
            estimatedItemSize={ACTIVITY_DEFAULT_ESTIMATED_ROW_SIZE}
            getItemType={getActivityItemType}
            estimatedListSize={ACTIVITY_ESTIMATED_LIST_SIZE}
            drawDistance={ACTIVITY_DRAW_DISTANCE}
            recycleItems
            ListHeaderComponent={activityToolbar}
            ListEmptyComponent={listEmptyComponent}
            ListFooterComponent={listFooterComponent}
            contentContainerStyle={{
              paddingTop: listPaddingTop,
              // The tuned inset clears the floating filters button over real rows;
              // with none, fall back to the shared reserve so the empty state sits
              // at the same height as the other tabs.
              paddingBottom: activities.length === 0 ? EMPTY_STATE_BOTTOM_INSET : listPaddingBottom,
              flexGrow: 1,
            }}
            style={{ flex: 1, minHeight: 0 }}
            onScroll={handleScroll}
            sharedValues={{ scrollOffset: headerTitleScrollY }}
            onContentSizeChange={(_, height) => setContentHeight(height)}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            onEndReached={loadMore}
            onEndReachedThreshold={ACTIVITY_END_REACHED_THRESHOLD}
            onMomentumScrollBegin={handleMomentumScrollBegin}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            onScrollBeginDrag={handleScrollBeginDrag}
            onScrollEndDrag={handleScrollEndDrag}
            renderItem={renderItem}
          />
        </View>
      </MentionPaletteOverrideContext.Provider>

      <ActivityFiltersFloatingButton onPress={openFilters} />
      <ActivityFiltersSheet
        isOpen={isFiltersOpen}
        onClose={closeFilters}
        onMarkAsRead={markAsRead}
      />
    </View>
  );
};

export default ActivityScreen;
