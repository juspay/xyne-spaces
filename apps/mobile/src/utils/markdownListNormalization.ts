type OrderedListItem = {
  lineIndex: number;
  number: number;
  marker: string;
  content: string;
};

type OrderedListRun = {
  items: OrderedListItem[];
  marker: string;
  nextNumber: number;
  baseIndent: string;
};

const LIST_WHITESPACE = '[ \\t\\u00a0\\u2007\\u202f]';
const ORDERED_LIST_ITEM_PATTERN = new RegExp(
  `^(${LIST_WHITESPACE}*)(\\d+)([.)])(${LIST_WHITESPACE}+)(.*)$`,
);
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})/;

const normalizeIndent = (indent: string): string => indent.replace(/[\u00a0\u2007\u202f]/g, ' ');

// One or two leading spaces are common editor noise. Three or more spaces are
// the indentation emitted by htmlListsToMarkdown for a nested list and must
// remain structural.
const getStructuralIndent = (indent: string): string => {
  const normalized = normalizeIndent(indent);
  return normalized.length < 3 || /^[\u00a0\u2007\u202f]+$/.test(indent) ? '' : normalized;
};

const normalizeRun = (lines: string[], run: OrderedListRun | null): void => {
  if (!run || run.items.length < 2) return;

  for (const item of run.items) {
    lines[item.lineIndex] = `${run.baseIndent}${item.number}${item.marker} ${item.content}`;
  }
};

/**
 * Align consecutive ordered-list items when their source contains incidental
 * one-to-three-space indentation. A numbering break starts a new run, which
 * preserves genuinely nested ordered lists that restart at 1.
 */
export const normalizeMarkdownListIndentation = (markdown: string): string => {
  if (!markdown) return markdown;

  // Messages can arrive from different editors with either line endings or
  // non-breaking indentation. Canonicalize those before applying list rules;
  // otherwise the same visual list can reach md4c as a nested list on mobile.
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let inFence = false;
  let run: OrderedListRun | null = null;

  const flushRun = (): void => {
    normalizeRun(lines, run);
    run = null;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const fence = FENCE_PATTERN.test(line);
    if (fence) {
      flushRun();
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      flushRun();
      continue;
    }

    // A blank line is still part of a Markdown list when the next item keeps
    // the sequence. Keep the run open so Flow components joined with blank
    // separators cannot accidentally turn later items into nested lists.
    if (line.trim().length === 0) continue;

    const match = ORDERED_LIST_ITEM_PATTERN.exec(line);
    if (!match) {
      flushRun();
      continue;
    }

    const indent = getStructuralIndent(match[1] ?? '');
    const number = Number(match[2]);
    const marker = match[3] ?? '.';
    const isContinuation =
      run !== null &&
      indent === run.baseIndent &&
      number === run.nextNumber &&
      marker === run.marker;

    if (isContinuation && run) {
      run.nextNumber = number + 1;
      run.items.push({
        lineIndex,
        number,
        marker,
        content: match[5] ?? '',
      });
      continue;
    }

    flushRun();
    run = {
      items: [
        {
          lineIndex,
          number,
          marker,
          content: match[5] ?? '',
        },
      ],
      marker,
      nextNumber: number + 1,
      baseIndent: indent,
    };
  }

  flushRun();
  return lines.join('\n');
};
