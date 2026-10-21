/* eslint-disable @typescript-eslint/naming-convention -- Zero / schema field names on ParsedInitialMessageForUi */
import type { ReactNode } from 'react';
import type { ChannelScopeType, MessageAttachment } from '@xyne/shared';

import type { ParsedInitialMessageForUi } from '@/src/components/chat/message/message.types';
import type { ForwardMessageSheetTarget } from '@/src/components/chat/message-sheet/views/forward-message-view-model';
import type { MessageItem } from '@/src/components/message-composer';
import type { ConversationItem } from '@/src/features/chat/v2/components/conversation-composer/conversation-composer.types';
import { getInitialMessageFromConversation } from '@/src/utils/conversationMessageHelpers';
import { getConversationReactionsMd } from '@/src/features/chat/v2/components/conversation-composer/utils/getConversationReactionsMd';

export type MessageAction = {
  id: string;
  icon: ReactNode;
  label: string;
  variant?: 'default' | 'destructive' | undefined;
  /** Every rendered action must have an executable handler. */
  onPress: () => void;
  visible: boolean;
  /** When true (and the action is visible), the sheet renders a divider above it. */
  dividerBefore?: boolean | undefined;
};

export type MessageActionsTarget = {
  message: ParsedInitialMessageForUi;
  channelId: string;
  channelName?: string | undefined;
  channelScopeType?: ChannelScopeType | undefined;
  /** Present only in thread context. */
  threadId?: string | undefined;
  conversationId: string;
  isPinned: boolean;
  reactionsMd: string | null;
  isFirstInThread?: boolean | undefined;
  isChannelArchived?: boolean | undefined;
  hasTicket: boolean;
};

const metadataHasTicket = (metadata: unknown): boolean =>
  typeof metadata === 'object' &&
  metadata !== null &&
  (metadata as Record<string, unknown>)['ticketId'] !== undefined;

/**
 * Channel caller: wraps `getInitialMessageFromConversation` + `getConversationReactionsMd`.
 * The thread caller never needs to know about `initial_message_md` parsing.
 */
export const conversationItemToActionsTarget = (
  row: ConversationItem,
  currentUserId?: string | undefined,
  options?:
    | {
        isChannelArchived?: boolean | undefined;
        channelName?: string | undefined;
        channelScopeType?: ChannelScopeType | undefined;
      }
    | undefined,
): MessageActionsTarget | null => {
  const base = getInitialMessageFromConversation(row, currentUserId);
  if (!base) return null;

  const message: ParsedInitialMessageForUi = {
    ...base,
    attachments: (row.initialMessageAttachments ?? []) as readonly MessageAttachment[],
    nudgeCounts: row.initialMessageNudgeCounts ?? [],
  };

  return {
    message,
    channelId: row.channelId,
    ...(options?.channelName ? { channelName: options.channelName } : {}),
    ...(options?.channelScopeType ? { channelScopeType: options.channelScopeType } : {}),
    conversationId: row.conversationId,
    isPinned: row.pinned ?? false,
    reactionsMd: getConversationReactionsMd(row),
    isChannelArchived: options?.isChannelArchived,
    hasTicket: !!row.ticketId || metadataHasTicket(base.metadata),
  };
};

/**
 * Thread caller: folds the legacy `messageItemToForwardSheetTarget` mapping into the
 * normalized message shape.
 */
export const messageItemToActionsTarget = (
  msg: MessageItem | null,
  options: {
    channelId: string;
    threadId?: string | undefined;
    currentUserId?: string | undefined;
    isFirstInThread?: boolean | undefined;
    isChannelArchived?: boolean | undefined;
    channelName?: string | undefined;
    channelScopeType?: ChannelScopeType | undefined;
  },
): MessageActionsTarget | null => {
  if (!msg) return null;

  const message: ParsedInitialMessageForUi = {
    messageId: msg.messageId,
    conversationId: msg.conversationId,
    childConversationId: msg.childConversationId ?? null,
    senderId: msg.senderId,
    content: msg.content ?? '',
    msgType: msg.msgType,
    hasAttachment: msg.hasAttachment,
    edited: msg.edited,
    isDeleted: msg.isDeleted,
    showInChannel: msg.showInChannel,
    visibleTo: msg.visibleTo ?? null,
    createdAt: msg.createdAt,
    metadata: msg.metadata ?? null,
    nudgeCount: msg.nudgeCount ?? null,
    isSent: msg.isSent,
    reactions_md: msg.reactions_md ?? null,
    link_preview_md: msg.link_preview_md ?? null,
    attachments: msg.attachments,
    nudgeCounts: msg.nudgeCounts,
  };

  return {
    message,
    channelId: options.channelId,
    ...(options.channelName ? { channelName: options.channelName } : {}),
    ...(options.channelScopeType ? { channelScopeType: options.channelScopeType } : {}),
    threadId: options.threadId,
    conversationId: msg.conversationId,
    isPinned: false,
    reactionsMd: msg.reactions_md ?? null,
    isFirstInThread: options.isFirstInThread,
    isChannelArchived: options.isChannelArchived,
    hasTicket: metadataHasTicket(msg.metadata),
  };
};

/** Uniform builder for the forward view from a normalized target. */
export const toForwardSheetTarget = (
  message: ParsedInitialMessageForUi,
  channelId: string,
  currentUserId: string | undefined,
): ForwardMessageSheetTarget =>
  ({
    conversationId: message.conversationId,
    currentUserId: currentUserId ?? '',
    channelId,
    initialMessage: message,
  }) as ForwardMessageSheetTarget;
