/**
 * Compaction policy extension — owns the `session_before_compact` hook and makes
 * one correction to pi's native compaction:
 *
 *  Fresh-start when pi's cut doesn't reduce. pi keeps a recent window of
 *  `keepRecentTokens` after compacting. When that window is dominated by huge
 *  tool results (spaces-search etc.) with no user/assistant cut point inside
 *  the budget, pi's `findCutPoint` hits a fallback and KEEPS THE ENTIRE window
 *  while summarizing NOTHING (`messagesToSummarize` is empty). The next request
 *  is then as large as before and we re-compact almost immediately — the
 *  thrash the debugger shows as "27 msgs after compaction". We detect that
 *  case and instead re-summarize the WHOLE window (so nothing is lost) and keep
 *  ONLY the summary — a genuine fresh start: `[system, summary, user]`.
 *
 * (Copilot user replies used to be smuggled in as respond-to-user tool_results
 * and were dropped by pi's summarizer, so this extension used to reconstruct and
 * force-preserve them. Copilot replies now arrive as ordinary `type:"text"` user
 * messages that the summarizer already keeps, so that special case is gone.)
 *
 * Coupling to pi internals (the `preparation`/`branchEntries`/sentinel-id
 * behavior of buildSessionContext) is contained here; everything degrades to
 * pi-native compaction (return undefined) if a step can't run.
 */

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { compact, estimateTokens } from "@earendil-works/pi-coding-agent";
import { metric } from "./metrics.js";

import { createLogger } from "./logger.js";
const log = createLogger("compaction-extension");

// Sentinel `firstKeptEntryId` meaning "keep no prior messages — only the summary".
// buildSessionContext emits the summary, then appends entries from firstKeptEntryId
// onward; an id that matches no entry yields just `[summary]` (verified against pi
// internals). pi entry ids are UUIDs, so this never collides with a real entry.
const FRESH_START_SENTINEL = "__xyne_fresh_start__";

type Entry = { id?: string; type?: string; message?: unknown; firstKeptEntryId?: string };

/** The window-start entry id: the entry pi's cut starts the keep-window from
 *  (the prior compaction's firstKeptEntryId, or the first entry). When pi's
 *  chosen firstKeptEntryId equals this, the cut kept the ENTIRE window — i.e. it
 *  reduced nothing (the fallback). Mirrors prepareCompaction's boundaryStart. */
function windowStartId(branchEntries: Entry[]): string | undefined {
  let prevCompactionIndex = -1;
  for (let i = branchEntries.length - 1; i >= 0; i--) {
    if (branchEntries[i]?.type === "compaction") {
      prevCompactionIndex = i;
      break;
    }
  }
  if (prevCompactionIndex >= 0) {
    const prev = branchEntries[prevCompactionIndex];
    const fkIdx = branchEntries.findIndex((e) => e.id === prev?.firstKeptEntryId);
    return (fkIdx >= 0 ? branchEntries[fkIdx] : branchEntries[prevCompactionIndex + 1])?.id;
  }
  return branchEntries[0]?.id;
}

/** Messages + estimated tokens for everything pi planned to KEEP (from
 *  firstKeptEntryId to the end of the branch). Used both to size the kept tail
 *  and to feed the fresh-start re-summarization so no kept content is lost. */
function keptTail(branchEntries: Entry[], firstKeptEntryId: string | undefined): { tokens: number; messages: unknown[] } {
  const idx = branchEntries.findIndex((e) => e.id === firstKeptEntryId);
  if (idx < 0) return { tokens: 0, messages: [] };
  let tokens = 0;
  const messages: unknown[] = [];
  for (let i = idx; i < branchEntries.length; i++) {
    const e = branchEntries[i];
    if (e?.type === "message" && e.message) {
      tokens += estimateTokens(e.message as Parameters<typeof estimateTokens>[0]);
      messages.push(e.message);
    }
  }
  return { tokens, messages };
}

interface CompactionPrep {
  firstKeptEntryId?: string;
  messagesToSummarize: unknown[];
  turnPrefixMessages?: unknown[];
  isSplitTurn?: boolean;
  settings?: { keepRecentTokens?: number };
}

