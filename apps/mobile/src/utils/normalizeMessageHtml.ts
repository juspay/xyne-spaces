/**
 * Normalize native composer HTML to the shape web TipTap stores before send.
 *
 * Web blank lines = empty `<p></p>` (never `<p><br></p>` or bare `<br>` between blocks).
 * This module is idempotent on HTML that already came from TipTap.
 */

import { hasCustomEmojiInComposerHtml } from '@/src/utils/customEmoji';
import { stripHtmlTags } from './htmlText';

const PARAGRAPH_TAG_REGEX = /<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi;
const BR_BETWEEN_PARAGRAPHS_REGEX = /<\/p>(\s*(?:<br\s*\/?>\s*)+)(<p[^>]*>)/gi;
const BLOCK_CLOSE_TAG = 'p|ul|ol|blockquote|pre|codeblock|h[1-6]|div';
const BR_BETWEEN_BLOCKS_REGEX = new RegExp(
  `<\\/(${BLOCK_CLOSE_TAG})>(\\s*(?:<br\\s*\\/?>\\s*)+)(?=<(?:${BLOCK_CLOSE_TAG}|ul|ol|li|blockquote|pre|h[1-6])\\b)`,
  'gi',
);
const BR_BETWEEN_LIST_ITEMS_REGEX = /<\/li>(\s*(?:<br\s*\/?>\s*)+)(?=<li\b)/gi;
const BR_BEFORE_LIST_CLOSE_REGEX = /<\/li>(\s*(?:<br\s*\/?>\s*)+)(?=<\/(?:ul|ol)>)/gi;
const BR_AFTER_LIST_OPEN_REGEX = /<ul(\s[^>]*)?>(\s*(?:<br\s*\/?>\s*)+)(?=<li\b)/gi;
const BR_AFTER_OL_OPEN_REGEX = /<ol(\s[^>]*)?>(\s*(?:<br\s*\/?>\s*)+)(?=<li\b)/gi;
const BR_BEFORE_BLOCK_CLOSE_REGEX = /(\s*(?:<br\s*\/?>\s*)+)(?=<\/(?:ul|ol|blockquote)>)/gi;
const LEADING_TRAILING_BR_REGEX = /^(\s*(?:<br\s*\/?>\s*)+)|(\s*(?:<br\s*\/?>\s*)+)$/gi;
const BLOCKQUOTE_BR_ONLY_REGEX = /<blockquote(\s[^>]*)?>(\s*(?:<br\s*\/?>\s*)+)<\/blockquote>/gi;

const emptyParagraphTag = (attrs?: string): string => (attrs ? `<p${attrs}></p>` : '<p></p>');

const countBrTags = (fragment: string): number => (fragment.match(/<br\b/gi) ?? []).length;

const emptyParagraphs = (count: number, attrs?: string): string =>
  emptyParagraphTag(attrs).repeat(Math.max(1, count));

/** True when paragraph inner HTML is only whitespace, nbsp, zwsp, and/or `<br>`. */
const isBlankParagraphInner = (inner: string): boolean => {
  if (hasCustomEmojiInComposerHtml(inner)) return false;

  const withoutBreaks = inner.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, ' ');
  const withoutTags = stripHtmlTags(withoutBreaks);
  return withoutTags.replace(/[\u200B\uFEFF]/g, '').trim().length === 0;
};

const normalizeParagraphMatch = (match: string, attrs?: string, inner?: string): string => {
  const content = inner ?? '';

  if (isBlankParagraphInner(content)) {
    const brCount = countBrTags(content);
    return brCount > 0 ? emptyParagraphs(brCount, attrs) : emptyParagraphTag(attrs);
  }

  const leadingBr = content.match(/^(\s*(?:<br\s*\/?>\s*)+)/i);
  const leadingBrSection = leadingBr?.[1];
  if (leadingBrSection) {
    const remainder = content.slice(leadingBrSection.length);
    if (remainder.trim().length > 0 && !isBlankParagraphInner(remainder)) {
      const brCount = countBrTags(leadingBrSection);
      const open = attrs ? `<p${attrs}>` : '<p>';
      return `${emptyParagraphs(brCount, attrs)}${open}${remainder}</p>`;
    }
  }

  return match;
};

const replaceBrBetweenParagraphs = (
  _match: string,
  brSection: string,
  nextParagraphOpen: string,
): string => `</p>${emptyParagraphs(countBrTags(brSection))}${nextParagraphOpen}`;

const replaceBrBetweenBlocks = (_match: string, closeTag: string, brSection: string): string =>
  `</${closeTag}>${emptyParagraphs(countBrTags(brSection))}`;

const replaceBlockquoteBrOnly = (
  _match: string,
  attrs: string | undefined,
  brSection: string,
): string => `<blockquote${attrs ?? ''}>${emptyParagraphs(countBrTags(brSection))}</blockquote>`;

const normalizeLeadingTrailingBr = (html: string): string =>
  html.replace(LEADING_TRAILING_BR_REGEX, (_match, leading?: string, trailing?: string) => {
    const section = leading ?? trailing ?? '';
    return emptyParagraphs(countBrTags(section));
  });

/** Native sometimes wraps blocks in a single `<div>`; TipTap stores blocks at the root. */
const unwrapSingleDivWrapper = (html: string): string => {
  const trimmed = html.trim();
  const simpleDiv = trimmed.match(/^<div(\s[^>]*)?>([\s\S]*)<\/div>$/i);
  if (!simpleDiv) return html;
  const inner = simpleDiv[2]?.trim() ?? '';
  if (!/^<(?:p|ul|ol|blockquote|pre|codeblock|h[1-6])\b/i.test(inner)) {
    return html;
  }
  if (/<\/div>/i.test(inner)) {
    return html;
  }
  return inner;
};

const applyStructuralNormalizations = (html: string): string => {
  let result = html;

  result = unwrapSingleDivWrapper(result);

  result = result.replace(PARAGRAPH_TAG_REGEX, normalizeParagraphMatch);
  result = result.replace(BR_BETWEEN_PARAGRAPHS_REGEX, replaceBrBetweenParagraphs);
  result = result.replace(BR_BETWEEN_BLOCKS_REGEX, replaceBrBetweenBlocks);
  result = result.replace(BR_BETWEEN_LIST_ITEMS_REGEX, '</li>');
  result = result.replace(BR_BEFORE_LIST_CLOSE_REGEX, '</li>');
  result = result.replace(BR_AFTER_LIST_OPEN_REGEX, '<ul$1>');
  result = result.replace(BR_AFTER_OL_OPEN_REGEX, '<ol$1>');
  result = result.replace(BR_BEFORE_BLOCK_CLOSE_REGEX, '');
  result = result.replace(BLOCKQUOTE_BR_ONLY_REGEX, replaceBlockquoteBrOnly);
  result = normalizeLeadingTrailingBr(result);

  return result;
};

/**
 * Normalize rich message HTML from react-native-enriched before persisting.
 */
export function normalizeMessageHtmlForSend(html: string): string {
  if (typeof html !== 'string') return '';
  let result = html.trim();
  if (result.length === 0) return '';

  result = applyStructuralNormalizations(result);
  result = applyStructuralNormalizations(result);

  result = result.replace(/>\s+</g, '><');

  return result;
}
