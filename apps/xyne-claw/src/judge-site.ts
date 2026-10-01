/**
 * One way to run a classifier-backed decision. Every new Jev call site goes
 * through here so they all behave the same when Jev is slow, down, or unsure:
 *
 *   disabled    → fallback (today's path), no Jev call
 *   unavailable → fallback (Jev returned nothing within the site's budget)
 *   unsure      → fallback (the site's pure `decide` declined to commit)
 *   decided     → Jev's decision
 *
 * and every outcome leaves exactly one `[judge] site=…` log line plus one
 * `judge_outcome` entry in the run's debug trace. `decide` is pure, so the
 * thresholds are unit-tested without a network.
 */

import { jevAsk, type JevAnswer, type JevQuestion } from "./jev.js";
import { recordJudgeOutcome } from "./judge-backend.js";
import { createLogger } from "./logger.js";
import { metric } from "./metrics.js";

const log = createLogger("judge");

export type JudgeSiteOutcome = "disabled" | "unavailable" | "unsure" | "decided";

export interface JudgeSiteSpec<D> {
  /** Stable name: used in logs, metrics and the debug trace. */
  site: string;
  /** Resolved on/off switch for this site. */
  enabled: boolean;
  /** Time budget for the Jev call; the backend may shorten it, never stretch it. */
  budgetMs: number;
  state: string;
  questions: Record<string, JevQuestion>;
  /** Pure: answers → decision, or null when not confident enough to act. */
  decide: (answers: Record<string, JevAnswer>) => D | null;
  /** Today's path. Used whenever Jev does not decide. Omit for advisory sites. */
  fallback?: () => Promise<D>;
  /** One short phrase for the log line (e.g. "respond", "keep 3/12"). */
  describe?: (decision: D) => string;
  signal?: AbortSignal;
  /** Test seam. */
  ask?: typeof jevAsk | undefined;
}

/** The test seam a site's own deps object carries, passed straight through to its spec. */
export interface JudgeSiteDeps {
  ask?: typeof jevAsk | undefined;
  enabled?: boolean | undefined;
}

export interface JudgeSiteResult<D> {
  decision: D | null;
  outcome: JudgeSiteOutcome;
  /** Raw answers when Jev replied (also on "unsure"), for callers that record scores. */
  answers: Record<string, JevAnswer> | null;
}

function summarise(answers: Record<string, JevAnswer> | null): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [id, a] of Object.entries(answers ?? {})) {
    const v = a.noul ?? a.score ?? a.choice;
    if (v !== undefined) out[id] = typeof v === "number" ? round3(v) : v;
  }
  return out;
}

// A supplied fallback means the decision is never null.
export function runJudgeSite<D>(
  spec: JudgeSiteSpec<D> & { fallback: () => Promise<D> },
): Promise<JudgeSiteResult<D> & { decision: D }>;
export function runJudgeSite<D>(spec: JudgeSiteSpec<D>): Promise<JudgeSiteResult<D>>;
export async function runJudgeSite<D>(spec: JudgeSiteSpec<D>): Promise<JudgeSiteResult<D>> {
  const started = Date.now();
  const finish = async (
    outcome: JudgeSiteOutcome,
    answers: Record<string, JevAnswer> | null,
    decided: D | null,
  ): Promise<JudgeSiteResult<D>> => {
    const decision = decided ?? (spec.fallback ? await spec.fallback() : null);
    const ms = Date.now() - started;
    const action = decision === null ? "none" : spec.describe ? spec.describe(decision) : String(decision);
    const scores = summarise(answers);
    log.info(
      `[judge] site=${spec.site} outcome=${outcome} source=${outcome === "decided" ? "jev" : "fallback"} ms=${ms} action=${action}` +
        (Object.keys(scores).length ? ` scores=${JSON.stringify(scores)}` : ""),
    );
    metric.count("judge_site", { site: spec.site, outcome });
    if (outcome !== "disabled") {
      recordJudgeOutcome(spec.site, `${outcome} → ${action}`, { outcome, action, scores, ms });
    }
    return { decision, outcome, answers };
  };

  if (!spec.enabled) return finish("disabled", null, null);
  const ask = spec.ask ?? jevAsk;
  const answers = await ask(spec.state, spec.questions, {
    timeoutMs: spec.budgetMs,
    purpose: spec.site,
    ...(spec.signal ? { signal: spec.signal } : {}),
  });
  if (!answers || Object.keys(answers).length === 0) return finish("unavailable", null, null);
  let decided: D | null = null;
  try {
    decided = spec.decide(answers);
  } catch (err) {
    log.warn(`[judge] site=${spec.site} decide threw — using fallback:`, err instanceof Error ? err.message : String(err));
  }
  return finish(decided === null ? "unsure" : "decided", answers, decided);
}

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Read a 0..1 value from any answer type. */
export function answerProb(answers: Record<string, JevAnswer>, id: string): number | undefined {
  const a = answers[id];
  if (!a) return undefined;
  const v = a.noul ?? a.score;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Three-way band on a probability: ≥ high → "yes", ≤ low → "no", else null
 * (unsure → caller falls back). The one rule every gating site shares.
 */
export function band(p: number | undefined, high: number, low: number): "yes" | "no" | null {
  if (p === undefined) return null;
  if (p >= high) return "yes";
  if (p <= low) return "no";
  return null;
}
