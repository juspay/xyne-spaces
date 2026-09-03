/**
 * Spaces message HTML → readable plain text for the awakening window.
 *
 * Spaces stores what the rich-text editor produced, so a real message is
 * `<p class="m-0 leading-6">hey</p>`, not `hey`. Handing that to the model
 * wasted context on markup, and — worse — silently broke the signal
 * extractors that read the text: `isQuestion` tests for a trailing `?`, which
 * never matches when the string ends in `</p>`, so no real message was ever
 * detected as a question.
 *
 * Written here rather than reusing Spaces' `extractPlainTextFromHtml`: that
 * lives in another service and leans on `html-to-text`, which claw-auth does
 * not declare as a dependency (it currently resolves only via workspace
 * hoisting). This runs over every event of every window, must never throw on
 * the critical path, and has to do something a generic converter would not —
 * keep mention identity.
 */

/**
 * Mentions become the SAME bracketed shorthand the send tool accepts
 * (`@Name[userId]`, `@Alias[group:ID:Name]`), so the agent can copy a mention
 * straight out of the window into a reply, and so the user id survives into
 * the text instead of being flattened to a bare display name.
 */
const USER_MENTION_RE =
  /<span[^>]*data-mention-type="user"[^>]*>.*?<\/span>/gi;
const GROUP_MENTION_RE =
  /<span[^>]*data-mention-type="group"[^>]*>.*?<\/span>/gi;
const SPECIAL_MENTION_RE =
  /<span[^>]*data-mention-type="(channel|here)"[^>]*>.*?<\/span>/gi;

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", middot: "·", bull: "•",
};

function attr(tag: string, name: string): string {
  const m = new RegExp(`${name}="([^"]*)"`, "i").exec(tag);
  return m?.[1] ?? "";
}

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Convert one message body to text.
 *
 * Never throws: anything unexpected falls back to a blunt tag strip, because a
 * single malformed message must not be able to take down a window collection.
 */
export function messageToText(raw: string | null | undefined): string {
  const input = (raw ?? "").trim();
  if (!input) return "";
  // Overwhelmingly common for bot posts and API-authored messages.
  if (!input.includes("<") && !input.includes("&")) return input;

  try {
    let out = input
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ");

    out = out
      .replace(USER_MENTION_RE, (tag) => {
        const name = attr(tag, "data-username");
        const id = attr(tag, "data-user-id");
        return name ? (id ? `@${name}[${id}]` : `@${name}`) : "@someone";
      })
      .replace(GROUP_MENTION_RE, (tag) => {
        const alias = attr(tag, "data-group-alias") || attr(tag, "data-group-name");
        const id = attr(tag, "data-group-id");
        const name = attr(tag, "data-group-name");
        return alias ? (id ? `@${alias}[group:${id}:${name}]` : `@${alias}`) : "@group";
      })
      .replace(SPECIAL_MENTION_RE, (tag) => `@${attr(tag, "data-mention-type")}`);

    // Custom emoji render as <img alt=":shipit:">; the alt text is the emoji.
    out = out.replace(/<img[^>]*>/gi, (tag) => attr(tag, "alt") || attr(tag, "title") || "");

    out = out
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|li|ul|ol|pre|blockquote|h[1-6]|tr|table)>/gi, "\n")
      .replace(/<(p|div|ul|ol|pre|blockquote|h[1-6])[^>]*>/gi, "\n")
      .replace(/<td[^>]*>/gi, " ")
      .replace(/<[^>]+>/g, "");

    return normalize(decodeEntities(out));
  } catch {
    return normalize(decodeEntities(input.replace(/<[^>]+>/g, " ")));
  }
}

/**
 * Blank lines are collapsed away entirely, not preserved as paragraph breaks:
 * the window is a scanning artifact (one line per event in WINDOW.md, one JSON
 * object per line in events.jsonl), so vertical whitespace costs context and
 * buys nothing. Line structure inside a message is kept; empty runs are not.
 */
function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Thread title from a conversation's `initial_message_md`.
 *
 * That column is not markdown despite the name — it is a fenced metadata block
 * (`:::initialMessage`, then `key: value` lines, then `:::`). Taking its first
 * non-empty line, as this used to, titled EVERY real thread ":::initialMessage".
 * The title is the `content:` value, which runs until the next `key:` line and
 * is itself message HTML.
 */
export function threadTitleFrom(initialMessageMd: string | null | undefined, maxLength = 80): string {
  const raw = (initialMessageMd ?? "").trim();
  if (!raw) return "(untitled thread)";

  const body = raw.includes(":::initialMessage") ? extractContentField(raw) : raw;
  const text = messageToText(body).split("\n").find((line) => line.trim().length > 0) ?? "";
  const cleaned = text.replace(/[#*_`>]/g, "").trim();
  if (!cleaned) return "(untitled thread)";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function extractContentField(block: string): string {
  const lines = block.split("\n");
  const start = lines.findIndex((line) => /^content:/.test(line));
  if (start < 0) return "";

  const collected = [lines[start]!.replace(/^content:\s*/, "")];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    // The block's own keys terminate the value; anything else is a continuation
    // of a multi-line message.
    if (/^[a-zA-Z][a-zA-Z0-9]*:\s/.test(line) || line.trim() === ":::") break;
    collected.push(line);
  }
  return collected.join("\n");
}
