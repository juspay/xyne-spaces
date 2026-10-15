import { decodeBasicEntities, stripHtmlTags } from './htmlText';

function parseSpanAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pairRegex = /(\w+(?:-\w+)*)\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(attrStr)) !== null) {
    attrs[match[1] ?? ''] = match[2] ?? '';
  }
  return attrs;
}

function spanInnerToPlainText(inner: string): string {
  return decodeBasicEntities(stripHtmlTags(inner)).trim();
}

function escapeMarkdownLinkLabel(s: string): string {
  return s.replace(/[\\\]]/g, '\\$&').replace(/`/g, '');
}

function withMentionPrefix(label: string, prefix: '@' | '#'): string {
  const trimmed = label.trim();
  if (!trimmed) return prefix;
  return trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`;
}

function pickLongerName(attrName: string, innerName: string): string {
  const a = attrName.trim();
  const i = innerName.trim();
  if (!a) return i;
  if (!i) return a;
  return a.length >= i.length ? a : i;
}

export function formatMentionMarkdownLink(label: string, url: string): string {
  return `[${escapeMarkdownLinkLabel(label)}](${url})`;
}

/** Next token is a xyne mention / broadcast markdown link. */
const NEXT_MENTION_LINK = '(?=\\[[^\\]]*\\]\\(xyne:\\/\\/)';

/**
 * EnrichedMarkdownText draws adjacent `[mention](xyne://…)` links flush (no span padding).
 * Insert a space when stored HTML had back-to-back mention spans with no text node between.
 */
export function ensureSpacesBetweenMentionLinks(markdown: string): string {
  if (!markdown) return markdown;
  return markdown
    .replace(new RegExp(`\\)${NEXT_MENTION_LINK}`, 'g'), ') ')
    .replace(new RegExp(`,${NEXT_MENTION_LINK}`, 'g'), ', ');
}

/** Opening tag for dashboard or native-enriched mention elements. */
const MENTION_OPEN_TAG =
  '<(?:span|mention)\\b[^>]*\\b(?:data-mention(?:\\s*=|-)|data-channel-mention(?:\\s*=|-))';

/**
 * Persist visible gaps between consecutive mentions. Runs after normalizeMessageHtmlForSend,
 * which collapses `>\s+<` and would otherwise store flush `</span><span>` pairs.
 * `&nbsp;` survives sanitization and renders on web; native bubbles also read it via htmlToMD.
 */
export function ensureSpacesBetweenMentionSpans(html: string): string {
  if (!html) return html;
  return html
    .replace(new RegExp(`<\\/mention>(?=${MENTION_OPEN_TAG})`, 'gi'), '</mention>&nbsp;')
    .replace(new RegExp(`<\\/span>(?=${MENTION_OPEN_TAG})`, 'gi'), '</span>&nbsp;');
}

export function userMentionLabelFromSpan(attrs: string, inner: string): string {
  const parsed = parseSpanAttrs(attrs);
  const fromAttr = decodeBasicEntities(parsed['data-username'] ?? '');
  const fromInner = spanInnerToPlainText(inner).replace(/^@/, '');
  return withMentionPrefix(pickLongerName(fromAttr, fromInner), '@');
}

export function channelMentionLabelFromSpan(attrs: string, inner: string): string {
  const parsed = parseSpanAttrs(attrs);
  const fromAttr = decodeBasicEntities(parsed['data-channel-name'] ?? '');
  const fromInner = spanInnerToPlainText(inner).replace(/^#/, '');
  return withMentionPrefix(pickLongerName(fromAttr, fromInner), '#');
}

export function groupMentionLabelFromSpan(attrs: string, inner: string): string {
  const parsed = parseSpanAttrs(attrs);
  const alias = decodeBasicEntities(parsed['data-group-alias'] ?? '');
  const name = decodeBasicEntities(parsed['data-group-name'] ?? '');
  const fromAttr = alias || name;
  const fromInner = spanInnerToPlainText(inner).replace(/^@/, '');
  return withMentionPrefix(pickLongerName(fromAttr, fromInner), '@');
}
