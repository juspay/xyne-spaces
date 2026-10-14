const LONG_MESSAGE_VIEWPORT_RATIO = 0.46;
const LONG_MESSAGE_MIN_COLLAPSED_LINES = 14;
const LONG_MESSAGE_MAX_COLLAPSED_LINES = 18;
const LONG_MESSAGE_LINE_BUFFER = 3;
const LONG_MESSAGE_MIN_READABLE_CHARS = 650;
const ESTIMATED_BODY_CHAR_WIDTH = 7.3;
const FENCED_CODE_BLOCK_PATTERN = /```|~~~/;
const INDENTED_CODE_BLOCK_PATTERN = /^(?: {4,}|\t+)(?=\S)/m;

type LongMessageCollapseArgs = {
  markdown: string;
  maxWidth: number;
  viewportHeight: number;
};

export type LongMessageCollapseModel = {
  shouldCollapse: boolean;
  collapsedNumberOfLines: number;
  estimatedLineCount: number;
  readableCharacterCount: number;
};

type CollapsibleMessageKind = 'BOT' | 'SYSTEM' | string;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const markdownToCollapsedPreviewText = (markdown: string): string =>
  markdown
    .replace(/xemoji:[^:]+:([^:]*):emojix/g, (_, name: string) => (name ? `:${name}:` : ''))
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`{1,3}/g, '')
    .replace(/^\s{0,3}[-+*]\s+/gm, '• ')
    .replace(/^\s{0,3}\d+[.)]\s+/gm, '• ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[*_~#|]/g, '');

const countReadableCharacters = (readableText: string): number =>
  readableText.replace(/\s+/g, ' ').trim().length;

const countExplicitContentLines = (readableText: string): number =>
  readableText.split('\n').filter(line => line.trim().length > 0).length;

const estimateMarkdownLineCount = (readableText: string, maxWidth: number): number => {
  const charsPerLine = Math.max(18, Math.floor(maxWidth / ESTIMATED_BODY_CHAR_WIDTH));
  const lines = readableText.split('\n');

  return lines.reduce((total, line) => {
    const trimmedLength = line.trimEnd().length;
    if (trimmedLength === 0) return total + 1;
    return total + Math.max(1, Math.ceil(trimmedLength / charsPerLine));
  }, 0);
};

const hasCodeBlock = (markdown: string): boolean =>
  FENCED_CODE_BLOCK_PATTERN.test(markdown) || INDENTED_CODE_BLOCK_PATTERN.test(markdown);

export const getLongMessageCollapseModel = ({
  markdown,
  maxWidth,
  viewportHeight,
}: LongMessageCollapseArgs): LongMessageCollapseModel => {
  const collapsedNumberOfLines = clamp(
    Math.floor((viewportHeight * LONG_MESSAGE_VIEWPORT_RATIO) / 20),
    LONG_MESSAGE_MIN_COLLAPSED_LINES,
    LONG_MESSAGE_MAX_COLLAPSED_LINES,
  );
  const readableText = markdownToCollapsedPreviewText(markdown);
  const readableCharacterCount = countReadableCharacters(readableText);
  const explicitContentLineCount = countExplicitContentLines(readableText);
  const estimatedLineCount = estimateMarkdownLineCount(readableText, maxWidth);
  const collapseThreshold = collapsedNumberOfLines + LONG_MESSAGE_LINE_BUFFER;
  const isClearlyLongText = readableCharacterCount >= LONG_MESSAGE_MIN_READABLE_CHARS;
  const isClearlyTallBlock = explicitContentLineCount >= collapseThreshold;
  const shouldPreserveCodeBlock = hasCodeBlock(markdown);

  return {
    shouldCollapse:
      !shouldPreserveCodeBlock &&
      estimatedLineCount >= collapseThreshold &&
      (isClearlyLongText || isClearlyTallBlock),
    collapsedNumberOfLines,
    estimatedLineCount,
    readableCharacterCount,
  };
};

export const shouldCollapseMessageBody = (
  model: LongMessageCollapseModel,
  kind?: CollapsibleMessageKind,
): boolean => {
  if (model.shouldCollapse) return true;
  if (kind !== 'BOT' && kind !== 'SYSTEM') return false;
  return model.estimatedLineCount >= model.collapsedNumberOfLines + LONG_MESSAGE_LINE_BUFFER;
};
