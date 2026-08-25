import { CustomEmojiRepository } from '@/database/repositories/customEmojiRepository';

const SHORTCODE_REGEX = /:([a-zA-Z0-9_+-]{1,50}):/g;

/**
 * Splits HTML into tags (`<…>`) and the text between them.
 *
 * A tag must open with a letter or `/`, the same rule browsers use, so a bare
 * `<` in alert text (`latency < 200ms`) stays text — slack-to-html does not
 * escape it. Anything the regex does not match is copied through untouched.
 */
const HTML_TAG_OR_TEXT_REGEX = /<\/?[a-zA-Z][^>]*>|[^<]+/g;

/**
 * Apply `mapText` to text content only, never to markup.
 *
 * `@clearfeed-ai/slack-to-html` expands a unicode emoji to
 * `<span title=":name:">&#x…;</span>`, i.e. it leaves a copy of the shortcode
 * inside an attribute value. Rewriting that copy would inject an `<img>` tag
 * into the attribute and break the surrounding element.
 */
function replaceInTextContent(content: string, mapText: (text: string) => string): string {
  return content.replace(HTML_TAG_OR_TEXT_REGEX, (segment) =>
    segment.startsWith('<') ? segment : mapText(segment),
  );
}

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
 * Collect shortcode names that appear in text content, ignoring markup.
 */
function collectShortcodeNames(content: string): string[] {
  const names = new Set<string>();

  replaceInTextContent(content, (text) => {
    for (const match of text.matchAll(SHORTCODE_REGEX)) {
      if (match[1]) names.add(match[1]);
    }
    return text;
  });

  return Array.from(names);
}

/**
 * Replace custom emoji shortcodes (e.g. :test:) with inline <img> tags
 * if the emoji exists in DB (`customEmoji` table).
 */
export async function replaceCustomEmojiShortcodesWithImg(content: string): Promise<string> {
  if (!content) return content;

  const names = collectShortcodeNames(content);

  if (names.length === 0) return content;

  const repo = new CustomEmojiRepository();
  const emojis = await repo.findManyByNames(names);

  if (emojis.length === 0) return content;

  const emojiByName = new Map(emojis.map((e) => [e.name, e]));

  return replaceInTextContent(content, (text) =>
    text.replace(SHORTCODE_REGEX, (full, name: string) => {
      const emoji = emojiByName.get(name);
      return emoji ? buildEmojiImgTag(name, emoji) : full;
    }),
  );
}
