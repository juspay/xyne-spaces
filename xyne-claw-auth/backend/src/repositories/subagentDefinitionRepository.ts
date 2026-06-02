import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

const includeSkills = {
  skills: {
    include: { skill: { include: { files: true } } },
  },
} as const;

export const subagentDefinitionRepository = {
  listAll: () =>
    prisma.subagentDefinition.findMany({
      include: includeSkills,
      orderBy: { name: "asc" },
    }),

  listEnabled: () =>
    prisma.subagentDefinition.findMany({
      where: { enabled: true },
      include: includeSkills,
      orderBy: { name: "asc" },
    }),

  findByName: (name: string) =>
    prisma.subagentDefinition.findUnique({
      where: { name },
      include: includeSkills,
    }),

  findByNames: (names: string[]) =>
    names.length === 0
      ? Promise.resolve([])
      : prisma.subagentDefinition.findMany({
          where: { name: { in: names }, enabled: true },
          include: includeSkills,
        }),

  create: (data: Prisma.SubagentDefinitionCreateInput) =>
    prisma.subagentDefinition.create({ data, include: includeSkills }),

  update: (name: string, data: Prisma.SubagentDefinitionUpdateInput) =>
    prisma.subagentDefinition.update({ where: { name }, data, include: includeSkills }),

  /** Soft-delete: flip enabled=false. Hard-delete is intentionally not exposed. */
  disable: (name: string) =>
    prisma.subagentDefinition.update({
      where: { name },
      data: { enabled: false },
      include: includeSkills,
    }),

  enable: (name: string) =>
    prisma.subagentDefinition.update({
      where: { name },
      data: { enabled: true },
      include: includeSkills,
    }),

  /**
   * Replace the skill set for a subagent in one transaction — drops all
   * existing SubagentSkill rows for this subagent and inserts new ones from
   * the provided skill IDs. No-op when the list is unchanged.
   */
  replaceSkills: async (subagentDefinitionId: string, skillIds: string[]) => {
    await prisma.$transaction([
      prisma.subagentSkill.deleteMany({ where: { subagentDefinitionId } }),
      ...(skillIds.length > 0
        ? [
            prisma.subagentSkill.createMany({
              data: skillIds.map((skillId) => ({ subagentDefinitionId, skillId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  },
};
