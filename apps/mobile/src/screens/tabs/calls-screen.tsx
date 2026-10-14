import { ReactElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, Keyboard, InteractionManager } from 'react-native';
import { LegendListRef } from '@legendapp/list/react-native';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import { CallLogItem, CallDetailsSheet } from '@/src/components/call-log';
import { useCalls, CallTab } from '@/src/hooks/useCalls';
import type { CallDisplayData } from '@/src/types/calls';

import { ChatFilterTabs, type ChatFilterTabOption } from '@/src/components/chat/chat-filter-tabs';
import { ListEmptyState, type EmptyIllustrationName } from '@/src/components/ui/empty-state';
import { useRegisterTabScrollToTop } from '@/src/hooks/useRegisterTabScrollToTop';
import { useTabHeaderScrollY } from '@/src/components/tab-pager/tab-pager-context';
import { useTabPageFocusEffect, useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';
import { CallsFab } from '@/src/components/call/calls-fab';
import { InstantCallSheet } from '@/src/components/call/instant-call-sheet';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import { useDeferredLiveData } from '@/src/hooks/useDeferredLiveData';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { useReportTabReady } from '@/src/observability/logging/hooks/navigation/useReportTabReady';

type CallListRow =
  | { type: 'header'; key: string; label: string } // date section header ("Today", "Mon May 6")
  | { type: 'section_label'; key: string; label: string } // section label ("UPCOMING CALLS", "RECENTS")
  | { type: 'item'; key: string; call: CallDisplayData }
  | { type: 'upcoming_item'; key: string; call: CallDisplayData };

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

const formatDateHeader = (ts: number, now: Date): string => {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/** Build date-sectioned rows for the recents / missed list. */
const buildDateGroupedRows = (calls: CallDisplayData[]): CallListRow[] => {
  if (calls.length === 0) return [];
  const rows: CallListRow[] = [];
  const now = new Date();
  const today = startOfDay(now.getTime());
  const yesterday = today - 86400000;
  let lastLabel: string | null = null;
  for (const call of calls) {
    const ts = call.startedAt ?? call.startsAt ?? call.createdAt;
    const dayStart = startOfDay(ts);
    let label: string;
    if (dayStart === today) label = 'Today';
    else if (dayStart === yesterday) label = 'Yesterday';
    else label = formatDateHeader(ts, now);
    if (label !== lastLabel) {
      rows.push({ type: 'header', key: `h:${label}:${dayStart}`, label });
      lastLabel = label;
    }
    rows.push({ type: 'item', key: call.id, call });
  }
  return rows;
};

/**
 * Build the full flat row list for the LegendList.
 *
 * ALL tab:  ["UPCOMING CALLS" label + upcoming items] + ["RECENTS" label + date-grouped recents]
 * UPCOMING: date-sectioned upcoming items
 * MISSED:   date-grouped recent items
 */
const buildGroupedRows = (
  activeTab: CallTab,
  calls: CallDisplayData[],
  upcomingCalls: CallDisplayData[],
): CallListRow[] => {
  if (activeTab === CallTab.ALL) {
    const rows: CallListRow[] = [];

    if (upcomingCalls.length > 0) {
      rows.push({ type: 'section_label', key: '__upcoming_label__', label: 'UPCOMING CALLS' });
      for (const call of upcomingCalls) {
        rows.push({ type: 'upcoming_item', key: `up:${call.id}`, call });
      }
    }

    if (calls.length > 0) {
      rows.push(...buildDateGroupedRows(calls));
    }

    return rows;
  }

  if (activeTab === CallTab.UPCOMING) {
    // Date-section upcoming calls by their scheduled start date
    if (calls.length === 0) return [];
    const rows: CallListRow[] = [];
    const now = new Date();
    const today = startOfDay(now.getTime());
    const tomorrow = today + 86400000;
    let lastLabel: string | null = null;
    for (const call of calls) {
      const ts = call.startsAt ?? call.createdAt;
      const dayStart = startOfDay(ts);
      let label: string;
      if (dayStart === today) label = 'Today';
      else if (dayStart === tomorrow) label = 'Tomorrow';
      else label = formatDateHeader(ts, now);
      if (label !== lastLabel) {
        rows.push({ type: 'header', key: `h:${label}:${dayStart}`, label });
        lastLabel = label;
      }
      rows.push({ type: 'upcoming_item', key: call.id, call });
    }
    return rows;
  }

  // MISSED tab
  return buildDateGroupedRows(calls);
};

const DateSectionHeader = memo(({ label }: { label: string }) => (
  <View className='px-4 pt-6 pb-2 bg-tabs-screen'>
    <Text className='text-xs font-semibold uppercase text-secondary-foreground tracking-wide'>
      {label}
    </Text>
  </View>
));
DateSectionHeader.displayName = 'DateSectionHeader';

const SectionLabel = memo(({ label }: { label: string }) => (
  <View className='px-4 pt-6 pb-2 bg-tabs-screen'>
    <Text className='text-xs font-semibold uppercase tracking-widest text-secondary-foreground font-mono'>
      {label}
    </Text>
  </View>
));
SectionLabel.displayName = 'SectionLabel';

const FooterLoader = memo(({ isFetchingMore }: { isFetchingMore: boolean }) => {
  if (!isFetchingMore) return null;
  return (
    <View className='py-4 items-center'>
      <ActivityIndicator size='small' />
    </View>
  );
});
FooterLoader.displayName = 'FooterLoader';

const EmptyState = memo(({ activeTab }: { activeTab: string }) => {
  const getContent = (): {
    illustration: EmptyIllustrationName;
    title: string;
    subtitle: string;
  } => {
    switch (activeTab) {
      case CallTab.UPCOMING:
        return {
          illustration: 'callsUpcoming',
          title: 'No upcoming calls',
          subtitle: 'Your calendar is clear. Schedule a call to get started.',
        };
      case CallTab.MISSED:
        return {
          illustration: 'callsMissed',
          title: 'No missed calls',
          subtitle: "You haven't missed any calls. All caught up!",
        };
      default:
        return {
          illustration: 'calls',
          title: 'No calls yet',
          subtitle: 'Start a conversation by making your first call.',
        };
    }
  };

  return <ListEmptyState {...getContent()} />;
});
EmptyState.displayName = 'EmptyState';

// Static extractors - defined outside component to maintain referential equality
const keyExtractor = (item: CallListRow): string => item.key;
const getItemType = (item: CallListRow): string => item.type;
const IMMEDIATE_CALL_AVATAR_ROW_COUNT = 8;

const CallsScreen = (): ReactElement => {
  const { topSafeHeight, headerHeight, searchBarHeight, searchBarGap } = useHeaderHeight();
  // Same inset as DMs/Channels: clear absolute title + search, then one gap above filters.
  // TabsScreenHeader expanded height is title + gap + search; trailing gap lives in list padding.
  const listPaddingTop =
    topSafeHeight + headerHeight + searchBarGap + searchBarHeight + searchBarGap;
  const listPaddingBottom = 100;

  const listRef = useRef<LegendListRef>(null);
  const endReachedArmedRef = useRef(false);
  const scrollY = useTabHeaderScrollY();
  const scrollListToTop = useCallback(
    (animated = false) => {
      scrollY.value = 0;
      listRef.current?.scrollToOffset({ offset: 0, animated });
    },
    [scrollY],
  );
  const scrollToTop = useCallback(() => scrollListToTop(true), [scrollListToTop]);
  useRegisterTabScrollToTop('calls', scrollToTop);
  useTabPageFocusEffect(
    useCallback(() => {
      endReachedArmedRef.current = false;
      scrollListToTop(false);
    }, [scrollListToTop]),
  );
  const zero = useZero();
  const isFocused = useTabPageIsFocused();
  const [hasFirstLayout, setHasFirstLayout] = useState(false);
  const liveDataEnabled = useDeferredLiveData({
    name: 'calls',
    screen: 'calls',
    screenReady: hasFirstLayout && isFocused,
    hasInitialData: false,
    delayMs: 900,
    noInitialDataDelayMs: 0,
  });

  const {
    calls,
    upcomingCalls,
    isLoading,
    isFetchingMore,
    hasMore,
    loadMore,
    activeTab,
    setActiveTab,
    searchQuery: _searchQuery,
    setSearchQuery: _setSearchQuery,
  } = useCalls({ liveDataEnabled });
  void _searchQuery;
  void _setSearchQuery;

  useReportTabReady('calls', !isLoading);

  const [selectedCall, setSelectedCall] = useState<CallDisplayData | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isInstantCallOpen, setIsInstantCallOpen] = useState(false);
  const [shouldMountCallSheets, setShouldMountCallSheets] = useState(false);
  const [shouldLoadRemoteAvatars, setShouldLoadRemoteAvatars] = useState(false);

  const handleLayout = useCallback(() => {
    setHasFirstLayout(true);
  }, []);

  // Keep this mutation off cold start and the tab-press frame.
  useEffect(() => {
    if (!isFocused || !liveDataEnabled) {
      return;
    }

    const task = InteractionManager.runAfterInteractions(() => {
      void zero.mutate(mutators.activities.markMissedCallsAsRead({}));
    });

    return (): void => task.cancel();
  }, [isFocused, liveDataEnabled, zero]);

  useEffect(() => {
    if (!isFocused || (shouldMountCallSheets && shouldLoadRemoteAvatars)) {
      return;
    }

    const task = InteractionManager.runAfterInteractions(() => {
      if (!shouldMountCallSheets) {
        setShouldMountCallSheets(true);
      }
      if (!shouldLoadRemoteAvatars) {
        setShouldLoadRemoteAvatars(true);
      }
    });

    return (): void => task.cancel();
  }, [isFocused, shouldLoadRemoteAvatars, shouldMountCallSheets]);

  // Row press: open the call details sheet
  const handleCallPress = useCallback((call: CallDisplayData) => {
    Keyboard.dismiss();
    setSelectedCall(call);
    setIsDetailsOpen(true);
  }, []);

  // Handler for avatar press - opens call details sheet (matches DM pattern)
  const handleAvatarPress = useCallback((call: CallDisplayData) => {
    Keyboard.dismiss();
    setSelectedCall(call);
    setIsDetailsOpen(true);
  }, []);

  // groupedRows: for ALL tab, prepend upcoming section; for UPCOMING/MISSED, flat date-sectioned list.
  const groupedRows = useMemo<CallListRow[]>(
    () => buildGroupedRows(activeTab, calls, upcomingCalls),
    [activeTab, calls, upcomingCalls],
  );

  const handleTabChange = useCallback(
    (tab: CallTab) => {
      endReachedArmedRef.current = false;
      setActiveTab(tab);
      scrollListToTop(false);
    },
    [scrollListToTop, setActiveTab],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: CallListRow; index: number }) => {
      if (item.type === 'header') {
        return <DateSectionHeader label={item.label} />;
      }
      if (item.type === 'section_label') {
        return <SectionLabel label={item.label} />;
      }
      // Both 'item' and 'upcoming_item' render the same CallLogItem;
      // CallLogItem already handles isScheduled / isActive visually.
      return (
        <CallLogItem
          call={item.call}
          onPress={handleCallPress}
          onAvatarPress={handleAvatarPress}
          deferRemoteAvatarLoad={
            !shouldLoadRemoteAvatars && index >= IMMEDIATE_CALL_AVATAR_ROW_COUNT
          }
        />
      );
    },
    [handleCallPress, handleAvatarPress, shouldLoadRemoteAvatars],
  );

  const armEndReached = useCallback(() => {
    endReachedArmedRef.current = true;
  }, []);

  const handleEndReached = useCallback(() => {
    if (!endReachedArmedRef.current) {
      return;
    }
    endReachedArmedRef.current = false;
    if (activeTab === CallTab.UPCOMING) {
      return;
    }
    if (!isFetchingMore && hasMore) {
      loadMore();
    }
  }, [activeTab, isFetchingMore, hasMore, loadMore]);

  const callFilterTabs: ChatFilterTabOption<CallTab>[] = useMemo(
    () => [
      { value: CallTab.ALL, label: 'All' },
      { value: CallTab.UPCOMING, label: 'Upcoming' },
      { value: CallTab.MISSED, label: 'Missed' },
    ],
    [],
  );

  const callToolbar = useMemo(
    () => (
      <View className='px-3 pb-2.5'>
        <ChatFilterTabs tabs={callFilterTabs} activeTab={activeTab} onTabChange={handleTabChange} />
      </View>
    ),
    [callFilterTabs, activeTab, handleTabChange],
  );
  const listFooter = useMemo(
    () => <FooterLoader isFetchingMore={isFetchingMore} />,
    [isFetchingMore],
  );
  const listEmptyComponent = useMemo(
    () =>
      isLoading ? (
        <View className='flex-1 items-center justify-center py-16'>
          <ActivityIndicator size='large' />
        </View>
      ) : (
        <EmptyState activeTab={activeTab} />
      ),
    [activeTab, isLoading],
  );

  // const { theme } = useUniwind();
  // const headerGradientColors =
  //   theme === 'dark'
  //     ? (['#1f2a3a', '#1a1d2c', '#0e1018'] as const)
  //     : (['#a8c4dc', '#c5b8d8'] as const);
  // const headerGradientLocations = theme === 'dark' ? ([0, 0.6, 1] as const) : ([0, 1] as const);

  return (
    <View className='flex-1 bg-tabs-screen' onLayout={handleLayout} onTouchStart={Keyboard.dismiss}>
      <View className='flex-1 bg-tabs-screen'>
        <AnimatedLegendList
          ref={listRef}
          data={groupedRows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          getItemType={getItemType}
          estimatedItemSize={76}
          drawDistance={320}
          recycleItems
          keyboardShouldPersistTaps='handled'
          keyboardDismissMode='on-drag'
          ListHeaderComponent={callToolbar}
          ListEmptyComponent={listEmptyComponent}
          ListFooterComponent={listFooter}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          onMomentumScrollBegin={armEndReached}
          onScrollBeginDrag={armEndReached}
          sharedValues={{ scrollOffset: scrollY }}
          scrollEventThrottle={16}
          contentContainerStyle={{
            paddingTop: listPaddingTop,
            paddingBottom: listPaddingBottom,
            flexGrow: groupedRows.length === 0 ? 1 : undefined,
          }}
          contentContainerClassName='bg-tabs-screen'
          contentInsetAdjustmentBehavior='never'
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
        />
      </View>

      {isFocused && (
        <CallsFab
          onPress={() => setIsInstantCallOpen(true)}
          isHidden={isInstantCallOpen || isDetailsOpen}
        />
      )}

      {(shouldMountCallSheets || isInstantCallOpen) && (
        <InstantCallSheet isOpen={isInstantCallOpen} onClose={() => setIsInstantCallOpen(false)} />
      )}

      {selectedCall ? (
        <CallDetailsSheet
          call={selectedCall}
          isOpen={isDetailsOpen}
          onOpenChange={setIsDetailsOpen}
          onDeleted={() => setIsDetailsOpen(false)}
          onDismiss={() => setSelectedCall(null)}
        />
      ) : null}
    </View>
  );
};

export default CallsScreen;
