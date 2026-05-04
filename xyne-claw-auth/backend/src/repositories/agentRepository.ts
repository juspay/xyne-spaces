import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

const INCLUDE_TOOLS_SKILLS = { tools: { include: { tool: true } }, skills: { include: { skill: true } } } as const;

export const agentRepository = {
  findBySlug: (slug: string) =>
    prisma.agent.findUnique({ where: { slug } }),

  findBySlugWithRelations: (slug: string) =>
    prisma.agent.findUnique({ where: { slug }, include: { ...INCLUDE_TOOLS_SKILLS, owner: true } }),

  findById: (id: string) =>
    prisma.agent.findUnique({ where: { id } }),

  findByIds: (ids: string[]) =>
    ids.length === 0 ? Promise.resolve([]) : prisma.agent.findMany({ where: { id: { in: ids } } }),

  findByAppUserId: (appUserId: string) =>
    prisma.agent.findFirst({ where: { spacesAppUserId: appUserId } }),

  findDefault: () =>
    prisma.agent.findFirst({ where: { isDefault: true, enabled: true } }),

  findByNameInsensitive: (name: string) =>
    prisma.agent.findFirst({ where: { name: { equals: name, mode: "insensitive" } } }),

  listVisible: (userId?: string) =>
    prisma.agent.findMany({
      where: userId
        ? { OR: [{ scope: "global" }, { ownerUserId: userId }, { shares: { some: { userId } } }] }
        : { scope: "global" },
      include: INCLUDE_TOOLS_SKILLS,
      orderBy: { name: "asc" as const },
    }),

  create: (data: Prisma.AgentCreateInput) =>
    prisma.agent.create({ data, include: INCLUDE_TOOLS_SKILLS }),

  update: (slug: string, data: Prisma.AgentUpdateInput) =>
    prisma.agent.update({ where: { slug }, data, include: INCLUDE_TOOLS_SKILLS }),

  updateById: (id: string, data: Prisma.AgentUpdateInput) =>
    prisma.agent.update({ where: { id }, data, include: INCLUDE_TOOLS_SKILLS }),

  delete: (slug: string) =>
    prisma.agent.delete({ where: { slug } }),

  // Skills (junction table)
  upsertSkill: (agentId: string, skillId: string) =>
    prisma.agentSkill.upsert({
      where: { agentId_skillId: { agentId, skillId } },
      create: { agentId, skillId },
      update: {},
      include: { skill: true },
    }),

  deleteSkill: (agentId: string, skillId: string) =>
    prisma.agentSkill.delete({ where: { agentId_skillId: { agentId, skillId } } }),

  deleteAllSkills: (agentId: string) =>
    prisma.agentSkill.deleteMany({ where: { agentId } }),

  listSkills: (agentId: string) =>
    prisma.agentSkill.findMany({ where: { agentId }, include: { skill: true } }),

  // Tools
  upsertTool: (agentId: string, toolId: string, permission: string) =>
    prisma.agentTool.upsert({
      where: { agentId_toolId: { agentId, toolId } },
      create: { agentId, toolId, permission },
      update: { permission },
      include: { tool: true },
    }),

  deleteTool: (agentId: string, toolId: string) =>
    prisma.agentTool.delete({ where: { agentId_toolId: { agentId, toolId } } }),

  findToolById: (id: string) =>
    prisma.tool.findUnique({ where: { id } }),
};
