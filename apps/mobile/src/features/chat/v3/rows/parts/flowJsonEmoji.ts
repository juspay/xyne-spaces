import { ORDERED_EMOJIS } from '@/src/components/emoji-picker/emoji-picker.data';

export const STANDARD_FLOW_EMOJIS = new Map<string, string>(
  ORDERED_EMOJIS.flatMap(emoji => [
    [emoji.name, emoji.emoji],
    [emoji.slug, emoji.emoji],
  ]),
);

const customEmojiMapCache = new WeakMap<object, Map<string, { id: string; name: string }>>();

export const getCachedCustomEmojis = (
  emojis: readonly { id: string; name: string }[],
): Map<string, { id: string; name: string }> => {
  const cached = customEmojiMapCache.get(emojis);
  if (cached) return cached;
  const map = new Map(emojis.map(emoji => [emoji.name, { id: emoji.id, name: emoji.name }]));
  customEmojiMapCache.set(emojis, map);
  return map;
};
