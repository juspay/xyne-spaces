import { stripHtmlTags } from './htmlText';

const HTML_LINE_START = '(^|<br\\s*\\/?>|\\n)';
const HTML_LINE_INDENT = '((?:[ \\t]|&nbsp;)*)';
const HTML_LINE_MARKER_BOUNDARY = '(?=$|[ \\t]|&nbsp;|<br\\s*\\/?>|\\n)';
const UNORDERED_MARKDOWN_LIST_MARKER_IN_HTML_PARAGRAPH = new RegExp(
  `${HTML_LINE_START}${HTML_LINE_INDENT}([-+*])${HTML_LINE_MARKER_BOUNDARY}`,
  'gi',
);
const ORDERED_MARKDOWN_LIST_MARKER_IN_HTML_PARAGRAPH = new RegExp(
  `${HTML_LINE_START}${HTML_LINE_INDENT}(\\d{1,9})([.)])${HTML_LINE_MARKER_BOUNDARY}`,
  'gi',
);

const BLANK_PARAGRAPH_INNER_PATTERN = /^(?:\s|&nbsp;|<br\s*\/?>|\u200B|\uFEFF)*$/i;

const isBlankParagraphInnerHtml = (inner: string): boolean =>
  BLANK_PARAGRAPH_INNER_PATTERN.test(stripHtmlTags(inner));

const escapeMarkdownListMarkersInParagraphInnerHtml = (inner: string): string =>
  inner
    .replace(UNORDERED_MARKDOWN_LIST_MARKER_IN_HTML_PARAGRAPH, '$1$2\\$3')
    .replace(ORDERED_MARKDOWN_LIST_MARKER_IN_HTML_PARAGRAPH, '$1$2$3\\$4');

export function escapePlainTextMarkdownListMarkersInHtmlParagraphs(html: string): string {
  return html.replace(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi, (match, attrs = '', inner: string) => {
    if (isBlankParagraphInnerHtml(inner)) return match;
    return `<p${attrs}>${escapeMarkdownListMarkersInParagraphInnerHtml(inner)}</p>`;
  });
}
