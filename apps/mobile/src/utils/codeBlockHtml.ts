import { decodeHtmlEntities, stripHtmlTags } from './htmlText';

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function codeBlockHtmlToEscapedText(innerHtml: string): string {
  const text = decodeHtmlEntities(
    stripHtmlTags(
      innerHtml
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
        .replace(/<p[^>]*>/gi, '')
        .replace(/<\/p>/gi, '\n'),
    ),
  ).trim();

  return escapeHtml(text);
}
