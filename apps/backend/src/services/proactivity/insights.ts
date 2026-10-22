import type { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';

/**
 * What Administration → Agent activity reads, and the "why did or didn't it answer this
 * message" lookup. Reads go through the ACL, so a reader only gets channels they can access.
 */

const EPISODE_FIELDS = {
  id: true,
  kind: true,
  mode: true,
  gate: true,
  messageIds: true,
  conversationId: true,
  outcome: true,
  reason: true,
  score: true,
  agentSlug: true,
  createdAt: true,
} as const;

/** Every decision about a message: the question it was in, or the follow-up it was. */
export function whyForMessage(messageId: string) {
  return db.agentProactivityDecision.findMany({
    where: { messageIds: { has: messageId } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { ...EPISODE_FIELDS, channelId: true },
  });
}

export interface DecisionFilter {
  channelId?: string;
  /** An outcome, or `drafting` for ones still waiting on their agents. */
  outcome?: string;
  /** Older than this, for the next page. */
  before?: Date;
  limit: number;
}

/**
 * The workspace's decisions for the Administration page, newest first, each with its
 * channel's name and the question's opening line. Read through the ACL, so a reader
 * gets the channels they can access.
 */
export async function workspaceDecisions(filter: DecisionFilter) {
  const where: Prisma.AgentProactivityDecisionWhereInput = {
    ...(filter.before ? { createdAt: { lt: filter.before } } : {}),
    ...(filter.channelId ? { channelId: filter.channelId } : {}),
    ...(filter.outcome === 'drafting'
      ? { outcome: null }
      : filter.outcome
        ? { outcome: filter.outcome }
        : {}),
  };
  const rows = await db.agentProactivityDecision.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filter.limit,
    select: { ...EPISODE_FIELDS, channelId: true },
  });
  const [channels, messages] = await Promise.all([
    db.channel.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.channelId))] } },
      select: { id: true, name: true },
    }),
    db.message.findMany({
      where: { messageId: { in: rows.flatMap((r) => r.messageIds.slice(0, 1)) } },
      select: { messageId: true, content: true },
    }),
  ]);
  const channelName = new Map(channels.map((c) => [c.id, c.name]));
  const text = new Map(
    messages.map((m) => [m.messageId, extractPlainTextFromHtml(m.content).slice(0, 200)])
  );
  return rows.map((row) => ({
    ...row,
    channelName: channelName.get(row.channelId) ?? null,
    question: text.get(row.messageIds[0]) ?? null,
  }));
}

/** Channels with agents allowed to reply on their own, for the page's filter. */
export function proactiveChannels() {
  return db.channel.findMany({
    where: { agentProactivityMode: { not: 'OFF' } },
    select: { id: true, name: true, agentProactivityMode: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * A message's whole journey, for Administration → Agent activity: the message, every
 * decision about it (follow-ups and bumps that point back to it included) with all the
 * messages each one covered, and each decision's XOR requests with every question and
 * probability. The agents' runs come
 * from claw-auth.
 */
export async function messageTrace(messageId: string) {
  const message = await db.message.findUnique({
    where: { messageId },
    select: {
      messageId: true,
      content: true,
      createdAt: true,
      sender: { select: { name: true, displayName: true } },
      conversation: { select: { channelId: true, channel: { select: { name: true } } } },
    },
  });
  const direct = await db.agentProactivityDecision.findMany({
    where: { messageIds: { has: messageId } },
    select: { id: true },
  });
  const ids = direct.map((d) => d.id);
  const decisions = await db.agentProactivityDecision.findMany({
    where: { OR: [{ id: { in: ids } }, { parentEpisodeId: { in: ids } }] },
    orderBy: { createdAt: 'asc' },
    select: {
      ...EPISODE_FIELDS,
      workspaceId: true,
      channelId: true,
      parentEpisodeId: true,
      senderId: true,
    },
  });
  const calls = await db.agentProactivityXorCall.findMany({
    where: { decisionId: { in: decisions.map((d) => d.id) } },
    orderBy: { createdAt: 'asc' },
  });
  const questions = await db.agentProactivityXorQuestion.findMany({
    where: { callId: { in: calls.map((c) => c.id) } },
  });
  // Every message of every decision: a decision is about a burst, not one message.
  const burst = await db.message.findMany({
    where: { messageId: { in: [...new Set(decisions.flatMap((d) => d.messageIds))] } },
    orderBy: { createdAt: 'asc' },
    select: { messageId: true, content: true, createdAt: true },
  });
  return {
    message: message && {
      messageId: message.messageId,
      text: extractPlainTextFromHtml(message.content),
      senderName: message.sender?.displayName || message.sender?.name || null,
      channelId: message.conversation?.channelId ?? null,
      channelName: message.conversation?.channel?.name ?? null,
      createdAt: message.createdAt,
    },
    decisions: decisions.map((decision) => ({
      ...decision,
      messages: burst
        .filter((m) => decision.messageIds.includes(m.messageId))
        .map((m) => ({
          messageId: m.messageId,
          text: extractPlainTextFromHtml(m.content),
          createdAt: m.createdAt,
        })),
      xorCalls: calls
        .filter((call) => call.decisionId === decision.id)
        .map((call) => ({
          ...call,
          questions: questions.filter((q) => q.callId === call.id),
        })),
    })),
  };
}
