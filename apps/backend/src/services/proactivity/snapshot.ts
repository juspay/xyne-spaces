import { DatabaseClient, db } from '@/database/client';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { typingService } from '@/services/typingService';
import { redisService } from '@/services/redisService';
import { MessageType, UserType } from '@xyne/shared';
import type { ProactivityConfig } from './config';
import type { ProactivityMode, Snapshot, SnapshotMessage } from './types';

/**
 * Snapshots read from the replica when there is one: replication lag is milliseconds,
 * and these reads run for every episode. Resolved once, so an unset replica warns once.
 */
let replica: typeof db | null | undefined;
const reader = (): typeof db => {
  if (replica === undefined) replica = DatabaseClient.getReadReplicaInstance();
  return replica ?? db;
};

type Row = {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  msgType: string;
  createdAt: Date;
};

const ROW = {
  messageId: true,
  conversationId: true,
  senderId: true,
  content: true,
  msgType: true,
  createdAt: true,
} as const;

/** Messages everyone in the channel can see, from people and agents. */
const VISIBLE = {
  isDeleted: false,
  visibleTo: null,
  msgType: { in: [MessageType.USER, MessageType.BOT, MessageType.FORWARDED] },
};

async function describe(rows: Row[], prefix: string): Promise<SnapshotMessage[]> {
  const senderIds = [...new Set(rows.map((r) => r.senderId))];
  const users = await reader().user.findMany({
    where: { id: { in: senderIds } },
    select: { id: true, name: true, displayName: true, userType: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((row, i) => {
    const user = byId.get(row.senderId);
    return {
      label: `${prefix}${i + 1}`,
      messageId: row.messageId,
      conversationId: row.conversationId,
      senderId: row.senderId,
      senderName: user?.displayName || user?.name || 'Someone',
      fromAgent:
        row.msgType === MessageType.BOT ||
        user?.userType === UserType.APP ||
        user?.userType === UserType.AGENT ||
        user?.userType === UserType.BOT,
      text: extractPlainTextFromHtml(row.content).trim(),
      at: row.createdAt.getTime(),
    };
  });
}

export interface SnapshotInput {
  channelId: string;
  channelName: string;
  mode: ProactivityMode;
  askerId: string;
  /** The asker's messages: an episode's, or a single reply. Deleted ones drop out. */
  messageIds: string[];
  /** Agents drafting for this episode: their own working pill is not someone else on it. */
  draftingAgentUserIds?: string[];
  /** A reply in a conversation: include the thread before it. */
  inConversation?: boolean;
  /** How much of the conversation to read. */
  context: ProactivityConfig['context'];
}

/** The conversation as of now. Edits show as their new text. */
export async function buildSnapshot(input: SnapshotInput): Promise<Snapshot> {
  const askedRows = await reader().message.findMany({
    where: { messageId: { in: input.messageIds }, ...VISIBLE },
    select: ROW,
    orderBy: { createdAt: 'asc' },
  });
  const asked = (await describe(askedRows, 'm')).filter((m) => m.text);
  const askerName = (await describe(askedRows.slice(0, 1), 'x'))[0]?.senderName ?? 'Someone';
  const since = askedRows[0]?.createdAt ?? new Date();

  // Only the question's own threads: other conversations in the channel are other
  // questions, and read as replies they confuse every check that compares with them.
  const askedIds = new Set(input.messageIds);
  const afterRows = (
    await reader().message.findMany({
      where: {
        conversationId: { in: [...new Set(askedRows.map((r) => r.conversationId))] },
        createdAt: { gt: since },
        ...VISIBLE,
      },
      select: ROW,
      orderBy: { createdAt: 'desc' },
      take: input.context.afterMessages,
    })
  )
    .filter((row) => !askedIds.has(row.messageId))
    .reverse();

  const conversations = [...new Set(asked.map((m) => m.conversationId))];
  const beforeRows = input.inConversation ? await threadBefore(conversations, since, input) : [];
  const [typing, agentEngaged] = await Promise.all([
    Promise.all(conversations.map((id) => typingService.getTypingUsersInConversation(id))),
    agentEngagedIn(conversations, new Set(input.draftingAgentUserIds ?? [])),
  ]);

  return {
    channelName: input.channelName,
    mode: input.mode,
    askerId: input.askerId,
    askerName,
    asked,
    before: (await describe(beforeRows, 'b')).filter((m) => m.text),
    after: (await describe(afterRows, 'r')).filter((m) => m.text),
    othersTyping: typing.flat().some((user) => user.userId !== input.askerId),
    agentEngaged,
    now: Date.now(),
  };
}

const MENTION = /<span\b[^>]*\bdata-user-id=["']([^"']+)["']/g;

/**
 * Whether an agent is already on these threads: one is showing its working pill, has
 * replied, or was tagged in them.
 */
async function agentEngagedIn(conversationIds: string[], drafting: Set<string>): Promise<boolean> {
  const working = await Promise.all(
    conversationIds.map((id) =>
      redisService.getAllHashFields(`agent_progress:conversation:${id}`).catch(() => ({}))
    )
  );
  if (
    working.some((fields) => Object.keys(fields).some((agentUserId) => !drafting.has(agentUserId)))
  ) {
    return true;
  }

  const rows = await reader().message.findMany({
    where: { conversationId: { in: conversationIds }, isDeleted: false },
    select: { content: true, msgType: true, senderId: true },
  });
  // The agents drafting for this question are part of the answer, not someone else's.
  if (rows.some((r) => r.msgType === MessageType.BOT && !drafting.has(r.senderId))) return true;
  const mentioned = [
    ...new Set(rows.flatMap((r) => [...r.content.matchAll(MENTION)].map((m) => m[1]))),
  ].filter((id) => !drafting.has(id));
  if (mentioned.length === 0) return false;
  const agents = await reader().user.count({
    where: { id: { in: mentioned }, userType: { in: [UserType.APP, UserType.AGENT] } },
  });
  return agents > 0;
}

/**
 * A thread before a reply: its newest messages, and always its first, which says what
 * the thread is about. In a long thread the newest messages alone often lose it.
 */
async function threadBefore(conversations: string[], since: Date, input: SnapshotInput) {
  const [newest, starters] = await Promise.all([
    reader().message.findMany({
      where: { conversationId: { in: conversations }, createdAt: { lt: since }, ...VISIBLE },
      select: ROW,
      orderBy: { createdAt: 'desc' },
      take: input.context.threadBefore,
    }),
    reader().conversation.findMany({
      where: { conversationId: { in: conversations } },
      select: { initialMessageId: true },
    }),
  ]);
  const have = new Set(newest.map((r) => r.messageId));
  const missing = starters.flatMap((c) =>
    c.initialMessageId && !have.has(c.initialMessageId) ? [c.initialMessageId] : []
  );
  const firsts = missing.length
    ? await reader().message.findMany({
        where: { messageId: { in: missing }, createdAt: { lt: since }, ...VISIBLE },
        select: ROW,
      })
    : [];
  return [...firsts, ...newest].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** A thread from its first message, for judging a reply to an agent. */
export async function threadMessages(
  conversationId: string,
  limit = 30
): Promise<SnapshotMessage[]> {
  const rows = (
    await reader().message.findMany({
      where: { conversationId, ...VISIBLE },
      select: ROW,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  ).reverse();
  return (await describe(rows, 't')).filter((m) => m.text);
}
