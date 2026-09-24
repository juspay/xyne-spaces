/**
 * Compaction by selection instead of summarisation.
 *
 * pi's compaction asks an LLM to rewrite the window into prose — one blocking
 * call that costs ~50s p50 in prod and can lose an exact path or error string.
 * This scores each tool call with Jev instead and rebuilds the window verbatim,
 * dropping only what scored low. User and assistant text is never rewritten.
 *
 * Dropping a tool result is safe here in a way it would not be elsewhere:
 * oversized results are already spilled to `.context/tool-results/` and the
 * model is handed the path, so a dropped result is recoverable by reading the
 * file rather than lost.
 *
 * Returns null whenever it cannot do the job, so the caller keeps pi's path.
 */

import { jevEnabled, jevScoreItems, jevThreshold } from "./jev.js";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";

const log = createLogger("jev-compaction");

const RESULT_NOTE_HEAD = 400;
const INPUT_CHARS = 300;
// Read at call time, not import time: these are the knobs an operator reaches
// for while watching a rollout, and a module-level const would need a redeploy
// to move (and silently ignores overrides in tests).
function maxStateChars(): number {
  return Math.max(4_000, Number(process.env["JEV_COMPACTION_STATE_CHARS"]) || 100_000);
}
// Each scored call costs two questions, and batches are 50 questions wide, so
// an unbounded run (the worst observed made 934 tool calls) would fan out to
// dozens of requests against a fleet-wide rate limit. Oldest calls past the cap
// are dropped unscored rather than kept.
function maxScoredCalls(): number {
  return Math.max(1, Number(process.env["JEV_COMPACTION_MAX_CALLS"]) || 120);
}
// Rebuilding must actually reduce the window. If selection keeps nearly
// everything, committing it leaves context over threshold and pi compacts
// again — a loop worse than the summarisation stall this replaces.
function minReduction(): number {
  const raw = Number(process.env["JEV_COMPACTION_MIN_REDUCTION"]);
  return Math.min(0.95, Math.max(0.05, Number.isFinite(raw) ? raw : 0.4));
}
function preserveRecentDefault(): number {
  const raw = Number(process.env["JEV_COMPACTION_PRESERVE_RECENT"]);
  return Math.max(0, Number.isFinite(raw) ? raw : 6);
}

interface Call {
  id: string;
  name: string;
  args: string;
  resultText: string;
  resultChars: number;
  isError: boolean;
  messageIndex: number;
  pinned: boolean;
}

