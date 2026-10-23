type ParsedTableLine = {
  cells: string[];
  quoteDepth: number;
};

type FenceState = {
  marker: '`' | '~';
  length: number;
};

const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})/;
const DELIMITER_CELL_PATTERN = /^:?-+:?$/;

const stripBlockquotePrefix = (line: string): { content: string; quoteDepth: number } => {
  let content = line;
  let quoteDepth = 0;

  while (true) {
    const match = /^[ \t]{0,3}>[ \t]?/.exec(content);
    if (!match) break;
    quoteDepth += 1;
    content = content.slice(match[0].length);
  }

  return { content, quoteDepth };
};

const splitUnescapedPipes = (line: string): string[] | null => {
  const trimmed = line.trim();
  const cells: string[] = [];
  let cell = '';
  let hasSeparator = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index] ?? '';
    if (char === '\\' && index + 1 < trimmed.length) {
      cell += char + (trimmed[index + 1] ?? '');
      index += 1;
      continue;
    }
    if (char === '|') {
      hasSeparator = true;
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());

  if (!hasSeparator) return null;
  if (trimmed.startsWith('|')) cells.shift();
  if (trimmed.endsWith('|')) cells.pop();
  return cells.length > 0 ? cells : null;
};

const parseTableLine = (line: string): ParsedTableLine | null => {
  const { content, quoteDepth } = stripBlockquotePrefix(line);
  const cells = splitUnescapedPipes(content);
  return cells ? { cells, quoteDepth } : null;
};

const isDelimiterRow = (line: ParsedTableLine): boolean =>
  line.cells.length > 0 &&
  line.cells.every(cell => DELIMITER_CELL_PATTERN.test(cell.replace(/[ \t]/g, '')));

/**
 * Returns physical line indexes that form valid GFM pipe tables.
 *
 * Supports optional/mixed leading and trailing pipes, CRLF, and blockquoted
 * tables. Fenced-code content is excluded. Header and delimiter column counts
 * must match, as required by GFM; body rows may be shorter or longer because
 * GFM pads missing cells and ignores extras.
 */
export const getMarkdownTableLineIndexes = (markdown: string): ReadonlySet<number> => {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const eligible: Array<ParsedTableLine | null> = [];
  let fence: FenceState | null = null;

  for (const line of lines) {
    const { content } = stripBlockquotePrefix(line);
    const fenceMatch = FENCE_PATTERN.exec(content);

    if (fence) {
      const closing = fenceMatch?.[1] ?? '';
      if (closing[0] === fence.marker && closing.length >= fence.length) fence = null;
      eligible.push(null);
      continue;
    }

    if (fenceMatch) {
      const marker = fenceMatch[1] ?? '';
      fence = { marker: marker[0] as '`' | '~', length: marker.length };
      eligible.push(null);
      continue;
    }

    eligible.push(parseTableLine(line));
  }

  const indexes = new Set<number>();
  for (let index = 0; index < eligible.length - 1; index += 1) {
    const header = eligible[index];
    const delimiter = eligible[index + 1];
    if (
      !header ||
      !delimiter ||
      header.quoteDepth !== delimiter.quoteDepth ||
      header.cells.length !== delimiter.cells.length ||
      !isDelimiterRow(delimiter)
    ) {
      continue;
    }

    indexes.add(index);
    indexes.add(index + 1);
    for (let rowIndex = index + 2; rowIndex < eligible.length; rowIndex += 1) {
      const row = eligible[rowIndex];
      if (!row || row.quoteDepth !== header.quoteDepth) break;
      indexes.add(rowIndex);
    }
  }
  return indexes;
};

export const hasMarkdownTable = (markdown: string): boolean =>
  getMarkdownTableLineIndexes(markdown).size > 0;

export const markdownFlavorFor = (markdown: string): 'github' | undefined =>
  hasMarkdownTable(markdown) ? 'github' : undefined;
