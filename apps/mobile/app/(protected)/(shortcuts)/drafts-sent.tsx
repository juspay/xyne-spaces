import { LegendList } from '@legendapp/list/react-native';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useUniwind } from 'uniwind';

import { AppHeader } from '@/src/components/app-header';
import { SafeAreaView } from '@/src/components/ui/safe-area-view';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { Badge } from '@/src/components/ui/badge';
import {
  ListEmptyState,
  EMPTY_STATE_BOTTOM_INSET,
  type EmptyIllustrationName,
} from '@/src/components/ui/empty-state';
import { ActivityLoadingSkeleton } from '@/src/components/activity';
import { useAuthContextValues } from '@/src/contexts/AuthContext';
import {
  DraftsSentListDivider,
  DraftsSentListItem,
} from '@/src/features/drafts-sent/drafts-sent-list-item';
import {
  DRAFTS_SENT_TABS,
  canSendDraft,
  composerDraftLookupId,
  groupSentByDay,
  parseDraftsSentTab,
  sortDrafts,
  sortScheduled,
  type DelayedMessageRow,
  type DraftMessageRow,
  type DraftsSentTab,
  type SentListEntry,
} from '@/src/features/drafts-sent/drafts-sent-utils';
import {
  listTwinDraftViews,
  type TwinReplyDraftView,
} from '@/src/features/drafts-sent/twin-draft-utils';
import {
  useDismissedTwinDraftIds,
  filterDismissedTwinDrafts,
} from '@/src/features/drafts-sent/twin-draft-dismissed';
import { ScheduleMessageSheet } from '@/src/features/drafts-sent/schedule-message-sheet';
import { EditScheduledMessageComposer } from '@/src/features/drafts-sent/edit-scheduled-message-composer';
import { useSentMessages } from '@/src/features/drafts-sent/use-sent-messages';
import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';
import { useQuery } from '@/src/hooks/useQuery';
import { useTabBarHeight } from '@/src/hooks/useTabBarHeight';
import { useZero } from '@/src/hooks/useZero';
import {
  claimRemoteUserDraftDelete,
  clearDraft,
} from '@/src/components/input-composer/utils/drafts';
import { showMessageToast } from '@/src/utils/toast';
import { formatScheduledToast } from '@/src/features/drafts-sent/schedule-message-utils';
import { haptics } from '@/src/utils/haptics';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

const SHEET_TOP_RADIUS = 28;
const DEFAULT_TAB_LABEL = 'Drafts';

const EMPTY_STATE: Record<
  DraftsSentTab,
  { title: string; description: string; illustration: EmptyIllustrationName }
> = {
  drafts: {
    title: 'No drafts yet',
    description: 'Unsent messages from chat will appear here.',
    illustration: 'bookmarks',
  },
  scheduled: {
    title: 'Nothing scheduled',
    description: 'Messages you schedule to send later will appear here.',
    illustration: 'bookmarkReminders',
  },
  twin: {
    title: 'No twin drafts',
    description: 'Twin replies awaiting your approval will appear here.',
    illustration: 'bookmarks',
  },
  sent: {
    title: 'No sent messages',
    description: 'Messages you send will appear here.',
    illustration: 'bookmarkComplete',
  },
};

type ScheduleTarget =
  { kind: 'draft'; draft: DraftMessageRow } | { kind: 'scheduled'; row: DelayedMessageRow };

const openChat = (
  router: ReturnType<typeof useRouter>,
  channelId: string,
  conversationId: string | null | undefined,
): void => {
  const intent = createChatOpenIntent(
    {
      channelId,
      ...(conversationId ? { origin: conversationId, threadId: conversationId } : {}),
      openStartedAtMs: Date.now(),
    },
    'activity',
  );
  if (intent) executeChatOpenIntent(router, intent);
};

