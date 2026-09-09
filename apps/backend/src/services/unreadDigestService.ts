import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { isDeskChannelType, ChannelType } from '@xyne/shared';
import type { ThreadMessage } from '@/agents/summariser';
import {
  UNREAD_DIGEST_CAPS,
  capChannelMessages,
  rankAndCapChannels,
} from '@/services/unreadDigestSelection';

export {
  UNREAD_DIGEST_CAPS,
  isDigestEligible,
  capChannelMessages,
  rankAndCapChannels,
} from '@/services/unreadDigestSelection';

const prisma = DatabaseClient.getInstance();

/** A message as needed by the summariser, plus the fields we filter on. */
export interface DigestSourceMessage {
  readonly messageId: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly content: string;
  readonly createdAt: Date;
  readonly isDeleted: boolean;
  readonly visibleTo: string | null;
  readonly hasAttachment: boolean;
  readonly authorName: string;
}

export interface DigestChannelInput {
  readonly channelId: string;
  readonly channelName: string;
  readonly unreadHint: number; // ranking signal (unread count / activity)
  readonly messages: readonly DigestSourceMessage[];
}

export interface DigestChannelSnapshot {
  readonly channelId: string;
  readonly channelName: string;
  readonly messages: ThreadMessage[];
  /** 1-based index -> messageId, for citation mapping (mirrors summarizeChannel). */
  readonly messageIdMapping: Map<number, string>;
  readonly conversationIdMapping: Map<number, string>;
  readonly includedCount: number;
  readonly omittedCount: number;
}

export interface UnreadDigestSnapshot {
  readonly snapshotAt: Date;
  readonly channels: DigestChannelSnapshot[];
  /** Channels that were unread but dropped because of the channel cap. */
  readonly omittedChannelCount: number;
  readonly caps: typeof UNREAD_DIGEST_CAPS;
}

/** Channel types that never appear in the Unreads inbox (mirrors the UI). */
function isExcludedChannelType(type: string | null | undefined): boolean {
  return (
    isDeskChannelType(type) ||
    type === ChannelType.SUPPORT ||
    type === ChannelType.SDLC
  );
}

