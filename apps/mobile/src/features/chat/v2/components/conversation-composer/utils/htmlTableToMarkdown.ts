/**
 * `<table>` → GFM pipe table.
 *
 * Email bodies (desk tickets especially) carry real data tables that the plain
 * tag stripper in `htmlToMD` would otherwise flatten into one unreadable run of
 * concatenated cell text. GFM tables render natively via
 * `EnrichedMarkdownText flavor="github"`; on a `commonmark` surface the pipe
 * rows at least stay one-row-per-line.
 *
 * Layout tables (the `<table>`-as-grid chrome that Outlook/Gmail wrap real
 * content in) are unwrapped rather than converted — see `isDataTable`.
 */

const TABLE_BLOCK_PATTERN = /<table\b[^>]*>([\s\S]*?)<\/table>/i;
const ROW_PATTERN = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
const CELL_PATTERN = /<(t[hd])\b([^>]*)>([\s\S]*?)<\/\1>/gi;

/** A table with a single column (or a single cell) is page chrome, not data. */
const MIN_DATA_TABLE_COLUMNS = 2;

type TableRow = {
  cells: string[];
  isHeader: boolean;
};

const repeatColumns = (count: number, value: string): string[] =>
  Array.from({ length: count }, () => value);

/**
 * Row text must survive as a single line: newlines would end the table, and a
 * bare `|` would open a phantom column. `||` is never emitted because every
 * cell is padded — the renderer always parses `||` as spoiler syntax.
 */
const toCellText = (markdown: string): string =>
  markdown
    .replace(/\|/g, '\\|')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

const parseRows = (tableInner: string, cellToMarkdown: (html: string) => string): TableRow[] => {
  const rows: TableRow[] = [];

  ROW_PATTERN.lastIndex = 0;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = ROW_PATTERN.exec(tableInner)) !== null) {
    const rowInner = rowMatch[1] ?? '';
    const cells: string[] = [];
    let sawHeaderCell = false;

    CELL_PATTERN.lastIndex = 0;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = CELL_PATTERN.exec(rowInner)) !== null) {
      if ((cellMatch[1] ?? '').toLowerCase() === 'th') sawHeaderCell = true;
      cells.push(cellToMarkdown(cellMatch[3] ?? '').trim());
    }

    if (cells.length > 0) rows.push({ cells, isHeader: sawHeaderCell });
  }

  return rows;
};

const isDataTable = (rows: TableRow[]): boolean => {
  if (rows.length === 0) return false;
  const widest = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  return widest >= MIN_DATA_TABLE_COLUMNS;
};

const buildRowLine = (cells: string[], columnCount: number): string => {
  const padded = cells.map(toCellText);
  while (padded.length < columnCount) padded.push('');
  return `| ${padded.slice(0, columnCount).join(' | ')} |`;
};

/**
 * GFM requires a header row, so a table whose first row carries no `<th>` still
 * promotes that row — the same choice every html→markdown converter makes,
 * and the shape real email tables come in.
 */
const rowsToMarkdown = (rows: TableRow[]): string => {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  const [firstRow, ...restRows] = rows;
  if (!firstRow) return '';

  const lines = [
    buildRowLine(firstRow.cells, columnCount),
    `| ${repeatColumns(columnCount, '---').join(' | ')} |`,
    ...restRows.map(row => buildRowLine(row.cells, columnCount)),
  ];

  return `\n\n${lines.join('\n')}\n\n`;
};

/** Strip the table chrome but keep its content, one cell per line. */
const unwrapTable = (rows: TableRow[]): string => {
  const text = rows
    .map(row => row.cells.filter(cell => cell.length > 0).join('\n'))
    .filter(line => line.length > 0)
    .join('\n');
  return text ? `\n${text}\n` : '';
};

/**
 * Convert every `<table>` in `html`, innermost first so a layout table wrapping
 * a data table unwraps to the already-converted inner one.
 *
 * `cellToMarkdown` converts a cell's inner HTML to inline markdown — callers
 * pass their own converter so mentions, links and emphasis inside cells keep
 * working.
 */
export function convertHtmlTablesToMarkdown(
  html: string,
  cellToMarkdown: (cellHtml: string) => string,
): string {
  if (!/<table\b/i.test(html)) return html;

  let out = html;
  // Bounded so malformed markup (an unclosed <table>) can never spin forever.
  for (let pass = 0; pass < 32; pass += 1) {
    const match = findInnermostTable(out);
    if (!match) break;

    const rows = parseRows(match.inner, cellToMarkdown);
    const replacement = isDataTable(rows) ? rowsToMarkdown(rows) : unwrapTable(rows);
    out = out.slice(0, match.start) + replacement + out.slice(match.end);
  }

  return out;
}

type InnermostTable = {
  start: number;
  end: number;
  inner: string;
};

/** The first `<table>` whose body holds no further `<table>`. */
function findInnermostTable(html: string): InnermostTable | null {
  let searchFrom = 0;

  while (searchFrom < html.length) {
    const rest = html.slice(searchFrom);
    const match = TABLE_BLOCK_PATTERN.exec(rest);
    if (!match || match.index === undefined) return null;

    const inner = match[1] ?? '';
    const start = searchFrom + match.index;
    const end = start + match[0].length;

    if (!/<table\b/i.test(inner)) {
      return { start, end, inner };
    }

    // Nested table: restart the scan just past this opening tag so the inner
    // one is found first.
    searchFrom = start + match[0].indexOf('>') + 1;
  }

  return null;
}

const isMarkdownTableLine = (line: string): boolean => line.trimStart().startsWith('|');

/**
 * Prefix quoted lines with `> `, but leave table rows at the document root.
 *
 * Both native renderers only turn a table into a real table when the table node
 * is a direct child of the document root (`splitASTIntoSegments` on Android,
 * `ENRMSplitASTIntoSegments` on iOS). A `>`-prefixed table falls back to the
 * span renderer, which has no table handling at all — the flattened run of cell
 * text this whole module exists to fix. Hoisting the table out of the quote
 * costs the accent bar and keeps the table.
 */
export function quoteMarkdownHoistingTables(markdown: string): string {
  const lines = markdown
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0);
  if (lines.length === 0) return '';

  const blocks: string[] = [];
  let quoted: string[] = [];
  let table: string[] = [];

  const flushQuoted = (): void => {
    if (quoted.length === 0) return;
    blocks.push(quoted.map(line => `> ${line}`).join('\n'));
    quoted = [];
  };
  const flushTable = (): void => {
    if (table.length === 0) return;
    blocks.push(table.join('\n'));
    table = [];
  };

  for (const line of lines) {
    if (isMarkdownTableLine(line)) {
      flushQuoted();
      table.push(line);
    } else {
      flushTable();
      quoted.push(line);
    }
  }
  flushQuoted();
  flushTable();

  return blocks.join('\n\n');
}
