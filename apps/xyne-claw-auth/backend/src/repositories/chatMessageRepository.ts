import type { Prisma } from "@prisma/client";
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

  /** Messages for every user for ONE agent in ONE org. Used by elevated agent
   *  editors/contributors when the Conversations tab explicitly requests the
   *  cross-user inspector view. Keep orgId in the predicate so a shared slug
   *  across orgs cannot merge conversation history. */
  findByAgent: (agentSlug: string, orgId: string) =>
    prisma.chatMessage.findMany({ where: { agentSlug, orgId }, orderBy: { createdAt: "asc" } }),

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
