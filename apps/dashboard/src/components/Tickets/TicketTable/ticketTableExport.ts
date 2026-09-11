import type { Ticket, TicketTag } from '@xyne/shared';
import { serializeCsv, type CsvCell } from '@xyne/shared';
import { formatStatusLabel } from '../TicketCard/TicketCard.utils';

/**
 * Builds CSV / JSON export payloads for the ticket table view. Kept free of
 * React so the serialization can be unit-tested and reused. The column set
 * mirrors what the table shows: Ticket ID + name are always present, the rest
 * follow the caller's `visibleColumns` so the export matches the on-screen grid.
 */

export interface TicketExportOptions {
  tagsByTicketId?: Map<string, TicketTag[]>;
  /** id -> display name for user assignees / creators (from `userNamesById`). */
  userNamesById?: ReadonlyMap<string, string>;
  /** id -> name for group assignees (from `useUserGroups`). */
  userGroupNamesById?: ReadonlyMap<string, string>;
  /** channelId -> channel name. */
  channelNamesById?: ReadonlyMap<string, string>;
  /** boardId -> board name. */
  boardNamesById?: ReadonlyMap<string, string>;
  /** Same set the grid uses (e.g. `tableVisibleColumns`); gates optional columns. */
  visibleColumns?: ReadonlySet<string>;
}

export interface TicketExportPayload {
  headers: string[];
  rows: CsvCell[][];
  objects: Array<Record<string, CsvCell>>;
}

interface ExportColumn {
  /** Grid column key used to gate on `visibleColumns`; `null` = always included. */
  key: string | null;
  header: string;
  value: (ticket: Ticket, opts: TicketExportOptions) => CsvCell;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date);
}

function formatPriority(priority: string | null | undefined): string {
  if (!priority) return '';
  return priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase();
}

function ageInDays(createdAt: unknown): CsvCell {
  if (createdAt === null || createdAt === undefined || createdAt === '') return '';
  const created = new Date(createdAt as string | number | Date);
  if (Number.isNaN(created.getTime())) return '';
  return Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400000));
}

/** Resolves an assignee to a readable name, mirroring `AssigneeCellRenderer`. */
function resolveAssignee(ticket: Ticket, opts: TicketExportOptions): string {
  const assignedTo = ticket.assignedTo ?? '';
  if (assignedTo && !assignedTo.startsWith('group:')) {
    const userId = assignedTo.replace(/^user:/, '');
    return opts.userNamesById?.get(userId) ?? userId;
  }
  const groupId = assignedTo.startsWith('group:')
    ? assignedTo.slice('group:'.length)
    : (ticket.userGroupId ?? '');
  if (groupId) return opts.userGroupNamesById?.get(groupId) ?? groupId;
  return 'Unassigned';
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: null, header: 'Ticket ID', value: ticket => ticket.xyneId ?? '' },
  // Always exported: the table forces the title column on (it isn't a toggle), so
  // key `null` keeps Ticket name in every export regardless of `visibleColumns`.
  { key: null, header: 'Ticket name', value: ticket => ticket.title ?? '' },
  {
    key: 'status',
    header: 'Status',
    value: ticket => (ticket.statusV2 ? formatStatusLabel(String(ticket.statusV2)) : ''),
  },
  { key: 'priority', header: 'Priority', value: ticket => formatPriority(ticket.priority) },
  { key: 'assignee', header: 'Assignee', value: resolveAssignee },
  { key: 'stage', header: 'Stage', value: ticket => ticket.stageName ?? '' },
  { key: 'dueDate', header: 'Due date', value: ticket => formatDate(ticket.eta) },
  { key: 'createdAt', header: 'Created at', value: ticket => formatDate(ticket.createdAt) },
  {
    key: 'createdBy',
    header: 'Created by',
    value: (ticket, opts) =>
      ticket.createdBy ? (opts.userNamesById?.get(ticket.createdBy) ?? ticket.createdBy) : '',
  },
  {
    key: 'board',
    header: 'Board',
    value: (ticket, opts) =>
      ticket.boardId ? (opts.boardNamesById?.get(ticket.boardId) ?? ticket.boardId) : '',
  },
  {
    key: 'channel',
    header: 'Channel',
    value: (ticket, opts) =>
      ticket.channelId ? (opts.channelNamesById?.get(ticket.channelId) ?? ticket.channelId) : '',
  },
  { key: 'type', header: 'Type', value: ticket => ticket.ticketType ?? '' },
  { key: 'age', header: 'Age (days)', value: ticket => ageInDays(ticket.createdAt) },
  {
    key: 'tags',
    header: 'Labels',
    value: (ticket, opts) =>
      (opts.tagsByTicketId?.get(ticket.id) ?? []).map(tag => tag.name).join(', '),
  },
];

export function buildTicketExportPayload(
  tickets: readonly Ticket[],
  opts: TicketExportOptions = {},
): TicketExportPayload {
  const columns = EXPORT_COLUMNS.filter(
    col => col.key === null || !opts.visibleColumns || opts.visibleColumns.has(col.key),
  );
  const headers = columns.map(col => col.header);
  const rows: CsvCell[][] = [];
  const objects: Array<Record<string, CsvCell>> = [];

  for (const ticket of tickets) {
    const row: CsvCell[] = [];
    const obj: Record<string, CsvCell> = {};
    for (const col of columns) {
      const cell = col.value(ticket, opts);
      row.push(cell);
      obj[col.header] = cell;
    }
    rows.push(row);
    objects.push(obj);
  }

  return { headers, rows, objects };
}

export function ticketPayloadToCsv(payload: TicketExportPayload): string {
  return serializeCsv(payload.headers, payload.rows);
}

export function ticketPayloadToJson(payload: TicketExportPayload): string {
  return JSON.stringify(payload.objects, null, 2);
}

export function buildTicketExportFilename(extension: 'csv' | 'json'): string {
  const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `tickets-${stamp}.${extension}`;
}

/** Downloads a text payload as a file. Adds a BOM for CSV so Excel keeps UTF-8. */
export function downloadTextFile(filename: string, content: string, mime: string): void {
  const withBom = mime.startsWith('text/csv') ? `\uFEFF${content}` : content;
  const blob = new Blob([withBom], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
