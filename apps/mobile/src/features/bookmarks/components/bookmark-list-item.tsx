import { useSelector } from '@xstate/react';
import {
  Bookmark,
  Check,
  CircleCheck,
  ChevronRight,
  AlarmClock,
  MessageSquareText,
} from 'lucide-react-native';
import { BookmarkEntityType, ChannelScopeType, type Bookmark as BookmarkRow } from '@xyne/shared';
import { type ReactElement, useCallback, useMemo } from 'react';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import type { MessageItem } from '@/src/components/message-composer/message-composer.types';
import { ListRowPressable } from '@/src/components/ui/list-row-pressable';
import { ListRowDivider } from '@/src/components/ui/settings-list';
import { PresenceDot } from '@/src/components/ui/presence-dot';
import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';
import {
  messageItemToActionsTarget,
  type MessageActionsTarget,
} from '@/src/features/chat/v2/components/message-actions-sheet';
import {
  buildReminderMessagePreview,
  getPendingReminderFromMetadata,
  getReminderDueInLabel,
} from '@/src/features/chat/v3/model/reminder';
import { getChannelDisplayName } from '@/src/hooks/useChannels';
import { useQuery } from '@/src/hooks/useQuery';
import { useZero } from '@/src/hooks/useZero';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import { getDmAvatarUserIds } from '@/src/utils/channel-utils';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import {
  formatBookmarkDateLabel,
  formatReminderFallbackLabel,
  getCompletionTimestamp,
  getReminderTimestamp,
  normalizeScopeType,
  readReminderRecord,
  resolveBookmarkChatOpenTarget,
  truncateBookmarkPreview,
  type BookmarkTab,
  type HydratedBookmarkMessage,
} from '../bookmark-utils';

type BookmarkListItemProps = {
  activeTab: BookmarkTab;
  bookmark: BookmarkRow;
  currentUserId: string;
  isTarget: boolean;
  onRemind?: ((target: MessageActionsTarget) => void) | undefined;
};

