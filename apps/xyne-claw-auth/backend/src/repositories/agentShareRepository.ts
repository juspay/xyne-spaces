import { prisma } from "../db.js";

export const agentShareRepository = {
  findByAgentAndUser: (agentId: string, userId: string) =>
    prisma.agentShare.findUnique({ where: { agentId_userId: { agentId, userId } } }),

  listByAgent: (agentId: string) =>
    prisma.agentShare.findMany({
      where: { agentId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),

  upsert: (agentId: string, userId: string, role: string, sharedBy: string) =>
    prisma.agentShare.upsert({
      where: { agentId_userId: { agentId, userId } },
      create: { agentId, userId, role, sharedBy },
      update: { role, sharedBy },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),

  delete: (agentId: string, userId: string) =>
    prisma.agentShare.delete({ where: { agentId_userId: { agentId, userId } } }),
};
