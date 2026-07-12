import type { AggregationOp } from '@xyne/shared';

// One declarative entry per aggregate op. Adding an aggregate = ONE row here,
// with both dialects side by side — no edits to per-dialect switch logic.
//
// Template placeholders:
//   {x}    argument SQL (the column or expression being aggregated)
//   {cond} filter condition SQL (ClickHouse -If form only)
//   {p}    percentile fraction, for quantile-style ops
//
// Fields:
//   argType 'numeric' → the argument must resolve to a numeric type; 'any'
//           allows min/max/count over non-numeric columns.
//   pg      Postgres form. The FILTERED Postgres form is generic and derived
//           by the engine as `<pg> FILTER (WHERE cond)`, so it isn't listed.
//   ch      ClickHouse unfiltered form.
//   chIf    ClickHouse filtered form (the -If combinator).
export interface AggSpec {
  argType: 'numeric' | 'any';
  p?: number;
  pg: string;
  ch: string;
  chIf: string;
}

// Shared shape for the five percentile ops — identical templates, different p.
const percentile = (p: number): AggSpec => ({
  argType: 'numeric',
  p,
  pg: 'percentile_cont({p}) WITHIN GROUP (ORDER BY {x})',
  ch: 'quantile({p})({x})',
  chIf: 'quantileIf({p})({x}, {cond})',
});

export const AGGREGATES: Record<AggregationOp, AggSpec> = {
  count:          { argType: 'any',     pg: 'COUNT({x})',          ch: 'count({x})',      chIf: 'countIf({cond})' },
  count_distinct: { argType: 'any',     pg: 'COUNT(DISTINCT {x})', ch: 'uniqExact({x})',  chIf: 'uniqExactIf({x}, {cond})' },
  sum:            { argType: 'numeric', pg: 'SUM({x})',            ch: 'sum({x})',        chIf: 'sumIf({x}, {cond})' },
  avg:            { argType: 'numeric', pg: 'AVG({x})',            ch: 'avg({x})',        chIf: 'avgIf({x}, {cond})' },
  min:            { argType: 'any',     pg: 'MIN({x})',            ch: 'min({x})',        chIf: 'minIf({x}, {cond})' },
  max:            { argType: 'any',     pg: 'MAX({x})',            ch: 'max({x})',        chIf: 'maxIf({x}, {cond})' },
  stddev:         { argType: 'numeric', pg: 'STDDEV_SAMP({x})',    ch: 'stddevSamp({x})', chIf: 'stddevSampIf({x}, {cond})' },
  variance:       { argType: 'numeric', pg: 'VAR_SAMP({x})',       ch: 'varSamp({x})',    chIf: 'varSampIf({x}, {cond})' },
  median: percentile(0.5),
  p75:    percentile(0.75),
  p90:    percentile(0.9),
  p95:    percentile(0.95),
  p99:    percentile(0.99),
};

export function fillTemplate(
  tpl: string,
  vars: { x?: string; cond?: string; p?: number },
): string {
  return tpl
    .replace(/\{x\}/g, vars.x ?? '')
    .replace(/\{cond\}/g, vars.cond ?? '')
    .replace(/\{p\}/g, vars.p !== undefined ? String(vars.p) : '');
}

// Ops whose argument must be numeric — derived from the registry so it stays in
// sync automatically when an op is added.
export const NUMERIC_AGG_OPS: ReadonlySet<AggregationOp> = new Set(
  (Object.keys(AGGREGATES) as AggregationOp[]).filter(
    (op) => AGGREGATES[op].argType === 'numeric',
  ),
);