const DraftsSentScreen = (): ReactElement => {
  const router = useRouter();
  const { theme } = useUniwind();
  const zero = useZero();
  const { userID } = useAuthContextValues();
  const insets = useSafeAreaInsets();
  const { tabBarHeight } = useTabBarHeight();
  const listPaddingBottom = Math.max(insets.bottom, tabBarHeight) + 16;
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const resolvedTab = parseDraftsSentTab(Array.isArray(tabParam) ? tabParam[0] : tabParam);
  const [activeTab, setActiveTab] = useState<DraftsSentTab>(() => resolvedTab);
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(null);
  const [editingScheduled, setEditingScheduled] = useState<DelayedMessageRow | null>(null);
  const scheduleTargetRef = useRef(scheduleTarget);
  scheduleTargetRef.current = scheduleTarget;

  useEffect(() => {
    setActiveTab(resolvedTab);
  }, [resolvedTab]);

  const [rawDrafts] = useQuery(queries.userDrafts());
  const [rawScheduled] = useQuery(queries.userDelayedMessages());
  const sentModel = useSentMessages(true);
  const dismissedTwinDraftIds = useDismissedTwinDraftIds();

  const drafts = useMemo(() => sortDrafts(rawDrafts ?? []), [rawDrafts]);
  const twinDrafts = useMemo(
    () => filterDismissedTwinDrafts(listTwinDraftViews(rawDrafts ?? []), dismissedTwinDraftIds),
    [dismissedTwinDraftIds, rawDrafts],
  );
  const scheduled = useMemo(() => sortScheduled(rawScheduled ?? []), [rawScheduled]);
  const sentEntries = useMemo(() => groupSentByDay(sentModel.rows), [sentModel.rows]);

  const activeTabLabel =
    DRAFTS_SENT_TABS.find(tab => tab.id === activeTab)?.label ?? DEFAULT_TAB_LABEL;
  const emptyState = EMPTY_STATE[activeTab];
  const tabCounts: Record<DraftsSentTab, number | undefined> = {
    drafts: drafts.length,
    scheduled: scheduled.length,
    twin: twinDrafts.length,
    sent: undefined,
  };

  const handleTabChange = useCallback(
    (tab: DraftsSentTab): void => {
      if (tab !== activeTab) void haptics.selection();
      setActiveTab(tab);
    },
    [activeTab],
  );

  const handleBack = useCallback((): void => {
    router.back();
  }, [router]);

  const handleSendDraft = useCallback(
    (draft: DraftMessageRow): void => {
      if (!canSendDraft(draft.content, !!(draft.hasAttachment || draft.attachments?.length))) {
        Alert.alert('Nothing to send', 'Add a message or an attachment first.');
        return;
      }
      void haptics.success();
      void (async (): Promise<void> => {
        try {
          const result = await zero.mutate(
            mutators.draftMessages.send({ id: draft.id, timestamp: Date.now() }),
          ).client;
          if (result.type === 'error') throw new Error(result.error.message);
          openChat(router, draft.channelId, draft.conversationId);
        } catch (error: unknown) {
          Alert.alert('Send failed', error instanceof Error ? error.message : 'Please try again.');
        }
      })();
    },
    [router, zero],
  );

  const handleDeleteDraft = useCallback(
    (draft: DraftMessageRow): void => {
      Alert.alert('Delete draft?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: (): void => {
            void haptics.success();
            clearDraft(composerDraftLookupId(draft.channelId, draft.conversationId));
            const remoteId = claimRemoteUserDraftDelete(draft);
            if (!remoteId) return;
            void zero.mutate(mutators.draftMessages.delete({ id: remoteId }));
          },
        },
      ]);
    },
    [zero],
  );

  const handleSendScheduled = useCallback(
    (row: DelayedMessageRow): void => {
      Alert.alert('Send now?', 'This message will be sent immediately.', [
        { text: 'Keep scheduled', style: 'cancel' },
        {
          text: 'Send now',
          onPress: (): void => {
            void (async (): Promise<void> => {
              try {
                const result = await zero.mutate(
                  mutators.delayedMessages.sendNow({ id: row.id, timestamp: Date.now() }),
                ).client;
                if (result.type === 'error') throw new Error(result.error.message);
                void haptics.success();
                openChat(router, row.channelId, row.conversationId);
              } catch (error: unknown) {
                Alert.alert(
                  'Send failed',
                  error instanceof Error ? error.message : 'Please try again.',
                );
              }
            })();
          },
        },
      ]);
    },
    [router, zero],
  );

  const handleCancelScheduled = useCallback(
    (row: DelayedMessageRow): void => {
      Alert.alert('Cancel scheduled message?', 'It will be removed from this list.', [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: (): void => {
            void haptics.success();
            void zero.mutate(
              mutators.delayedMessages.cancel({ id: row.id, timestamp: Date.now() }),
            );
          },
        },
      ]);
    },
    [zero],
  );

  const handleEditScheduled = useCallback((row: DelayedMessageRow): void => {
    void haptics.selection();
    setEditingScheduled(row);
  }, []);

  const handleConfirmSchedule = useCallback(
    async (scheduledFor: number): Promise<void> => {
      const target = scheduleTargetRef.current;
      if (!target) throw new Error('Nothing to schedule.');
      if (target.kind === 'draft') {
        const draft = target.draft;
        if (!canSendDraft(draft.content, !!(draft.hasAttachment || draft.attachments?.length))) {
          throw new Error('Add a message or an attachment first.');
        }
        const created = await zero.mutate(
          mutators.delayedMessages.create({
            id: draft.id,
            channelId: draft.channelId,
            ...(draft.conversationId ? { conversationId: draft.conversationId } : {}),
            content: draft.content,
            scheduledFor,
            timestamp: Date.now(),
          }),
        ).client;
        if (created.type === 'error') throw new Error(created.error.message);
        clearDraft(composerDraftLookupId(draft.channelId, draft.conversationId));
        showMessageToast(formatScheduledToast(scheduledFor), 'success');
        setActiveTab('scheduled');
        return;
      }
      const rescheduled = await zero.mutate(
        mutators.delayedMessages.reschedule({
          id: target.row.id,
          scheduledFor,
          timestamp: Date.now(),
        }),
      ).client;
      if (rescheduled.type === 'error') throw new Error(rescheduled.error.message);
    },
    [zero],
  );

  const listEmpty =
    activeTab === 'drafts'
      ? drafts.length === 0
      : activeTab === 'scheduled'
        ? scheduled.length === 0
        : activeTab === 'twin'
          ? twinDrafts.length === 0
          : sentModel.rows.length === 0;

  const renderDraft = useCallback(
    ({ item }: { item: DraftMessageRow }): ReactElement => (
      <DraftsSentListItem
        tab='drafts'
        currentUserId={userID}
        draft={item}
        onSendDraft={handleSendDraft}
        onDeleteDraft={handleDeleteDraft}
        onScheduleDraft={next => setScheduleTarget({ kind: 'draft', draft: next })}
      />
    ),
    [handleDeleteDraft, handleSendDraft, userID],
  );

  const renderScheduled = useCallback(
    ({ item }: { item: DelayedMessageRow }): ReactElement => (
      <DraftsSentListItem
        tab='scheduled'
        currentUserId={userID}
        scheduled={item}
        onSendScheduled={handleSendScheduled}
        onCancelScheduled={handleCancelScheduled}
        onEditScheduled={handleEditScheduled}
        onReschedule={row => setScheduleTarget({ kind: 'scheduled', row })}
      />
    ),
    [handleCancelScheduled, handleEditScheduled, handleSendScheduled, userID],
  );

  const renderSent = useCallback(
    ({ item }: { item: SentListEntry }): ReactElement => {
      if (item.type === 'header') {
        return (
          <View className='px-4 pt-5 pb-2 bg-tabs-screen'>
            <Text className='text-xs font-semibold uppercase tracking-widest text-secondary-foreground'>
              {item.label}
            </Text>
          </View>
        );
      }
      return <DraftsSentListItem tab='sent' currentUserId={userID} sent={item.message} />;
    },
    [userID],
  );

  const renderTwin = useCallback(
    ({ item }: { item: TwinReplyDraftView }): ReactElement => (
      <DraftsSentListItem tab='twin' currentUserId={userID} twin={item} />
    ),
    [userID],
  );

  return (
    <View className='flex-1 bg-tabs-screen'>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AppHeader absolute={false} className='pb-2'>
          <View className='flex-1 flex-row items-center gap-3'>
            <HeaderBackButton liquidGlass accessibilityLabel='Go back' onPress={handleBack} />
            <AppHeader.Title className='text-foreground'>Drafts & Sent</AppHeader.Title>
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
            <View className='pb-2.5 pt-3'>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName='flex-row gap-2 px-3'
                keyboardShouldPersistTaps='handled'
              >
                {DRAFTS_SENT_TABS.map(tab => (
                  <Badge
                    key={tab.id}
                    label={tab.label}
                    {...(tabCounts[tab.id] !== undefined ? { count: tabCounts[tab.id] } : {})}
                    variant={activeTab === tab.id ? 'active' : 'default'}
                    className='shrink-0'
                    accessibilityRole='button'
                    accessibilityLabel={`${tab.label} messages`}
                    accessibilityState={{ selected: activeTab === tab.id }}
                    onPress={() => handleTabChange(tab.id)}
                  />
                ))}
              </ScrollView>
            </View>

            {activeTab === 'sent' && sentModel.isLoading ? (
              <ActivityLoadingSkeleton rows={4} />
            ) : listEmpty ? (
              <ListEmptyState
                illustration={emptyState.illustration}
                title={emptyState.title}
                subtitle={emptyState.description}
                insetBottom={EMPTY_STATE_BOTTOM_INSET}
              />
            ) : activeTab === 'drafts' ? (
              <LegendList
                data={drafts}
                keyExtractor={item => item.id}
                renderItem={renderDraft}
                ItemSeparatorComponent={DraftsSentListDivider}
                extraData={`${theme}:${activeTab}`}
                recycleItems
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: listPaddingBottom, paddingTop: 4 }}
                accessibilityLabel={`${activeTabLabel} list`}
              />
            ) : activeTab === 'scheduled' ? (
              <LegendList
                data={scheduled}
                keyExtractor={item => item.id}
                renderItem={renderScheduled}
                ItemSeparatorComponent={DraftsSentListDivider}
                extraData={`${theme}:${activeTab}`}
                recycleItems
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: listPaddingBottom, paddingTop: 4 }}
                accessibilityLabel={`${activeTabLabel} list`}
              />
            ) : activeTab === 'twin' ? (
              <LegendList
                data={twinDrafts}
                keyExtractor={item => item.id}
                renderItem={renderTwin}
                ItemSeparatorComponent={DraftsSentListDivider}
                extraData={`${theme}:${activeTab}`}
                recycleItems
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: listPaddingBottom, paddingTop: 4 }}
                accessibilityLabel={`${activeTabLabel} list`}
              />
            ) : (
              <LegendList
                data={sentEntries}
                keyExtractor={item => item.id}
                renderItem={renderSent}
                extraData={`${theme}:${activeTab}:${sentModel.isLoadingMore}`}
                recycleItems
                showsVerticalScrollIndicator={false}
                onEndReached={() => {
                  void sentModel.loadMore();
                }}
                onEndReachedThreshold={0.4}
                ListFooterComponent={
                  sentModel.isLoadingMore ? (
                    <View className='items-center py-4'>
                      <Text className='text-xs text-secondary-foreground'>Loading…</Text>
                    </View>
                  ) : null
                }
                contentContainerStyle={{ paddingBottom: listPaddingBottom, paddingTop: 4 }}
                accessibilityLabel={`${activeTabLabel} list`}
              />
            )}
          </View>
        </View>
      </SafeAreaView>

      <ScheduleMessageSheet
        isOpen={scheduleTarget !== null}
        mode={scheduleTarget?.kind === 'scheduled' ? 'reschedule' : 'create'}
        {...(scheduleTarget?.kind === 'scheduled'
          ? { initialScheduledFor: scheduleTarget.row.scheduledFor }
          : {})}
        onOpenChange={open => {
          if (!open) setScheduleTarget(null);
        }}
        onConfirm={handleConfirmSchedule}
      />
      <EditScheduledMessageComposer
        isOpen={editingScheduled !== null}
        row={
          editingScheduled
            ? (scheduled.find(row => row.id === editingScheduled.id) ?? editingScheduled)
            : null
        }
        onOpenChange={open => {
          if (!open) setEditingScheduled(null);
        }}
      />
    </View>
  );
};

export default DraftsSentScreen;
