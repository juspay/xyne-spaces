import { hasCustomEmojiInComposerHtml } from '@/src/utils/customEmoji';
import { stripHtmlTags } from './htmlText';

/** True when paragraph inner HTML is only whitespace, nbsp, zwsp, and/or `<br>`. */
export function isBlankParagraphInnerHtml(inner: string): boolean {
  if (hasCustomEmojiInComposerHtml(inner)) return false;

  const withoutBreaks = inner.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, ' ');
  const withoutTags = stripHtmlTags(withoutBreaks);
  return withoutTags.replace(/[\u200B\uFEFF]/g, '').trim().length === 0;
}

/**
 * Convert remaining `<p>` / `<br>` in partial HTML to chat markdown line breaks.
 * Empty paragraphs (TipTap blank lines) → `\n\n`; content paragraphs → `\n`.
 */
export function convertParagraphsAndBreaksToMarkdown(html: string): string {
  let md = html.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_match, inner: string) => {
    if (isBlankParagraphInnerHtml(inner)) {
      return '\n\n';
    }
    return `${inner}\n`;
  });

  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(
    /<div\b[^>]*class=["'][^"']*(?:line[_-]break|break[_-]line)[^"']*["'][^>]*>\s*<\/div>/gi,
    '\n',
  );

  return md;
}

/** Collapse runs of 3+ newlines to a single blank line (`\n\n`). */
export function normalizeChatMarkdownNewlines(markdown: string): string {
  return markdown.replace(/\n{3,}/g, '\n\n');
}

export { prepareChatMarkdownForMd4c } from './markdownNativePreparation';
