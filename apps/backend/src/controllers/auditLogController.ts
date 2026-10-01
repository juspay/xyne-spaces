import { Request, Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ApiResponse } from '@/types/express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import {
  AuditEntityType,
  type AuditLogEntityOption,
  type AuditLogEntry,
  type AuditLogExport,
  type AuditLogPage,
} from '@xyne/shared';

const TAG = '[AuditLogController]';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** Backstop for CSV exports; the screen's date range is capped at 90 days. */
const MAX_EXPORT_LOGS = 5000;

const cursorPayloadSchema = z.object({ createdAt: z.number(), id: z.string() });

const feedFilterShape = {
  entityType: z.nativeEnum(AuditEntityType),
  // Omitted = every entity of the type (the workspace-wide Audit Logs screen).
  entityId: z.string().min(1).optional(),
  // Inclusive epoch-ms window on audit_logs.createdAt.
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
};

type FeedFilter = z.infer<z.ZodObject<typeof feedFilterShape>>;

const isValidRange = (filter: FeedFilter): boolean =>
  filter.from === undefined || filter.to === undefined || filter.from <= filter.to;

const feedFilterSchema = z
  .object(feedFilterShape)
  .refine(isValidRange, { message: '`from` must not be after `to`' });

const listQuerySchema = z
  .object({
    ...feedFilterShape,
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
    cursor: z.string().optional(),
  })
  .refine(isValidRange, { message: '`from` must not be after `to`' });

const entitiesQuerySchema = z.object({ entityType: z.nativeEnum(AuditEntityType) });

const LOG_INCLUDE = {
  actorUser: { select: { id: true, name: true, email: true, picture: true } },
  changes: { orderBy: { createdAt: 'asc' } },
} as const satisfies Prisma.AuditLogInclude;

type AuditLogRow = Prisma.AuditLogGetPayload<{ include: typeof LOG_INCLUDE }>;

const ENTITY_NOUNS: Record<AuditEntityType, string> = {
  [AuditEntityType.BOARD]: 'board',
  [AuditEntityType.USER_GROUP_ASSIGNMENT_CONFIG]: 'user group',
  [AuditEntityType.DESK]: 'desk',
};

const encodeCursor = (createdAt: number, id: string): string =>
  Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');

