import { FlowPlanModel, TicketStatusV2 } from '@xyne/shared';
import { apiInstance } from '../../../services/clients/apiClient';
import { getStatusOption } from '../BoardStageConfigScreen/BoardStageConfigScreen.types';
import { buildFlowRunModel } from './flowRunModel';
import {
  isFlowStepBacklogged,
  isRunRoot,
  mapPlanToRunTickets,
  normalizeUserId,
  type FlowRunTicket,
} from './flowRun.utils';

export interface FlowRunExportRow {
  sequence: number;
  mainTicketId: string;
  mainTicketTitle: string;
  mainTicketStatus: string;
  subTicketId: string;
  subTicketTitle: string;
  subTicketGroup: string;
  subTicketStatus: string;
  lastUpdatedBy: string;
  lastUpdated: string;
}

const flowExportDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatFlowExportDate(value?: number | null): string {
  return value ? flowExportDateFormatter.format(new Date(value)) : '-';
}

export function buildFlowRunExportRows({
  currentModel,
  visibleTickets,
  allTickets,
  userNamesById,
}: {
  currentModel: FlowPlanModel;
  visibleTickets: readonly FlowRunTicket[];
  allTickets: readonly FlowRunTicket[];
  userNamesById: ReadonlyMap<string, string>;
}): FlowRunExportRow[] {
  const rows: FlowRunExportRow[] = [];
  let sequence = 1;
  const visibleRootIds = new Set(
    visibleTickets.filter(ticket => isRunRoot(ticket)).map(ticket => ticket.id),
  );
  for (const rootTicket of allTickets) {
    if (!isRunRoot(rootTicket) || !visibleRootIds.has(rootTicket.id)) continue;

    const runTickets = mapPlanToRunTickets(allTickets, rootTicket.id);
    const runModel = buildFlowRunModel(currentModel, rootTicket, runTickets);
    const nodes = [...runModel.nodes].sort(
      (left, right) => left.order - right.order || left.title.localeCompare(right.title),
    );
    const mainTicketStatus = getStatusOption(rootTicket.statusV2).label;

    if (nodes.length === 0) {
      rows.push({
        sequence,
        mainTicketId: rootTicket.xyneId,
        mainTicketTitle: rootTicket.title,
        mainTicketStatus,
        subTicketId: '-',
        subTicketTitle: '-',
        subTicketGroup: '-',
        subTicketStatus: '-',
        lastUpdatedBy: '-',
        lastUpdated: formatFlowExportDate(rootTicket.statusUpdatedAt ?? rootTicket.updatedAt),
      });
      sequence += 1;
      continue;
    }

    for (const node of nodes) {
      const stepTicket = runTickets.get(node.id);
      rows.push({
        sequence,
        mainTicketId: rootTicket.xyneId,
        mainTicketTitle: rootTicket.title,
        mainTicketStatus,
        subTicketId: stepTicket?.xyneId ?? '-',
        subTicketTitle: stepTicket?.title ?? node.title,
        subTicketGroup: node.groupId ? (runModel.getGroup(node.groupId)?.name ?? 'Group') : '-',
        subTicketStatus: stepTicket
          ? isFlowStepBacklogged(stepTicket)
            ? 'Backlog'
            : getStatusOption(stepTicket.statusV2).label
          : getStatusOption(TicketStatusV2.TODO).label,
        lastUpdatedBy: stepTicket?.updatedBy
          ? (userNamesById.get(normalizeUserId(stepTicket.updatedBy) ?? stepTicket.updatedBy) ??
            stepTicket.updatedBy)
          : '-',
        lastUpdated: stepTicket
          ? formatFlowExportDate(stepTicket.updatedAt ?? stepTicket.statusUpdatedAt)
          : '-',
      });
    }
    sequence += 1;
  }
  return rows;
}

const FLOW_RUN_EXPORT_COLUMNS = [
  '#',
  'Main Ticket ID',
  'Main Ticket',
  'Main Ticket Status',
  'Sub-ticket ID',
  'Sub-ticket',
  'Sub-ticket Group',
  'Sub-ticket Status',
  'Last Updated By',
  'Last Updated',
] as const;

function rowValues(row: FlowRunExportRow): string[] {
  return [
    String(row.sequence),
    row.mainTicketId,
    row.mainTicketTitle,
    row.mainTicketStatus,
    row.subTicketId,
    row.subTicketTitle,
    row.subTicketGroup,
    row.subTicketStatus,
    row.lastUpdatedBy,
    row.lastUpdated,
  ];
}

