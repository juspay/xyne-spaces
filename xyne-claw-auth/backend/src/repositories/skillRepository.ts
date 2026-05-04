import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export const skillRepository = {
  listVisible: (userId?: string) =>
    prisma.skill.findMany({
      where: userId
        ? { OR: [{ scope: "global" }, { ownerUserId: userId }] }
        : { scope: "global" },
      orderBy: { name: "asc" },
    }),

  findAll: (source?: string) =>
    prisma.skill.findMany({
      ...(source ? { where: { source } } : {}),
      orderBy: { name: "asc" },
    }),

  findBySlug: (slug: string) =>
    prisma.skill.findUnique({ where: { slug } }),

  findById: (id: string) =>
    prisma.skill.findUnique({ where: { id } }),

  findByIds: (ids: string[]) =>
    ids.length === 0 ? Promise.resolve([]) : prisma.skill.findMany({ where: { id: { in: ids } } }),

  create: (data: Prisma.SkillCreateInput) =>
    prisma.skill.create({ data }),

  update: (slug: string, data: Prisma.SkillUpdateInput) =>
    prisma.skill.update({ where: { slug }, data }),

  delete: (slug: string) =>
    prisma.skill.delete({ where: { slug } }),

  upsertBySlug: (slug: string, create: Prisma.SkillCreateInput, update: Prisma.SkillUpdateInput) =>
    prisma.skill.upsert({ where: { slug }, create, update }),
};