/**
 * Pure decision: did pi's planned cut reduce the context, and what should be
 * summarized? `freshStart` is true when pi kept the ENTIRE window (its
 * firstKeptEntryId is the window start) AND that window is non-trivial — i.e. the
 * cut reduced nothing. A small conversation that legitimately keeps everything
 * (kept tail under the keep-recent budget) is left alone. `summarizeSet` is what
 * the summary must cover: pi's own summarize list, plus — for a fresh start —
 * everything pi would have kept (so nothing is lost when we drop it).
 *
 * Exported for compaction-extension.test.ts.
 */
export function evaluateCompaction(
  branchEntries: Entry[],
  preparation: CompactionPrep,
): { freshStart: boolean; summarizeSet: unknown[]; keptTokens: number; keptCount: number } {
  const keepRecent = preparation.settings?.keepRecentTokens ?? 20000;
  const tail = keptTail(branchEntries, preparation.firstKeptEntryId);
  const keptWholeWindow = preparation.firstKeptEntryId === windowStartId(branchEntries);
  const freshStart = keptWholeWindow && tail.tokens >= keepRecent;
  const summarizeSet = freshStart
    ? [...preparation.messagesToSummarize, ...tail.messages]
    : preparation.messagesToSummarize;
  return { freshStart, summarizeSet, keptTokens: tail.tokens, keptCount: tail.messages.length };
}

export const compactionExtension: ExtensionFactory = (pi) => {
  pi.on("session_before_compact", async (event, ctx) => {
    const ev = event as unknown as {
      preparation: CompactionPrep;
      branchEntries: Entry[];
      signal?: AbortSignal;
    };
    const { preparation, branchEntries, signal } = ev;

    const { freshStart, summarizeSet, keptTokens, keptCount } = evaluateCompaction(branchEntries, preparation);

    // Nothing to correct: pi's cut already reduces the context → let pi-native
    // compaction run.
    if (!freshStart) return;

    const model = ctx.model;
    if (!model) {
      log.warn("[compaction] No model available — falling back to default compaction");
      return;
    }
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      log.warn(`[compaction] Auth unavailable (${!auth.ok ? auth.error : "no API key"}) — default compaction`);
      return;
    }

    try {
      // Re-summarize the ENTIRE window (old + the part pi wanted to keep), then
      // keep ONLY the summary. The sentinel firstKeptEntryId makes
      // buildSessionContext yield just `[summary]` — a clean fresh start with no
      // lost content (the recent tool results now live inside the summary).
      const freshPrep = {
        ...preparation,
        messagesToSummarize: summarizeSet,
        turnPrefixMessages: [],
        isSplitTurn: false,
        firstKeptEntryId: FRESH_START_SENTINEL,
      };
      const result = await compact(
        freshPrep as unknown as Parameters<typeof compact>[0],
        model,
        auth.apiKey,
        auth.headers ?? {},
        undefined,
        signal,
      );

      // Guard: a fresh start REPLACES the whole window with only this summary
      // (firstKeptEntryId = FRESH_START_SENTINEL makes buildSessionContext yield
      // just `[summary]`). If the summarizer returned an EMPTY summary — e.g. an
      // oversized single-shot request whose output budget was spent on reasoning
      // or truncated, or a provider that returned no text block — committing it
      // would ERASE the entire context, and the next turn would see an empty
      // summary and stop. Never commit an empty fresh-start summary: fall back to
      // pi-native compaction, which keeps the window intact (safe; at worst we
      // re-compact next turn).
      const summaryText = (result as { summary?: string } | undefined)?.summary?.trim();
      if (!summaryText) {
        metric.count("agent_compaction", { kind: "fresh_start_empty" });
        log.error(
          `[compaction] Fresh start produced an EMPTY summary ` +
          `(${keptCount} msgs ~${keptTokens} tok est) — refusing to drop the ` +
          `window; falling back to pi-native compaction to preserve context.`,
        );
        return; // let default compaction proceed (keeps the messages)
      }

      metric.count("agent_compaction", { kind: "fresh_start" });
      log.info(
        `[compaction] Fresh start: pi would have kept the whole window ` +
        `(${keptCount} msgs ~${keptTokens} tok est, reduced nothing) — ` +
        `re-summarized it all, keeping only the summary.`,
      );
      return { compaction: result };
    } catch (err) {
      log.error("[compaction] Custom compaction failed, falling back to default:", err);
      return; // let default compaction proceed
    }
  });
};