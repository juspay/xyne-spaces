import { useSelector } from '@xstate/react';
import { AlarmClock, Clock, Pencil, SendHorizontal, Sparkles, Trash2 } from 'lucide-react-native';
import { type ReactElement, useCallback, useMemo } from 'react';
import { Alert, Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { ListRowPressable } from '@/src/components/ui/list-row-pressable';
import { ListRowDivider } from '@/src/components/ui/settings-list';
import { PresenceDot } from '@/src/components/ui/presence-dot';
import { normalizeScopeType } from '@/src/features/bookmarks/bookmark-utils';
import { setDraft } from '@/src/components/input-composer/utils/drafts';
import { composerHtmlToPlainText } from '@/src/components/input-composer/utils/conversation-input.utils';
import { getChannelDisplayName } from '@/src/hooks/useChannels';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { getDmAvatarUserIds } from '@/src/utils/channel-utils';
import { cn } from '@/src/utils/cn';
import { ChannelScopeType } from '@xyne/shared';

import {
  canSendDraft,
  composerDraftLookupId,
  draftPreviewText,
  formatRelativeTimestamp,
  formatScheduledChip,
  formatSentTime,
  isScheduledDueSoon,
  isSentThreadReply,
  type DelayedMessageRow,
  type DraftMessageRow,
  type DraftsSentTab,
  type SentMessageRow,
} from './drafts-sent-utils';
import { twinDraftPreview, type TwinReplyDraftView } from './twin-draft-utils';
import { setTwinDraftOpenSelection } from './twin-draft-open';
import { executeDraftsSentChatOpen, twinDraftOpenMessageId } from './drafts-sent-open';

const DIVIDER_INSET = 72;

type DraftsSentListItemProps = {
  tab: DraftsSentTab;
  currentUserId: string;
  draft?: DraftMessageRow;
  scheduled?: DelayedMessageRow;
  sent?: SentMessageRow;
  twin?: TwinReplyDraftView;
  onScheduleDraft?: (draft: DraftMessageRow) => void;
  onReschedule?: (row: DelayedMessageRow) => void;
  onSendDraft?: (draft: DraftMessageRow) => void;
  onDeleteDraft?: (draft: DraftMessageRow) => void;
  onSendScheduled?: (row: DelayedMessageRow) => void;
  onCancelScheduled?: (row: DelayedMessageRow) => void;
  onEditScheduled?: (row: DelayedMessageRow) => void;
};

const stopAndRun = (event: GestureResponderEvent, action: () => void): void => {
  event.stopPropagation();
  action();
};

export const DraftsSentListItem = ({
  tab,
  currentUserId,
  draft,
  scheduled,
  sent,
  twin,
  onScheduleDraft,
  onReschedule,
  onSendDraft,
  onDeleteDraft,
  onSendScheduled,
  onCancelScheduled,
  onEditScheduled,
}: DraftsSentListItemProps): ReactElement => {
  const router = useRouter();
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const { accentSoft } = useBubbleAccent();
  const users = useSelector(stateMachineActor, state => state.context.users);
  const channels = useSelector(stateMachineActor, state => state.context.allChannels);
  const visibleChannels = useSelector(stateMachineActor, state => state.context.visibleChannels);

  const channelId =
    draft?.channelId ??
    scheduled?.channelId ??
    twin?.channelId ??
    sent?.conversation?.channelId ??
    '';
  const conversationId =
    draft?.conversationId ??
    scheduled?.conversationId ??
    twin?.conversationId ??
    sent?.conversationId ??
    null;
  const channel =
    channels.find(entry => entry.id === channelId) ??
    visibleChannels.find(entry => entry.id === channelId);
  const scopeType = normalizeScopeType(channel?.scopeType);
  const channelName =
    (channel ? getChannelDisplayName(channel, currentUserId, users) : undefined) ?? 'Conversation';
  // Sent matches dashboard: no "· thread" in the title (thread is only in nav).
  const title = tab !== 'sent' && conversationId ? `${channelName} · thread` : channelName;

  const content = draft?.content ?? scheduled?.content ?? sent?.content ?? '';
  const hasAttachment =
    !!(draft?.hasAttachment || draft?.attachments?.length) ||
    !!(scheduled?.hasAttachment || scheduled?.attachments?.length) ||
    !!(sent?.hasAttachment || sent?.attachments?.length);
  const preview =
    tab === 'twin' && twin
      ? twinDraftPreview(twin)
      : draftPreviewText(
          content,
          hasAttachment,
          'Attachment',
          tab === 'sent' ? '(no text)' : '(empty draft)',
        );
  const timestamp =
    tab === 'drafts'
      ? formatRelativeTimestamp(draft?.updatedAt ?? Date.now())
      : tab === 'scheduled'
        ? formatRelativeTimestamp(scheduled?.scheduledFor ?? Date.now())
        : tab === 'twin'
          ? formatRelativeTimestamp(twin?.createdAt ?? Date.now())
          : formatSentTime(sent?.createdAt ?? Date.now());
  const dueSoon =
    tab === 'scheduled' && scheduled ? isScheduledDueSoon(scheduled.scheduledFor) : false;
  const chipLabel =
    tab === 'drafts'
      ? timestamp
      : tab === 'scheduled' && scheduled
        ? formatScheduledChip(scheduled.scheduledFor)
        : timestamp;

  const avatarUserIds = useMemo(() => {
    if (
      !channel ||
      (scopeType !== ChannelScopeType.DM && scopeType !== ChannelScopeType.GROUP_DM)
    ) {
      return [];
    }
    return getDmAvatarUserIds({ name: channel.name, scopeType: channel.scopeType }, currentUserId);
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
    if (!channelId) return;
    // Twin drafts open the source thread. Do not hydrate the composer — the
    // assist dock owns the proposal. Ticket threads go to the ticket Thread
    // tab directly so ChatThread is not remounted after a chat-screen bounce.
    if (tab === 'twin' && twin) {
      setTwinDraftOpenSelection({
        conversationId: twin.conversationId,
        draftId: twin.id,
      });
    }
    if (tab === 'drafts' && draft?.content) {
      setDraft(composerDraftLookupId(channelId, conversationId), {
        text: composerHtmlToPlainText(draft.content),
        html: draft.content,
      });
    }
    const isThreadReply =
      tab === 'sent' && sent ? isSentThreadReply(sent) : tab === 'twin' ? true : !!conversationId;
    const targetMessageId =
      tab === 'twin' ? twinDraftOpenMessageId(twin) : tab === 'sent' ? sent?.messageId : undefined;
    executeDraftsSentChatOpen(router, {
      channelId,
      conversationId,
      isThreadReply,
      ...(targetMessageId ? { messageId: targetMessageId } : {}),
      ...(scopeType ? { scopeType } : {}),
      openStartedAtMs: Date.now(),
    });
  }, [channelId, conversationId, draft, router, scopeType, sent, tab, twin]);

  const handleSendDraft = useCallback(
    (event: GestureResponderEvent): void => {
      if (!draft) return;
      if (!canSendDraft(draft.content, !!(draft.hasAttachment || draft.attachments?.length))) {
        Alert.alert('Nothing to send', 'Add a message or an attachment first.');
        return;
      }
      stopAndRun(event, () => onSendDraft?.(draft));
    },
    [draft, onSendDraft],
  );

  return (
    <ListRowPressable
      accessibilityLabel={`Open ${tab} item in ${title}`}
      disabled={!channelId || (tab === 'twin' && !conversationId)}
      onPress={handleOpen}
      className={cn(
        'w-full bg-tabs-screen',
        !channelId || (tab === 'twin' && !conversationId) ? 'opacity-70' : '',
      )}
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
            <View
              className='size-12 items-center justify-center rounded-full bg-muted/20'
              style={dueSoon ? { backgroundColor: accentSoft } : undefined}
            >
              {tab === 'scheduled' ? (
                <Clock size={18} color={foregroundColor} />
              ) : tab === 'sent' ? (
                <SendHorizontal size={18} color={foregroundColor} />
              ) : tab === 'twin' ? (
                <Sparkles size={18} color={foregroundColor} />
              ) : (
                <Pencil size={18} color={foregroundColor} />
              )}
            </View>
          )}
        </View>

        <View className='ml-3 min-w-0 flex-1'>
          <View className='flex-row items-start justify-between gap-2'>
            <Text
              className='min-w-0 flex-1 text-base font-medium text-primary-text'
              numberOfLines={1}
            >
              {title}
            </Text>
            <Text
              className='shrink-0 text-[12px] tabular-nums text-chat-time-text'
              numberOfLines={1}
            >
              {chipLabel}
            </Text>
          </View>
          <View className='mt-0.5 flex-row items-center gap-2'>
            <Text
              className='min-w-0 flex-1 text-[15px] font-medium text-chat-preview-msg-text'
              numberOfLines={1}
              ellipsizeMode='tail'
            >
              {preview}
            </Text>
            <View
              className='shrink-0 flex-row items-center gap-1'
              onStartShouldSetResponder={() => true}
            >
              {tab === 'drafts' && draft ? (
                <>
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='Send draft'
                    hitSlop={10}
                    onPress={handleSendDraft}
                    className='size-8 items-center justify-center rounded-full bg-muted/10 active:opacity-75'
                  >
                    <SendHorizontal size={16} color={foregroundColor} />
                  </Pressable>
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='Schedule draft'
                    hitSlop={10}
                    onPress={event => stopAndRun(event, () => onScheduleDraft?.(draft))}
                    className='size-8 items-center justify-center rounded-full bg-muted/10 active:opacity-75'
                  >
                    <AlarmClock size={16} color={foregroundColor} />
                  </Pressable>
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='Delete draft'
                    hitSlop={10}
                    onPress={event => stopAndRun(event, () => onDeleteDraft?.(draft))}
                    className='size-8 items-center justify-center rounded-full bg-muted/10 active:opacity-75'
                  >
                    <Trash2 size={16} color={foregroundColor} />
                  </Pressable>
                </>
              ) : null}
              {tab === 'scheduled' && scheduled ? (
                <>
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='Send now'
                    hitSlop={10}
                    onPress={event => stopAndRun(event, () => onSendScheduled?.(scheduled))}
                    className='size-8 items-center justify-center rounded-full bg-muted/10 active:opacity-75'
                  >
                    <SendHorizontal size={16} color={foregroundColor} />
                  </Pressable>
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='Reschedule'
                    hitSlop={10}
                    onPress={event => stopAndRun(event, () => onReschedule?.(scheduled))}
                    className='size-8 items-center justify-center rounded-full bg-muted/10 active:opacity-75'
                  >
                    <AlarmClock size={16} color={foregroundColor} />
                  </Pressable>
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='Edit scheduled message'
                    hitSlop={10}
                    onPress={event => stopAndRun(event, () => onEditScheduled?.(scheduled))}
                    className='size-8 items-center justify-center rounded-full bg-muted/10 active:opacity-75'
                  >
                    <Pencil size={16} color={foregroundColor} />
                  </Pressable>
                  <Pressable
                    accessibilityRole='button'
                    accessibilityLabel='Cancel scheduled message'
                    hitSlop={10}
                    onPress={event => stopAndRun(event, () => onCancelScheduled?.(scheduled))}
                    className='size-8 items-center justify-center rounded-full bg-muted/10 active:opacity-75'
                  >
                    <Trash2 size={16} color={foregroundColor} />
                  </Pressable>
                </>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </ListRowPressable>
  );
};

export const DraftsSentListDivider = (): ReactElement => <ListRowDivider inset={DIVIDER_INSET} />;
