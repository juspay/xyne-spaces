import { Prisma } from "@prisma/client";
import type { AssistantPart } from "../lib/chat-run-record.js";
import { prisma } from "../db.js";
import { userIdFilter } from "./userIdFilter.js";

export const chatMessageRepository = {
  create: (data: {
    pendingActions?: unknown;
    runProvider?: string | null;
    conversationId: string;
    agentSlug: string;
    userId: string;
    role: string;
    content: string;
    status?: string;
    reasoning?: string | null;
    parentId?: string | null;
    orgId: string;
    /** Normalized AttachedContextRef[] the user attached to this turn. Stored on
     *  user messages only; shown read-only in the transcript on reload. Typed as
     *  unknown so callers can pass the domain array without a Prisma import; the
     *  JSON cast is localized here. */
    attachedContext?: unknown;
    /** The assistant turn as ordered parts (see the `parts` column). */
    parts?: AssistantPart[] | null;
  }) => {
    const { attachedContext, pendingActions, parts, ...rest } = data;
    return prisma.chatMessage.create({
      data: {
        ...rest,
        ...(parts ? { parts: parts as unknown as Prisma.InputJsonValue } : {}),
        ...(attachedContext !== undefined
          ? { attachedContext: attachedContext as Prisma.InputJsonValue }
          : {}),
        ...(pendingActions !== undefined
          ? { pendingActions: pendingActions as Prisma.InputJsonValue }
          : {}),
      },
    });
  },

  /** Update a message's content, status, reasoning, or parent. Used by the
   *  chat callback to finalize the pre-created assistant placeholder once the
   *  run completes (branching needs the assistant id reserved up-front). */
  update: (
    id: string,
    data: { content?: string; status?: string; reasoning?: string | null; parentId?: string | null; pendingActions?: unknown; runProvider?: string | null; parts?: AssistantPart[] | null },
  ) => {
    const { pendingActions, parts, ...rest } = data;
    return prisma.chatMessage.update({
      where: { id },
      data: {
        ...rest,
        ...(pendingActions !== undefined
          ? { pendingActions: pendingActions as Prisma.InputJsonValue }
          : {}),
        ...(parts !== undefined
          ? { parts: parts === null ? Prisma.DbNull : (parts as unknown as Prisma.InputJsonValue) }
          : {}),
      },
    });
  },

  resolvePendingAction: async (
    conversationId: string,
    signature: string,
    resolution: "approved" | "declined",
  ): Promise<boolean> => {
    const row = await prisma.chatMessage.findFirst({
      where: { conversationId, pendingActions: { array_contains: [{ signature }] } },
      select: { id: true, pendingActions: true },
      orderBy: { createdAt: "desc" },
    });
    if (!row || !Array.isArray(row.pendingActions)) return false;
    const next = (row.pendingActions as Array<Record<string, unknown>>).map((action) =>
      action && typeof action === "object" && action["signature"] === signature ? { ...action, resolution } : action,
    );
    await prisma.chatMessage.update({ where: { id: row.id }, data: { pendingActions: next as Prisma.InputJsonValue } });
    return true;
  },

  /** Append a FlowUI artifact card, deduped by screenId. */
  appendUiFlow: async (id: string, flow: { screenId: string }): Promise<void> => {
    await prisma.$transaction(async (tx) => {
      const row = await tx.chatMessage.findUnique({ where: { id }, select: { uiFlows: true } });
      if (!row) return;
      const existing = Array.isArray(row.uiFlows)
        ? (row.uiFlows as Array<Record<string, unknown>>)
        : [];
      if (existing.some((entry) => entry?.["screenId"] === flow.screenId)) return;
      await tx.chatMessage.update({
        where: { id },
        data: { uiFlows: [...existing, flow] as unknown as Prisma.InputJsonValue },
      });
    });
  },

  /** Swap a stored card for a new version of itself (pending → answered /
   *  declined). Returns false when the message or screenId is gone. */
  replaceUiFlow: async (id: string, screenId: string, flow: unknown): Promise<boolean> => {
    return prisma.$transaction(async (tx) => {
      const row = await tx.chatMessage.findUnique({ where: { id }, select: { uiFlows: true } });
      if (!row || !Array.isArray(row.uiFlows)) return false;
      const existing = row.uiFlows as Array<Record<string, unknown>>;
      if (!existing.some((entry) => entry?.["screenId"] === screenId)) return false;
      const next = existing.map((entry) => (entry?.["screenId"] === screenId ? flow : entry));
      await tx.chatMessage.update({
        where: { id },
        data: { uiFlows: next as unknown as Prisma.InputJsonValue },
      });
      return true;
    });
  },

  /** Persist mid-run PARTIAL content, but ONLY while the row is still "running".
   *  Conditional (updateMany + status guard) so a late/cross-pod debounced write
   *  can never clobber the final content the completion callback wrote (which
   *  flips status off "running"). Returns count of rows updated (0 = ignored). */
  updatePartialContent: (id: string, data: { content?: string; reasoning?: string | null; parts?: AssistantPart[] }) =>
    prisma.chatMessage.updateMany({
      where: { id, status: "running" },
      data: { ...data, ...(data.parts ? { parts: data.parts as unknown as Prisma.InputJsonValue } : {}) },
    }),

  /** Hard-delete a single message by id. Used to drop a duplicate run's
   *  pre-created assistant placeholder when that run is skipped because another
   *  worker already owns the conversation (deferred / lock-skip) — so the user
   *  never sees a spurious error bubble for the redundant run. `deleteMany` (not
   *  `delete`) so a missing row is a no-op rather than a throw. */
  deleteById: (id: string) => prisma.chatMessage.deleteMany({ where: { id } }),

  /**
   * Newest message id in a conversation, or null when it's empty.
   *
   * HEADLESS runs (error-pipeline, Spaces automations) persist their assistant
   * turn with no parent, which left several messages hanging off the ROOT.
   * The chat then read that as a regenerate FORK: resolvePiConversationIdForPath
   * saw >1 root sibling, returned `<conv>__branch__<assistantId>`, and claw
   * opened a BRAND-NEW pi session for the follow-up — the agent answered with
   * no memory of the run the user was looking at. Chaining each persisted turn
   * onto the previous message keeps the tree linear so the base conversationId
   * (and therefore the run's own session) resolves.
   */
  latestMessageId: async (conversationId: string, agentSlug: string): Promise<string | null> => {
    const row = await prisma.chatMessage.findFirst({
      // Scoped to the SAME agent: a conversation/thread is shared across agents
      // (e.g. a mentioned user's digital-twin runs under the same
      // conversationId), so an unscoped "latest" could parent this turn under
      // another agent's message and cross-link the two trees.
      where: { conversationId, agentSlug },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return row?.id ?? null;
  },

  /** Newest user message in this conversation+agent whose attachedContext holds
   *  a `local-folder` item, or null. Powers the sticky local folder: once a turn
   *  attaches a folder, later turns in the same thread keep running in it.
   *  `agentSlug` null = any agent: a direct chat keeps its folder when the user
   *  switches agents mid-conversation. */
  latestLocalFolderContext: async (
    conversationId: string,
    agentSlug: string | null,
  ): Promise<unknown | null> => {
    if (!conversationId || agentSlug === "") return null;
    const rows = await prisma.chatMessage.findMany({
      where: { conversationId, ...(agentSlug ? { agentSlug } : {}), role: "user" },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { attachedContext: true },
    });
    for (const row of rows) {
      const list = row.attachedContext;
      if (!Array.isArray(list)) continue;
      const hit = list.find(
        (entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry) &&
          (entry as Record<string, unknown>)["type"] === "local-folder",
      );
      if (hit) return hit;
    }
    return null;
  },

  findByConversation: (conversationId: string) =>
    prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: { attachments: true },
    }),

  /** Messages for ONE agent within a conversation. A thread (conversationId) is
   *  shared across agents (e.g. a host agent AND a mentioned user's digital
   *  twin run with the SAME conversationId but different agentSlug), so the
   *  per-agent chat window MUST scope by agentSlug — otherwise the twin's
   *  private messages/reasoning bleed into the host agent's window. */
  findByConversationAndAgent: (conversationId: string, agentSlug: string) =>
    prisma.chatMessage.findMany({
      where: { conversationId, agentSlug },
      orderBy: { createdAt: "asc" },
      include: { attachments: true },
    }),

  /** Every (conversation, agent) pair one user has rows in, with first/last
   *  activity and row counts — the whole all-agents history in one aggregate
   *  query instead of loading every message. Rows may be keyed by either of
   *  the caller's verified ids (see getRequesterAliases). */
  conversationAgentGroupsForUser: async (
    userIds: string | string[],
  ): Promise<Array<{ conversationId: string; agentSlug: string; firstAt: Date; lastAt: Date; count: number }>> => {
    const rows = await prisma.chatMessage.groupBy({
      by: ["conversationId", "agentSlug"],
      where: userIdFilter(userIds),
      _min: { createdAt: true },
      _max: { createdAt: true },
      _count: { _all: true },
    });
    return rows
      .filter((row) => row._min.createdAt && row._max.createdAt)
      .map((row) => ({
        conversationId: row.conversationId,
        agentSlug: row.agentSlug,
        firstAt: row._min.createdAt!,
        lastAt: row._max.createdAt!,
        count: row._count._all,
      }));
  },

  /** The earliest user message per (conversation, agent) for one user, oldest
   *  first, clipped to a title's worth of text. DISTINCT ON keeps it to one row
   *  per pair rather than every user message in every conversation. */
  firstUserMessagesPerAgent: async (
    conversationIds: string[],
    userIds: string | string[],
  ): Promise<Array<{ conversationId: string; agentSlug: string; content: string }>> => {
    if (conversationIds.length === 0) return [];
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    const rows = await prisma.$queryRaw<Array<{ conversationId: string; agentSlug: string; content: string; createdAt: Date }>>`
      SELECT DISTINCT ON ("conversationId", "agentSlug")
        "conversationId", "agentSlug", left("content", 200) AS "content", "createdAt"
      FROM "chat_messages"
      WHERE "userId" = ANY(${ids}) AND "role" = 'user' AND "conversationId" = ANY(${conversationIds})
      ORDER BY "conversationId", "agentSlug", "createdAt" ASC`;
    return rows
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(({ conversationId, agentSlug, content }) => ({ conversationId, agentSlug, content }));
  },

  /** The ordered parts a still-running placeholder accumulated (partial writes). */
  partialParts: async (id: string): Promise<unknown> =>
    (await prisma.chatMessage.findUnique({ where: { id }, select: { parts: true } }))?.parts ?? null,

  /** Delete every message in a conversation belonging to this user+agent.
   *  Scoped by all three to prevent one user from deleting another's chat
   *  even if they guess a conversationId. Returns the delete count. Alias
   *  array = both verified representations of the SAME caller. */
  deleteConversation: async (userIds: string | string[], agentSlug: string, conversationId: string) => {
    const result = await prisma.chatMessage.deleteMany({
      where: { ...userIdFilter(userIds), agentSlug, conversationId },
    });
    if (result.count > 0) {
      await prisma.chatConversationMeta.deleteMany({
        where: { conversationId, agentSlug, ...userIdFilter(userIds) },
      });
    }
    return result.count;
  },

  /** Delete ONE user's rows in a direct chat across every agent that answered
   *  in it. A chat the user switched agents in is one conversation: deleting
   *  only the requesting agent's rows would leave the other agents' turns
   *  hanging off parents that no longer exist. Same user scoping as above. */
  deleteConversationAllAgents: async (userIds: string | string[], conversationId: string) => {
    const result = await prisma.chatMessage.deleteMany({ where: { ...userIdFilter(userIds), conversationId } });
    if (result.count > 0) {
      await prisma.chatConversationMeta.deleteMany({ where: { conversationId, ...userIdFilter(userIds) } });
    }
    return result.count;
  },
};
