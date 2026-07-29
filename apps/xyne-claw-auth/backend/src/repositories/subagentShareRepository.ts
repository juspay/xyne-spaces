import { prisma } from "../db.js";

/**
 * Per-subagent share grants. Mirrors agentShareRepository — owner + N
 * contributors can edit a custom subagent. Reads are not gated by this
 * table; all subagents are globally visible.
 */
export const subagentShareRepository = {
  findBySubagentAndUser: (subagentDefinitionId: string, userId: string) =>
    prisma.subagentShare.findUnique({
      where: { subagentDefinitionId_userId: { subagentDefinitionId, userId } },
    }),

  listBySubagent: (subagentDefinitionId: string) =>
    prisma.subagentShare.findMany({
      where: { subagentDefinitionId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),

  upsert: (subagentDefinitionId: string, userId: string, role: string, sharedBy: string) =>
    prisma.subagentShare.upsert({
      where: { subagentDefinitionId_userId: { subagentDefinitionId, userId } },
      create: { subagentDefinitionId, userId, role, sharedBy },
      update: { role, sharedBy },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),

  delete: (subagentDefinitionId: string, userId: string) =>
    prisma.subagentShare.delete({
      where: { subagentDefinitionId_userId: { subagentDefinitionId, userId } },
    }),
};
