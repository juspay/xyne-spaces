/**
 * §8.1 reuse gate: **Rewrite (pure port)**. v2 htmlToMD is entangled with Expo
 * (`customEmoji` → `config` → `expo-constants`) so it cannot enter model/. The
 * inline rich-HTML conversions are copied into the pure `htmlInlineToMarkdown`
 * helper; this module orchestrates them with list/paragraph/tag-strip cleanup so
 * message bodies keep mentions, custom emoji, code, and formatting.
 */
import { convertHtmlListsToMarkdown } from './htmlListsToMarkdown';
import { ensureSpacesBetweenMentionLinks, htmlInlineToMarkdown } from './htmlInlineToMarkdown';
import { decodeBasicEntities, stripHtmlTags } from '@/src/utils/htmlText';

export const EMOJI_PLACEHOLDER_PATTERN = /xemoji:([^:]+):([^:]*):emojix/g;

export const extractEmojiIds = (md: string): string[] => {
  if (!md) return [];
  const ids = new Set<string>();
  for (const match of md.matchAll(EMOJI_PLACEHOLDER_PATTERN)) {
    if (match[1]) ids.add(match[1]);
  }
  return Array.from(ids);
};

const INLINE_IMAGE_GUARD = '\u2060';

const escapeEmojiAltText = (value: string): string => value.replace(/[\\[\]]/g, '\\$&');

/**
 * Resolve Flow's opaque custom-emoji markers without changing the surrounding
 * markdown structure. A missing URI stays readable while the authenticated
 * resolver is in flight or has failed; a resolved URI becomes the same guarded
 * inline image form used by the native markdown renderer.
 */
export const replaceEmojiPlaceholders = (
  md: string,
  uriMap: Readonly<Record<string, string | null | undefined>>,
): string => {
  if (!md) return md;
  return md.replace(EMOJI_PLACEHOLDER_PATTERN, (_, emojiId: string, encodedName: string) => {
    let name: string;
    try {
      name = decodeURIComponent(encodedName);
    } catch {
      name = encodedName;
    }
    const safeName = name || emojiId;
    const uri = uriMap[emojiId];
    if (uri) {
      return `${INLINE_IMAGE_GUARD}![:${escapeEmojiAltText(safeName)}](${uri})`;
    }
    return `:${safeName}:`;
  });
};

export const htmlToMD = (html: string): string => {
  if (!html) return '';
  // Plain markdown / text with no tags and no leaked emoji shortcode: pass through.
  if (!html.includes('<') && !html.includes('custom:')) return html;

  let md = htmlInlineToMarkdown(html);
  md = convertHtmlListsToMarkdown(md);
  md = decodeBasicEntities(
    stripHtmlTags(
      md
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
        .replace(/<p[^>]*>/gi, '')
        .replace(/<\/p>/gi, '\n'),
    ),
  );
  md = ensureSpacesBetweenMentionLinks(md);
  return md.replace(/\n{3,}/g, '\n\n').trim();
};
