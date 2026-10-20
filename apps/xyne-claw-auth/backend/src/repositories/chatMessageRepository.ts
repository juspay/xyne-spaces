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

  /** Appends finished user/assistant pairs in one transaction, chained from
   *  `parentId` so the tree stays linear. `createdAt` is set a millisecond
   *  apart: rows of one transaction would otherwise share a timestamp and the
   *  transcript (ordered by createdAt) could show a reply before its request. */
  appendTurns: (data: {
    conversationId: string;
    agentSlug: string;
    userId: string;
    orgId: string;
    parentId: string | null;
    turns: Array<{ request: string; reply: string }>;
  }) =>
    prisma.$transaction(async (tx) => {
      const { turns, parentId: firstParentId, ...owner } = data;
      const start = Date.now();
      const ids: string[] = [];
      let parentId = firstParentId;
      for (const [index, turn] of turns.flatMap((t) => [
        { role: "user", content: t.request },
        { role: "assistant", content: t.reply },
      ]).entries()) {
        const row = await tx.chatMessage.create({
          data: { ...owner, ...turn, status: "completed", parentId, createdAt: new Date(start + index) },
          select: { id: true },
        });
        ids.push(row.id);
        parentId = row.id;
      }
      return ids;
    }),

  /** The pending action exactly as the run stored it, found by signature. */
  findPendingAction: async (conversationId: string, signature: string): Promise<Record<string, unknown> | null> => {
    const row = await prisma.chatMessage.findFirst({
      where: { conversationId, pendingActions: { array_contains: [{ signature }] } },
      select: { pendingActions: true },
      orderBy: { createdAt: "desc" },
    });
    if (!row || !Array.isArray(row.pendingActions)) return null;
    const match = (row.pendingActions as Array<Record<string, unknown>>).find(
      (action) => action && typeof action === "object" && action["signature"] === signature,
    );
    return match ?? null;
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
  /**
   * `scope` narrows the aggregate itself rather than its result, so cursor
   * pagination downstream still sees a complete, correctly ordered set.
   *
   * Both arrays are honoured when EMPTY and must be: an empty `only` means a
   * project with no chats and has to return nothing, while an empty `exclude`
   * means nothing is filed and has to return everything. Guarding on
   * truthiness instead of `undefined` turns the first case into "no filter"
   * and lists every chat the user has.
   */
  conversationAgentGroupsForUser: async (
    userIds: string | string[],
    scope?: { only?: string[]; exclude?: string[] },
  ): Promise<Array<{ conversationId: string; agentSlug: string; firstAt: Date; lastAt: Date; count: number }>> => {
    const conversationId: Record<string, string[]> = {};
    if (scope?.only !== undefined) conversationId["in"] = scope.only;
    if (scope?.exclude !== undefined) conversationId["notIn"] = scope.exclude;
    const rows = await prisma.chatMessage.groupBy({
      by: ["conversationId", "agentSlug"],
      where: {
        ...userIdFilter(userIds),
        ...(Object.keys(conversationId).length > 0 ? { conversationId } : {}),
      },
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
   *  first, clipped to a title's worth of text. One aggregate finds each
   *  pair's first timestamp, then only those rows are read — not every user
   *  message in every conversation. */
  firstUserMessagesPerAgent: async (
    conversationIds: string[],
    userIds: string | string[],
  ): Promise<Array<{ conversationId: string; agentSlug: string; content: string }>> => {
    if (conversationIds.length === 0) return [];
    const where = { ...userIdFilter(userIds), role: "user", conversationId: { in: conversationIds } };
    const firsts = await prisma.chatMessage.groupBy({
      by: ["conversationId", "agentSlug"],
      where,
      _min: { createdAt: true },
    });
    const pairs = firsts.flatMap((row) =>
      row._min.createdAt
        ? [{ conversationId: row.conversationId, agentSlug: row.agentSlug, createdAt: row._min.createdAt }]
        : [],
    );
    if (pairs.length === 0) return [];
    const rows = await prisma.chatMessage.findMany({
      where: { ...where, OR: pairs },
      select: { conversationId: true, agentSlug: true, content: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    // Two messages can share a pair's first timestamp; keep one per pair.
    const seen = new Set<string>();
    return rows.flatMap(({ conversationId, agentSlug, content }) => {
      const key = `${conversationId}:${agentSlug}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ conversationId, agentSlug, content: content.slice(0, 200) }];
    });
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
      await dropProjectMembershipIfChatGone(userIds, conversationId);
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
      await dropProjectMembershipIfChatGone(userIds, conversationId);
    }
    return result.count;
  },
};

/**
 * Drop this user's ChatProjectItem once their last message in the conversation
 * is gone. `chat_project_items` has no foreign key to `chat_messages` — it
 * cannot, since a conversation is just an id shared by rows — so nothing else
 * reclaims the membership, and a stale row would keep a deleted chat counted in
 * its project and inside `?projectId=` results.
 *
 * Conditional on nothing remaining because the per-agent delete above removes
 * only one agent's turns: a chat the user switched agents in still exists under
 * the others and must keep its project.
 */
async function dropProjectMembershipIfChatGone(
  userIds: string | string[],
  conversationId: string,
): Promise<void> {
  const remaining = await prisma.chatMessage.count({
    where: { ...userIdFilter(userIds), conversationId },
  });
  if (remaining > 0) return;
  await prisma.chatProjectItem.deleteMany({
    where: { conversationId, ...userIdFilter(userIds) },
  });
}
