/**
 * Channel-neutral text shaping. Dialect conversion (WhatsApp `*bold*`,
 * Telegram HTML) is a plugin concern (`plugin.formatText`); this file only
 * cleans what no messenger can render and splits long replies into
 * messenger-sized chunks without mangling them.
 */

/** Every inline citation shape claw's tools and models produce: the canonical
 *  `[clf-<toolCallId>#n]`, the off-format brackets the sanitizer normalises,
 *  and the legacy `[1.0](cite:clf-…)` link. */
const BRACKETED_CLF_RE = /[ \t]*[[({<【⟦]clf-[^\])}>】⟧\n]*[\])}>】⟧]/gi;
const CITE_LINK_RE = /[ \t]*\[[^\]\n]*\]\(cite:[^)\n]*\)/gi;
const BARE_CLF_RE = /[ \t]*(?<![\w/])clf-[^\s#[\](){}<>]+#\d+(?:-#?\d+)?/gi;
const CITATION_BLOCK_RE = /<citation>\n?([\s\S]*?)\n?<\/citation>/gi;
const MAX_SOURCES = 5;

/**
 * The `<citation>` block appendCitations adds ("1. point ||| [label](url)")
 * as a short sources list. Spaces turns the block into chips; a messenger
 * would show the raw tags and pipes.
 */
function citationBlockAsSources(body: string): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of body.split("\n")) {
    const entry = raw.replace(/^\s*\d+\.\s*/, "");
    const source = entry.includes("|||") ? entry.slice(entry.lastIndexOf("|||") + 3).trim() : entry.trim();
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(source);
    const label = (link?.[1] ?? source).trim();
    const url = link?.[2]?.trim();
    const key = url ?? label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    lines.push(url ? `- ${label}: ${url}` : `- ${label}`);
    if (lines.length >= MAX_SOURCES) break;
  }
  return lines.length ? `**Sources**\n${lines.join("\n")}` : "";
}

/**
 * Remove citation markup a messenger cannot render: inline `[clf-…]` tokens
 * (the "reference ids" people saw as `[clf-toolu_01…#3]`), cite links, and the
 * `<citation>` block, which becomes a plain sources list. Code is left alone —
 * a token quoted inside a fence is content, not a citation.
 */
export function stripCitationMarkup(text: string): string {
  if (!/clf-|<citation>|\(cite:/i.test(text)) return text;
  const withSources = text.replace(CITATION_BLOCK_RE, (_m, body: string) => citationBlockAsSources(body));
  let inFence = false;
  const lines = withSources.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    const cleaned = line
      .replace(CITE_LINK_RE, "")
      .replace(BRACKETED_CLF_RE, "")
      .replace(BARE_CLF_RE, "");
    if (cleaned === line) return line;
    // Removing "claim [clf-x#1]." leaves "claim ." — close the gap the token left.
    return cleaned.replace(/[ \t]+([.,;:!?)])/g, "$1").replace(/([^\s]) {2,}/g, "$1 ").trimEnd();
  });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Split `text` into pieces of at most `max` chars, preferring paragraph
 * breaks, then line breaks, then a space, then a hard cut. A fenced code
 * block that straddles a cut gets its fence closed and reopened so every
 * chunk renders on its own.
 */
export function chunkText(text: string, max: number): string[] {
  const body = text.replace(/\r\n/g, "\n").trim();
  if (!body) return [];
  if (max < 16) throw new Error("chunkText: max too small");
  if (body.length <= max) return [body];

  const chunks: string[] = [];
  let rest = body;
  let openFence: string | null = null;

  while (rest.length > 0) {
    const prefix = openFence ? `${openFence}\n` : "";
    // Reserve room for a closing fence in case this piece leaves one open.
    const budget = max - prefix.length - 4;
    if (rest.length <= budget + 4) {
      chunks.push(prefix + rest);
      break;
    }
    let cut = lastBreak(rest, budget, "\n\n");
    if (cut < budget * 0.4) cut = lastBreak(rest, budget, "\n");
    if (cut < budget * 0.4) cut = lastBreak(rest, budget, " ");
    if (cut <= 0) cut = budget;

    const piece = rest.slice(0, cut);
    rest = rest.slice(cut).replace(/^\n+/, "");

    const stillOpen = fenceAfter(piece, openFence);
    let out = prefix + piece.trimEnd();
    if (stillOpen) out += "\n```";
    chunks.push(out);
    openFence = stillOpen;
  }
  return chunks;
}

function lastBreak(text: string, limit: number, sep: string): number {
  const idx = text.lastIndexOf(sep, limit);
  return idx > 0 ? idx + (sep === " " ? 1 : 0) : -1;
}

/** Fence marker still open at the end of `piece`, given the state before it. */
function fenceAfter(piece: string, before: string | null): string | null {
  let open = before;
  for (const line of piece.split("\n")) {
    const match = /^\s*(```|~~~)/.exec(line);
    if (!match) continue;
    open = open ? null : (match[1] ?? "```");
  }
  return open;
}
