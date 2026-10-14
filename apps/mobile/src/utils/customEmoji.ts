import { API_BASE_URL } from '@/src/config';

import { hasCustomEmojiInComposerHtml } from './composerCustomEmojiHtml';
import { HTML_TAG_OR_EMPTY, stripHtmlTags } from './htmlText';

export { hasCustomEmojiInComposerHtml };

export function isCustomEmoji(emojiName: string): boolean {
  return emojiName.startsWith('custom:');
}

/** Same as dashboard: custom:{emojiId}:{name} (optional extra segments ignored) */
export function parseCustomEmoji(emojiName: string): { emojiId: string; name: string } | null {
  if (!isCustomEmoji(emojiName)) return null;
  const parts = emojiName.split(':');
  if (parts.length < 3 || !parts[1] || !parts[2]) return null;
  return { emojiId: parts[1], name: parts[2] };
}

export function customEmojiImageUri(emojiId: string): string {
  return `${API_BASE_URL}/emojis/${emojiId}/stream`;
}

/** Relative stream path stored in message HTML (same shape as backend / dashboard). */
export function customEmojiStreamPath(emojiId: string): string {
  return `/api/emojis/${emojiId}/stream`;
}

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/** Inline `<img>` for composer HTML — matches `backend/src/utils/customEmojiUtils.ts`. */
export function buildCustomEmojiImgHtml(emojiId: string, name: string): string {
  const safeName = escapeHtmlAttr(name);
  const src = escapeHtmlAttr(customEmojiStreamPath(emojiId));
  const safeId = escapeHtmlAttr(emojiId);
  return `<img src="${src}" alt=":${safeName}:" title="${safeName}" data-emoji="true" data-emoji-id="${safeId}" class="inline-emoji">`;
}

/** Plain-text fallback for `:name:` shortcode (composer text + send pipeline). */
export function customEmojiPlainText(name: string): string {
  return `:${name}:`;
}

function stripComposerHtmlForContentCheck(html: string): string {
  return stripHtmlTags(html.replace(/<br\s*\/?>/gi, '\n'), HTML_TAG_OR_EMPTY)
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

/** True when composer HTML has visible text and/or inline custom emoji images. */
export function composerHtmlHasSendableBody(html: string): boolean {
  if (!html.trim()) return false;
  if (hasCustomEmojiInComposerHtml(html)) return true;
  return stripComposerHtmlForContentCheck(html).length > 0;
}

/**
 * Parse dashboard, API stream, or native `file://` custom emoji `<img>` attributes.
 * Used when rendering messages that may contain legacy/broken send HTML.
 */
export function parseCustomEmojiFromImgAttrs(
  attrs: string,
): { emojiId: string; name: string } | null {
  const idMatch = /\bdata-emoji-id=["']([^"']+)["']/.exec(attrs);
  if (idMatch?.[1]) {
    const altMatch = /\balt=["']([^"']*)["']/.exec(attrs);
    const name = (altMatch?.[1] ?? '').replace(/^:|:$/g, '') || idMatch[1];
    return { emojiId: idMatch[1], name };
  }

  const fileSrcMatch = /\bsrc=["']file:\/\/[^"']*\/emojis\/([^/."]+)\.[^"']+["']/.exec(attrs);
  if (fileSrcMatch?.[1]) {
    const emojiId = fileSrcMatch[1];
    const altMatch = /\balt=["']([^"']*)["']/.exec(attrs);
    const name = (altMatch?.[1] ?? '').replace(/^:|:$/g, '') || emojiId;
    return { emojiId, name };
  }

  const apiSrcMatch = /\bsrc=["']\/api\/emojis\/([^/"']+)\/stream["']/.exec(attrs);
  if (apiSrcMatch?.[1]) {
    const emojiId = apiSrcMatch[1];
    const altMatch = /\balt=["']([^"']*)["']/.exec(attrs);
    const name = (altMatch?.[1] ?? '').replace(/^:|:$/g, '') || emojiId;
    return { emojiId, name };
  }

  return null;
}

const CUSTOM_EMOJI_SHORTCODE_REGEX = /:([a-zA-Z0-9_+-]{1,50}):/g;

/** Native enriched inline emoji: `file://…/emojis/{id}.{gif|png|…}` with width/height. */
const ENRICHED_CUSTOM_EMOJI_IMG_REGEX =
  /<img\b[^>]*\bsrc="file:\/\/[^"]*\/emojis\/([^/."]+)\.[^"]+"[^>]*\/?>/gi;

function collectCustomEmojiShortcodeNames(plainText: string): string[] {
  if (!plainText) return [];
  const names: string[] = [];
  for (const match of plainText.matchAll(CUSTOM_EMOJI_SHORTCODE_REGEX)) {
    if (match[1]) names.push(match[1]);
  }
  return names;
}

/**
 * Rewrite native composer `<img src="file://…/emojis/{id}.gif">` tags to dashboard
 * send HTML before persisting or sending. Matches any cached image extension.
 */
export function transformComposerCustomEmojiHtmlForSend(html: string, plainText = ''): string {
  if (!html) return html;

  const shortcodeNames = collectCustomEmojiShortcodeNames(plainText);
  let shortcodeIndex = 0;

  return html.replace(ENRICHED_CUSTOM_EMOJI_IMG_REGEX, (_, emojiId: string) => {
    const name = shortcodeNames[shortcodeIndex++] ?? emojiId;
    return buildCustomEmojiImgHtml(emojiId, name);
  });
}

/**
 * Replace a single native enriched custom emoji img with dashboard send HTML.
 * Prefer `transformComposerCustomEmojiHtmlForSend` when normalizing full documents.
 */
export function replaceEnrichedCustomEmojiImgForSend(
  html: string,
  emojiId: string,
  name: string,
): string {
  if (!html || !emojiId) return html;
  const escapedId = emojiId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<img\\b[^>]*\\bsrc="file://[^"]*\\/emojis\\/${escapedId}\\.[^"]+"[^>]*\\/?>`,
    'i',
  );
  return html.replace(pattern, buildCustomEmojiImgHtml(emojiId, name));
}

/** Label for filters / accessibility, e.g. ":plus1:" vs raw unicode */
export function reactionEmojiLabel(emojiName: string): string {
  const parsed = parseCustomEmoji(emojiName);
  if (parsed) return `:${parsed.name}:`;
  return emojiName;
}