function safeFileName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-');
  return normalized || 'flow-runs';
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function centerMergedMainTicketCells(
  workbookData: ArrayBuffer,
  cellRefs: readonly string[],
): Promise<Blob> {
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (cellRefs.length === 0) return new Blob([workbookData], { type: mimeType });

  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(workbookData);
  const stylesFile = zip.file('xl/styles.xml');
  const worksheetFile = zip.file('xl/worksheets/sheet1.xml');
  if (!stylesFile || !worksheetFile) throw new Error('Invalid Excel workbook');

  const [stylesXml, worksheetXml] = await Promise.all([
    stylesFile.async('string'),
    worksheetFile.async('string'),
  ]);
  const cellFormatsPattern = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/;
  const cellFormats = stylesXml.match(cellFormatsPattern);
  if (!cellFormats) throw new Error('Excel workbook styles are missing');

  const centeredStyleIndex = Number(cellFormats[1]);
  const centeredStyle =
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
    '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>';
  const centeredStylesXml = stylesXml.replace(
    cellFormatsPattern,
    `<cellXfs count="${centeredStyleIndex + 1}">${cellFormats[2]}${centeredStyle}</cellXfs>`,
  );
  const centeredCellRefs = new Set(cellRefs);
  const centeredWorksheetXml = worksheetXml.replace(
    /<c\b([^>]*?)(\/?)>/g,
    (cell, attributes: string, selfClosing: string) => {
      const cellRef = attributes.match(/\br="([^"]+)"/)?.[1];
      if (!cellRef || !centeredCellRefs.has(cellRef)) return cell;
      return `<c${attributes.replace(/\s+s="[^"]*"/, '')} s="${centeredStyleIndex}"${selfClosing}>`;
    },
  );

  zip.file('xl/styles.xml', centeredStylesXml);
  zip.file('xl/worksheets/sheet1.xml', centeredWorksheetXml);
  return zip.generateAsync({
    type: 'blob',
    mimeType,
  });
}

export async function downloadFlowRunsExcel(
  title: string,
  rows: readonly FlowRunExportRow[],
): Promise<void> {
  const XLSX = await import('xlsx');
  const worksheet = XLSX.utils.aoa_to_sheet([
    [title],
    [`Report generated by Xyne Space at ${new Date().toLocaleString('en-IN')}`],
    [],
    [...FLOW_RUN_EXPORT_COLUMNS],
    ...rows.map(rowValues),
  ]);
  worksheet['!cols'] = [
    { wch: 8 },
    { wch: 18 },
    { wch: 32 },
    { wch: 20 },
    { wch: 18 },
    { wch: 32 },
    { wch: 22 },
    { wch: 20 },
    { wch: 24 },
    { wch: 24 },
  ];
  worksheet['!autofilter'] = { ref: `A4:J${rows.length + 4}` };
  worksheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
  ];
  const centeredTableCells = [
    ...Array.from({ length: 10 }, (_column, columnIndex) =>
      XLSX.utils.encode_cell({ r: 3, c: columnIndex }),
    ),
    ...rows.flatMap((_row, rowIndex) =>
      Array.from({ length: 10 }, (_column, columnIndex) =>
        XLSX.utils.encode_cell({ r: rowIndex + 4, c: columnIndex }),
      ),
    ),
  ];

  let groupStart = 0;
  for (let index = 1; index <= rows.length; index += 1) {
    const currentGroupId = rows[groupStart]?.mainTicketId;
    if (index < rows.length && rows[index]?.mainTicketId === currentGroupId) continue;
    if (index - groupStart > 1) {
      for (let column = 0; column <= 3; column += 1) {
        worksheet['!merges'].push({
          s: { r: groupStart + 4, c: column },
          e: { r: index + 3, c: column },
        });
      }
    }
    groupStart = index;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Flow runs');
  const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const centeredWorkbook = await centerMergedMainTicketCells(workbookData, centeredTableCells);
  saveBlob(centeredWorkbook, `${safeFileName(title)}.xlsx`);
}

export async function downloadFlowRunsPdf(
  title: string,
  rows: readonly FlowRunExportRow[],
): Promise<void> {
  const response = await apiInstance.post<Blob>(
    '/tickets/flow-run-export/pdf',
    { title, rows },
    { responseType: 'blob' },
  );
  saveBlob(response.data, `${safeFileName(title)}.pdf`);
}
