import { LegendList } from '@legendapp/list/react-native';
import { type ReactElement, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useUniwind } from 'uniwind';

import { haptics } from '@/src/utils/haptics';
import { AppHeader } from '@/src/components/app-header';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { Badge } from '@/src/components/ui/badge';
import {
  ListEmptyState,
  EMPTY_STATE_BOTTOM_INSET,
  type EmptyIllustrationName,
} from '@/src/components/ui/empty-state';
import { useAuthContextValues } from '@/src/contexts/AuthContext';
import {
  BookmarkListDivider,
  BookmarkListItem,
} from '@/src/features/bookmarks/components/bookmark-list-item';
import {
  BOOKMARK_TABS,
  partitionMessageBookmarks,
  type BookmarkTab,
} from '@/src/features/bookmarks/bookmark-utils';
import {
  MessageReminderOptionsSheet,
  type MessageActionsTarget,
} from '@/src/features/chat/v2/components/message-actions-sheet';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';

const SHEET_TOP_RADIUS = 28;
const DEFAULT_BOOKMARK_TAB_LABEL = 'Bookmarks';
const BOOKMARK_EMPTY_STATE: Record<
  BookmarkTab,
  { title: string; description: string; illustration: EmptyIllustrationName }
> = {
  all: {
    title: 'No bookmarks yet',
    description: 'Saved messages and reminders will appear here.',
    illustration: 'bookmarks',
  },
  reminder: {
    title: 'No reminders yet',
    description: 'Message reminders will appear here.',
    illustration: 'bookmarkReminders',
  },
  complete: {
    title: 'No completed bookmarks',
    description: 'Bookmarks you mark complete will appear here.',
    illustration: 'bookmarkComplete',
  },
};

const BookmarksScreen = (): ReactElement => {
  const router = useRouter();
  const { theme } = useUniwind();
  const { userID } = useAuthContextValues();
  const [activeTab, setActiveTab] = useState<BookmarkTab>('all');
  const [reminderTarget, setReminderTarget] = useState<MessageActionsTarget | null>(null);
  const [isReminderSheetOpen, setIsReminderSheetOpen] = useState(false);
  const { messageId: targetMessageIdParam } = useLocalSearchParams<{ messageId?: string }>();
  const targetMessageId = Array.isArray(targetMessageIdParam)
    ? targetMessageIdParam[0]
    : targetMessageIdParam;
  const [rawBookmarks] = useQuery(queries.userBookmarks());

  const { allBookmarks, reminderBookmarks, completedBookmarks, visibleBookmarks } = useMemo(() => {
    const partitioned = partitionMessageBookmarks(rawBookmarks ?? []);
    return {
      allBookmarks: partitioned.all,
      reminderBookmarks: partitioned.reminder,
      completedBookmarks: partitioned.complete,
      visibleBookmarks: partitioned[activeTab],
    };
  }, [activeTab, rawBookmarks]);
  const activeTabLabel =
    BOOKMARK_TABS.find(tab => tab.id === activeTab)?.label ?? DEFAULT_BOOKMARK_TAB_LABEL;
  const emptyState = BOOKMARK_EMPTY_STATE[activeTab];
  const tabCounts: Record<BookmarkTab, number> = {
    all: allBookmarks.length,
    reminder: reminderBookmarks.length,
    complete: completedBookmarks.length,
  };
  const handleRemind = useCallback((target: MessageActionsTarget): void => {
    setReminderTarget(target);
    setIsReminderSheetOpen(true);
  }, []);
  const handleReminderSheetOpenChange = useCallback((open: boolean): void => {
    setIsReminderSheetOpen(open);
    if (!open) setReminderTarget(null);
  }, []);
  const handleTabChange = useCallback(
    (tab: BookmarkTab): void => {
      if (tab !== activeTab) {
        void haptics.selection();
      }
      setActiveTab(tab);
    },
    [activeTab],
  );
  const handleBack = useCallback((): void => {
    router.back();
  }, [router]);

  return (
    <View className='flex-1 bg-tabs-screen'>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AppHeader absolute={false} className='pb-2'>
          <View className='flex-1 flex-row items-center gap-3'>
            <HeaderBackButton liquidGlass accessibilityLabel='Go back' onPress={handleBack} />
            <AppHeader.Title className='text-foreground'>Bookmarks</AppHeader.Title>
          </View>
          <View className='flex-row items-center gap-4'>
            <AppHeader.UserGuide />
            <AppHeader.UserProfile />
          </View>
        </AppHeader>

        <View className='flex-1 pt-2'>
          <View
            className='flex-1 overflow-hidden bg-tabs-screen'
            style={{
              borderTopLeftRadius: SHEET_TOP_RADIUS,
              borderTopRightRadius: SHEET_TOP_RADIUS,
            }}
          >
            <View className='px-3 pb-2.5 pt-3'>
              <View className='flex-row gap-2'>
                {BOOKMARK_TABS.map(tab => (
                  <Badge
                    key={tab.id}
                    label={tab.label}
                    count={tabCounts[tab.id]}
                    variant={activeTab === tab.id ? 'active' : 'default'}
                    accessibilityRole='button'
                    accessibilityLabel={`${tab.label} bookmarks`}
                    accessibilityState={{ selected: activeTab === tab.id }}
                    onPress={() => handleTabChange(tab.id)}
                  />
                ))}
              </View>
            </View>

            {visibleBookmarks.length === 0 ? (
              <ListEmptyState
                illustration={emptyState.illustration}
                title={emptyState.title}
                subtitle={emptyState.description}
                insetBottom={EMPTY_STATE_BOTTOM_INSET}
              />
            ) : (
              <LegendList
                data={visibleBookmarks}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <BookmarkListItem
                    activeTab={activeTab}
                    bookmark={item}
                    currentUserId={userID}
                    isTarget={item.entityId === targetMessageId}
                    onRemind={handleRemind}
                  />
                )}
                ItemSeparatorComponent={BookmarkListDivider}
                extraData={`${theme}:${activeTab}:${targetMessageId ?? ''}`}
                recycleItems
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 16, paddingTop: 4 }}
                accessibilityLabel={`${activeTabLabel} bookmark list`}
              />
            )}
          </View>
        </View>
      </SafeAreaView>
      <MessageReminderOptionsSheet
        target={reminderTarget}
        isOpen={isReminderSheetOpen}
        onOpenChange={handleReminderSheetOpenChange}
        currentUserId={userID}
      />
    </View>
  );
};

export default BookmarksScreen;
