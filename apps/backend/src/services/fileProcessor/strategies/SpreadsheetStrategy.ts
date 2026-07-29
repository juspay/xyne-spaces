import * as XLSX from 'xlsx';
import { BaseStrategy } from './BaseStrategy';
import type { ChunkMetadata, ProcessingResult, StrategyConfig } from '../types';

const MAX_ROWS_PER_SHEET = 10_000;
const MAX_COLUMNS_PER_SHEET = 256;
const MAX_CELLS_PER_WORKBOOK = 100_000;
const MAX_PROFILE_COLUMNS = 64;

interface ParsedCell {
  address: string;
  column: number;
  row: number;
  value: string;
  kind: string;
}

interface RowBlock {
  row: number;
  text: string;
}

interface SpreadsheetDataChunk {
  text: string;
  startRow?: number;
  endRow?: number;
}

interface SheetSummary {
  sheetName: string;
  visibility: 'visible' | 'hidden' | 'very hidden';
  usedRange: string;
  headerRow?: number;
  dataRows: number;
  columnCount: number;
  nonEmptyCells: number;
}

interface ParsedSheet {
  sheetName: string;
  profile: string;
  summary: SheetSummary;
  chunks: SpreadsheetDataChunk[];
  includedCellCount: number;
}

/**
 * Parses Excel workbooks into coordinate-labelled Markdown that remains useful
 * for both Vespa retrieval and the document-analysis agent. Coordinates are
 * retained so sparse sheets and repeated/blank headers do not lose meaning.
 */
export class SpreadsheetStrategy extends BaseStrategy {
  private config: Required<Pick<StrategyConfig, 'chunkSize'>>;

  constructor(config?: StrategyConfig) {
    super();
    this.config = {
      chunkSize: Math.max(config?.chunkSize ?? 4_000, 512),
    };
  }

  async parse(buffer: Buffer, _vespaDocId: string): Promise<ProcessingResult> {
    try {
      const workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: true,
        cellFormula: true,
        cellStyles: false,
        bookVBA: false,
      });

      if (workbook.SheetNames.length === 0) {
        throw new Error('workbook contains no worksheets');
      }

      const chunks: string[] = [];
      const chunks_map: ChunkMetadata[] = [];
      const parsedSheets: ParsedSheet[] = [];
      let remainingCells = MAX_CELLS_PER_WORKBOOK;

