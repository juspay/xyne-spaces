import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export const sandboxRepoConfigRepository = {
  list: () => prisma.sandboxRepoConfig.findMany({ orderBy: { key: "asc" } }),

  find: (key: string) => prisma.sandboxRepoConfig.findUnique({ where: { key } }),

  // Plain insert: a key taken meanwhile fails with P2002 instead of being overwritten.
  create: (key: string, config: Prisma.InputJsonValue, workspaceId: string, userId: string) =>
    prisma.sandboxRepoConfig.create({
      data: { key, config, enabled: true, updatedByUserId: userId, workspaceId, createdByUserId: userId },
    }),

  // workspaceId and createdByUserId are set on create only; an update never moves a profile.
  upsert: (
    key: string,
    config: Prisma.InputJsonValue,
    enabled: boolean,
    updatedByUserId: string | null,
    owner: { workspaceId?: string | null; createdByUserId?: string | null } = {},
  ) =>
    prisma.sandboxRepoConfig.upsert({
      where: { key },
      create: {
        key,
        config,
        enabled,
        updatedByUserId,
        workspaceId: owner.workspaceId ?? null,
        createdByUserId: owner.createdByUserId ?? updatedByUserId,
      },
      update: { config, enabled, updatedByUserId },
    }),

  setEnabled: (key: string, enabled: boolean, updatedByUserId: string | null) =>
    prisma.sandboxRepoConfig.update({ where: { key }, data: { enabled, updatedByUserId } }),

  listUnowned: (keys?: string[]) =>
    prisma.sandboxRepoConfig.findMany({
      where: { workspaceId: null, ...(keys ? { key: { in: keys } } : {}) },
      select: { key: true },
      orderBy: { key: "asc" },
    }),

  assignWorkspace: (keys: string[], workspaceId: string) =>
    prisma.sandboxRepoConfig.updateMany({ where: { key: { in: keys }, workspaceId: null }, data: { workspaceId } }),

  delete: (key: string) => prisma.sandboxRepoConfig.delete({ where: { key } }),
};
