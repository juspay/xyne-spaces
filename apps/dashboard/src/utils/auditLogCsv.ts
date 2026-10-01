import { format } from 'date-fns';
import { AuditAction, type AuditLogEntry } from '@xyne/shared';
import { fieldLabel } from './auditLogLabels';

const ACTION_LABELS: Record<string, string> = {
  [AuditAction.CREATE]: 'Added',
  [AuditAction.UPDATE]: 'Changed',
  [AuditAction.DELETE]: 'Removed',
};

/** Quote a cell; a leading formula character is neutralised so spreadsheets don't evaluate it. */
const csvCell = (value: string | null | undefined): string => {
  const text = value ?? '';
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** One CSV row per field change. `entityLabel` names the entity column (Board / User group / Desk). */
export const buildAuditLogCsv = (logs: AuditLogEntry[], entityLabel: string): string => {
  const headers = [
    'Time',
    'Actor',
    'Actor email',
    entityLabel,
    'Changed item',
    'Action',
    'Field',
    'Old value',
    'New value',
  ];
  const rows = logs.flatMap(log =>
    log.changes.map(change =>
      [
        format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm:ss'),
        log.actor?.name || log.actor?.email || 'System',
        log.actor?.email ?? '',
        log.entityName,
        change.targetName,
        ACTION_LABELS[change.action] ?? change.action,
        fieldLabel(change.field),
        change.oldValue,
        change.newValue,
      ]
        .map(csvCell)
        .join(','),
    ),
  );
  return [headers.map(csvCell).join(','), ...rows].join('\n');
};

/** Save CSV text as a file. The BOM keeps Excel reading it as UTF-8 (→, ›, names). */
export const downloadCsvFile = (filename: string, csv: string): void => {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};
