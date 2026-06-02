import { prisma } from "../db.js";

export const chatMessageRepository = {
  create: (data: { conversationId: string; agentSlug: string; userId: string; role: string; content: string; status?: string }) =>
    prisma.chatMessage.create({ data }),

  findByConversation: (conversationId: string) =>
    prisma.chatMessage.findMany({
      where: { conversationId },
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
