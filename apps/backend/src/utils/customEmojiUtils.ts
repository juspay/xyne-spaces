import { CustomEmojiRepository } from '@/database/repositories/customEmojiRepository';

const SHORTCODE_REGEX = /:([a-zA-Z0-9_+-]{1,50}):/g;

/**
 * Regions where a `:shortcode:` must NEVER be treated as an emoji, because the
 * text is meant to be literal:
 *   - fenced markdown code blocks   ```...```
 *   - inline markdown code spans    `...`
 *   - HTML <pre>...</pre> blocks
 *   - HTML <code>...</code> spans
 *
 * Substituting inside these corrupts literal content — e.g. an ARN written as
 * `arn:aws:kms:...` would get its `:aws:` swapped for an <img> tag. On markdown
 * clients the injected tag then renders as raw HTML text inside the code span
 * (see the emoji-inside-ARN rendering bug), so we protect these regions here at
 * the single write point instead of relying on each client to cope.
 *
 * The single capturing group is deliberate: String.prototype.split with one
 * capturing group interleaves the array as [text, code, text, code, ...], so
 * even indices are substitutable text and odd indices are protected code.
 */
const CODE_SPAN_REGEX =
  /(```[\s\S]*?```|`[^`\r\n]*`|<pre\b[^>]*>[\s\S]*?<\/pre>|<code\b[^>]*>[\s\S]*?<\/code>)/gi;

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
 *
 * Shortcodes inside code spans / code blocks are left untouched so that literal
 * content such as ARNs (`arn:aws:kms:...`) is never corrupted.
 */
export async function replaceCustomEmojiShortcodesWithImg(content: string): Promise<string> {
  if (!content) return content;

  // Split into alternating [text, code, text, code, ...] segments. Only the
  // even-indexed text segments are candidates for shortcode substitution.
  const segments = content.split(CODE_SPAN_REGEX);

  const names = Array.from(
    new Set(
      segments
        .filter((_, i) => i % 2 === 0)
        .flatMap((segment) => Array.from(segment.matchAll(SHORTCODE_REGEX)).map((m) => m[1]))
        .filter(Boolean),
    ),
  );

  if (names.length === 0) return content;

  const repo = new CustomEmojiRepository();
  const emojis = await repo.findManyByNames(names);

  if (emojis.length === 0) return content;

  const emojiByName = new Map(emojis.map((e) => [e.name, e]));

  return segments
    .map((segment, i) => {
      // Odd indices are protected code segments — keep them verbatim.
      if (i % 2 === 1) return segment;
      return segment.replace(SHORTCODE_REGEX, (full, name: string) => {
        const emoji = emojiByName.get(name);
        return emoji ? buildEmojiImgTag(name, emoji) : full;
      });
    })
    .join('');
}
