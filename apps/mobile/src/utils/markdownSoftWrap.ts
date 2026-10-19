const SOFT_BREAK = '\u200B';
const MAX_UNBROKEN_CODE_RUN = 48;
const LONG_CODE_RUN = 72;

const FENCE_LINE_PATTERN = /^\s*(`{3,}|~{3,})/;
const INDENTED_CODE_LINE_PATTERN = /^(?: {4,}|\t+)(?=\S)/m;

const insertSoftBreaks = (value: string): string => {
  if (value.length <= LONG_CODE_RUN) return value;

  let result = '';
  let charsSinceBreak = 0;

  for (const char of value) {
    result += char;
    charsSinceBreak += 1;

    if (charsSinceBreak >= MAX_UNBROKEN_CODE_RUN) {
      result += SOFT_BREAK;
      charsSinceBreak = 0;
    }
  }

  return result;
};

const softWrapCodeLine = (line: string): string => line.replace(/\S{73,}/g, insertSoftBreaks);

export const softWrapLongCodeFenceLines = (markdown: string): string => {
  if (
    !markdown.includes('```') &&
    !markdown.includes('~~~') &&
    !INDENTED_CODE_LINE_PATTERN.test(markdown)
  ) {
    return markdown;
  }

  const lines = markdown.split('\n');
  let inFence = false;
  let fenceMarker = '';

  return lines
    .map(line => {
      const fenceMatch = line.match(FENCE_LINE_PATTERN);
      if (fenceMatch) {
        const marker = fenceMatch[1] ?? '';
        if (!inFence) {
          inFence = true;
          fenceMarker = marker[0] ?? '';
        } else if ((marker[0] ?? '') === fenceMarker) {
          inFence = false;
          fenceMarker = '';
        }
        return line;
      }

      return inFence || INDENTED_CODE_LINE_PATTERN.test(line) ? softWrapCodeLine(line) : line;
    })
    .join('\n');
};