export const BookmarkListItem = ({
  activeTab,
  bookmark,
  currentUserId,
  isTarget,
  onRemind,
}: BookmarkListItemProps): ReactElement => {
  const router = useRouter();
  const { accentSoft } = useBubbleAccent();
  const zero = useZero();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const users = useSelector(stateMachineActor, state => state.context.users);
  const channels = useSelector(stateMachineActor, state => state.context.allChannels);
  const visibleChannels = useSelector(stateMachineActor, state => state.context.visibleChannels);
  const [liveMessage] = useQuery(
    queries.getMessageForActivityV2({ messageId: bookmark.entityId }),
    {
      enabled: bookmark.entityType === BookmarkEntityType.MESSAGE,
    },
  );

  const hydratedMessage = liveMessage as HydratedBookmarkMessage | null | undefined;
  const reminder = readReminderRecord(bookmark.metadata);
  const pendingReminder = getPendingReminderFromMetadata(bookmark.metadata);

  const channelId = reminder?.channelId ?? hydratedMessage?.conversation?.channelId ?? '';
  const channel =
    channels.find(entry => entry.id === channelId) ??
    visibleChannels.find(entry => entry.id === channelId);
  const scopeType = normalizeScopeType(reminder?.channelScopeType ?? channel?.scopeType);
  const conversationId =
    reminder?.conversationId ??
    hydratedMessage?.conversation?.conversationId ??
    hydratedMessage?.conversationId;
  const channelName =
    reminder?.channelName ??
    (channel ? getChannelDisplayName(channel, currentUserId, users) : undefined) ??
    'Conversation';
  const preview = truncateBookmarkPreview(
    reminder?.messagePreview ??
      (hydratedMessage?.isDeleted
        ? 'Message deleted'
        : buildReminderMessagePreview(
            hydratedMessage?.content,
            !!hydratedMessage?.hasAttachment || !!hydratedMessage?.attachments?.length,
          )),
  );
  const statusLabel = pendingReminder
    ? getReminderDueInLabel(pendingReminder)
    : reminder
      ? formatReminderFallbackLabel(reminder)
      : activeTab === 'complete'
        ? `Completed ${formatBookmarkDateLabel(getCompletionTimestamp(bookmark))}`
        : `Bookmarked ${formatBookmarkDateLabel(bookmark.createdAt)}`;
  const hasReminder = !!reminder;
  const isComplete = activeTab === 'complete';
  const reminderAt = getReminderTimestamp(bookmark);
  const isOverdue =
    !isComplete &&
    reminderAt !== null &&
    reminderAt <= Date.now() &&
    reminder?.enabled !== false &&
    reminder?.status !== 'CANCELLED' &&
    reminder?.status !== 'DISMISSED';
  const chipLabel = isOverdue ? 'Overdue' : statusLabel;
  const canOpen = !!channelId;
  const avatarUserIds = useMemo(() => {
    if (
      !channel ||
      (scopeType !== ChannelScopeType.DM && scopeType !== ChannelScopeType.GROUP_DM)
    ) {
      return [];
    }
    return getDmAvatarUserIds({ name: channel.name, scopeType }, currentUserId);
  }, [channel, currentUserId, scopeType]);
  const avatarFallbackUsers = useMemo(() => {
    const identities = avatarUserIds
      .map(id => {
        const user = users.find(entry => entry.id === id);
        if (!user) return null;

        return {
          id,
          ...(user.name ? { name: user.name } : {}),
          ...(user.displayName ? { displayName: user.displayName } : {}),
          ...(user.picture !== undefined ? { picture: user.picture } : {}),
        };
      })
      .filter((identity): identity is NonNullable<typeof identity> => identity !== null);

    return identities.length > 0 ? identities : undefined;
  }, [avatarUserIds, users]);
  const presenceUserId = scopeType === ChannelScopeType.DM ? avatarUserIds[0] : undefined;

  const handleOpen = useCallback((): void => {
    const target = resolveBookmarkChatOpenTarget({
      bookmarkEntityId: bookmark.entityId,
      channelId,
      conversationId,
      scopeType,
      reminder,
      hydratedMessage,
    });
    if (!target) return;

    const intent = createChatOpenIntent(
      {
        channelId: target.channelId,
        ...(target.threadId ? { threadId: target.threadId } : {}),
        ...(target.conversationId ? { origin: target.conversationId } : {}),
        messageId: target.messageId,
        ...(target.createdAt !== undefined ? { createdAt: target.createdAt } : {}),
        surface: target.surface,
        ...(target.scopeType ? { scopeType: target.scopeType } : {}),
        openStartedAtMs: Date.now(),
      },
      'activity',
    );

    if (intent) {
      executeChatOpenIntent(router, intent);
    }
  }, [bookmark.entityId, channelId, conversationId, hydratedMessage, reminder, router, scopeType]);

  const handleMarkDone = useCallback(
    (event: GestureResponderEvent): void => {
      event.stopPropagation();
      void haptics.success();
      void zero.mutate(
        mutators.bookmark.remove({
          entityId: bookmark.entityId,
          entityType: BookmarkEntityType.MESSAGE,
          timestamp: Date.now(),
          markAsDone: true,
        }),
      );
    },
    [bookmark.entityId, zero],
  );

  const handleRemind = useCallback(
    (event: GestureResponderEvent): void => {
      event.stopPropagation();
      if (!channelId || !onRemind) return;

      const initialMessageId =
        reminder?.initialMessageId ?? hydratedMessage?.conversation?.initialMessageId;
      const threadId =
        reminder?.threadId ??
        (initialMessageId && initialMessageId !== bookmark.entityId ? conversationId : undefined);
      const target = messageItemToActionsTarget(
        (liveMessage ?? null) as unknown as MessageItem | null,
        {
          channelId,
          ...(threadId ? { threadId } : {}),
          ...(scopeType ? { channelScopeType: scopeType } : {}),
          ...(channelName ? { channelName } : {}),
        },
      );
      if (!target) return;
      onRemind(target);
    },
    [
      bookmark.entityId,
      channelId,
      channelName,
      conversationId,
      hydratedMessage?.conversation?.initialMessageId,
      liveMessage,
      onRemind,
      reminder?.initialMessageId,
      reminder?.threadId,
      scopeType,
    ],
  );

  return (
    <ListRowPressable
      accessibilityLabel={`Open bookmarked message in ${channelName}`}
      disabled={!canOpen}
      onPress={handleOpen}
      className={cn(
        'w-full bg-tabs-screen',

        !canOpen ? 'opacity-70' : '',
      )}
      {...(isTarget ? { style: { backgroundColor: accentSoft } } : {})}
    >
      <View className='flex-row px-3 py-[14px]'>
        <View className='relative size-12 shrink-0'>
          {avatarUserIds.length > 0 ? (
            <>
              <Avatar
                userIds={avatarUserIds}
                size={48}
                rounded={false}
                {...(avatarFallbackUsers ? { fallbackUsers: avatarFallbackUsers } : {})}
              />
              {presenceUserId ? <PresenceDot userId={presenceUserId} /> : null}
            </>
          ) : (
            <View className='size-12 items-center justify-center rounded-full bg-muted/20'>
              <Bookmark size={18} color={foregroundColor} fill={foregroundColor} />
            </View>
          )}
        </View>
        <View className='ml-3 min-w-0 flex-1'>
          <View className='flex-row items-start justify-between gap-2'>
            <Text
              className='min-w-0 flex-1 text-base font-medium text-primary-text'
              numberOfLines={1}
            >
              {channelName}
            </Text>
            <Text
              className='shrink-0 text-[12px] tabular-nums text-chat-time-text'
              numberOfLines={1}
            >
              {formatBookmarkDateLabel(hydratedMessage?.createdAt ?? bookmark.createdAt)}
            </Text>
          </View>
          <Text
            className='mt-0.5 text-[15px] font-medium text-chat-preview-msg-text'
            numberOfLines={2}
          >
            {preview}
          </Text>

          <View className='mt-3 flex-row items-center gap-2'>
            <View
              className={cn(
                'flex-row items-center gap-1.5 rounded-full px-2.5 py-1',
                isOverdue ? 'bg-red-500' : 'bg-muted/15',
              )}
            >
              {isComplete ? (
                <CircleCheck size={12} color={isOverdue ? '#fff' : foregroundColor} />
              ) : hasReminder || isOverdue ? (
                <AlarmClock size={12} color={isOverdue ? '#fff' : foregroundColor} />
              ) : (
                <MessageSquareText size={12} color={foregroundColor} />
              )}
              <Text
                className={cn(
                  'text-xs font-semibold',
                  isOverdue ? 'text-white' : 'text-foreground',
                )}
                numberOfLines={1}
              >
                {chipLabel}
              </Text>
            </View>
          </View>
        </View>

        <View className='ml-2 items-center gap-3'>
          <ChevronRight size={18} color={foregroundColor} />
          {isComplete ? null : (
            <>
              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Mark bookmark complete'
                hitSlop={10}
                onPress={handleMarkDone}
                className='size-8 items-center justify-center rounded-full bg-muted/10 active:opacity-75'
              >
                <Check size={16} color={foregroundColor} />
              </Pressable>
              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Remind me'
                hitSlop={10}
                disabled={!channelId || !liveMessage}
                onPress={handleRemind}
                className='size-8 items-center justify-center rounded-full bg-muted/10 active:opacity-75'
              >
                <AlarmClock size={16} color={foregroundColor} />
              </Pressable>
            </>
          )}
        </View>
      </View>
    </ListRowPressable>
  );
};

/** Rows sit on the screen background, so this hairline is the only separation.
 *  Uses the profile/settings divider token, inset to where the row's text
 *  starts (px-3 + 48pt avatar + ml-3) rather than the settings default. */
const BOOKMARK_DIVIDER_INSET = 72;

export const BookmarkListDivider = (): ReactElement => (
  <ListRowDivider inset={BOOKMARK_DIVIDER_INSET} />
);
