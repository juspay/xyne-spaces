// emojiLookup.ts
import type { EmojiPickerEmoji } from '../hooks/useCustomEmojis';
import type { EmojiDatasourceEntry } from 'emoji-datasource/emoji.json';

let emojiDataCache: EmojiDatasourceEntry[] | null = null;
let emojiDataPromise: Promise<void> | null = null;
let nativeEmojiNames: Map<string, string> | null = null;

const normalizeNativeEmoji = (emoji: string): string =>
  [...emoji]
    .filter(character => {
      const codePoint = character.codePointAt(0);
      return codePoint !== 0xfe0f && !(codePoint && codePoint >= 0x1f3fb && codePoint <= 0x1f3ff);
    })
    .join('');

export const unifiedToEmoji = (unified: string): string =>
  unified
    .split('-')
    .map(code => String.fromCodePoint(parseInt(code, 16)))
    .join('');

const UNIFIED_PATTERN = /^[0-9a-f]{4,6}(-[0-9a-f]{4,6})*$/i;

const ensureEmojiData = (): Promise<void> => {
  if (emojiDataCache) return Promise.resolve();

  emojiDataPromise ??= import('emoji-datasource/emoji.json').then(m => {
    emojiDataCache = m.default;
    nativeEmojiNames = new Map(
      emojiDataCache.map(entry => [
        normalizeNativeEmoji(unifiedToEmoji(entry.unified)),
        entry.short_name,
      ]),
    );
  });

  return emojiDataPromise;
};

/** Trigger lazy load of emoji data so it's ready for sync lookups. */
export function preloadEmojiData(): void {
  void ensureEmojiData();
}

/** Load emoji metadata and resolve once sync native-emoji name lookups are ready. */
export const loadEmojiData = (): Promise<void> => ensureEmojiData();

/** Synchronous check for whether the emoji-datasource cache is already populated. */
export const isEmojiDataReady = (): boolean => emojiDataCache !== null;

/** Convert a native Unicode emoji to its canonical shortcode name. */
export const findUnicodeEmojiName = (emoji: string): string | undefined =>
  nativeEmojiNames?.get(normalizeNativeEmoji(emoji));

/** Same as findUnicodeEmojiName, keyed by a unified id (e.g. "1f917") instead of the character. */
export const findUnicodeEmojiNameByUnified = (unified: string): string | undefined =>
  UNIFIED_PATTERN.test(unified) ? findUnicodeEmojiName(unifiedToEmoji(unified)) : undefined;

export const findCustomEmoji = (
  name: string,
  customEmojis: EmojiPickerEmoji[] | null | undefined,
) => {
  if (!name || !customEmojis?.length) return undefined;
  return customEmojis.find(e => e.names?.includes(name));
};

export const findUnicodeEmoji = (name: string) => {
  if (!name || !emojiDataCache) return undefined;
  const emoji = emojiDataCache.find(e => e.short_names.includes(name.toLowerCase()));
  if (!emoji) return undefined;
  return { unified: emoji.unified };
};

/**
 * Lookup map from ASCII text emoticons (e.g. ":)", ":(", ":D") to their unified
 * Unicode code point string. Built lazily from emojiDataCache using the `text` and
 * `texts` fields. Longer emoticons are added first so that more-specific matches win.
 */
type EmojiEntryWithText = {
  unified: string;
  text?: string | null;
  texts?: string[] | null;
};

let textEmoticonMap: Map<string, string> | null = null;

function getTextEmoticonMap(): Map<string, string> {
  if (textEmoticonMap) return textEmoticonMap;
  if (!emojiDataCache) return new Map();

  const pairs: Array<{ text: string; unified: string }> = [];
  (emojiDataCache as EmojiEntryWithText[]).forEach(entry => {
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
  textEmoticonMap = map;
  return textEmoticonMap;
}

/**
 * Returns the unified code point string for a text emoticon (e.g. ":)" → "1F603"),
 * or undefined if not found.
 */
export const findEmojiByText = (text: string): { unified: string } | undefined => {
  if (!text) return undefined;
  const unified = getTextEmoticonMap().get(text);
  if (!unified) return undefined;
  return { unified };
};

/**
 * Returns all registered text emoticon strings (e.g. [":)", ":(", ":D", ...]).
 * Used by the TipTap extension to build the input-rule regex.
 */
export const getTextEmoticons = (): string[] => Array.from(getTextEmoticonMap().keys());
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
  const regex = new RegExp(`(?<!\\w)(${escaped.join('|')})\\s*$`);

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
