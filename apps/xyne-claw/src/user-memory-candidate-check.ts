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

import type {
  ClassifierExchange,
  ExistingUserMemory,
  UserMemoryCandidatePayload,
  UserMemoryCandidateVerdict,
  UserMemoryCuratorTrace,
} from "xyne-claw-shared";
import { jevAsk, jevEnabled, type JevAnswer, type JevQuestion } from "./jev.js";
import { collectJudgeExchanges, recordJudgeOutcome, storableExchange } from "./judge-backend.js";
import { round3, type JudgeSiteDeps } from "./judge-site.js";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";
import { optEnabled } from "./optimizations.js";
import { jaccard, wordSet } from "./text-similarity.js";

const log = createLogger("memory-candidate-check");

const SIMILAR_K = 5;
const CONCURRENCY = 8;
const DROP_AT = 0.7;
// Background (nightly) work: no user is waiting, so allow a slow classifier reply.
const BUDGET_MS = Number(process.env["MEMORY_CANDIDATE_CHECK_TIMEOUT_MS"] ?? 8_000);
const BATCH_DEADLINE_MS = Number(process.env["MEMORY_CANDIDATE_CHECK_DEADLINE_MS"] ?? 30_000);
const MAX_CONSECUTIVE_MISSES = 3;

export interface CandidateCheckSummary {
  checked: number;
  dropped: Array<{ text: string; verdict: UserMemoryCandidateVerdict; p: number }>;
  /** Every candidate Jev answered for (kept or dropped), for the pipeline trace. */
  verdicts: Array<{ text: string; verdict: UserMemoryCandidateVerdict; p: number; worth?: number }>;
  /** The classifier call per candidate text (first 200 chars), in full. */
  exchanges: Array<{ text: string; exchange: ClassifierExchange }>;
  unavailable: number;
  ms: number;
}

/** Jaccard similarity of word sets — cheap, local, good enough to pick neighbours. */
export function similarity(a: string, b: string): number {
  return jaccard(wordSet(a), wordSet(b));
}

export function mostSimilar(text: string, existing: readonly ExistingUserMemory[], k = SIMILAR_K): ExistingUserMemory[] {
  return existing
    .map((m) => ({ m, s: similarity(text, m.text) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.m);
}

const CANDIDATE_QUESTIONS: Record<string, JevQuestion> = {
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

function candidateState(c: UserMemoryCandidatePayload, similar: readonly ExistingUserMemory[]): string {
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
): { keep: boolean; verdict: UserMemoryCandidateVerdict; p: number; worth?: number } | null {
  const a = answers["verdict"];
  const verdict = a?.choice as UserMemoryCandidateVerdict | undefined;
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
  deps: JudgeSiteDeps = {},
): Promise<{ candidates: UserMemoryCandidatePayload[]; summary: CandidateCheckSummary | null }> {
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
  const kept: UserMemoryCandidatePayload[] = [];
  for (const { c, d, exchange } of results) {
    const text = c.text.slice(0, 200);
    if (exchange) exchangeList.push({ text, exchange: storableExchange(exchange, 4_000) });
    if (!d) {
      unavailable += 1;
      kept.push({ ...c });
      continue;
    }
    const p = round3(d.p);
    const worth = d.worth === undefined ? undefined : round3(d.worth);
    verdicts.push({ text, verdict: d.verdict, p, ...(worth !== undefined ? { worth } : {}) });
    if (!d.keep) {
      dropped.push({ text, verdict: d.verdict, p });
      continue;
    }
    kept.push({ ...c, jevVerdict: d.verdict, ...(worth !== undefined ? { jevScore: worth } : {}) });
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

/**
 * Store the classifier pass WITH the curator's LLM exchange (same trace row):
 * a batch-level record of every Jev call, plus its verdict on each candidate
 * and its drops turned into candidate verdicts.
 */
export function applyClassifierToTrace(trace: UserMemoryCuratorTrace, summary: CandidateCheckSummary): UserMemoryCuratorTrace {
  const byText = new Map(summary.verdicts.map((v) => [v.text, v]));
  const dropped = new Set(summary.dropped.map((d) => d.text));
  const classifier = {
    checked: summary.checked,
    kept: summary.checked - summary.dropped.length,
    dropped: summary.dropped.length,
    unavailable: summary.unavailable,
    ms: summary.ms,
    calls: summary.exchanges.map((x) => {
      const v = byText.get(x.text);
      return {
        text: x.text,
        ...(v ? { verdict: v.verdict, confidence: v.p } : {}),
        ...(v?.worth !== undefined ? { worth: v.worth } : {}),
        exchange: x.exchange,
      };
    }),
  };
  return {
    ...trace,
    classifier,
    emitted: trace.emitted.map((e) => {
      if (e.verdict !== "kept") return e;
      const key = e.text.slice(0, 200);
      const v = byText.get(key);
      if (!v) return e;
      const annotated = {
        ...e,
        jevVerdict: v.verdict,
        jevConfidence: v.p,
        ...(v.worth !== undefined ? { jevScore: v.worth } : {}),
      };
      return dropped.has(key)
        ? { ...annotated, verdict: "dropped" as const, dropReason: v.verdict === "duplicate" ? "classifier-duplicate" as const : "classifier-noise" as const }
        : annotated;
    }),
  };
}
