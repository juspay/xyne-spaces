/**
 * Second opinion on memory candidates (R8).
 *
 * The curator LLM extracts candidate facts and grades them itself
 * (signalScore). With `jev_memory_candidate_check` on, each candidate is
 * checked by Jev against the user's most similar EXISTING memories:
 *   duplicate / noise (probability ≥ 0.7) → dropped
 *   otherwise → kept, re-ranked, and tagged with jevScore (claw-auth's
 *   auto-approve then also requires jevScore ≥ 0.5)
 * Jev off or down → candidates pass through unchanged (today's behaviour).
 */

import type { ClassifierExchange, ExistingUserMemory, UserMemoryCandidatePayload } from "xyne-claw-shared";
import { jevAsk, jevEnabled, type JevAnswer, type JevQuestion } from "./jev.js";
import { collectJudgeExchanges, recordJudgeOutcome, storableExchange } from "./judge-backend.js";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";
import { optEnabled } from "./optimizations.js";

const log = createLogger("memory-candidate-check");

const SIMILAR_K = 5;
const CONCURRENCY = 8;
const DROP_AT = 0.7;
// Background (nightly) work: no user is waiting, so allow a slow classifier reply.
const BUDGET_MS = Number(process.env["MEMORY_CANDIDATE_CHECK_TIMEOUT_MS"] ?? 8_000);
const BATCH_DEADLINE_MS = Number(process.env["MEMORY_CANDIDATE_CHECK_DEADLINE_MS"] ?? 30_000);
const MAX_CONSECUTIVE_MISSES = 3;

export type CandidateVerdict = "new" | "duplicate" | "update" | "noise";

export interface CheckedCandidate extends UserMemoryCandidatePayload {
  jevVerdict?: CandidateVerdict;
  jevScore?: number;
}

export interface CandidateCheckSummary {
  checked: number;
  dropped: Array<{ text: string; verdict: CandidateVerdict; p: number }>;
  /** Every candidate Jev answered for (kept or dropped), for the pipeline trace. */
  verdicts: Array<{ text: string; verdict: CandidateVerdict; p: number; worth?: number }>;
  /** The classifier call per candidate text (first 200 chars), in full. */
  exchanges: Array<{ text: string; exchange: ClassifierExchange }>;
  unavailable: number;
  ms: number;
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
}

