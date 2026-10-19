export interface ModelRate {
  inPerM: number;
  outPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
}

export interface ModelCard {
  rate: ModelRate;
  open: boolean;
}

export const BASELINE_MODEL = "claude-opus-5-5";

export const MODEL_CARD: Record<string, ModelCard> = {
  "claude-opus-5-5": { open: false, rate: { inPerM: 4, outPerM: 20, cacheReadPerM: 0.2, cacheWritePerM: 5 } },
  "claude-sonnet-5-5": { open: false, rate: { inPerM: 3, outPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 3.75 } },
  "private-large-spaces": { open: true, rate: { inPerM: 0.15, outPerM: 0.5, cacheReadPerM: 0.03, cacheWritePerM: 0 } },
};

export interface TokenCounts {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
}

const BASELINE_RATE: ModelRate = (MODEL_CARD[BASELINE_MODEL] ?? {
  rate: { inPerM: 0, outPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 },
  open: false,
}).rate;

export function cardFor(model: string | null): ModelCard | null {
  return model ? MODEL_CARD[model] ?? null : null;
}

export function costOf(rate: ModelRate, t: TokenCounts): number {
  return (
    (t.tokensIn * rate.inPerM +
      t.tokensOut * rate.outPerM +
      t.cacheRead * rate.cacheReadPerM +
      t.cacheWrite * rate.cacheWritePerM) /
    1_000_000
  );
}

export interface PricedRow extends TokenCounts {
  model: string | null;
  runs: number;
  open: boolean;
  cost: number | null;
}

export function priceRow(model: string | null, runs: number, t: TokenCounts): PricedRow {
  const card = cardFor(model);
  return {
    model,
    runs,
    open: card?.open ?? false,
    cost: card ? costOf(card.rate, t) : null,
    ...t,
  };
}

export const XOR_BACKENDS = new Set(["xor", "jev", "ournormaljev"]);

export const LLM_JUDGE_COST_PER_CALL = 0.05;
export const XOR_JUDGE_COST_PER_CALL = 0.0002;
export const PRE_XOR_COMPACTION_OVERHEAD_PER_CALL = 0.1;

export interface JudgeRow {
  backend: string;
  runs: number;
  calls: number;
  failed: number;
  compactions: number;
}

export interface XorSavings {
  xorRuns: number;
  xorCalls: number;
  xorCompactions: number;
  judgeSaving: number;
  compactionSaving: number;
  saved: number;
  byBackend: JudgeRow[];
}

export function isXorBackend(backend: string): boolean {
  return XOR_BACKENDS.has(backend.trim().toLowerCase());
}

export function computeXorSavings(rows: JudgeRow[]): XorSavings {
  const xorRows = rows.filter((r) => isXorBackend(r.backend));
  const xorRuns = xorRows.reduce((a, r) => a + r.runs, 0);
  const xorCalls = xorRows.reduce((a, r) => a + r.calls, 0);
  const xorCompactions = xorRows.reduce((a, r) => a + r.compactions, 0);
  const judgeSaving = xorCalls * (LLM_JUDGE_COST_PER_CALL - XOR_JUDGE_COST_PER_CALL);
  const compactionSaving = xorCompactions * PRE_XOR_COMPACTION_OVERHEAD_PER_CALL;
  return {
    xorRuns,
    xorCalls,
    xorCompactions,
    judgeSaving,
    compactionSaving,
    saved: judgeSaving + compactionSaving,
    byBackend: [...rows].sort((a, b) => b.calls - a.calls),
  };
}

export interface CostSavings {
  baselineModel: string;
  openRuns: number;
  openActual: number;
  baselineCounterfactual: number;
  saved: number;
  cacheWriteShare: number;
}

export function computeCostSavings(rows: PricedRow[]): CostSavings {
  const openRows = rows.filter((r) => r.open);
  const openActual = openRows.reduce((a, r) => a + (r.cost ?? 0), 0);

  const baseline = rows
    .filter((r) => r.model === BASELINE_MODEL)
    .reduce((a, r) => ({ cacheRead: a.cacheRead + r.cacheRead, cacheWrite: a.cacheWrite + r.cacheWrite }), { cacheRead: 0, cacheWrite: 0 });
  const cacheTotal = baseline.cacheRead + baseline.cacheWrite;
  const cacheWriteShare = cacheTotal > 0 ? baseline.cacheWrite / cacheTotal : 0;

  const promptWorkload = openRows.reduce((a, r) => a + r.tokensIn + r.cacheRead + r.cacheWrite, 0);
  const outputWorkload = openRows.reduce((a, r) => a + r.tokensOut, 0);

  const baselineCounterfactual =
    (promptWorkload * (1 - cacheWriteShare) * BASELINE_RATE.cacheReadPerM +
      promptWorkload * cacheWriteShare * BASELINE_RATE.cacheWritePerM +
      outputWorkload * BASELINE_RATE.outPerM) /
    1_000_000;

  return {
    baselineModel: BASELINE_MODEL,
    openRuns: openRows.reduce((a, r) => a + r.runs, 0),
    openActual,
    baselineCounterfactual,
    saved: baselineCounterfactual - openActual,
    cacheWriteShare,
  };
}
