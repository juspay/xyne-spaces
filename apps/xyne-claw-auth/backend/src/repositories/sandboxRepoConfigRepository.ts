import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export const sandboxRepoConfigRepository = {
  list: () => prisma.sandboxRepoConfig.findMany({ orderBy: { key: "asc" } }),

  find: (key: string) => prisma.sandboxRepoConfig.findUnique({ where: { key } }),

  upsert: (key: string, config: Prisma.InputJsonValue, enabled: boolean, updatedByUserId: string | null) =>
    prisma.sandboxRepoConfig.upsert({
      where: { key },
      create: { key, config, enabled, updatedByUserId },
      update: { config, enabled, updatedByUserId },
    }),

  delete: (key: string) => prisma.sandboxRepoConfig.delete({ where: { key } }),
};
