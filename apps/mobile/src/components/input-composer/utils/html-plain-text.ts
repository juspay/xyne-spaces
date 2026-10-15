import { HTML_TAG_OR_EMPTY, stripHtmlTags } from '@/src/utils/htmlText';

export const decodeHtmlEntities = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => {
      const value = Number.parseInt(hex, 16);
      return value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    })
    .replace(/&#([0-9]+);/g, (match, decimal: string) => {
      const value = Number.parseInt(decimal, 10);
      return value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(?:apos|#39);/gi, "'")
    .replace(/&amp;/gi, '&');

/** Strip HTML to plain text for composer seeding (draft / edit), preserving block breaks. */
export const stripHtmlForPlainText = (html: string): string => {
  const withoutDocumentWrapper = html
    .trim()
    .replace(/^<html\b[^>]*>\s*/i, '')
    .replace(/\s*<\/html>$/i, '')
    .replace(/^<body\b[^>]*>\s*/i, '')
    .replace(/\s*<\/body>$/i, '');

  const withBlockBreaks = withoutDocumentWrapper
    // Message list items contain a paragraph wrapper; let </li> add the one line break.
    .replace(/<li\b[^>]*>\s*<p\b[^>]*>/gi, '<li>')
    .replace(/<\/p>\s*<\/li>/gi, '</li>')
    // The native editor needs <p><br></p> to retain an empty paragraph. Treat it
    // as one empty block here so the <br> and </p> do not produce two blank lines.
    .replace(/<p\b[^>]*>\s*<br\s*\/?>\s*<\/p>/gi, '<p></p>')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|pre|codeblock)>/gi, '\n');

  const plainText = stripHtmlTags(withBlockBreaks, HTML_TAG_OR_EMPTY)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n');

  // Closing the final block introduces one structural newline. Keep any additional
  // newline because it represents an intentional trailing blank line.
  return decodeHtmlEntities(plainText).replace(/\n$/, '');
};
