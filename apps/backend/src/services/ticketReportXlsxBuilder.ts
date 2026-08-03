import ExcelJS from 'exceljs';
import type { Ticket, Board, Project, Channel, User } from '@prisma/client';

export interface TicketExportTicket extends Ticket {
  board: Board & { project: Project | null };
  project: Project | null;
  channel: Channel | null;
  assignee: User | null;
  createdByUser: User | null;
  updatedByUser: User | null;
  tags: { id: string; name: string }[];
  group?: { id: string; name: string } | null;
  customFields: Record<string, string | number | Date | null | undefined>;
}

export interface TicketExportLink {
  sourceTicketKey: string;
  sourceTitle: string;
  sourceBoardName: string;
  relationshipType: string;
  targetTicketKey: string;
  targetTitle: string;
  targetBoardName: string;
  targetProjectName: string;
  targetStatus: string;
  targetAssigneeName: string;
}

export interface TicketExportActivity {
  ticketKey: string;
  ticketTitle: string;
  projectName: string;
  boardName: string;
  timestamp: Date;
  actorName: string;
  activityType: string;
  fieldChanged: string;
  oldValue: string;
  newValue: string;
  visibilityResult: string;
}

export interface ExportWorkbookInput {
  exportId: string;
  workspaceName: string;
  projectScope: string;
  generatedAt: Date;
  generatedBy: string;
  filters: Record<string, unknown>;
  includeLinks: boolean;
  includeActivity: boolean;
  ticketsByBoard: Map<string, { board: TicketExportTicket['board']; tickets: TicketExportTicket[] }>;
  links: TicketExportLink[];
  linkedTicketsByBoard?: Map<string, { board: TicketExportTicket['board']; tickets: TicketExportTicket[] }>;
  activities: TicketExportActivity[];
  columnsByBoard?: Record<string, string[]>;
}

export const STANDARD_TICKET_REPORT_COLUMNS = [
  { key: 'ticketKey', label: 'Ticket Key' },
  { key: 'title', label: 'Title' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'project', label: 'Project' },
  { key: 'board', label: 'Board' },
  { key: 'channel', label: 'Channel' },
  { key: 'status', label: 'Status' },
  { key: 'stage', label: 'Stage' },
  { key: 'priority', label: 'Priority' },
  { key: 'archived', label: 'Archived' },
  { key: 'createdBy', label: 'Created By' },
  { key: 'assignedTo', label: 'Assigned To' },
  { key: 'updatedBy', label: 'Updated By' },
  { key: 'group', label: 'Group' },
  { key: 'createdAt', label: 'Created At' },
  { key: 'updatedAt', label: 'Updated At' },
  { key: 'eta', label: 'ETA' },
  { key: 'closedAt', label: 'Closed At' },
  { key: 'tags', label: 'Tags' },
] as const;

const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r', '\n'];
const OPAQUE_DATABASE_ID_PATTERNS = [
  /^c[a-z0-9]{20,}$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{24}$/i,
];

export function redactOpaqueExportIdentifier(value: string): string {
  return OPAQUE_DATABASE_ID_PATTERNS.some(pattern => pattern.test(value))
    ? 'Unavailable'
    : value;
}

function sanitizeCell(value: unknown): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const str = redactOpaqueExportIdentifier(String(value));
  const needsEscape = FORMULA_TRIGGERS.some(trigger => str.startsWith(trigger));
  if (needsEscape) {
    return "'" + str.replace(/'/g, "''");
  }
  return str;
}

function buildRow(values: unknown[]): (string | number | Date | null)[] {
  return values.map(sanitizeCell);
}

