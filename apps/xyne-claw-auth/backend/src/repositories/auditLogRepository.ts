import { Prisma } from "@prisma/client";
import type { AgentAuditEvent } from "@prisma/client";
import { prisma } from "../db.js";

export const auditLogRepository = {
  create: (entry: { actorUserId?: string; eventType: AgentAuditEvent; targetId: string; description: string; metadata?: Record<string, unknown> }) =>
    prisma.agentAuditLog.create({
      data: {
        actorUserId: entry.actorUserId ?? null,
        eventType: entry.eventType,
        targetId: entry.targetId,
        description: entry.description,
        metadata: entry.metadata ? (entry.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    }),

  list: (options?: { eventType?: string | undefined; targetId?: string | undefined; actorUserIds?: string[] | undefined; startDate?: Date | undefined; endDate?: Date | undefined; limit?: number | undefined; offset?: number | undefined }) =>
    prisma.agentAuditLog.findMany({
      where: {
        ...(options?.eventType ? { eventType: options.eventType as AgentAuditEvent } : {}),
        ...(options?.targetId ? { targetId: options.targetId } : {}),
        ...(options?.actorUserIds ? { actorUserId: { in: options.actorUserIds } } : {}),
        ...((options?.startDate || options?.endDate) ? { createdAt: {
          ...(options?.startDate ? { gte: options.startDate } : {}),
          ...(options?.endDate ? { lte: options.endDate } : {}),
        } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    }),

  count: (options?: { eventType?: string | undefined; targetId?: string | undefined; actorUserIds?: string[] | undefined; startDate?: Date | undefined; endDate?: Date | undefined }) =>
    prisma.agentAuditLog.count({
      where: {
        ...(options?.eventType ? { eventType: options.eventType as AgentAuditEvent } : {}),
        ...(options?.targetId ? { targetId: options.targetId } : {}),
        ...(options?.actorUserIds ? { actorUserId: { in: options.actorUserIds } } : {}),
        ...((options?.startDate || options?.endDate) ? { createdAt: {
          ...(options?.startDate ? { gte: options.startDate } : {}),
          ...(options?.endDate ? { lte: options.endDate } : {}),
        } } : {}),
      },
    }),
};
