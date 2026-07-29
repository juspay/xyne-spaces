import { prisma } from "../db.js";

export const userSubagentConfigRepository = {
  listByUser: (userId: string) =>
    prisma.userSubagentConfig.findMany({ where: { userId } }),

  upsert: (userId: string, subagentName: string, provider: string) =>
    prisma.userSubagentConfig.upsert({
      where: { userId_subagentName: { userId, subagentName } },
      create: { userId, subagentName, provider },
      update: { provider },
    }),

  delete: (userId: string, subagentName: string) =>
    prisma.userSubagentConfig.delete({ where: { userId_subagentName: { userId, subagentName } } }),
};
