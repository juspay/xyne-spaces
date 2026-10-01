import { format } from 'date-fns';
import { AuditAction, type AuditLogEntry } from '@xyne/shared';
import { fieldLabel } from './auditLogLabels';

const ACTION_LABELS: Record<string, string> = {
  [AuditAction.CREATE]: 'Added',
  [AuditAction.UPDATE]: 'Changed',
  [AuditAction.DELETE]: 'Removed',
};

/** Excel rejects cells longer than this. */
const MAX_CELL_LENGTH = 32767;

/** Character widths per column, in header order. */
const COLUMN_WIDTHS = [20, 22, 28, 28, 34, 10, 34, 40, 40];

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Header plus one row per field change. `entityLabel` names the entity column (Board / User group / Desk). */
export const buildAuditLogRows = (logs: AuditLogEntry[], entityLabel: string): string[][] => [
  [
    'Time',
    'Actor',
    'Actor email',
    entityLabel,
    'Changed item',
    'Action',
    'Field',
    'Old value',
    'New value',
  ],
  ...logs.flatMap(log =>
    log.changes.map(change =>
      [
        format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss'),
        log.actor?.name || log.actor?.email || 'System',
        log.actor?.email,
        log.entityName,
        change.targetName,
        ACTION_LABELS[change.action] ?? change.action,
        fieldLabel(change.field),
        change.oldValue,
        change.newValue,
      ].map(value => (value ?? '').slice(0, MAX_CELL_LENGTH)),
    ),
  ),
];

/** Save the entries as an .xlsx file; the xlsx library loads only when a download happens. */
export const downloadAuditLogXlsx = async (
  filename: string,
  logs: AuditLogEntry[],
  entityLabel: string,
): Promise<void> => {
  const XLSX = await import('xlsx');
  const rows = buildAuditLogRows(logs, entityLabel);

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = COLUMN_WIDTHS.map(wch => ({ wch }));
  worksheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: rows.length - 1, c: COLUMN_WIDTHS.length - 1 },
    }),
  };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Audit logs');
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;

  const url = URL.createObjectURL(new Blob([data], { type: XLSX_MIME_TYPE }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};
