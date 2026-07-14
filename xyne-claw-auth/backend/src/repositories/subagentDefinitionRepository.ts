import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";

const log = createLogger("subagent-definition-repository");

const includeSkills = {
  skills: {
    include: { skill: { include: { files: true } } },
  },
} as const;

export const subagentDefinitionRepository = {
  listAll: (orgId?: string) =>
    prisma.subagentDefinition.findMany({
      ...(orgId ? { where: { orgId } } : {}),
      include: includeSkills,
      orderBy: { name: "asc" },
    }),

  listEnabled: (orgId?: string) =>
    prisma.subagentDefinition.findMany({
      where: orgId ? { enabled: true, orgId } : { enabled: true },
      include: includeSkills,
      orderBy: { name: "asc" },
    }),

  findByName: (name: string, orgId?: string | null) => {
    if (!orgId) {
      log.error("[subagentDefinitionRepository.findByName] missing orgId; refusing global name lookup", { name });
      return Promise.resolve(null);
    }
    return prisma.subagentDefinition.findUnique({
      where: { orgId_name: { orgId, name } },
      include: includeSkills,
    });
  },

  findByNames: (names: string[]) =>
    names.length === 0
      ? Promise.resolve([])
      : prisma.subagentDefinition.findMany({
          where: { name: { in: names }, enabled: true },
          include: includeSkills,
        }),

  create: (data: Prisma.SubagentDefinitionCreateInput) =>
    prisma.subagentDefinition.create({ data, include: includeSkills }),

  update: (name: string, orgId: string, data: Prisma.SubagentDefinitionUpdateInput) =>
    prisma.subagentDefinition.update({ where: { orgId_name: { orgId, name } }, data, include: includeSkills }),

  /** Soft-delete: flip enabled=false. Hard-delete is intentionally not exposed. */
  disable: (name: string, orgId: string) =>
    prisma.subagentDefinition.update({
      where: { orgId_name: { orgId, name } },
      data: { enabled: false },
      include: includeSkills,
    }),

  enable: (name: string, orgId: string) =>
    prisma.subagentDefinition.update({
      where: { orgId_name: { orgId, name } },
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
