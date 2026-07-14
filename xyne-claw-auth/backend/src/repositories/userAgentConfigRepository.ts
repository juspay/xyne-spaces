import { prisma } from "../db.js";

export const userAgentConfigRepository = {
  findByUserAndAgent: (userId: string, orgId: string, agentSlug: string) =>
    prisma.userAgentConfig.findUnique({ where: { userId_orgId_agentSlug: { userId, orgId, agentSlug } } }),

  listByUser: (userId: string, orgId: string) =>
    prisma.userAgentConfig.findMany({
      where: { userId, orgId },
      select: { agentSlug: true, provider: true, chainConfig: true, updatedAt: true },
      orderBy: { agentSlug: "asc" },
    }),

  upsert: (userId: string, agentSlug: string, data: Record<string, unknown>, orgId: string) =>
    prisma.userAgentConfig.upsert({
      where: { userId_orgId_agentSlug: { userId, orgId, agentSlug } },
      create: { userId, agentSlug, orgId, ...data } as never,
      update: data,
    }),

  delete: (userId: string, orgId: string, agentSlug: string) =>
    prisma.userAgentConfig.delete({ where: { userId_orgId_agentSlug: { userId, orgId, agentSlug } } }),
};
