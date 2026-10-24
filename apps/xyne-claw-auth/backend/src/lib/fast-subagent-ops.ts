import type { Prisma } from "@prisma/client";

export const DRIFT_MIN_ANSWERS = 30;
export const DRIFT_UNSURE_RISE = 10;
export const DRIFT_UNAVAILABLE_RISE = 5;
export const DRIFT_MIN_REVIEWS = 10;
export const DRIFT_WRONG_RATE = 15;
const DAY_MS = 86_400_000;

interface RunKeys {
  id: string;
  orgId: string;
  agentSlug: string;
  completedAt: Date;
  model?: string | null;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(2_147_483_647, Math.round(v))) : 0);

function fastDebug(inv: unknown): Record<string, unknown> | null {
  if (!inv || typeof inv !== "object") return null;
  const r = inv as Record<string, unknown>;
  if (r["parentToolCallId"] || typeof r["toolCallId"] !== "string" || typeof r["toolName"] !== "string") return null;
  const debug = r["debug"] as Record<string, unknown> | undefined;
  const fs = debug?.["fastSubagent"];
  return fs && typeof fs === "object" ? (fs as Record<string, unknown>) : null;
}

export function fastSubagentCallRows(run: RunKeys, invocations: unknown): Prisma.FastSubagentCallCreateManyInput[] {
  if (!Array.isArray(invocations)) return [];
  const rows: Prisma.FastSubagentCallCreateManyInput[] = [];
  for (const inv of invocations) {
    const fs = fastDebug(inv);
    if (!fs) continue;
    const r = inv as Record<string, unknown>;
    const xor = (fs["xor"] ?? {}) as Record<string, unknown>;
    rows.push({
      runId: run.id,
      orgId: run.orgId,
      agentSlug: run.agentSlug,
      subagentName: String(r["toolName"]).slice(0, 120),
      toolCallId: String(r["toolCallId"]).slice(0, 200),
      completedAt: run.completedAt,
      durationMs: num(r["durationMs"]),
      isError: r["isError"] === true,
      fast: fs["fast"] === true,
      model: typeof fs["model"] === "string" ? fs["model"].slice(0, 120) : null,
      parentModel: run.model ? run.model.slice(0, 120) : null,
      tokensIn: num(fs["tokensIn"]),
      tokensOut: num(fs["tokensOut"]),
      tokensCacheRead: num(fs["tokensCacheRead"]),
      tokensCacheWrite: num(fs["tokensCacheWrite"]),
      turns: num(fs["turns"]),
      fallbacks: num(fs["fallbacks"]),
      xorCalls: num(xor["calls"]),
      xorItems: num(xor["items"]),
      xorAnswers: num(xor["answers"]),
      xorUnsure: num(xor["unsure"]),
      xorUnavailable: num(xor["unavailable"]),
      xorCached: num(xor["cached"]),
      quotaBlocked: num(xor["quotaBlocked"]),
    });
  }
  return rows;
}

export function reviewSampleRows(run: RunKeys, invocations: unknown): Prisma.XorReviewSampleCreateManyInput[] {
  if (!Array.isArray(invocations)) return [];
  const rows: Prisma.XorReviewSampleCreateManyInput[] = [];
  for (const inv of invocations) {
    const fs = fastDebug(inv);
    const review = fs?.["review"];
    if (!Array.isArray(review)) continue;
    for (const s of review.slice(0, 6) as Array<Record<string, unknown>>) {
      if (typeof s?.["question"] !== "string" || typeof s["confidence"] !== "number" || s["value"] === undefined) continue;
      rows.push({
        orgId: run.orgId,
        subagentName: String((inv as Record<string, unknown>)["toolName"]).slice(0, 120),
        runId: run.id,
        item: String(s["item"] ?? "").slice(0, 400),
        questionId: String(s["questionId"] ?? "").slice(0, 80),
        question: s["question"].slice(0, 400),
        value: String(s["value"]).slice(0, 200),
        confidence: s["confidence"],
      });
    }
  }
  return rows;
}

