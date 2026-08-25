import { CustomEmojiRepository } from '@/database/repositories/customEmojiRepository';

const SHORTCODE_REGEX = /:([a-zA-Z0-9_+-]{1,50}):/g;

function isAsciiLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * True when `<` at `index` opens a tag: `<` followed by a letter, or by `/`
 * and then a letter. Same rule browsers use, so a bare `<` in alert text
 * (`latency < 200ms`) stays text — slack-to-html does not escape it.
 */
function isTagOpen(content: string, index: number): boolean {
  const next = content.charAt(index + 1);
  return isAsciiLetter(next === '/' ? content.charAt(index + 2) : next);
}

/**
 * Apply `mapText` to text content only, never to markup.
 *
 * `@clearfeed-ai/slack-to-html` expands a unicode emoji to
 * `<span title=":name:">&#x…;</span>`, i.e. it leaves a copy of the shortcode
 * inside an attribute value. Rewriting that copy would inject an `<img>` tag
 * into the attribute and break the surrounding element.
 *
 * Scans with `indexOf` rather than a tag-matching regex: `<[^>]*>` backtracks
 * quadratically on input like `<a<a<a…`, and message content is user supplied.
 * Every character here is visited once.
 */
function replaceInTextContent(content: string, mapText: (text: string) => string): string {
  let result = '';
  let cursor = 0;

  while (cursor < content.length) {
    const open = content.indexOf('<', cursor);

    if (open === -1) {
      result += mapText(content.slice(cursor));
      break;
    }

    if (!isTagOpen(content, open)) {
      // Bare `<` in text. Emit it as text and resume after it.
      result += mapText(content.slice(cursor, open + 1));
      cursor = open + 1;
      continue;
    }

    const close = content.indexOf('>', open);

    if (close === -1) {
      // No `>` left anywhere, so nothing from here on can be markup.
      result += mapText(content.slice(cursor));
      break;
    }

    if (open > cursor) result += mapText(content.slice(cursor, open));
    result += content.slice(open, close + 1); // markup, copied verbatim
    cursor = close + 1;
  }

  return result;
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
