import { prisma } from "../db.js";

export const userAgentConfigRepository = {
  findByUserAndAgent: (userId: string, agentSlug: string) =>
    prisma.userAgentConfig.findUnique({ where: { userId_agentSlug: { userId, agentSlug } } }),

  upsert: (userId: string, agentSlug: string, data: Record<string, unknown>) =>
    prisma.userAgentConfig.upsert({
      where: { userId_agentSlug: { userId, agentSlug } },
      create: { userId, agentSlug, ...data } as never,
      update: data,
    }),

  delete: (userId: string, agentSlug: string) =>
    prisma.userAgentConfig.delete({ where: { userId_agentSlug: { userId, agentSlug } } }),
};
