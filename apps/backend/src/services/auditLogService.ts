import type { Writable } from 'stream';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { db } from '@/database/client';
import {
  AuditAction,
  AuditEntityType,
  fieldLabel,
  formatAuditValue,
  type AuditLogEntry,
} from '@xyne/shared';

export interface AuditFeedFilter {
  entityType: AuditEntityType;
  /** Omitted = every entity of the type. */
  entityId?: string | undefined;
  /** Inclusive epoch-ms window on audit_logs.createdAt. */
  from?: number | undefined;
  to?: number | undefined;
  /** Only entries touching these audited tables, with only their change rows. */
  tables?: string[] | undefined;
}

const LOG_INCLUDE = {
  actorUser: { select: { id: true, name: true, email: true, picture: true } },
  changes: { orderBy: { createdAt: 'asc' } },
} as const satisfies Prisma.AuditLogInclude;

type AuditLogRow = Prisma.AuditLogGetPayload<{ include: typeof LOG_INCLUDE }>;

/** LOG_INCLUDE, narrowed to the requested tables' change rows when filtering. */
export const logInclude = (tables: string[] | undefined) =>
  ({
    actorUser: LOG_INCLUDE.actorUser,
    changes: {
      orderBy: LOG_INCLUDE.changes.orderBy,
      where: tables ? { tableName: { in: tables } } : {},
    },
  }) satisfies Prisma.AuditLogInclude;

const ENTITY_NOUNS: Record<AuditEntityType, string> = {
  [AuditEntityType.BOARD]: 'board',
  [AuditEntityType.USER_GROUP_ASSIGNMENT_CONFIG]: 'user group',
  [AuditEntityType.DESK]: 'desk',
};

export const feedWhere = (
  workspaceId: string,
  filter: AuditFeedFilter
): Prisma.AuditLogWhereInput => ({
  workspaceId,
  entityType: filter.entityType,
  ...(filter.entityId && { entityId: filter.entityId }),
  ...(filter.tables && { changes: { some: { tableName: { in: filter.tables } } } }),
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
export async function resolveEntityNames(
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

export const toEntries = async (
  entityType: AuditEntityType,
  logs: AuditLogRow[]
): Promise<AuditLogEntry[]> => {
  const names = await resolveEntityNames(
    entityType,
    logs.map((log) => log.entityId)
  );
  return logs.map((log) => toEntry(log, names.get(log.entityId) ?? log.entityId));
};

/** Logs per keyset read while exporting; each log becomes one row per change. */
const EXPORT_BATCH_SIZE = 500;

/**
 * The filtered feed, newest first, in keyset batches so an export holds one batch
 * at a time. Each entity's name is resolved once across batches.
 */
export async function* auditLogBatches(
  workspaceId: string,
  filter: AuditFeedFilter
): AsyncGenerator<AuditLogEntry[]> {
  const names = new Map<string, string>();
  let cursor: { createdAt: Date; id: string } | null = null;
  for (;;) {
    const rows: AuditLogRow[] = await db.auditLog.findMany({
      where: {
        ...feedWhere(workspaceId, filter),
        ...(cursor && {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_BATCH_SIZE,
      include: logInclude(filter.tables),
    });
    if (rows.length === 0) return;

    const unnamed = rows.map((row) => row.entityId).filter((id) => !names.has(id));
    for (const [id, name] of await resolveEntityNames(filter.entityType, unnamed)) {
      names.set(id, name);
    }
    yield rows.map((row) => toEntry(row, names.get(row.entityId) ?? row.entityId));

    const last = rows[rows.length - 1];
    if (rows.length < EXPORT_BATCH_SIZE || !last) return;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const ACTION_LABELS: Record<string, string> = {
  [AuditAction.CREATE]: 'Added',
  [AuditAction.UPDATE]: 'Changed',
  [AuditAction.DELETE]: 'Removed',
};

/** Excel rejects cells longer than this. */
const MAX_CELL_LENGTH = 32767;

/** Character widths per column, in header order. */
const COLUMN_WIDTHS = [20, 22, 28, 28, 34, 10, 34, 40, 40];

export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

/** epoch ms -> "yyyy-MM-dd HH:mm:ss" in the given IANA time zone. */
const timestampFormatter = (timeZone: string): ((ms: number) => string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return (ms) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(ms).map((part) => [part.type, part.value])
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  };
};

/** Resolves once `out` has room again (or has closed), so a slow download paces the DB reads. */
const drained = (out: Writable): Promise<void> =>
  !out.writableNeedDrain || out.destroyed
    ? Promise.resolve()
    : new Promise((resolve) => {
        const done = (): void => {
          out.off('drain', done);
          out.off('close', done);
          resolve();
        };
        out.on('drain', done);
        out.on('close', done);
      });

/**
 * Writes audit entries into `out` as an .xlsx, one row per field change. Rows are
 * flushed as they're added, so memory holds the current batch, not the file.
 */
export class AuditLogXlsxWriter {
  private readonly workbook: ExcelJS.stream.xlsx.WorkbookWriter;
  private readonly sheet: ExcelJS.Worksheet;
  private readonly formatTime: (ms: number) => string;

  constructor(
    private readonly out: Writable,
    entityType: AuditEntityType,
    timeZone: string
  ) {
    // Shared strings would keep every distinct value in memory until the file closes.
    this.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: out,
      useStyles: false,
      useSharedStrings: false,
    });
    this.sheet = this.workbook.addWorksheet('Audit logs');
    this.sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));
    this.sheet.autoFilter = 'A1:I1';
    const entityLabel = ENTITY_NOUNS[entityType];
    this.sheet
      .addRow([
        'Time',
        'Actor',
        'Actor email',
        entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1),
        'Changed item',
        'Action',
        'Field',
        'Old value',
        'New value',
      ])
      .commit();
    this.formatTime = timestampFormatter(timeZone);
  }

  async addLogs(logs: AuditLogEntry[]): Promise<void> {
    for (const log of logs) {
      for (const change of log.changes) {
        this.sheet
          .addRow(
            [
              this.formatTime(log.createdAt),
              log.actor?.name || log.actor?.email || 'System',
              log.actor?.email,
              log.entityName,
              change.targetName,
              ACTION_LABELS[change.action] ?? change.action,
              fieldLabel(change.field),
              formatAuditValue(change.field, change.oldValue),
              formatAuditValue(change.field, change.newValue),
            ].map((value) => (value ?? '').slice(0, MAX_CELL_LENGTH))
          )
          .commit();
      }
    }
    await drained(this.out);
  }

  async finish(): Promise<void> {
    this.sheet.commit();
    await this.workbook.commit();
  }
}
