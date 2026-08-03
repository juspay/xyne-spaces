import type { ConversationParticipant } from '@prisma/client';

import {
  serializeConversationV3Row,
  type SerializedConversationV3Row,
} from './conversationV3Serializer';
import {
  serializeConversationMessageRow,
  type SerializedConversationMessageRow,
} from './conversationMessageSerializer';
import type {
  RecentChannelConversations,
  RecentConversationRow,
} from '../database/repositories/recentConversationsRepository';

function toEpochMs(d: Date): number {
  return d.getTime();
}

export interface SerializedConversationParticipant {
  id: string;
  conversationId: string;
  userId: string;
  participationType: string | null;
  isSubscribed: boolean;
  joinedAt: number;
  lastReadAt: number | null;
  lastReplyAt: number | null;
  channelId: string | null;
}

export interface SerializedRecentConversation extends SerializedConversationV3Row {
  participant: SerializedConversationParticipant | null;
  messages: SerializedConversationMessageRow[];
}

export interface SerializedRecentChannel {
  channelId: string;
  lastViewedAt: number;
  conversations: SerializedRecentConversation[];
}

function serializeParticipant(p: ConversationParticipant): SerializedConversationParticipant {
  return {
    id: p.id,
    conversationId: p.conversationId,
    userId: p.userId,
    participationType: p.participationType,
    isSubscribed: p.isSubscribed,
    joinedAt: toEpochMs(p.joinedAt),
    lastReadAt: p.lastReadAt ? toEpochMs(p.lastReadAt) : null,
    lastReplyAt: p.lastReplyAt ? toEpochMs(p.lastReplyAt) : null,
    channelId: p.channelId,
  };
}

function serializeRecentConversation(row: RecentConversationRow): SerializedRecentConversation {
  const base = serializeConversationV3Row(
    row.conversation,
    row.initialMessageAttachments,
    row.initialMessageNudgeCounts
  );
  return {
    ...base,
    participant: row.participant ? serializeParticipant(row.participant) : null,
    messages: row.messages.map(m =>
      serializeConversationMessageRow(m.message, m.attachments, m.nudgeCounts)
    ),
  };
}

export function serializeRecentChannelConversations(
  channels: RecentChannelConversations[]
): SerializedRecentChannel[] {
  return channels.map(channel => ({
    channelId: channel.channelId,
    lastViewedAt: toEpochMs(channel.lastViewedAt),
    conversations: channel.conversations.map(serializeRecentConversation),
  }));
}
