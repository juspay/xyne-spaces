import { QueryResultType } from '@rocicorp/zero';
import { ReactNode } from 'react';
import { queries } from '@/src/zero/queries';
import { MessageType } from '@xyne/shared';
import type { MessageAttachment } from '@xyne/shared';
import type { RawReaction } from './reactions/reaction-pill.utils';

export type SenderFromConversation = {
  id: string;
  name: string;
  picture?: string | null;
};

/** Parsed `initial_message_md` plus relations used by the RN message UI. */
export type ParsedInitialMessageForUi = {
  messageId: string;
  conversationId: string;
  childConversationId: string | null;
  senderId: string;
  content: string;
  msgType: MessageType;
  hasAttachment: boolean;
  edited: boolean;
  isDeleted: boolean;
  showInChannel: boolean;
  visibleTo: string | null;
  createdAt: number;
  metadata: unknown;
  nudgeCount: number | null;
  isSent: boolean;
  reactions_md: string | null;
  link_preview_md: string | null;
  attachments?: readonly MessageAttachment[];
  nudgeCounts?: readonly { id: string; nudgeCount: number }[];
  reactions?: readonly RawReaction[];
  /** Present when loaded via legacy relation query */
  sender?: SenderFromConversation;
};

export type ChannelConversationV2Row = QueryResultType<
  typeof queries.channelConversationsPaginatedV2
>[number];

export type ChannelConversationV3Row = QueryResultType<
  typeof queries.channelConversationsPaginatedV3
>[number];

export type ChannelMessageForRender = ChannelConversationV2Row & {
  currentUserId: string;
  initialMessage: ParsedInitialMessageForUi;
};

export type ChannelMessageV3ForRender = ChannelConversationV3Row & {
  currentUserId: string;
  initialMessage: ParsedInitialMessageForUi;
  parentMessage?: undefined;
};

/**
 * Legacy full row (e.g. threads) — still uses nested Zero relations where present.
 */
export type MessageData = QueryResultType<typeof queries.channelConversationsPaginated>[number];

export type MessageDataLike = Pick<
  MessageData,
  'conversationId' | 'replyCount' | 'lastActivityAt' | 'createdAt'
> & {
  currentUserId: string;
  initialMessage?: MessageData['initialMessage'] | ParsedInitialMessageForUi;
  parentMessage?: MessageData['parentMessage'];
  participants?: MessageData['participants'];
  ticket?: MessageData['ticket'];
};

export type MessageForRender =
  ChannelMessageForRender | ChannelMessageV3ForRender | MessageDataLike;

export type ConversationType = 'dm' | 'channel';

export type MessageContextValue = {
  message: MessageForRender;
  previousMessage?: MessageForRender | undefined;
  msgType: MessageType;
  isTicket: boolean;
  conversationType?: ConversationType;
};

export type MessageRootProps = {
  message: MessageForRender;
  previousMessage?: MessageForRender | undefined;
  conversationType?: ConversationType;
  lastViewedAt?: number | undefined;
  children: ReactNode;
};
