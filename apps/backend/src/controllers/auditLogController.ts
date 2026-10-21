import { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '@/types/express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { AuditEntityType, type AuditLogPage } from '@xyne/shared';

const TAG = '[AuditLogController]';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const cursorPayloadSchema = z.object({ createdAt: z.number(), id: z.string() });

const querySchema = z.object({
  entityType: z.nativeEnum(AuditEntityType),
  entityId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  cursor: z.string().optional(),
});

const encodeCursor = (createdAt: number, id: string): string =>
  Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');

const decodeCursor = (value: string): { createdAt: number; id: string } | null => {
  try {
    const parsed = cursorPayloadSchema.safeParse(JSON.parse(Buffer.from(value, 'base64url').toString()));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export class AuditLogController {
  /**
   * Keyset-paginated audit feed for one entity context, newest first.
   * The keyset (createdAt, id) rides along as an opaque base64url cursor.
   */
  static async list(req: Request, res: Response): Promise<void> {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' });
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
          workspaceId,
          entityType,
          entityId,
          ...(cursor && {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        include: {
          actorUser: { select: { id: true, name: true, email: true, picture: true } },
          changes: { orderBy: { createdAt: 'asc' } },
        },
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];

      const body: ApiResponse<AuditLogPage> = {
        success: true,
        timestamp: new Date().toISOString(),
        data: {
          logs: page.map(log => ({
            id: log.id,
            entityType: log.entityType,
            entityId: log.entityId,
            createdAt: log.createdAt.getTime(),
            actor: log.actorUser
              ? {
                  id: log.actorUser.id,
                  name: log.actorUser.name,
                  email: log.actorUser.email,
                  picture: log.actorUser.picture,
                }
              : null,
            changes: log.changes.map(change => ({
              id: change.id,
              action: change.action as AuditLogPage['logs'][number]['changes'][number]['action'],
              tableName: change.tableName,
              recordId: change.recordId,
              targetName: change.targetName,
              field: change.field,
              oldValue: change.oldValue,
              newValue: change.newValue,
              createdAt: change.createdAt.getTime(),
            })),
          })),
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
}