/** Jaccard similarity of word sets — cheap, local, good enough to pick neighbours. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

export function mostSimilar(text: string, existing: readonly ExistingUserMemory[], k = SIMILAR_K): ExistingUserMemory[] {
  return existing
    .map((m) => ({ m, s: similarity(text, m.text) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.m);
}

export const CANDIDATE_QUESTIONS: Record<string, JevQuestion> = {
  verdict: {
    type: "choice",
    instructions: "Compared with the memories already stored about this user, what is the NEW candidate memory?",
    criteria: {
      new: "A new, useful fact about the user that the stored memories do not already say",
      duplicate: "Says the same thing as a stored memory, with no new detail",
      update: "Refines or corrects a stored memory with new, more specific detail",
      noise: "Not a durable fact about the user: a one-off event, chit-chat, or too vague to use",
    },
  },
  worth: {
    type: "score",
    instructions: "How useful is the NEW candidate for a Digital Twin that replies as this user?",
    criteria: ["Useless or misleading", "Somewhat useful", "Clearly useful: specific, durable and about the user"],
  },
};

export function candidateState(c: UserMemoryCandidatePayload, similar: readonly ExistingUserMemory[]): string {
  const stored = similar.length
    ? similar.map((m) => `- [${m.subsystem}] ${m.text.slice(0, 400)}`).join("\n")
    : "- (no similar stored memories)";
  return [
    `## Stored memories most similar to the candidate (data)\n<<<DATA\n${stored}\nDATA>>>`,
    `## NEW candidate memory (data)\n<<<DATA\n[${c.subsystem}] ${c.text.slice(0, 1_000)}\nDATA>>>`,
  ].join("\n\n");
}

/** Pure: answers → keep/drop decision for one candidate. */
export function decideCandidate(
  answers: Record<string, JevAnswer>,
): { keep: boolean; verdict: CandidateVerdict; p: number; worth?: number } | null {
  const a = answers["verdict"];
  const verdict = a?.choice as CandidateVerdict | undefined;
  if (!verdict) return null;
  const p = a?.probabilities?.[verdict] ?? a?.confidence ?? 0;
  const worthRaw = answers["worth"]?.score;
  const worth = typeof worthRaw === "number" ? worthRaw : undefined;
  const drop = (verdict === "duplicate" || verdict === "noise") && p >= DROP_AT;
  return { keep: !drop, verdict, p, ...(worth !== undefined ? { worth } : {}) };
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function checkMemoryCandidates(
  candidates: readonly UserMemoryCandidatePayload[],
  existing: readonly ExistingUserMemory[],
  deps: { ask?: typeof jevAsk; enabled?: boolean } = {},
): Promise<{ candidates: CheckedCandidate[]; summary: CandidateCheckSummary | null }> {
  const enabled = deps.enabled ?? optEnabled("jev_memory_candidate_check");
  if (!enabled || candidates.length === 0 || (!deps.ask && !jevEnabled())) {
    return { candidates: [...candidates], summary: null };
  }
  const ask = deps.ask ?? jevAsk;
  const started = Date.now();
  // claw-auth waits on this inside /distill: a slow or down Jev must not sink
  // the batch. Stop asking after 3 misses in a row or once the batch deadline
  // passes; the rest pass through unchecked (today's behaviour).
  let misses = 0;
  const giveUp = (): boolean => misses >= MAX_CONSECUTIVE_MISSES || Date.now() - started > BATCH_DEADLINE_MS;
  const results = await mapLimit(candidates, CONCURRENCY, async (c) => {
    if (giveUp()) return { c, d: null, exchange: undefined };
    const { result: answers, exchanges } = await collectJudgeExchanges(() =>
      ask(candidateState(c, mostSimilar(c.text, existing)), CANDIDATE_QUESTIONS, {
        timeoutMs: BUDGET_MS,
        purpose: "memory-candidate-check",
      }),
    );
    misses = answers ? 0 : misses + 1;
    return { c, d: answers ? decideCandidate(answers) : null, exchange: exchanges[0] };
  });

  const dropped: CandidateCheckSummary["dropped"] = [];
  const verdicts: CandidateCheckSummary["verdicts"] = [];
  const exchangeList: CandidateCheckSummary["exchanges"] = [];
  let unavailable = 0;
  const kept: CheckedCandidate[] = [];
  for (const { c, d, exchange } of results) {
    if (exchange) exchangeList.push({ text: c.text.slice(0, 200), exchange: storableExchange(exchange, 4_000) });
    if (!d) {
      unavailable += 1;
      kept.push({ ...c });
      continue;
    }
    verdicts.push({
      text: c.text.slice(0, 200),
      verdict: d.verdict,
      p: Math.round(d.p * 1000) / 1000,
      ...(d.worth !== undefined ? { worth: Math.round(d.worth * 1000) / 1000 } : {}),
    });
    if (!d.keep) {
      dropped.push({ text: c.text.slice(0, 200), verdict: d.verdict, p: Math.round(d.p * 1000) / 1000 });
      continue;
    }
    kept.push({ ...c, jevVerdict: d.verdict, ...(d.worth !== undefined ? { jevScore: Math.round(d.worth * 1000) / 1000 } : {}) });
  }
  // Re-rank: the two opinions averaged; unchecked candidates keep their own score.
  kept.sort((a, b) => (b.jevScore ?? b.signalScore) + b.signalScore - ((a.jevScore ?? a.signalScore) + a.signalScore));

  const summary: CandidateCheckSummary = {
    checked: candidates.length,
    dropped,
    verdicts,
    exchanges: exchangeList,
    unavailable,
    ms: Date.now() - started,
  };
  metric.count("memory_candidate_check", { checked: candidates.length, dropped: dropped.length, unavailable });
  log.info(
    `[judge] site=memory-candidate-check outcome=${unavailable === candidates.length ? "unavailable" : "decided"} ` +
      `ms=${summary.ms} action=keep ${kept.length}/${candidates.length} dropped=${dropped.length} unavailable=${unavailable}`,
  );
  recordJudgeOutcome("memory-candidate-check", `kept ${kept.length} of ${candidates.length}`, {
    checked: summary.checked,
    dropped: summary.dropped,
    unavailable,
    ms: summary.ms,
  });
  return { candidates: kept, summary };
}
