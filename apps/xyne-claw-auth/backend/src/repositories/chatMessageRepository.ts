import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export const chatMessageRepository = {
  create: (data: {
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
  }) => {
    const { attachedContext, ...rest } = data;
    return prisma.chatMessage.create({
      data: {
        ...rest,
        ...(attachedContext !== undefined
          ? { attachedContext: attachedContext as Prisma.InputJsonValue }
          : {}),
      },
    });
  },

  /** Update a message's content, status, reasoning, or parent. Used by the
   *  chat callback to finalize the pre-created assistant placeholder once the
   *  run completes (branching needs the assistant id reserved up-front). */
  update: (
    id: string,
    data: { content?: string; status?: string; reasoning?: string | null; parentId?: string | null },
  ) => prisma.chatMessage.update({ where: { id }, data }),

  /** Persist mid-run PARTIAL content, but ONLY while the row is still "running".
   *  Conditional (updateMany + status guard) so a late/cross-pod debounced write
   *  can never clobber the final content the completion callback wrote (which
   *  flips status off "running"). Returns count of rows updated (0 = ignored). */
  updatePartialContent: (id: string, data: { content?: string; reasoning?: string | null }) =>
    prisma.chatMessage.updateMany({ where: { id, status: "running" }, data }),

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

  findByUserAndAgent: (userId: string, agentSlug: string) =>
    prisma.chatMessage.findMany({ where: { userId, agentSlug }, orderBy: { createdAt: "asc" } }),

  /**
   * Cross-agent conversation summaries for ONE user, newest first — the
   * consolidated "all my AI chats" list. Unlike findByUserAndAgent (which loads
   * every message for a single agent and groups in JS), this aggregates in the
   * DB so it stays cheap across the user's entire history.
   *
   * A "conversation" has no table — it's the set of chat_messages sharing a
   * conversationId. We group by (conversationId, agentSlug) because a thread can
   * be shared across agents (e.g. a mentioned user's digital twin runs under the
   * same conversationId, different agentSlug); each (conversation, agent) pair is
   * one row, matching what the union of the per-agent lists would show and
   * keeping the agent chip + click→load-messages unambiguous.
   *
   * title      = first user message content, truncated to 80 (same as the
   *              per-agent handler); there is no title column.
   * messageCount = COUNT(*) in the group; lastMessageAt = MAX(createdAt).
   * q          = case-insensitive substring match on that title (P1 server
   *              search); matches the first user message only, not full content.
   * agentSlugs = restrict to these agents (the `with:` filter; OR semantics).
   *
   * Artifact-app threads (id prefix "app_") are excluded, same as the per-agent
   * handler. Pagination is limit/offset (per-user counts are in the 100s).
   */
  listUserConversations: async (
    userId: string,
    opts?: { limit?: number; offset?: number; q?: string; agentSlugs?: string[] },
  ): Promise<
    Array<{
      conversationId: string;
      agentSlug: string;
      title: string;
      messageCount: number;
      lastMessageAt: Date;
    }>
  > => {
    const limit = Math.min(Math.max(opts?.limit ?? 30, 1), 100);
    const offset = Math.max(opts?.offset ?? 0, 0);
    // Whitespace-robust search: trim the query and collapse any run of whitespace
    // (incl. tabs/newlines/non-breaking spaces the user may paste) to a single
    // space, and do the same to the title in SQL — so "daily   brief" matches
    // "daily brief" regardless of stray spacing on either side. `[[:space:]]` (POSIX)
    // is used instead of `\s` because a tagged-template `\s` cooks to a literal "s".
    const q = opts?.q?.trim().replace(/\s+/g, " ");
    const qFilter = q
      ? Prisma.sql`AND regexp_replace(t.title, '[[:space:]]+', ' ', 'g') ILIKE ${"%" + q + "%"}`
      : Prisma.empty;
    const agentSlugs = opts?.agentSlugs?.filter(Boolean);
    const agentFilter =
      agentSlugs && agentSlugs.length > 0
        ? Prisma.sql`AND g."agentSlug" = ANY(${agentSlugs})`
        : Prisma.empty;

    // Fetch limit+1 to tell the caller whether another page exists.
    const rows = await prisma.$queryRaw<
      Array<{
        conversationId: string;
        agentSlug: string;
        title: string | null;
        messageCount: bigint;
        lastMessageAt: Date;
      }>
    >`
      WITH grouped AS (
        SELECT "conversationId", "agentSlug",
               MAX("createdAt") AS "lastMessageAt",
               COUNT(*)         AS "messageCount"
        FROM "chat_messages"
        WHERE "userId" = ${userId}
          AND left("conversationId", 4) <> 'app_'
        GROUP BY "conversationId", "agentSlug"
      ),
      titles AS (
        SELECT DISTINCT ON ("conversationId", "agentSlug")
               "conversationId", "agentSlug", "content" AS title
        FROM "chat_messages"
        WHERE "userId" = ${userId}
          AND role = 'user'
          AND left("conversationId", 4) <> 'app_'
        ORDER BY "conversationId", "agentSlug", "createdAt" ASC
      )
      SELECT g."conversationId", g."agentSlug", g."lastMessageAt", g."messageCount",
             LEFT(t.title, 80) AS title
      FROM grouped g
      LEFT JOIN titles t
        ON t."conversationId" = g."conversationId" AND t."agentSlug" = g."agentSlug"
      WHERE TRUE ${qFilter} ${agentFilter}
      ORDER BY g."lastMessageAt" DESC, g."conversationId" DESC
      LIMIT ${limit + 1} OFFSET ${offset}
    `;

    return rows.map((r) => ({
      conversationId: r.conversationId,
      agentSlug: r.agentSlug,
      title: r.title ?? "",
      messageCount: Number(r.messageCount),
      lastMessageAt: r.lastMessageAt,
    }));
  },

  /** Delete every message in a conversation belonging to this user+agent.
   *  Scoped by all three to prevent one user from deleting another's chat
   *  even if they guess a conversationId. Returns the delete count. */
  deleteConversation: async (userId: string, agentSlug: string, conversationId: string) => {
    const result = await prisma.chatMessage.deleteMany({
      where: { userId, agentSlug, conversationId },
    });
    return result.count;
  },
};
