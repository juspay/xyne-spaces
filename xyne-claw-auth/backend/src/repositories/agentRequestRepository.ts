import { prisma } from "../db.js";

export const agentRequestRepository = {
  findById: (id: string) =>
    prisma.agentRequest.findUnique({ where: { id } }),

  findPending: (agentId: string, requestType: string) =>
    prisma.agentRequest.findFirst({ where: { agentId, requestType, status: "pending" } }),

  findPendingSkill: (skillId: string) =>
    prisma.agentRequest.findFirst({ where: { targetType: "skill", skillId, status: "pending" } }),

  listPending: () =>
    prisma.agentRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "desc" } }),

  create: (data: { targetType?: string; agentId?: string; agentSlug?: string; skillId?: string; skillSlug?: string; requestType: string; requesterId: string }) =>
    prisma.agentRequest.create({ data }),

  updateStatus: (id: string, status: string, reviewerId: string, reviewNote?: string | null) =>
    prisma.agentRequest.update({ where: { id }, data: { status, reviewerId, reviewNote: reviewNote ?? null } }),
};