const decodeCursor = (value: string): { createdAt: number; id: string } | null => {
  try {
    const parsed = cursorPayloadSchema.safeParse(
      JSON.parse(Buffer.from(value, 'base64url').toString())
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

const feedWhere = (workspaceId: string, filter: FeedFilter): Prisma.AuditLogWhereInput => ({
  workspaceId,
  entityType: filter.entityType,
  ...(filter.entityId && { entityId: filter.entityId }),
  ...((filter.from !== undefined || filter.to !== undefined) && {
    createdAt: {
      ...(filter.from !== undefined && { gte: new Date(filter.from) }),
      ...(filter.to !== undefined && { lte: new Date(filter.to) }),
    },
  }),
});

/**
 * Entity display names. Reads run under the caller's ACL, so a private desk the
 * caller isn't in, or a deleted entity, falls back to a labelled short id.
 */
async function resolveEntityNames(
  entityType: AuditEntityType,
  entityIds: string[]
): Promise<Map<string, string>> {
  const ids = [...new Set(entityIds)];
  if (ids.length === 0) return new Map();

  const args = { where: { id: { in: ids } }, select: { id: true, name: true } };
  let rows: { id: string; name: string }[];
  switch (entityType) {
    case AuditEntityType.BOARD:
      rows = await db.board.findMany(args);
      break;
    case AuditEntityType.USER_GROUP_ASSIGNMENT_CONFIG:
      rows = await db.userGroup.findMany(args);
      break;
    case AuditEntityType.DESK:
      rows = await db.channel.findMany(args);
      break;
  }

  const nameById = new Map(rows.map((row) => [row.id, row.name.trim()]));
  return new Map(
    ids.map((id) => [
      id,
      nameById.get(id) || `Unknown ${ENTITY_NOUNS[entityType]} (${id.slice(0, 8)})`,
    ])
  );
}

const toEntry = (log: AuditLogRow, entityName: string): AuditLogEntry => ({
  id: log.id,
  entityType: log.entityType,
  entityId: log.entityId,
  entityName,
  createdAt: log.createdAt.getTime(),
  actor: log.actorUser
    ? {
        id: log.actorUser.id,
        name: log.actorUser.name,
        email: log.actorUser.email,
        picture: log.actorUser.picture,
      }
    : null,
  changes: log.changes.map((change) => ({
    id: change.id,
    action: change.action as AuditLogEntry['changes'][number]['action'],
    tableName: change.tableName,
    recordId: change.recordId,
    targetName: change.targetName,
    field: change.field,
    oldValue: change.oldValue,
    newValue: change.newValue,
    createdAt: change.createdAt.getTime(),
  })),
});

const toEntries = async (
  entityType: AuditEntityType,
  logs: AuditLogRow[]
): Promise<AuditLogEntry[]> => {
  const names = await resolveEntityNames(
    entityType,
    logs.map((log) => log.entityId)
  );
  return logs.map((log) => toEntry(log, names.get(log.entityId) ?? log.entityId));
};

export class AuditLogController {
  /**
   * Keyset-paginated audit feed for one entity, or every entity of a type,
   * newest first. The keyset (createdAt, id) rides along as an opaque base64url cursor.
   */
  static async list(req: Request, res: Response): Promise<void> {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' });
      return;
    }

    const { entityType, entityId } = parsed.data;
    const limit = parsed.data.limit ?? DEFAULT_LIMIT;

    let cursor: { createdAt: number; id: string } | null = null;
    if (parsed.data.cursor) {
      cursor = decodeCursor(parsed.data.cursor);
      if (!cursor) {
        res.status(400).json({ success: false, error: 'Invalid cursor' });
        return;
      }
    }

    try {
      const rows = await db.auditLog.findMany({
        where: {
          ...feedWhere(workspaceId, parsed.data),
          ...(cursor && {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: LOG_INCLUDE,
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];

      const body: ApiResponse<AuditLogPage> = {
        success: true,
        timestamp: new Date().toISOString(),
        data: {
          logs: await toEntries(entityType, page),
          nextCursor: last && hasMore ? encodeCursor(last.createdAt.getTime(), last.id) : null,
          hasMore,
        },
      };
      res.json(body);
    } catch (error) {
      logger.error(`${TAG} failed to list audit logs`, {
        workspaceId,
        entityType,
        entityId,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ success: false, error: 'Failed to fetch audit logs' });
    }
  }

  /** Entities of a type that have audit history, for the screen's entity picker. */
  static async entities(req: Request, res: Response): Promise<void> {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const parsed = entitiesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' });
      return;
    }

    const { entityType } = parsed.data;
    try {
      const groups = await db.auditLog.groupBy({
        by: ['entityId'],
        where: { workspaceId, entityType },
      });
      const names = await resolveEntityNames(
        entityType,
        groups.map((group) => group.entityId)
      );

      const body: ApiResponse<AuditLogEntityOption[]> = {
        success: true,
        timestamp: new Date().toISOString(),
        data: [...names]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
      res.json(body);
    } catch (error) {
      logger.error(`${TAG} failed to list audited entities`, {
        workspaceId,
        entityType,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ success: false, error: 'Failed to fetch audited entities' });
    }
  }

  /** Every entry in the window (newest first, capped) for the screen's CSV download. */
  static async exportLogs(req: Request, res: Response): Promise<void> {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const parsed = feedFilterSchema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' });
      return;
    }

    const { entityType, entityId } = parsed.data;
    try {
      const rows = await db.auditLog.findMany({
        where: feedWhere(workspaceId, parsed.data),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_EXPORT_LOGS + 1,
        include: LOG_INCLUDE,
      });
      const truncated = rows.length > MAX_EXPORT_LOGS;

      const body: ApiResponse<AuditLogExport> = {
        success: true,
        timestamp: new Date().toISOString(),
        data: {
          logs: await toEntries(entityType, truncated ? rows.slice(0, MAX_EXPORT_LOGS) : rows),
          truncated,
        },
      };
      res.json(body);
    } catch (error) {
      logger.error(`${TAG} failed to export audit logs`, {
        workspaceId,
        entityType,
        entityId,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ success: false, error: 'Failed to export audit logs' });
    }
  }
}