interface Normalised {
  role: string;
  text: string;
  callIds: string[];
  toolCallId?: string;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => {
      const block = b as { type?: string; text?: string; thinking?: string };
      if (block.type === "text" && block.text) return block.text;
      if (block.type === "thinking" && block.thinking) return "";
      if (block.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Pair tool calls with their results and mark what must never be dropped. */
function normalise(messages: readonly unknown[], preserveRecent: number): {
  rows: Normalised[];
  calls: Map<string, Call>;
} {
  const rows: Normalised[] = [];
  const calls = new Map<string, Call>();
  const pinnedFrom = Math.max(1, messages.length - preserveRecent);

  messages.forEach((raw, i) => {
    const m = raw as {
      role?: string;
      content?: unknown;
      toolCallId?: string;
      toolName?: string;
      isError?: boolean;
    };
    const role = m.role ?? "unknown";
    const row: Normalised = { role, text: textOf(m.content), callIds: [] };

    if (role === "assistant" && Array.isArray(m.content)) {
      for (const b of m.content) {
        const block = b as { type?: string; id?: string; name?: string; arguments?: unknown };
        if (block.type !== "toolCall" || !block.id) continue;
        row.callIds.push(block.id);
        calls.set(block.id, {
          id: block.id,
          name: block.name ?? "tool",
          args: JSON.stringify(block.arguments ?? {}).slice(0, INPUT_CHARS),
          resultText: "",
          resultChars: 0,
          isError: false,
          messageIndex: i,
          // First message and the newest `preserveRecent` are the live working
          // set — scoring them risks cutting the thread the agent is mid-way
          // through.
          pinned: i === 0 || i >= pinnedFrom,
        });
      }
    }

    if (role === "toolResult" && m.toolCallId) {
      row.toolCallId = m.toolCallId;
      const call = calls.get(m.toolCallId);
      if (call) {
        call.resultText = row.text;
        call.resultChars = row.text.length;
        call.isError = Boolean(m.isError);
        if (i === 0 || i >= pinnedFrom) call.pinned = true;
      }
    }

    rows.push(row);
  });

  return { rows, calls };
}

/** The conversation as Jev sees it: results collapsed to notes. */
function buildState(rows: Normalised[], calls: Map<string, Call>): string {
  const parts: string[] = [];
  rows.forEach((row) => {
    if (row.role === "toolResult") {
      const call = row.toolCallId ? calls.get(row.toolCallId) : undefined;
      const label = call ? `${call.name} (${call.id})` : "tool";
      parts.push(`[result ${label}: ${call?.isError ? "error" : "ok"}, ${row.text.length} chars (omitted)]`);
      return;
    }
    const calledOut = row.callIds
      .map((id) => {
        const c = calls.get(id);
        return c ? `  → ${c.name} ${c.args}` : "";
      })
      .filter(Boolean)
      .join("\n");
    const body = row.text.trim();
    if (!body && !calledOut) return;
    parts.push(`${row.role}: ${body}${calledOut ? `\n${calledOut}` : ""}`);
  });

  let state = parts.join("\n\n");
  const cap = maxStateChars();
  if (state.length > cap) {
    // Oldest first: the tail is what the agent is actually working on.
    state = `[… older context trimmed …]\n\n${state.slice(state.length - cap)}`;
  }
  return state;
}

function renderKeptResult(call: Call, keepVerbatim: boolean): string {
  if (keepVerbatim) return call.resultText;
  const head = call.resultText.slice(0, RESULT_NOTE_HEAD);
  return `${head}\n[… ${call.resultChars - head.length} more chars omitted — re-read the tool's spilled file if needed …]`;
}

export interface JevCompactionOutcome {
  summary: string;
  charsBefore: number;
  charsAfter: number;
  unscoredCalls: number;
  keptCalls: number;
  keptResults: number;
  droppedCalls: number;
  scoredCalls: number;
}

export async function buildJevCompaction(
  messages: readonly unknown[],
  preserveRecent = preserveRecentDefault(),
): Promise<JevCompactionOutcome | null> {
  if (!jevEnabled() || messages.length === 0) return null;

  const { rows, calls } = normalise(messages, preserveRecent);
  const candidates = [...calls.values()].filter((c) => !c.pinned);
  if (candidates.length === 0) return null;

  // Newest candidates first: an old call is both likelier to be stale and
  // cheaper to lose, since its result was spilled to a file either way.
  const ordered = [...candidates].sort((a, b) => b.messageIndex - a.messageIndex);
  const scorable = ordered.slice(0, maxScoredCalls());
  const unscored = new Set(ordered.slice(maxScoredCalls()).map((c) => c.id));

  const state = buildState(rows, calls);
  const threshold = jevThreshold("JEV_COMPACTION_THRESHOLD", 0.5);
  const started = Date.now();

  const [keepCall, keepResult] = await Promise.all([
    jevScoreItems(state, scorable, {
      purpose: "compaction-call",
      key: (c) => c.id,
      instructions: (c) =>
        `Knowing that this tool call was made still matters for continuing the work. ` +
        `Call \`${c.name}\` with input ${c.args}`,
    }),
    jevScoreItems(state, scorable, {
      purpose: "compaction-result",
      key: (c) => c.id,
      instructions: (c) =>
        `The full result of this call must be kept verbatim to continue the work; ` +
        `a short excerpt would not be enough. Call \`${c.name}\` returned ` +
        `${c.isError ? "an error, " : ""}${c.resultChars} chars.`,
    }),
  ]);

  if (!keepCall || !keepResult) {
    log.warn("[jev-compaction] scoring unavailable — falling back to pi compaction");
    return null;
  }

  type Verdict = "verbatim" | "truncated" | "drop";
  const verdictFor = (call: Call): Verdict => {
    if (call.pinned) return "verbatim";
    if (unscored.has(call.id)) return "drop";
    if ((keepCall.get(call.id) ?? 0) < threshold) return "drop";
    return (keepResult.get(call.id) ?? 0) >= threshold ? "verbatim" : "truncated";
  };

  // One renderer for both the selected window and the keep-everything baseline,
  // so the reduction check compares like with like. Measuring raw message text
  // against rendered output overstates growth and rejects good selections.
  const render = (decide: (c: Call) => Verdict): string => {
    const parts: string[] = [];
    rows.forEach((row) => {
      if (row.role === "toolResult") {
        const call = row.toolCallId ? calls.get(row.toolCallId) : undefined;
        if (!call) return;
        const verdict = decide(call);
        if (verdict === "drop") return;
        parts.push(`[${call.name} result]\n${renderKeptResult(call, verdict === "verbatim")}`);
        return;
      }
      const body = row.text.trim();
      const kept = row.callIds.filter((id) => {
        const c = calls.get(id);
        return c ? decide(c) !== "drop" : false;
      });
      const callLines = kept
        .map((id) => {
          const c = calls.get(id);
          return c ? `→ ${c.name} ${c.args}` : "";
        })
        .filter(Boolean)
        .join("\n");
      if (!body && !callLines) return;
      parts.push(`${row.role}: ${body}${callLines ? `\n${callLines}` : ""}`);
    });
    return parts.join("\n\n");
  };

  let keptCalls = 0;
  let keptResults = 0;
  let droppedCalls = 0;
  for (const call of calls.values()) {
    if (call.pinned) continue;
    const verdict = verdictFor(call);
    if (verdict === "drop") droppedCalls += 1;
    else {
      keptCalls += 1;
      if (verdict === "verbatim") keptResults += 1;
    }
  }

  const summary = render(verdictFor);
  const charsBefore = render(() => "verbatim").length;
  const charsAfter = summary.length;
  if (charsBefore > 0 && charsAfter > charsBefore * (1 - minReduction())) {
    metric.count("jev_compaction_rejected", { reason: "insufficient_reduction" });
    log.info(
      `[jev-compaction] selection kept ${charsAfter} of ${charsBefore} chars ` +
      `(< ${Math.round(minReduction() * 100)}% reduction) — falling back to summarisation.`,
    );
    return null;
  }

  const outcome: JevCompactionOutcome = {
    summary,
    charsBefore,
    charsAfter,
    unscoredCalls: unscored.size,
    keptCalls,
    keptResults,
    droppedCalls,
    scoredCalls: scorable.length,
  };

  metric.observe("jev_compaction_ms", Date.now() - started, {
    scored: scorable.length,
    kept: keptCalls,
    dropped: droppedCalls,
    unscored: unscored.size,
    reduction: Math.round((1 - charsAfter / Math.max(1, charsBefore)) * 100),
  });
  log.info(
    `[jev-compaction] scored ${scorable.length} calls in ${Date.now() - started}ms — ` +
    `kept ${keptCalls} calls / ${keptResults} verbatim results, dropped ${droppedCalls}`,
  );
  return outcome;
}
