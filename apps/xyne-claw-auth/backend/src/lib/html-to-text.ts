/**
 * Convert rich-text / HTML into readable plain text for an agent prompt.
 *
 * The Spaces automation builder authors a step's prompt as HTML and resolves
 * variables like `trigger.message.content` — whose value is ALSO HTML (e.g.
 * `<p class="m-0 leading-6">hi</p>`). Left as-is, the agent receives a prompt
 * full of `<p>`/`<span>` markup. This flattens it: block boundaries become
 * newlines, tags are dropped, common entities are decoded, whitespace is
 * collapsed. A string with no markup is returned unchanged (fast path).
 *
 * Note: literal `<`/`>` a user types in the rich-text editor are stored as
 * `&lt;`/`&gt;`, so the tag regex only ever matches real tags — decoding the
 * entities afterwards restores the intended characters.
 */
export function htmlToPlainText(input: string): string {
  if (!input) return input;
  // Nothing tag- or entity-like → already plain, leave it untouched.
  if (!/[<&]/.test(input)) return input;

  let s = input;
  // Drop script/style bodies wholesale so their contents don't leak as text.
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Block-level boundaries → newlines so adjacent text doesn't run together.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|blockquote|section|article)>/gi, "\n");
  s = s.replace(/<\/(ul|ol|table|thead|tbody)>/gi, "\n");
  // Drop every remaining tag.
  s = s.replace(/<[^>]+>/g, "");
  // Decode common named + numeric entities (&amp; last to avoid double-decode).
  s = decodeHtmlEntities(s);
  // Collapse whitespace: runs of spaces/tabs, trim around newlines, cap blanks.
  s = s
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/gi, "&");
}

function fromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return "";
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "";
  }
}
