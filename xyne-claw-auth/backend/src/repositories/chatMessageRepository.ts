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
  }) =>
    prisma.chatMessage.create({ data }),

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
