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
};
