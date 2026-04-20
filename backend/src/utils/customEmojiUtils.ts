import { CustomEmojiRepository } from '@/database/repositories/customEmojiRepository';

const SHORTCODE_REGEX = /:([a-zA-Z0-9_+-]{1,50}):/g;

/**
 * Build emoji img tag with relative path.
 * Full URL is constructed at render time by the client based on current environment.
 */
function buildEmojiImgTag(name: string, emoji: { id: string }): string {
  // Use relative path - client constructs full URL at render time
  // This ensures compatibility across web and desktop apps
  const src = `/api/emojis/${emoji.id}/stream`;
  return `<img src="${src}" alt=":${name}:" title="${name}" data-emoji="true" data-emoji-id="${emoji.id}" class="inline-emoji">`;
}

/**
 * Replace custom emoji shortcodes (e.g. :test:) with inline <img> tags
 * if the emoji exists in DB (`customEmoji` table).
 */
export async function replaceCustomEmojiShortcodesWithImg(content: string): Promise<string> {
  if (!content) return content;

  const names = Array.from(
    new Set(
      Array.from(content.matchAll(SHORTCODE_REGEX))
        .map((m) => m[1])
        .filter(Boolean),
    ),
  );

  if (names.length === 0) return content;

  const repo = new CustomEmojiRepository();
  const emojis = await repo.findManyByNames(names);

  if (emojis.length === 0) return content;

  const emojiByName = new Map(emojis.map((e) => [e.name, e]));

  return content.replace(SHORTCODE_REGEX, (full, name: string) => {
    const emoji = emojiByName.get(name);
    return emoji ? buildEmojiImgTag(name, emoji) : full;
  });
}
