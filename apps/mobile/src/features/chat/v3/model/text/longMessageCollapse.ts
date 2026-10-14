/** §8.1 reuse gate: **Adopt**. Characterised against v2 longMessageCollapse. Hot path — measured in tests. */

import { stripMarkdownForPreview } from './markdownPreview';

const LONG_MESSAGE_VIEWPORT_RATIO = 0.46;
export const LONG_MESSAGE_MIN_COLLAPSED_LINES = 14;
export const LONG_MESSAGE_MAX_COLLAPSED_LINES = 18;
export const LONG_MESSAGE_LINE_BUFFER = 3;
export const LONG_MESSAGE_MIN_READABLE_CHARS = 650;
const ESTIMATED_BODY_CHAR_WIDTH = 7.3;
const MARKDOWN_LIST_ITEM_PATTERN = /^[ \t]{0,3}(?:[-+*]|\d+[.)])[ \t]+/;

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
  stripMarkdownForPreview(
    markdown.replace(/xemoji:[^:]+:([^:]*):emojix/g, (_, name: string) =>
      name ? `:${name}:` : '',
    ),
  );

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

const countMarkdownListItems = (markdown: string): number =>
  markdown.split('\n').filter(line => MARKDOWN_LIST_ITEM_PATTERN.test(line)).length;

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
  const isStructuredList = countMarkdownListItems(markdown) >= 2;
  const isClearlyTallBlock =
    explicitContentLineCount >= collapseThreshold ||
    (isStructuredList && estimatedLineCount >= collapseThreshold);

  return {
    shouldCollapse:
      estimatedLineCount >= collapseThreshold && (isClearlyLongText || isClearlyTallBlock),
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