export class UnreadDigestService {
  /**
   * Build a server-owned, timestamped snapshot of everything the given user has
   * not yet read across their channels. Identity is taken ONLY from the
   * authenticated caller — never from request input.
   *
   * This is strictly read-only: it never mutates read state. A future
   * "mark read after digest" action must clear against `snapshotAt`, not
   * `now()`, so messages that arrive during generation stay unread.
   */
  async createSnapshot(userId: string, workspaceId: string): Promise<UnreadDigestSnapshot> {
    const snapshotAt = new Date();

    // 1. Channels the user is a member of, within their workspace.
    const memberships = await prisma.channelParticipant.findMany({
      where: { userId, workspaceId },
      select: { channelId: true },
    });
    const channelIds = memberships.map((m) => m.channelId);
    if (channelIds.length === 0) {
      return { snapshotAt, channels: [], omittedChannelCount: 0, caps: UNREAD_DIGEST_CAPS };
    }

    // 2. Channel metadata + per-user read state.
    const [channels, statuses] = await Promise.all([
      prisma.channel.findMany({
        where: { id: { in: channelIds }, workspaceId },
        select: { id: true, name: true, type: true },
      }),
      prisma.channelUserStatus.findMany({
        where: { userId, channelId: { in: channelIds } },
        select: { channelId: true, lastViewedAt: true, unreadCount: true },
      }),
    ]);

    const statusByChannel = new Map(statuses.map((s) => [s.channelId, s]));
    const eligibleChannels = channels.filter((c) => !isExcludedChannelType(c.type));
    if (eligibleChannels.length === 0) {
      return { snapshotAt, channels: [], omittedChannelCount: 0, caps: UNREAD_DIGEST_CAPS };
    }

    // 3. For each channel, gather unread messages via its conversations.
    const rawChannels: DigestChannelInput[] = [];
    for (const channel of eligibleChannels) {
      const status = statusByChannel.get(channel.id);
      const lastViewedAt = status?.lastViewedAt ?? null;

      const conversations = await prisma.conversation.findMany({
        where: { channelId: channel.id },
        select: { conversationId: true },
      });
      const conversationIds = conversations.map((c) => c.conversationId);
      if (conversationIds.length === 0) continue;

      const rows = await prisma.message.findMany({
        where: {
          conversationId: { in: conversationIds },
          isDeleted: false,
          createdAt: {
            ...(lastViewedAt ? { gt: lastViewedAt } : {}),
            lte: snapshotAt,
          },
          senderId: { not: userId },
          OR: [{ visibleTo: null }, { visibleTo: userId }],
        },
        orderBy: { createdAt: 'asc' },
        take: UNREAD_DIGEST_CAPS.maxMessagesPerChannel + 1,
        select: {
          messageId: true,
          conversationId: true,
          senderId: true,
          content: true,
          createdAt: true,
          isDeleted: true,
          visibleTo: true,
          hasAttachment: true,
        },
      });
      if (rows.length === 0) continue;

      const senderIds = [...new Set(rows.map((r) => r.senderId))];
      const users = await prisma.user.findMany({
        where: { id: { in: senderIds } },
        select: { id: true, name: true, email: true },
      });
      const userMap = new Map(users.map((u) => [u.id, u]));

      rawChannels.push({
        channelId: channel.id,
        channelName: channel.name,
        unreadHint: status?.unreadCount ?? rows.length,
        messages: rows.map((r) => ({
          messageId: r.messageId,
          conversationId: r.conversationId,
          senderId: r.senderId,
          content: r.content,
          createdAt: r.createdAt,
          isDeleted: r.isDeleted,
          visibleTo: r.visibleTo,
          hasAttachment: r.hasAttachment,
          authorName: userMap.get(r.senderId)?.name || userMap.get(r.senderId)?.email || 'Unknown User',
        })),
      });
    }

    // 4. Rank + cap channels, then cap messages per channel with an overall budget.
    const { included, omittedChannelCount } = rankAndCapChannels(
      rawChannels,
      UNREAD_DIGEST_CAPS.maxChannels
    );

    const channelSnapshots: DigestChannelSnapshot[] = [];
    let overallBudget = UNREAD_DIGEST_CAPS.maxMessagesOverall;

    for (const ch of included) {
      if (overallBudget <= 0) break;
      const perChannelCap = Math.min(UNREAD_DIGEST_CAPS.maxMessagesPerChannel, overallBudget);
      const { kept, omitted } = capChannelMessages(ch.messages, perChannelCap);
      overallBudget -= kept.length;

      const messageIdMapping = new Map<number, string>();
      const conversationIdMapping = new Map<number, string>();
      const messages: ThreadMessage[] = kept.map((m, idx) => {
        messageIdMapping.set(idx + 1, m.messageId);
        conversationIdMapping.set(idx + 1, m.conversationId);
        return {
          id: m.messageId,
          content: m.content,
          authorName: m.authorName,
          createdAt: m.createdAt,
          hasAttachment: m.hasAttachment,
        };
      });

      channelSnapshots.push({
        channelId: ch.channelId,
        channelName: ch.channelName,
        messages,
        messageIdMapping,
        conversationIdMapping,
        includedCount: kept.length,
        omittedCount: omitted,
      });
    }

    logger.info(
      `[UnreadDigest] snapshot for user=${userId} channels=${channelSnapshots.length} omittedChannels=${omittedChannelCount}`
    );

    return { snapshotAt, channels: channelSnapshots, omittedChannelCount, caps: UNREAD_DIGEST_CAPS };
  }
}

export const unreadDigestService = new UnreadDigestService();
