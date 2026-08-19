import { PrismaClient, Prisma } from '@prisma/client';
import type {
  NotificationLogEvent,
  NotificationLogEventType,
  NotificationLogChannel,
  NotificationLogProvider,
  NotificationLogStatus,
} from '@prisma/client';
import { DatabaseClient } from '@/database/client';

/**
 * Input for a single append-only lifecycle event. `workspaceId` and
 * `correlationId` are mandatory join keys; everything else is optional
 * diagnostic context. `metadata` MUST already be redacted by the caller.
 */
export interface CreateNotificationLogEventInput {
  workspaceId: string;
  correlationId: string;
  eventType: NotificationLogEventType;
  channel: NotificationLogChannel;
  status: NotificationLogStatus;
  provider?: NotificationLogProvider | null;
  notificationId?: string | null;
  attempt?: number;
  reasonCode?: string | null;
  metadata?: Record<string, string | number | boolean> | null;
  /**
   * Stable key that makes a write idempotent. When two identical transitions
   * are recorded (e.g. a Bull job retried at-least-once), the duplicate is a
   * no-op instead of a second row.
   */
  idempotencyKey?: string | null;
  occurredAt?: Date;
}

export interface NotificationLogWindowFilter {
  channel?: NotificationLogChannel;
  provider?: NotificationLogProvider;
  eventType?: NotificationLogEventType;
  from?: Date;
  to?: Date;
  limit?: number;
}

/**
 * Data-access for the notification lifecycle audit trail (SDLCT-0002).
 *
 * Append-only: the only write is an idempotent insert. All reads are
 * workspace-scoped by an explicit `workspaceId` argument — this table is in the
 * `non_zero` schema and is NEVER exposed through Zero, so scoping is enforced
 * here at the query boundary rather than by a client-side ACL.
 */
export class NotificationLogRepository {
  private db: PrismaClient;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  /**
   * Idempotently append a lifecycle event. Uses the (workspaceId,
   * idempotencyKey) unique constraint to collapse duplicate transitions.
   * Returns the row when created/found; callers generally ignore the result.
   */
  async createEvent(input: CreateNotificationLogEventInput): Promise<void> {
    const data: Prisma.NotificationLogEventCreateInput = {
      workspaceId: input.workspaceId,
      correlationId: input.correlationId,
      eventType: input.eventType,
      channel: input.channel,
      status: input.status,
      provider: input.provider ?? null,
      notificationId: input.notificationId ?? null,
      attempt: input.attempt ?? 0,
      reasonCode: input.reasonCode ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      idempotencyKey: input.idempotencyKey ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    };

    if (input.idempotencyKey) {
      // Collapse at-least-once duplicates. `update: {}` keeps the row append-only
      // (the first-write-wins snapshot is never mutated).
      await this.db.notificationLogEvent.upsert({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: input.workspaceId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        create: data,
        update: {},
      });
      return;
    }

    await this.db.notificationLogEvent.create({ data });
  }

  /** All events for one notification, oldest-first. Workspace-scoped. */
  async findByNotificationId(
    workspaceId: string,
    notificationId: string,
  ): Promise<NotificationLogEvent[]> {
    return this.db.notificationLogEvent.findMany({
      where: { workspaceId, notificationId },
      orderBy: { occurredAt: 'asc' },
    });
  }

  /** All events sharing one correlation id, oldest-first. Workspace-scoped. */
  async findByCorrelationId(
    workspaceId: string,
    correlationId: string,
  ): Promise<NotificationLogEvent[]> {
    return this.db.notificationLogEvent.findMany({
      where: { workspaceId, correlationId },
      orderBy: { occurredAt: 'asc' },
    });
  }

  /**
   * Distinct correlation ids seen in a window, for a sweep/completeness scan.
   * Workspace-scoped; bounded by `limit` (default 500).
   */
  async findCorrelationIdsInWindow(
    workspaceId: string,
    filter: NotificationLogWindowFilter = {},
  ): Promise<string[]> {
    const rows = await this.db.notificationLogEvent.findMany({
      where: {
        workspaceId,
        channel: filter.channel,
        provider: filter.provider,
        eventType: filter.eventType,
        occurredAt: {
          gte: filter.from,
          lte: filter.to,
        },
      },
      select: { correlationId: true },
      distinct: ['correlationId'],
      take: filter.limit ?? 500,
      orderBy: { occurredAt: 'asc' },
    });
    return rows.map((r) => r.correlationId);
  }
}
