/**
 * Channel-neutral text shaping. Dialect conversion (WhatsApp `*bold*`,
 * Telegram HTML) is a plugin concern (`plugin.formatText`); this file only
 * splits long replies into messenger-sized chunks without mangling them.
 */

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
