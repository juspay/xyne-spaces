// emojiLookup.ts
import type { EmojiPickerEmoji } from '../hooks/useCustomEmojis';
import emojiData from 'emoji-datasource/emoji.json';

export const findCustomEmoji = (
  name: string,
  customEmojis: EmojiPickerEmoji[] | null | undefined,
) => {
  if (!name || !customEmojis?.length) return undefined;
  return customEmojis.find(e => e.names?.includes(name));
};

export const findUnicodeEmoji = (name: string) => {
  if (!name) return undefined;
  const emoji = emojiData.find(e => e.short_names?.includes(name.toLowerCase()));
  if (!emoji) return undefined;
  return { unified: emoji.unified };
};

/**
 * Lookup map from ASCII text emoticons (e.g. ":)", ":(", ":D") to their unified
 * Unicode code point string. Built once from emoji-datasource/emoji.json using the
 * `text` and `texts` fields.  Longer emoticons are added first so that more-specific
 * matches win when the lookup map is consulted.
 */
const textEmoticonMap: Map<string, string> = (() => {
  type EmojiEntry = {
    unified: string;
    text?: string | null;
    texts?: string[] | null;
  };

  // Collect all (emoticon, unified) pairs
  const pairs: Array<{ text: string; unified: string }> = [];
  (emojiData as EmojiEntry[]).forEach(entry => {
    if (!entry.unified) return;
    const candidates: string[] = [];
    if (entry.text) candidates.push(entry.text);
    if (Array.isArray(entry.texts)) {
      entry.texts.forEach(t => {
        if (t) candidates.push(t);
      });
    }
    candidates.forEach(t => {
      pairs.push({ text: t, unified: entry.unified });
    });
  });

  // Sort longest-first so that more specific emoticons (e.g. ":-)") win over ":)"
  pairs.sort((a, b) => b.text.length - a.text.length);

  const map = new Map<string, string>();
  pairs.forEach(({ text, unified }) => {
    if (!map.has(text)) {
      map.set(text, unified);
    }
  });
  return map;
})();

/**
 * Returns the unified code point string for a text emoticon (e.g. ":)" → "1F603"),
 * or undefined if not found.
 */
export const findEmojiByText = (text: string): { unified: string } | undefined => {
  if (!text) return undefined;
  const unified = textEmoticonMap.get(text);
  if (!unified) return undefined;
  return { unified };
};

/**
 * Returns all registered text emoticon strings (e.g. [":)", ":(", ":D", ...]).
 * Used by the TipTap extension to build the input-rule regex.
 */
export const getTextEmoticons = (): string[] => Array.from(textEmoticonMap.keys());
/** Convert a unified code string like "1F603" or "2764-FE0F" to an emoji character */
function unifiedToEmoji(unified: string): string {
  return unified
    .split('-')
    .map(code => String.fromCodePoint(parseInt(code, 16)))
    .join('');
}

/**
 * Replaces text emoticons that appear at the end of HTML text nodes with their
 * corresponding emoji characters. This handles the case where a user types an
 * emoticon at the end of a message and presses Enter (no trailing space).
 */
export const convertTrailingEmoticonsInHtml = (html: string): string => {
  const emoticons = getTextEmoticons();
  if (emoticons.length === 0) return html;

  const sorted = [...emoticons].sort((a, b) => b.length - a.length);
  const escaped = sorted.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})\\s*$`);

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  for (const node of textNodes) {
    const text = node.textContent || '';
    const match = regex.exec(text);
    if (!match) continue;

    const emoticonText = match[1];
    if (!emoticonText) continue;
    const result = findEmojiByText(emoticonText);
    if (!result) continue;

    const emojiChar = unifiedToEmoji(result.unified);
    node.textContent =
      text.slice(0, match.index) + emojiChar + text.slice(match.index + emoticonText.length);
  }

  return doc.body.innerHTML;
};
