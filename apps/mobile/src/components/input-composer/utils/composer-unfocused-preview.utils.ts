import {
  formatMentionDisplay,
  resolveUserMentionNameFromNativeAttrs,
  type MentionIndicator,
} from '@/src/utils/mentionLabelUtils';

import { decodeHtmlEntities } from './html-plain-text';
import { stripHtmlTags } from '@/src/utils/htmlText';

export type ComposerUnfocusedPreviewSegment =
  { type: 'text'; value: string } | { type: 'mention'; label: string };

const MENTION_TAG_REGEX = /<mention\b([^>]*)>([\s\S]*?)<\/mention>/gi;

const parseAttrs = (attrString: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  const pairRegex = /([\w-]+)\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(attrString)) !== null) {
    attrs[match[1] ?? ''] = match[2] ?? '';
  }
  return attrs;
};

const decodePreviewText = (value: string): string => decodeHtmlEntities(value);

const normalizeComposerHtmlForPreview = (html: string): string => {
  let body = html.trim();
  body = body.replace(/^<html\b[^>]*>\s*/i, '').replace(/\s*<\/html>$/i, '');
  body = body.replace(/^<body\b[^>]*>\s*/i, '').replace(/\s*<\/body>$/i, '');
  body = body.replace(/<br\s*\/?>/gi, ' ');
  body = body.replace(/<\/p>\s*<p\b[^>]*>/gi, ' ');
  body = body.replace(/<\/?p\b[^>]*>/gi, '');
  body = body.replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*\/?>/gi, (_, alt: string) =>
    decodePreviewText(alt),
  );
  return body;
};

const normalizeInlineFragment = (fragment: string): string =>
  decodePreviewText(stripHtmlTags(fragment))
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ');

const finalizePreviewSegments = (
  segments: ComposerUnfocusedPreviewSegment[],
): ComposerUnfocusedPreviewSegment[] => {
  if (segments.length === 0) return segments;

  const result = segments.map(segment => ({ ...segment }));
  const first = result[0];
  if (first?.type === 'text') {
    first.value = first.value.trimStart();
  }

  const last = result[result.length - 1];
  if (last?.type === 'text') {
    last.value = last.value.trimEnd();
  }

  for (let index = 0; index < result.length - 1; index += 1) {
    const current = result[index];
    const next = result[index + 1];
    if (!current || !next) continue;

    if (current.type === 'mention' && next.type === 'text' && next.value[0] !== ' ') {
      next.value = ` ${next.value}`;
    }

    if (current.type === 'text' && next.type === 'mention' && current.value.at(-1) !== ' ') {
      current.value = `${current.value} `;
    }
  }

  return result.filter(segment => segment.type === 'mention' || segment.value.length > 0);
};

const mentionLabelFromTag = (attrs: Record<string, string>, inner: string): string => {
  const indicator: MentionIndicator = attrs['indicator'] === '#' ? '#' : '@';
  if (indicator === '#') {
    const channelName = attrs['data-channel-name'] ?? decodePreviewText(inner);
    return formatMentionDisplay(channelName, '#');
  }

  const userName = resolveUserMentionNameFromNativeAttrs(attrs, decodePreviewText(inner));
  return formatMentionDisplay(userName, '@');
};

/** Parse composer HTML into a single-line preview with styled mention segments. */
export const parseComposerHtmlToUnfocusedPreviewSegments = (
  html: string,
  fallbackText = '',
): ComposerUnfocusedPreviewSegment[] => {
  const normalizedHtml = normalizeComposerHtmlForPreview(html);
  if (!normalizedHtml.trim()) {
    const fallback = fallbackText.trim();
    return fallback.length > 0 ? [{ type: 'text', value: fallback }] : [];
  }

  const segments: ComposerUnfocusedPreviewSegment[] = [];
  let lastIndex = 0;
  const mentionRegex = new RegExp(MENTION_TAG_REGEX.source, 'gi');
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(normalizedHtml)) !== null) {
    const before = normalizedHtml.slice(lastIndex, match.index);
    if (before.length > 0) {
      const normalizedBefore = normalizeInlineFragment(before);
      if (normalizedBefore.length > 0) {
        segments.push({ type: 'text', value: normalizedBefore });
      }
    }

    const attrs = parseAttrs(match[1] ?? '');
    const inner = match[2] ?? '';
    segments.push({
      type: 'mention',
      label: mentionLabelFromTag(attrs, inner),
    });
    lastIndex = match.index + match[0].length;
  }

  const trailing = normalizeInlineFragment(normalizedHtml.slice(lastIndex));
  if (trailing.length > 0) {
    segments.push({ type: 'text', value: trailing });
  }

  if (segments.length > 0) {
    return finalizePreviewSegments(segments);
  }

  const plainFallback = fallbackText.trim();
  return plainFallback.length > 0 ? [{ type: 'text', value: plainFallback }] : [];
};
