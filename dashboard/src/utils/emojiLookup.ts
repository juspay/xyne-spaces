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