export class TicketReportXlsxBuilder {
  /**
   * Build the workbook using ExcelJS streaming writer, writing rows to disk
   * instead of holding the entire workbook in memory.
   *
   * @param input - Export configuration and data
   * @param filePath - Absolute path to write the .xlsx file
   * @returns The same filePath that was passed in
   */
  async buildWorkbook(input: ExportWorkbookInput, filePath: string): Promise<string> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useSharedStrings: true,
    });
    const usedSheetNames = new Set<string>();

    await this.buildSummarySheet(workbook, input, usedSheetNames);

    for (const [, { board, tickets }] of input.ticketsByBoard) {
      await this.buildBoardSheet(
        workbook,
        input.workspaceName,
        board,
        tickets,
        usedSheetNames,
        input.columnsByBoard?.[board.id],
      );
    }

    if (input.includeLinks) {
      await this.buildLinksSheet(workbook, input.links, usedSheetNames);
    }

    if (input.linkedTicketsByBoard) {
      for (const [, { board, tickets }] of input.linkedTicketsByBoard) {
        await this.buildBoardSheet(
          workbook,
          input.workspaceName,
          board,
          tickets,
          usedSheetNames,
          input.columnsByBoard?.[board.id],
          `Linked - ${board.name || 'Untitled Board'}`,
        );
      }
    }

    if (input.includeActivity) {
      await this.buildActivitySheet(workbook, input.activities, usedSheetNames);
    }

    await workbook.commit();
    return filePath;
  }

  private async buildSummarySheet(
    workbook: ExcelJS.stream.xlsx.WorkbookWriter,
    input: ExportWorkbookInput,
    usedNames: Set<string>,
  ): Promise<void> {
    const sheetName = this.uniqueSheetName('Summary', usedNames);
    const ws = workbook.addWorksheet(sheetName);

    const rows: (string | number | Date | null)[][] = [
      ['Workspace', input.workspaceName],
      ['Project', input.projectScope],
      ['Generated at', input.generatedAt],
      ['Generated by', input.generatedBy],
      [
        'Board names',
        [
          ...new Set(
            Array.from(input.ticketsByBoard.values()).map(entry => entry.board.name),
          ),
        ].join(', '),
      ],
      ['Total tickets', Array.from(input.ticketsByBoard.values()).reduce((sum, b) => sum + b.tickets.length, 0)],
    ];

    for (const row of rows) {
      ws.addRow(buildRow(row)).commit();
    }
    await ws.commit();
  }

  private async buildBoardSheet(
    workbook: ExcelJS.stream.xlsx.WorkbookWriter,
    workspaceName: string,
    board: TicketExportTicket['board'],
    tickets: TicketExportTicket[],
    usedNames: Set<string>,
    selectedColumnKeys?: string[],
    requestedSheetName?: string,
  ): Promise<void> {
    const sheetName = this.uniqueSheetName(
      requestedSheetName ?? board.name ?? 'Untitled Board',
      usedNames,
    );
    const ws = workbook.addWorksheet(sheetName);

    const customFieldKeys = new Set<string>();
    for (const t of tickets) {
      Object.keys(t.customFields).forEach(k => customFieldKeys.add(k));
    }
    selectedColumnKeys
      ?.filter(key => key.startsWith('custom:'))
      .forEach(key => customFieldKeys.add(key.substring('custom:'.length)));

    const standardColumns = [
      { key: 'ticketKey', label: 'Ticket Key', value: (t: TicketExportTicket): unknown => t.xyneId },
      { key: 'title', label: 'Title', value: (t: TicketExportTicket): unknown => t.title },
      { key: 'workspace', label: 'Workspace', value: (): unknown => workspaceName },
      { key: 'project', label: 'Project', value: (t: TicketExportTicket): unknown => t.project?.name ?? board.project?.name ?? null },
      { key: 'board', label: 'Board', value: (): unknown => board.name },
      { key: 'channel', label: 'Channel', value: (t: TicketExportTicket): unknown => t.channel?.name ?? null },
      { key: 'status', label: 'Status', value: (t: TicketExportTicket): unknown => t.statusV2 ?? t.status },
      { key: 'stage', label: 'Stage', value: (t: TicketExportTicket): unknown => t.stageName },
      { key: 'priority', label: 'Priority', value: (t: TicketExportTicket): unknown => t.priority },
      { key: 'archived', label: 'Archived', value: (t: TicketExportTicket): unknown => t.isArchived ? 'Yes' : 'No' },
      { key: 'createdBy', label: 'Created By', value: (t: TicketExportTicket): unknown => t.createdByUser?.name ?? t.createdByUser?.email ?? null },
      { key: 'assignedTo', label: 'Assigned To', value: (t: TicketExportTicket): unknown => t.assignee?.name ?? t.assignee?.email ?? null },
      { key: 'updatedBy', label: 'Updated By', value: (t: TicketExportTicket): unknown => t.updatedByUser?.name ?? t.updatedByUser?.email ?? null },
      { key: 'group', label: 'Group', value: (t: TicketExportTicket): unknown => t.group?.name ?? null },
      { key: 'createdAt', label: 'Created At', value: (t: TicketExportTicket): unknown => t.createdAt },
      { key: 'updatedAt', label: 'Updated At', value: (t: TicketExportTicket): unknown => t.updatedAt },
      { key: 'eta', label: 'ETA', value: (t: TicketExportTicket): unknown => t.eta },
      { key: 'closedAt', label: 'Closed At', value: (t: TicketExportTicket): unknown => t.closedAt },
      { key: 'tags', label: 'Tags', value: (t: TicketExportTicket): unknown => t.tags.map(tag => tag.name).join(', ') },
    ];
    const customColumns = Array.from(customFieldKeys).map(fieldName => ({
      key: `custom:${fieldName}`,
      label: fieldName,
      value: (ticket: TicketExportTicket): unknown => ticket.customFields[fieldName] ?? null,
    }));
    const selected = selectedColumnKeys ? new Set(selectedColumnKeys) : null;
    let columns = [...standardColumns, ...customColumns].filter(
      column => !selected || selected.has(column.key),
    );
    if (columns.length === 0) {
      columns = standardColumns.filter(column => column.key === 'ticketKey');
    }
    const headers = columns.map(column => column.label);

    ws.addRow(buildRow(headers)).commit();
    for (const t of tickets) {
      ws.addRow(buildRow(columns.map(column => column.value(t)))).commit();
    }
    await ws.commit();
  }

  private async buildLinksSheet(
    workbook: ExcelJS.stream.xlsx.WorkbookWriter,
    links: TicketExportLink[],
    usedNames: Set<string>,
  ): Promise<void> {
    const sheetName = this.uniqueSheetName('Ticket Links', usedNames);
    const ws = workbook.addWorksheet(sheetName);

    const headers = [
      'Source Ticket Key',
      'Source Ticket Title',
      'Source Board',
      'Relationship Type',
      'Target Ticket Key',
      'Target Ticket Title',
      'Target Board',
      'Target Project',
      'Target Status',
      'Target Assignee',
    ];
    ws.addRow(buildRow(headers)).commit();
    for (const l of links) {
      ws.addRow(buildRow([
        l.sourceTicketKey,
        l.sourceTitle,
        l.sourceBoardName,
        l.relationshipType,
        l.targetTicketKey,
        l.targetTitle,
        l.targetBoardName,
        l.targetProjectName,
        l.targetStatus,
        l.targetAssigneeName,
      ])).commit();
    }
    await ws.commit();
  }

  private async buildActivitySheet(
    workbook: ExcelJS.stream.xlsx.WorkbookWriter,
    activities: TicketExportActivity[],
    usedNames: Set<string>,
  ): Promise<void> {
    const sheetName = this.uniqueSheetName('Activity', usedNames);
    const ws = workbook.addWorksheet(sheetName);

    const headers = [
      'Ticket Key',
      'Ticket Title',
      'Project',
      'Board',
      'Activity Timestamp',
      'Actor',
      'Activity Type',
      'Field Changed',
      'Old Value',
      'New Value',
      'Visibility Result',
    ];
    ws.addRow(buildRow(headers)).commit();
    for (const a of activities) {
      ws.addRow(buildRow([
        a.ticketKey,
        a.ticketTitle,
        a.projectName,
        a.boardName,
        a.timestamp,
        a.actorName,
        a.activityType,
        a.fieldChanged,
        a.oldValue,
        a.newValue,
        a.visibilityResult,
      ])).commit();
    }
    await ws.commit();
  }

  private uniqueSheetName(requestedName: string, usedNames: Set<string>): string {
    const base = this.safeSheetName(requestedName);
    let name = base;
    let suffix = 2;
    while (usedNames.has(name.toLowerCase())) {
      const marker = ` (${suffix})`;
      name = `${base.substring(0, 31 - marker.length)}${marker}`;
      suffix += 1;
    }
    usedNames.add(name.toLowerCase());
    return name;
  }

  private safeSheetName(name: string): string {
    const sanitized = name.replace(/[*\\/?[\]:?]/g, '-').substring(0, 31);
    return sanitized || 'Sheet';
  }
}

export const ticketReportXlsxBuilder = new TicketReportXlsxBuilder();
