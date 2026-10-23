import { Prisma } from "@prisma/client";
import type { AgentAuditEvent } from "@prisma/client";
import { prisma } from "../db.js";

interface ListOptions {
  eventType?: string | undefined;
  targetId?: string | undefined;
  /** Rows of this org, plus older rows (no orgId yet) whose actor is one of actorUserIds. */
  orgId?: string | undefined;
  actorUserIds?: string[] | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
}

function where(options?: ListOptions): Prisma.AgentAuditLogWhereInput {
  const byActor = options?.actorUserIds ? { actorUserId: { in: options.actorUserIds } } : undefined;
  return {
    ...(options?.eventType ? { eventType: options.eventType as AgentAuditEvent } : {}),
    ...(options?.targetId ? { targetId: options.targetId } : {}),
    ...(options?.orgId ? { OR: [{ orgId: options.orgId }, ...(byActor ? [{ orgId: null, ...byActor }] : [])] } : byActor ?? {}),
    ...((options?.startDate || options?.endDate) ? { createdAt: {
      ...(options?.startDate ? { gte: options.startDate } : {}),
      ...(options?.endDate ? { lte: options.endDate } : {}),
    } } : {}),
  };
}

export const auditLogRepository = {
  create: (entry: { actorUserId?: string | undefined; orgId?: string | undefined; eventType: AgentAuditEvent; targetId: string; description: string; metadata?: Record<string, unknown> | undefined }) =>
    prisma.agentAuditLog.create({
      data: {
        actorUserId: entry.actorUserId ?? null,
        orgId: entry.orgId ?? null,
        eventType: entry.eventType,
        targetId: entry.targetId,
        description: entry.description,
        metadata: entry.metadata ? (entry.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    }),

  list: (options?: ListOptions & { limit?: number | undefined; offset?: number | undefined }) =>
    prisma.agentAuditLog.findMany({
      where: where(options),
      orderBy: { createdAt: "desc" },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    }),

  count: (options?: ListOptions) => prisma.agentAuditLog.count({ where: where(options) }),
};
