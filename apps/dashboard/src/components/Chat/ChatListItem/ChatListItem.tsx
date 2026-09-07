import { QueryResultType } from '@rocicorp/zero';
import React, { ReactElement } from 'react';
import { queries } from '../../../zero/queries';
import { ChatBubble } from '../ChatBubble/ChatBubble';
import { DatePill } from '../DatePill';
import { type ChatListItemWithSeparator } from '../../../utils/chatUtils';
import { shouldShowAvatar } from '../ChatList/ChatListUtils';
import { useDraft, useDraftFromDB } from '../../../hooks/useDraft';
import { ChannelScopeType, MessageAttachment } from '@xyne/shared';
import { getInitialMessageFromConversation } from '../../../utils/conversationMessageHelpers';
import { useAuth } from '../../../hooks/useAuth';
import { useZero } from '../../../hooks/useZero';
import { useShowThreadTags } from '../../../hooks/useShowThreadTags';

import {
  usePendingStatusByMessageId,
  usePendingByMessageId,
  firePendingMutator,
  removePending,
} from '@xyne/shared/messages';

type ChatListItemProps = {
  item: ChatListItemWithSeparator;
  index: number;
  chatListItems: ChatListItemWithSeparator[];
  channelId: string;
  projectId?: string | undefined;
  channelScopeType?: ChannelScopeType | undefined;
  handleOpenThread: (conversationId: string, e?: React.MouseEvent) => void;
  measureRef?: (node: Element | null) => void;
  dataIndex?: number;
  onEmojiPickerOpenChange?: (isOpen: boolean) => void;
  linkedConversationId?: string | null;
};

const ChatListItemComponent = ({
  item,
  index,
  chatListItems,
  channelId,
  projectId,
  channelScopeType,
  handleOpenThread,
  measureRef,
  dataIndex,
  onEmojiPickerOpenChange,
  linkedConversationId,
}: ChatListItemProps): ReactElement | null => {
  // All non-date-separator items are conversations - get conversation data first
  const conversation =
    item.type !== 'date-separator'
      ? (item.data as QueryResultType<typeof queries.channelConversationsPaginatedV3>[number])
      : null;

  // Hooks must be called unconditionally
  const { user } = useAuth();
  const draft = useDraft(channelId, conversation?.conversationId ?? '');
  const draftFromDB = useDraftFromDB(channelId, conversation?.conversationId ?? '');
  const hasDraftAttachments = draftFromDB?.attachments && draftFromDB.attachments?.length > 0;
  const zero = useZero();
  const pendingMessageId = conversation?.initialMessageId ?? '';
  const pendingStatus = usePendingStatusByMessageId(pendingMessageId);
  const pendingEntry = usePendingByMessageId(pendingMessageId);
  const { showThreadTags } = useShowThreadTags();

  // Render date separator
  if (item.type === 'date-separator') {
    return (
      <div ref={measureRef} data-index={dataIndex}>
        <DatePill dateText={item.dateText} />
      </div>
    );
  }
  // Now we know it's a conversation - get initial message from denormalized data
  const initialMsg = conversation
    ? getInitialMessageFromConversation(conversation, user?.id)
    : null;

  // Attach attachments and nudgeCounts from the conversation's denormalized relations
  const convAny = conversation as {
    initialMessageAttachments?: readonly { id: string }[];
    initialMessageNudgeCounts?: readonly { id: string; nudgeCount: number }[];
  } | null;
  const message = initialMsg
    ? {
        ...initialMsg,
        attachments: (convAny?.initialMessageAttachments ?? []) as unknown as MessageAttachment[],
        nudgeCounts: convAny?.initialMessageNudgeCounts ?? [],
      }
    : null;

  if (!message || !conversation) return null;

  // Use centralized avatar logic for conversations
  const prevItem = index > 0 ? (chatListItems[index - 1] ?? null) : null;
  let showAvatar = true;

  if (prevItem && prevItem.type !== 'date-separator') {
    showAvatar = shouldShowAvatar(item, prevItem, showThreadTags);
  }

  return (
    <div
      ref={measureRef}
      data-index={dataIndex}
      id={`conv-${conversation.conversationId}`}
      data-hash-id={`conv-${conversation.conversationId}`}
      className={`${showAvatar ? 'pt-4' : 'pt-1'} pb-1`}
    >
      <ChatBubble
        message={message}
        channelId={channelId}
        projectId={projectId}
        channelScopeType={channelScopeType}
        showAvatar={showAvatar}
        conversation={conversation}
        {...(draft && { draft })}
        {...(!!hasDraftAttachments && { hasDraftAttachments })}
        replies={{
          replyCount: conversation.replyCount,
          lastActivityAt: conversation.lastActivityAt,
          onOpenThread: (e?: React.MouseEvent) => handleOpenThread(conversation.conversationId, e),
        }}
        {...(onEmojiPickerOpenChange && { onEmojiPickerOpenChange })}
        {...(linkedConversationId !== null && { linkedConversationId })}
      />
      {pendingStatus === 'failed' && pendingEntry && (
        <div className='flex items-center gap-3 pl-12 pt-1 text-xs text-red-500'>
          <span>Failed to send.</span>
          <button
            type='button'
            data-ph-capture-attribute-track-id='retry_failed_send'
            data-track-category='PENDING_MESSAGE'
            data-track-name='retry_failed_send'
            className='font-medium underline hover:opacity-80'
            onClick={() => firePendingMutator(zero, pendingEntry)}
          >
            Retry
          </button>
          <button
            type='button'
            data-ph-capture-attribute-track-id='delete_failed_send'
            data-track-category='PENDING_MESSAGE'
            data-track-name='delete_failed_send'
            className='font-medium underline hover:opacity-80'
            onClick={() => removePending(pendingEntry.messageId)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

export const ChatListItem = React.memo(ChatListItemComponent);
