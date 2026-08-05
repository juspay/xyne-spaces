import {
  Conversation,
  ConversationParticipant,
  Message,
  MessageAttachment,
  SurfaceNudgeCount,
} from '@prisma/client';
import { DatabaseClient } from '../client';
import { AttachmentEntityType } from '@xyne/shared';

export interface RecentConversationMessage {
  message: Message;
  attachments: MessageAttachment[];
  nudgeCounts: SurfaceNudgeCount[];
}

export interface RecentConversationRow {
  conversation: Conversation;
  initialMessageAttachments: MessageAttachment[];
  initialMessageNudgeCounts: SurfaceNudgeCount[];
  participant: ConversationParticipant | null;
  messages: RecentConversationMessage[];
}

export interface RecentChannelConversations {
  channelId: string;
  lastViewedAt: Date;
  conversations: RecentConversationRow[];
}

function groupBy<T>(rows: T[], key: (row: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (k == null) continue;
    const existing = map.get(k);
    if (existing) existing.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export class RecentConversationsRepository {
  private db = DatabaseClient.getInstance();

  async getRecentVisitedChannelConversations(
    userId: string,
    cutoff: Date
  ): Promise<RecentChannelConversations[]> {
    const statuses = await this.db.channelUserStatus.findMany({
      where: { userId, isDeleted: false, lastViewedAt: { gte: cutoff } },
      select: { channelId: true, lastViewedAt: true },
      orderBy: { lastViewedAt: 'desc' },
    });
    if (statuses.length === 0) return [];

    const lastViewedByChannel = new Map<string, Date>();
    for (const s of statuses) {
      const existing = lastViewedByChannel.get(s.channelId);
      if (!existing || s.lastViewedAt > existing) {
        lastViewedByChannel.set(s.channelId, s.lastViewedAt);
      }
    }
    const channelIds = [...lastViewedByChannel.keys()];

    const channels = await this.db.channel.findMany({
      where: { id: { in: channelIds } },
      select: { id: true, visibility: true },
    });
    const publicIds = new Set(
      channels.filter(c => c.visibility !== 'PRIVATE').map(c => c.id)
    );
    const privateIds = channels.filter(c => c.visibility === 'PRIVATE').map(c => c.id);

    let memberPrivateIds = new Set<string>();
    if (privateIds.length > 0) {
      const parts = await this.db.channelParticipant.findMany({
        where: { channelId: { in: privateIds }, userId },
        select: { channelId: true },
      });
      memberPrivateIds = new Set(parts.map(p => p.channelId));
    }

    const allowedChannelIds = channelIds.filter(
      id => publicIds.has(id) || memberPrivateIds.has(id)
    );
    if (allowedChannelIds.length === 0) return [];

    const perChannelConvos = await Promise.all(
      allowedChannelIds.map(channelId =>
        this.db.conversation.findMany({
          where: { channelId },
          orderBy: [{ createdAt: 'desc' }, { conversationId: 'asc' }],
        })
      )
    );

    const conversations = perChannelConvos.flat();
    if (conversations.length === 0) {
      return allowedChannelIds.map(channelId => ({
        channelId,
        lastViewedAt: lastViewedByChannel.get(channelId)!,
        conversations: [],
      }));
    }

    const conversationIds = conversations.map(c => c.conversationId);
    const initialMessageIds = [...new Set(conversations.map(c => c.initialMessageId))];

    const [initialAttachments, initialNudges, threadMessages, participants] = await Promise.all([
      this.db.messageAttachment.findMany({
        where: { entityId: { in: initialMessageIds }, entityType: AttachmentEntityType.CHAT },
      }),
      this.db.surfaceNudgeCount.findMany({
        where: {
          messageId: { in: initialMessageIds },
          OR: [{ userId }, { channelId: { not: null } }],
        },
      }),
      this.db.message.findMany({
        where: {
          conversationId: { in: conversationIds },
          OR: [{ visibleTo: null }, { visibleTo: userId }],
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.conversationParticipant.findMany({
        where: { conversationId: { in: conversationIds }, userId },
      }),
    ]);

    const messageIds = threadMessages.map(m => m.messageId);
    const [messageAttachments, messageNudges] = await Promise.all([
      messageIds.length
        ? this.db.messageAttachment.findMany({
            where: { entityId: { in: messageIds }, entityType: AttachmentEntityType.CHAT, isDeleted: false },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([] as MessageAttachment[]),
      messageIds.length
        ? this.db.surfaceNudgeCount.findMany({
            where: {
              messageId: { in: messageIds },
              OR: [{ userId }, { channelId: { not: null } }],
            },
          })
        : Promise.resolve([] as SurfaceNudgeCount[]),
    ]);

    const initialAttByMsg = groupBy(initialAttachments, a => a.entityId);
    const initialNudgeByMsg = groupBy(initialNudges, n => n.messageId);
    const messagesByConv = groupBy(threadMessages, m => m.conversationId);
    const msgAttByMsg = groupBy(messageAttachments, a => a.entityId);
    const msgNudgeByMsg = groupBy(messageNudges, n => n.messageId);
    const participantByConv = new Map(participants.map(p => [p.conversationId, p]));

    const buildRow = (conversation: Conversation): RecentConversationRow => ({
      conversation,
      initialMessageAttachments: initialAttByMsg.get(conversation.initialMessageId) ?? [],
      initialMessageNudgeCounts: initialNudgeByMsg.get(conversation.initialMessageId) ?? [],
      participant: participantByConv.get(conversation.conversationId) ?? null,
      messages: (messagesByConv.get(conversation.conversationId) ?? []).map(message => ({
        message,
        attachments: msgAttByMsg.get(message.messageId) ?? [],
        nudgeCounts: msgNudgeByMsg.get(message.messageId) ?? [],
      })),
    });

    // 6. Assemble grouped by channel, preserving per-channel conversation order.
    return allowedChannelIds.map((channelId, i) => ({
      channelId,
      lastViewedAt: lastViewedByChannel.get(channelId)!,
      conversations: perChannelConvos[i].map(buildRow),
    }));
  }
}