      workbook.SheetNames.forEach((sheetName, sheetIndex) => {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) return;

        const visibility = this.getSheetVisibility(workbook, sheetIndex);
        const visibilitySuffix = visibility === 'visible' ? '' : ` (${visibility})`;
        const heading = `## Sheet: ${this.cleanHeading(sheetName)}${visibilitySuffix}`;
        const parsedSheet = this.parseSheet(
          worksheet,
          sheetName,
          heading,
          visibility,
          remainingCells
        );

        parsedSheets.push(parsedSheet);
        remainingCells -= parsedSheet.includedCellCount;
      });

      if (parsedSheets.length === 0) {
        throw new Error('workbook contains no readable worksheets');
      }

      // Profile chunks live first so callers can inspect the workbook like a
      // compact pandas DataFrame.info() before reading row-level data.
      chunks.push(this.buildWorkbookProfile(parsedSheets));
      chunks_map.push({
        chunk_index: 0,
        page_numbers: [],
        block_labels: ['spreadsheet', 'workbook-profile'],
      });

      const profileIndexBySheet = new Map<string, number>();
      for (const parsedSheet of parsedSheets) {
        const profileIndex = chunks.length;
        profileIndexBySheet.set(parsedSheet.sheetName, profileIndex);
        chunks.push(parsedSheet.profile);
        chunks_map.push({
          chunk_index: profileIndex,
          page_numbers: [],
          block_labels: ['spreadsheet', 'sheet-profile', `sheet:${parsedSheet.sheetName}`],
        });
      }

      for (const parsedSheet of parsedSheets) {
        const profileIndex = profileIndexBySheet.get(parsedSheet.sheetName);
        for (const chunk of parsedSheet.chunks) {
          const blockLabels = ['spreadsheet', 'table', `sheet:${parsedSheet.sheetName}`];
          if (profileIndex !== undefined) {
            blockLabels.push(`sheet-profile-index:${profileIndex}`);
          }
          if (chunk.startRow !== undefined && chunk.endRow !== undefined) {
            blockLabels.push(`rows:${chunk.startRow}-${chunk.endRow}`);
          }
          chunks.push(chunk.text);
          chunks_map.push({
            chunk_index: chunks_map.length,
            page_numbers: [],
            block_labels: blockLabels,
          });
        }
      }

      return {
        chunks,
        chunks_map,
        documentOutline: workbook.SheetNames.map(
          (sheetName) => `- ${this.cleanHeading(sheetName)}`
        ).join('\n'),
        processingMethod: this.getName(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Spreadsheet parsing failed: ${message}`);
    }
  }

  private parseSheet(
    worksheet: XLSX.WorkSheet,
    sheetName: string,
    heading: string,
    visibility: SheetSummary['visibility'],
    remainingCells: number
  ): ParsedSheet {
    const candidateCells = Object.keys(worksheet)
      .filter((key) => /^[A-Z]+[1-9][0-9]*$/.test(key))
      .map((address) => {
        const position = XLSX.utils.decode_cell(address);
        const cell = worksheet[address];
        return {
          address,
          column: position.c,
          row: position.r,
          value: cell ? this.formatCell(cell) : '',
          kind: cell ? this.getCellKind(cell) : 'unknown',
        };
      })
      .filter((cell) => cell.value.length > 0)
      .sort((a, b) => a.row - b.row || a.column - b.column);

    if (candidateCells.length === 0) {
      const summary: SheetSummary = {
        sheetName,
        visibility,
        usedRange: 'empty',
        dataRows: 0,
        columnCount: 0,
        nonEmptyCells: 0,
      };
      return {
        sheetName,
        profile: this.buildSheetProfile(summary, []),
        summary,
        chunks: [{ text: `${heading}\n\n_Empty sheet._` }],
        includedCellCount: 0,
      };
    }

    const allowedRows = new Set(
      [...new Set(candidateCells.map((cell) => cell.row))].slice(0, MAX_ROWS_PER_SHEET)
    );
    const allowedColumns = new Set(
      [...new Set(candidateCells.map((cell) => cell.column))].slice(0, MAX_COLUMNS_PER_SHEET)
    );

    const filteredCells = candidateCells
      .filter((cell) => allowedRows.has(cell.row) && allowedColumns.has(cell.column))
      .slice(0, Math.max(remainingCells, 0));
    const isTruncated = filteredCells.length < candidateCells.length;

    if (filteredCells.length === 0) {
      const summary: SheetSummary = {
        sheetName,
        visibility,
        usedRange: 'not ingested',
        dataRows: 0,
        columnCount: 0,
        nonEmptyCells: 0,
      };
      return {
        sheetName,
        profile: this.buildSheetProfile(summary, []),
        summary,
        chunks: [
          {
            text: `${heading}\n\n_Workbook cell limit reached; this sheet was not ingested._`,
          },
        ],
        includedCellCount: 0,
      };
    }

    const summary = this.buildSheetSummary(sheetName, visibility, filteredCells);
    const rowBlocks = this.buildRowBlocks(filteredCells);
    const chunks = this.chunkRowBlocks(heading, rowBlocks);

    if (isTruncated) {
      chunks[chunks.length - 1]!.text +=
        '\n\n> Sheet truncated during ingestion to protect processing limits.';
    }

    return {
      sheetName,
      profile: this.buildSheetProfile(summary, filteredCells),
      summary,
      chunks,
      includedCellCount: filteredCells.length,
    };
  }

  private buildRowBlocks(cells: ParsedCell[]): RowBlock[] {
    const rows = new Map<number, ParsedCell[]>();
    for (const cell of cells) {
      const row = rows.get(cell.row) ?? [];
      row.push(cell);
      rows.set(cell.row, row);
    }

    return [...rows.entries()].map(([rowIndex, rowCells]) => {
      const values = rowCells.map((cell) => `- ${cell.address}: ${cell.value}`).join('\n');
      return { row: rowIndex + 1, text: `### Row ${rowIndex + 1}\n${values}` };
    });
  }

  private chunkRowBlocks(heading: string, rowBlocks: RowBlock[]): SpreadsheetDataChunk[] {
    const chunks: SpreadsheetDataChunk[] = [];
    let current = heading;
    let startRow: number | undefined;
    let endRow: number | undefined;

    const flush = () => {
      if (current !== heading) chunks.push({ text: current, startRow, endRow });
      current = heading;
      startRow = undefined;
      endRow = undefined;
    };

    for (const rowBlock of rowBlocks) {
      const addition = `\n\n${rowBlock.text}`;
      if (current !== heading && current.length + addition.length > this.config.chunkSize) {
        flush();
      }

      // Keep every row intact. This can exceed chunkSize only when a single
      // spreadsheet row itself is unusually large, which preserves cell context.
      current += addition;
      startRow ??= rowBlock.row;
      endRow = rowBlock.row;
    }

    flush();
    return chunks;
  }

  private buildSheetSummary(
    sheetName: string,
    visibility: SheetSummary['visibility'],
    cells: ParsedCell[]
  ): SheetSummary {
    const rows = [...new Set(cells.map((cell) => cell.row))].sort((a, b) => a - b);
    const columns = [...new Set(cells.map((cell) => cell.column))].sort((a, b) => a - b);
    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];
    const firstColumn = columns[0];
    const lastColumn = columns[columns.length - 1];
    const usedRange =
      firstRow === undefined ||
      lastRow === undefined ||
      firstColumn === undefined ||
      lastColumn === undefined
        ? 'empty'
        : `${XLSX.utils.encode_cell({ r: firstRow, c: firstColumn })}:` +
          `${XLSX.utils.encode_cell({ r: lastRow, c: lastColumn })}`;

    return {
      sheetName,
      visibility,
      usedRange,
      ...(firstRow !== undefined ? { headerRow: firstRow + 1 } : {}),
      dataRows: Math.max(rows.length - 1, 0),
      columnCount: columns.length,
      nonEmptyCells: cells.length,
    };
  }

  private buildWorkbookProfile(parsedSheets: ParsedSheet[]): string {
    const totalCells = parsedSheets.reduce(
      (total, sheet) => total + sheet.summary.nonEmptyCells,
      0
    );
    const lines = [
      '# Workbook profile',
      '',
      `- Worksheets: ${parsedSheets.length}`,
      `- Non-empty cells: ${totalCells}`,
      '',
      '## Sheets',
    ];

    for (const sheet of parsedSheets) {
      const summary = sheet.summary;
      lines.push(
        `- ${this.cleanHeading(summary.sheetName)}: range ${summary.usedRange}; ` +
          `${summary.dataRows} data rows; ${summary.columnCount} columns; ` +
          `header row ${summary.headerRow ?? 'unknown'}; ${summary.visibility}`
      );
    }

    return lines.join('\n');
  }

  private buildSheetProfile(summary: SheetSummary, cells: ParsedCell[]): string {
    const lines = [
      `## Sheet profile: ${this.cleanHeading(summary.sheetName)}`,
      '',
      `- Used range: ${summary.usedRange}`,
      `- Visibility: ${summary.visibility}`,
      `- Assumed header row: ${summary.headerRow ?? 'unknown'}`,
      `- Data rows: ${summary.dataRows}`,
      `- Columns: ${summary.columnCount}`,
      `- Non-empty cells: ${summary.nonEmptyCells}`,
    ];

    if (cells.length === 0 || summary.headerRow === undefined) {
      return lines.join('\n');
    }

    const headerRowIndex = summary.headerRow - 1;
    const columns = [...new Set(cells.map((cell) => cell.column))]
      .sort((a, b) => a - b)
      .slice(0, MAX_PROFILE_COLUMNS);
    const headerByColumn = new Map(
      cells
        .filter((cell) => cell.row === headerRowIndex)
        .map((cell) => [cell.column, cell.value] as const)
    );
    const kindsByColumn = new Map<number, Set<string>>();
    for (const cell of cells) {
      if (cell.row === headerRowIndex) continue;
      const kinds = kindsByColumn.get(cell.column) ?? new Set<string>();
      kinds.add(cell.kind);
      kindsByColumn.set(cell.column, kinds);
    }

    lines.push('', '### Column schema');
    for (const column of columns) {
      const columnName = XLSX.utils.encode_col(column);
      const rawHeader = headerByColumn.get(column) ?? '(unnamed)';
      const header = this.truncateProfileValue(rawHeader);
      const kinds = [...(kindsByColumn.get(column) ?? new Set(['unknown']))].sort();
      const inferredType = kinds.length === 1 ? kinds[0] : `mixed (${kinds.join(', ')})`;
      lines.push(`- ${columnName}: ${header} — ${inferredType}`);
    }
    if (summary.columnCount > MAX_PROFILE_COLUMNS) {
      lines.push(`- … ${summary.columnCount - MAX_PROFILE_COLUMNS} additional columns omitted`);
    }

    return lines.join('\n');
  }

  private getCellKind(cell: XLSX.CellObject): string {
    let kind: string;
    switch (cell.t) {
      case 'n':
        kind = 'number';
        break;
      case 'b':
        kind = 'boolean';
        break;
      case 'd':
        kind = 'date';
        break;
      case 'e':
        kind = 'error';
        break;
      default:
        kind = 'text';
    }
    return cell.f ? `formula/${kind}` : kind;
  }

  private truncateProfileValue(value: string): string {
    const singleLine = value.replace(/<br>/g, ' ').trim();
    return singleLine.length > 160 ? `${singleLine.slice(0, 157)}…` : singleLine;
  }

  private formatCell(cell: XLSX.CellObject): string {
    const formattedValue = XLSX.utils.format_cell(cell).trim();
    const formula = typeof cell.f === 'string' && cell.f.length > 0 ? `=${cell.f}` : '';

    let value = formattedValue;
    if (formula && !value) {
      value = formula;
    } else if (formula && value !== formula) {
      value = `${value} (formula: ${formula})`;
    }

    const link = cell.l?.Target;
    if (link && !value.includes(link)) {
      value = value ? `${value} (${link})` : link;
    }

    return value
      .normalize('NFC')
      .replace(/[^\P{C}\n\t]/gu, '')
      .replace(/\r?\n/g, '<br>');
  }

  private getSheetVisibility(
    workbook: XLSX.WorkBook,
    sheetIndex: number
  ): SheetSummary['visibility'] {
    const hidden = workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden;
    if (hidden === 2) return 'very hidden';
    if (hidden === 1) return 'hidden';
    return 'visible';
  }

  private cleanHeading(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').trim();
  }

  getName(): string {
    return 'spreadsheet-xlsx';
  }
}
