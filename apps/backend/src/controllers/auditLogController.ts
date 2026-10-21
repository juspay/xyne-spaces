import { Request, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '@/types/express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { AUDIT_TABLE_CONFIG } from '@/zero/audit';
import {
  AuditLogXlsxWriter,
  XLSX_MIME_TYPE,
  auditLogBatches,
  feedWhere,
  isValidTimeZone,
  logInclude,
  resolveEntityNames,
  toEntries,
} from '@/services/auditLogService';
import { AuditEntityType, type AuditLogEntityOption, type AuditLogPage } from '@xyne/shared';

const TAG = '[AuditLogController]';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const cursorPayloadSchema = z.object({ createdAt: z.number(), id: z.string() });

const AUDITED_TABLES = new Set(Object.keys(AUDIT_TABLE_CONFIG));

const feedFilterShape = {
  entityType: z.nativeEnum(AuditEntityType),
  // Omitted = every entity of the type (the workspace-wide Audit Logs screen).
  entityId: z.string().min(1).optional(),
  // Inclusive epoch-ms window on audit_logs.createdAt.
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  // Comma-separated audited tables: only entries touching them, with only their change rows.
  tables: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').filter(Boolean) : undefined))
    .refine((tables) => !tables || tables.every((table) => AUDITED_TABLES.has(table)), {
      message: 'Unknown audit table',
    }),
};

type FeedFilter = z.infer<z.ZodObject<typeof feedFilterShape>>;

const isValidRange = (filter: FeedFilter): boolean =>
  filter.from === undefined || filter.to === undefined || filter.from <= filter.to;

const exportQuerySchema = z
  .object({
    ...feedFilterShape,
    // IANA zone for the Time column, so it matches what the viewer saw on screen.
    timeZone: z.string().default('UTC').refine(isValidTimeZone, { message: 'Unknown time zone' }),
  })
  .refine(isValidRange, { message: '`from` must not be after `to`' });

const listQuerySchema = z
  .object({
    ...feedFilterShape,
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
    cursor: z.string().optional(),
  })
  .refine(isValidRange, { message: '`from` must not be after `to`' });

const entitiesQuerySchema = z.object({ entityType: z.nativeEnum(AuditEntityType) });

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
        include: logInclude(parsed.data.tables),
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

  /** Streams every entry in the window (newest first) as an .xlsx; 404 when nothing matches. */
  static async exportLogs(req: Request, res: Response): Promise<void> {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const parsed = exportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid query' });
      return;
    }

    const { entityType, entityId, timeZone } = parsed.data;
    try {
      let writer: AuditLogXlsxWriter | null = null;
      for await (const logs of auditLogBatches(workspaceId, parsed.data)) {
        // The client went away; stop reading.
        if (res.destroyed) return;
        if (!writer) {
          res.setHeader('Content-Type', XLSX_MIME_TYPE);
          res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.xlsx"');
          writer = new AuditLogXlsxWriter(res, entityType, timeZone);
        }
        await writer.addLogs(logs);
      }

      if (!writer) {
        res.status(404).json({ success: false, error: 'No changes in this period' });
        return;
      }
      await writer.finish();
    } catch (error) {
      logger.error(`${TAG} failed to export audit logs`, {
        workspaceId,
        entityType,
        entityId,
        error: error instanceof Error ? error.message : error,
      });
      // Once the file has started, cutting the connection is the only way to signal failure.
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Failed to export audit logs' });
      } else {
        res.destroy();
      }
    }
  }
}