export interface CallRow {
  subagentName: string;
  completedAt: Date;
  durationMs: number;
  isError: boolean;
  fast: boolean;
  model: string | null;
  parentModel?: string | null;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead?: number;
  tokensCacheWrite?: number;
  fallbacks: number;
  xorCalls: number;
  xorItems: number;
  xorAnswers: number;
  xorUnsure: number;
  xorUnavailable: number;
  xorCached: number;
  quotaBlocked: number;
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

export function aggregateCalls(rows: CallRow[], days: number, now = Date.now()) {
  const by = new Map<string, CallRow[]>();
  for (const r of rows) by.set(r.subagentName, [...(by.get(r.subagentName) ?? []), r]);
  return [...by.entries()]
    .map(([name, list]) => {
      const durations = list.map((r) => r.durationMs).sort((a, b) => a - b);
      const sum = (k: keyof CallRow) => list.reduce((n, r) => n + (r[k] as number), 0);
      const daily = Array.from({ length: days }, (_, i) => {
        const start = now - (days - i) * DAY_MS;
        const day = list.filter((r) => r.completedAt.getTime() >= start && r.completedAt.getTime() < start + DAY_MS);
        const answers = day.reduce((n, r) => n + r.xorAnswers, 0);
        return { day: new Date(start).toISOString().slice(0, 10), calls: day.length, unsureRate: pct(day.reduce((n, r) => n + r.xorUnsure, 0), answers) };
      });
      return {
        subagentName: name,
        fast: list.some((r) => r.fast),
        models: [...new Set(list.map((r) => r.model).filter((m): m is string => Boolean(m)))],
        calls: list.length,
        errorRate: pct(list.filter((r) => r.isError).length, list.length),
        p50Ms: percentile(durations, 50),
        p95Ms: percentile(durations, 95),
        tokensOffloaded: sum("tokensIn") + sum("tokensOut") + list.reduce((n, r) => n + (r.tokensCacheRead ?? 0), 0),
        costRows: costRows(list),
        xorCalls: sum("xorCalls"),
        xorItems: sum("xorItems"),
        unsureRate: pct(sum("xorUnsure"), sum("xorAnswers")),
        unavailableRate: pct(sum("xorUnavailable"), sum("xorItems")),
        cacheHitRate: pct(sum("xorCached"), sum("xorItems")),
        escalations: sum("fallbacks"),
        quotaBlocked: sum("quotaBlocked"),
        daily,
      };
    })
    .sort((a, b) => b.calls - a.calls);
}

export interface CostRow {
  model: string | null;
  parentModel: string | null;
  calls: number;
  xorCalls: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
}

function costRows(list: CallRow[]): CostRow[] {
  const by = new Map<string, CostRow>();
  for (const r of list) {
    const key = `${r.model ?? ""}\u0000${r.parentModel ?? ""}`;
    const c = by.get(key) ?? { model: r.model, parentModel: r.parentModel ?? null, calls: 0, xorCalls: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 };
    c.calls += 1;
    c.xorCalls += r.xorCalls;
    c.tokensIn += r.tokensIn;
    c.tokensOut += r.tokensOut;
    c.cacheRead += r.tokensCacheRead ?? 0;
    c.cacheWrite += r.tokensCacheWrite ?? 0;
    by.set(key, c);
  }
  return [...by.values()];
}

export interface DriftAlert {
  subagentName: string;
  kind: "unsure_rate" | "unavailable" | "confident_wrong";
  baseline: number;
  current: number;
  samples: number;
  message: string;
}

export function detectDrift(
  rows: Array<Pick<CallRow, "subagentName" | "completedAt" | "xorAnswers" | "xorUnsure" | "xorItems" | "xorUnavailable">>,
  reviews: Array<{ subagentName: string; verdict: string | null; reviewedAt: Date | null }>,
  now = Date.now(),
): DriftAlert[] {
  const alerts: DriftAlert[] = [];
  const names = new Set([...rows.map((r) => r.subagentName), ...reviews.map((r) => r.subagentName)]);
  for (const name of names) {
    const mine = rows.filter((r) => r.subagentName === name);
    const recent = mine.filter((r) => now - r.completedAt.getTime() < DAY_MS);
    const base = mine.filter((r) => now - r.completedAt.getTime() >= DAY_MS && now - r.completedAt.getTime() < 8 * DAY_MS);
    const s = (list: typeof mine, k: "xorAnswers" | "xorUnsure" | "xorItems" | "xorUnavailable") => list.reduce((n, r) => n + r[k], 0);
    const ra = s(recent, "xorAnswers");
    const ba = s(base, "xorAnswers");
    if (ra >= DRIFT_MIN_ANSWERS && ba >= DRIFT_MIN_ANSWERS) {
      const cur = pct(s(recent, "xorUnsure"), ra)!;
      const was = pct(s(base, "xorUnsure"), ba)!;
      if (cur - was >= DRIFT_UNSURE_RISE) {
        alerts.push({ subagentName: name, kind: "unsure_rate", baseline: was, current: cur, samples: ra, message: `${name}: xor is unsure on ${cur}% of answers in the last 24h, up from ${was}% over the previous 7 days (${ra} answers). Check for an xor model change or new kinds of input.` });
      }
    }
    const ri = s(recent, "xorItems");
    const bi = s(base, "xorItems");
    if (ri >= DRIFT_MIN_ANSWERS && bi >= DRIFT_MIN_ANSWERS) {
      const cur = pct(s(recent, "xorUnavailable"), ri)!;
      const was = pct(s(base, "xorUnavailable"), bi)!;
      if (cur - was >= DRIFT_UNAVAILABLE_RISE) {
        alerts.push({ subagentName: name, kind: "unavailable", baseline: was, current: cur, samples: ri, message: `${name}: xor did not answer ${cur}% of items in the last 24h, up from ${was}% (${ri} items). Likely grid 429s or timeouts.` });
      }
    }
    const reviewed = reviews.filter((r) => r.subagentName === name && r.verdict && r.reviewedAt && now - r.reviewedAt.getTime() < 7 * DAY_MS);
    if (reviewed.length >= DRIFT_MIN_REVIEWS) {
      const wrong = pct(reviewed.filter((r) => r.verdict === "wrong").length, reviewed.length)!;
      if (wrong >= DRIFT_WRONG_RATE) {
        alerts.push({ subagentName: name, kind: "confident_wrong", baseline: DRIFT_WRONG_RATE, current: wrong, samples: reviewed.length, message: `${name}: reviewers marked ${wrong}% of confident xor answers wrong in the last 7 days (${reviewed.length} reviews). Rephrase the checks and run evals.` });
      }
    }
  }
  return alerts;
}

export const hourBucket = (now = Date.now()): string => new Date(Math.floor(now / 3_600_000) * 3_600_000).toISOString();
