/**
 * Web search for the Build chat's conversational answers ("weather in
 * Bangalore", "what does X's review agent do"). A thin wrapper over the shared
 * web-search tool with a tight deadline, so a slow search costs a few seconds,
 * not the turn.
 */
import { getCustomTool } from "xyne-claw-shared";

export type WebLookup =
  | { ok: true; text: string; sources: Array<{ title: string; url: string }> }
  | { ok: false; reason: "unconfigured" | "timeout" | "error" };

export const SEARCH_TIMEOUT_MS = 6_000;
const MAX_SOURCES = 5;
const MAX_CHARS_PER_SOURCE = 900;

/**
 * The tool's text is `[1] Title\nURL: https://… (date)\nexcerpt…` blocks. Keep
 * the first few, trimmed, and pull out title and link for the chat's source list.
 * Exported for tests.
 */
export function parseSearchText(raw: string): {
  text: string;
  sources: Array<{ title: string; url: string }>;
} {
  const blocks = raw.split(/\n(?=\[\d+\] )/).filter((block) => /^\[\d+\] /.test(block.trim()));
  const kept = blocks.slice(0, MAX_SOURCES).map((block) => block.trim().slice(0, MAX_CHARS_PER_SOURCE));
  const sources = kept.flatMap((block) => {
    const title = /^\[\d+\] (.+)$/m.exec(block)?.[1]?.trim();
    const url = /^URL: (\S+)/m.exec(block)?.[1];
    return title && url ? [{ title, url }] : [];
  });
  return { text: kept.join("\n\n"), sources };
}

/** Search the web; never throws. Queries go to Parallel.ai, so callers only send public ones. */
export async function searchWeb(
  queries: readonly string[],
  objective: string,
  signal?: AbortSignal,
  timeoutMs = SEARCH_TIMEOUT_MS,
): Promise<WebLookup> {
  const tool = getCustomTool("web-search");
  if (!tool || !process.env["PARALLEL_API_KEY"]) return { ok: false, reason: "unconfigured" };
  // The tool can't be cancelled, so a timed-out search may finish in the background.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    signal?.addEventListener("abort", () => resolve("timeout"), { once: true });
  });
  try {
    const raw = await Promise.race([
      tool.execute({ query: queries[0], queries: [...queries], objective }),
      deadline,
    ]);
    if (raw === "timeout") return { ok: false, reason: "timeout" };
    if (raw.startsWith("Error")) return { ok: false, reason: "error" };
    const parsed = parseSearchText(raw);
    return parsed.sources.length > 0 ? { ok: true, ...parsed } : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}
