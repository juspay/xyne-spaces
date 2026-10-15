import { getMarkdownTableLineIndexes } from './markdownTable';

const FENCE_OPEN_LINE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*$/;
const FENCE_CLOSE_LINE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;
const MARKDOWN_LIST_ITEM_PATTERN = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/;
const BARE_URL_AT_START = /^https?:\/\/[^\s<>()]+/;
const TRAILING_URL_PUNCTUATION = /[.,!?;:]+$/;
const NATIVE_CODE_BLOCK_END_GUARD = '\n\u200B';
const CHAT_ARCHIVE_URL_WITH_SUFFIX_PATTERN =
  /^(https?:\/\/[^/\s<>()]+\/archives\/[A-Z0-9]+\/p\d{16})([A-Z][^\s<>()]*)$/;

const splitBareUrlCandidate = (raw: string): { url: string; suffix: string; trailing: string } => {
  const trailing = TRAILING_URL_PUNCTUATION.exec(raw)?.[0] ?? '';
  const withoutTrailing = trailing ? raw.slice(0, -trailing.length) : raw;
  const chatArchive = CHAT_ARCHIVE_URL_WITH_SUFFIX_PATTERN.exec(withoutTrailing);
  if (chatArchive) {
    return {
      url: chatArchive[1] ?? withoutTrailing,
      suffix: chatArchive[2] ?? '',
      trailing,
    };
  }
  return { url: withoutTrailing, suffix: '', trailing };
};

const findMarkdownLinkEnd = (text: string, start: number): number | null => {
  let cursor = start + 1;
  while (cursor < text.length) {
    if (text[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (text[cursor] === ']') break;
    cursor += 1;
  }
  if (text[cursor] !== ']' || text[cursor + 1] !== '(') return null;

  cursor += 2;
  let depth = 0;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      if (depth === 0) return cursor + 1;
      depth -= 1;
    }
    cursor += 1;
  }
  return null;
};

const linkBareUrlsInInlineMarkdown = (text: string): string => {
  let out = '';
  let cursor = 0;

  while (cursor < text.length) {
    const char = text[cursor];

    if (char === '[') {
      const linkEnd = findMarkdownLinkEnd(text, cursor);
      if (linkEnd !== null) {
        out += text.slice(cursor, linkEnd);
        cursor = linkEnd;
        continue;
      }
    }

    if (char === '`') {
      const codeEnd = text.indexOf('`', cursor + 1);
      if (codeEnd !== -1) {
        out += text.slice(cursor, codeEnd + 1);
        cursor = codeEnd + 1;
        continue;
      }
    }

    if (char === 'h') {
      const match = BARE_URL_AT_START.exec(text.slice(cursor));
      if (match) {
        const raw = match[0];
        const { url, suffix, trailing } = splitBareUrlCandidate(raw);
        if (url.length > 0) {
          out += '[' + url + '](' + url + ')' + (suffix ? ' ' + suffix : '') + trailing;
          cursor += raw.length;
          continue;
        }
      }
    }

    out += char;
    cursor += 1;
  }

  return out;
};

const applyHardBreaksToInlineMarkdown = (text: string): string =>
  linkBareUrlsInInlineMarkdown(text)
    .split('\n\n')
    .map(block => {
      const lines = block.split('\n');
      const tableLineIndexes = getMarkdownTableLineIndexes(block);
      return lines
        .map((line, index) => {
          if (index === lines.length - 1) return line;

          // A newline before another list marker is structural Markdown. A
          // hard-break marker would make the next item part of the previous
          // item, which breaks marker alignment and native height measurement.
          // GFM table rows are structural for the same reason — the delimiter
          // row only parses as a table when the line is left exactly as built.
          const nextLine = lines[index + 1] ?? '';
          const nextLineIsStructural =
            MARKDOWN_LIST_ITEM_PATTERN.test(nextLine) || tableLineIndexes.has(index + 1);
          const isStructural = nextLineIsStructural || tableLineIndexes.has(index);
          return line + (isStructural ? '\n' : '  \n');
        })
        .join('');
    })
    .join('\n\n');

const splitFencedCodeBlocks = (markdown: string): Array<{ text: string; fenced: boolean }> => {
  const segments: Array<{ text: string; fenced: boolean }> = [];
  const lines = markdown.split(/(\n)/);
  let buffer = '';
  let fenceBuffer = '';
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;

  const pushPlain = (): void => {
    if (!buffer) return;
    segments.push({ text: buffer, fenced: false });
    buffer = '';
  };

  const pushFence = (): void => {
    if (!fenceBuffer) return;
    segments.push({ text: fenceBuffer, fenced: true });
    fenceBuffer = '';
  };

  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index] ?? '';
    const newline = lines[index + 1] ?? '';
    const lineWithNewline = line + newline;
    const fenceMatch = line.match(FENCE_OPEN_LINE_PATTERN);

    if (!inFence && fenceMatch) {
      pushPlain();
      inFence = true;
      const marker = fenceMatch[1] ?? '';
      fenceChar = marker[0] ?? '';
      fenceLength = marker.length;
      fenceBuffer += lineWithNewline;
      continue;
    }

    if (inFence) {
      fenceBuffer += lineWithNewline;
      const closeMatch = line.match(FENCE_CLOSE_LINE_PATTERN);
      if (closeMatch) {
        const marker = closeMatch[1] ?? '';
        if ((marker[0] ?? '') === fenceChar && marker.length >= fenceLength) {
          inFence = false;
          fenceChar = '';
          fenceLength = 0;
          pushFence();
        }
      }
      continue;
    }

    buffer += lineWithNewline;
  }

  if (inFence) {
    buffer += fenceBuffer;
  } else {
    pushFence();
  }
  pushPlain();

  if (segments.length > 0) return segments;
  return [];
};

const endsWithFencedCodeBlock = (segments: Array<{ text: string; fenced: boolean }>): boolean => {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!segment || segment.text.trim().length === 0) continue;
    return segment.fenced;
  }

  return false;
};

/**
 * md4c treats a lone newline as a soft break (rendered as a space). Promote
 * single newlines outside fenced code blocks to CommonMark hard breaks.
 */
export function prepareChatMarkdownForMd4c(markdown: string): string {
  const normalizedMarkdown = markdown.replace(/\r\n?/g, '\n');
  if (
    !normalizedMarkdown.includes('\n') &&
    !normalizedMarkdown.includes('```') &&
    !normalizedMarkdown.includes('~~~')
  ) {
    return linkBareUrlsInInlineMarkdown(normalizedMarkdown);
  }

  const segments = splitFencedCodeBlocks(normalizedMarkdown);
  if (segments.length > 0) {
    const prepared = segments
      .map(segment =>
        segment.fenced ? segment.text : applyHardBreaksToInlineMarkdown(segment.text),
      )
      .join('');

    return endsWithFencedCodeBlock(segments)
      ? `${prepared}${NATIVE_CODE_BLOCK_END_GUARD}`
      : prepared;
  }

  return applyHardBreaksToInlineMarkdown(normalizedMarkdown);
}
