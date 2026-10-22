import { decideBatch, type DecideAnswer, type DecideQuestion } from "./xor-decide.js";
import type { XorAsk } from "./xor.js";

export type Expected = string | number | boolean | null;

export interface EvalSample {
  id: string;
  text?: string;
  image?: string;
  expected: Record<string, Expected>;
  checks?: DecideQuestion[];
}

export interface CheckStats {
  id: string;
  question: string;
  variantOf?: string;
  labelled: number;
  matched: number;
  correct: number;
  confidentWrong: number;
  unsure: number;
  accuracy: number;
  unsureRate: number;
}

export interface ModelReport {
  model: string;
  checks: CheckStats[];
  overall: Omit<CheckStats, "id" | "question" | "variantOf">;
  meanMs: number;
  unavailable: number;
}

export interface EvalReport {
  samples: number;
  models: ModelReport[];
  ranAt: string;
}

export interface Regression {
  id: string;
  question: string;
  from: number;
  to: number;
  confidentWrongFrom: number;
  confidentWrongTo: number;
}

export const CURRENT_MODEL = "current";
export const MAX_EVAL_SAMPLES = 200;
export const MAX_EVAL_MODELS = 4;
const CONCURRENCY = 8;
const VARIANT_SEP = "~";

const pct = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

function norm(v: Expected | DecideAnswer["value"]): string {
  if (v === true) return "yes";
  if (v === false) return "no";
  const s = String(v).trim().replace(/\s+/g, " ").toLowerCase();
  return s === "true" ? "yes" : s === "false" ? "no" : s;
}

export function expandVariants(checks: DecideQuestion[], variants: Record<string, string[]> | undefined): DecideQuestion[] {
  if (!variants) return checks;
  const out: DecideQuestion[] = [];
  for (const c of checks) {
    out.push(c);
    (variants[c.id] ?? []).slice(0, 4).forEach((question, i) => {
      if (question.trim()) out.push({ ...c, id: `${c.id}${VARIANT_SEP}${i + 1}`, question: question.trim() });
    });
  }
  return out;
}

const baseId = (id: string): string => id.split(VARIANT_SEP)[0]!;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

function emptyStats(): Omit<CheckStats, "id" | "question" | "variantOf"> {
  return { labelled: 0, matched: 0, correct: 0, confidentWrong: 0, unsure: 0, accuracy: 0, unsureRate: 0 };
}

function finish<T extends ReturnType<typeof emptyStats>>(s: T): T {
  return { ...s, accuracy: pct(s.correct, s.labelled), unsureRate: pct(s.unsure, s.labelled) };
}

async function runModel(input: { checks: DecideQuestion[]; samples: EvalSample[]; model: string; variants?: Record<string, string[]>; context?: string; ask?: XorAsk }): Promise<ModelReport> {
  const stats = new Map<string, CheckStats>();
  const overall = emptyStats();
  let ms = 0;
  let unavailable = 0;
  const runs = await mapLimit(input.samples, CONCURRENCY, async (sample) => {
    const questions = expandVariants(sample.checks ?? input.checks, input.variants).filter((q) => baseId(q.id) in sample.expected);
    if (questions.length === 0) return null;
    const started = Date.now();
    const res = await decideBatch({
      items: [{ id: sample.id, ...(sample.text ? { text: sample.text } : {}), ...(sample.image ? { image: sample.image } : {}) }],
      questions,
      ...(input.context ? { context: input.context } : {}),
      purpose: "xor-eval",
      ...(input.model && input.model !== CURRENT_MODEL ? { model: input.model } : {}),
      ...(input.ask ? { ask: input.ask } : {}),
    });
    return { sample, questions, res, ms: Date.now() - started };
  });
  for (const run of runs) {
    if (!run) continue;
    ms += run.ms;
    unavailable += run.res.unavailable;
    const answers = run.res.items[0]?.answers ?? {};
    for (const q of run.questions) {
      const key = run.sample.checks ? `${run.sample.id}/${q.id}` : q.id;
      const s = stats.get(key) ?? { id: key, question: q.question, ...(q.id.includes(VARIANT_SEP) ? { variantOf: baseId(key) } : {}), ...emptyStats() };
      const want = run.sample.expected[baseId(q.id)];
      const a = answers[q.id];
      const hit = a !== undefined && a.value !== null && norm(a.value) === norm(want ?? null);
      s.labelled += 1;
      if (hit) s.matched += 1;
      if (!a || a.unsure) s.unsure += 1;
      else if (hit) s.correct += 1;
      else s.confidentWrong += 1;
      stats.set(key, s);
      if (!q.id.includes(VARIANT_SEP)) {
        overall.labelled += 1;
        if (hit) overall.matched += 1;
        if (!a || a.unsure) overall.unsure += 1;
        else if (hit) overall.correct += 1;
        else overall.confidentWrong += 1;
      }
    }
  }
  const counted = runs.filter(Boolean).length;
  return {
    model: input.model,
    checks: [...stats.values()].map(finish),
    overall: finish(overall),
    meanMs: counted ? Math.round(ms / counted) : 0,
    unavailable,
  };
}

export async function runChecksEval(input: {
  checks: DecideQuestion[];
  samples: EvalSample[];
  models: string[];
  variants?: Record<string, string[]>;
  context?: string;
  ask?: XorAsk;
}): Promise<EvalReport> {
  const models: ModelReport[] = [];
  for (const model of input.models.slice(0, MAX_EVAL_MODELS)) {
    models.push(
      await runModel({
        checks: input.checks,
        samples: input.samples.slice(0, MAX_EVAL_SAMPLES),
        model,
        ...(input.variants ? { variants: input.variants } : {}),
        ...(input.context ? { context: input.context } : {}),
        ...(input.ask ? { ask: input.ask } : {}),
      }),
    );
  }
  return { samples: Math.min(input.samples.length, MAX_EVAL_SAMPLES), models, ranAt: new Date().toISOString() };
}

export function findRegressions(base: ModelReport, next: ModelReport, maxDrop = 5): Regression[] {
  const before = new Map(base.checks.map((c) => [c.id, c]));
  const out: Regression[] = [];
  for (const c of next.checks) {
    const b = before.get(c.id);
    if (!b || c.variantOf) continue;
    if (c.accuracy < b.accuracy - maxDrop || c.confidentWrong > b.confidentWrong) {
      out.push({ id: c.id, question: c.question, from: b.accuracy, to: c.accuracy, confidentWrongFrom: b.confidentWrong, confidentWrongTo: c.confidentWrong });
    }
  }
  if (next.overall.accuracy < base.overall.accuracy - maxDrop) {
    out.unshift({ id: "overall", question: "All checks", from: base.overall.accuracy, to: next.overall.accuracy, confidentWrongFrom: base.overall.confidentWrong, confidentWrongTo: next.overall.confidentWrong });
  }
  return out;
}

export function formatEvalReport(report: EvalReport, title = "xor eval"): string {
  const [first, ...rest] = report.models;
  if (!first) return `${title}: no models`;
  const head = [`## ${title}`, "", `${report.samples} sample(s), ${report.models.map((m) => m.model).join(" vs ")}, ${report.ranAt}`, ""];
  const cols = report.models.map((m) => m.model);
  const lines = [
    `| check | ${cols.map((c) => `${c} acc / unsure / conf-wrong`).join(" | ")} |`,
    `|---|${cols.map(() => "---|").join("")}`,
  ];
  const row = (label: string, pick: (m: ModelReport) => ReturnType<typeof emptyStats> | undefined) =>
    `| ${label} | ${report.models
      .map((m) => {
        const s = pick(m);
        return s ? `${s.accuracy}% / ${s.unsureRate}% / ${s.confidentWrong}` : "—";
      })
      .join(" | ")} |`;
  lines.push(row("**overall**", (m) => m.overall));
  const perSample = (m: ModelReport) => m.checks.filter((c) => c.id.includes("/") && !c.variantOf);
  if (perSample(first).length > 0) {
    lines.push(
      row(`per-sample statements (${perSample(first).length})`, (m) =>
        finish(perSample(m).reduce((t, c) => ({ ...t, labelled: t.labelled + c.labelled, matched: t.matched + c.matched, correct: t.correct + c.correct, confidentWrong: t.confidentWrong + c.confidentWrong, unsure: t.unsure + c.unsure }), emptyStats())),
      ),
    );
  }
  for (const c of first.checks.filter((x) => !x.id.includes("/") || x.variantOf)) {
    lines.push(row(`${c.variantOf ? "↳ " : ""}${c.question.slice(0, 70)}${c.variantOf ? "" : ` (${c.id})`}`, (m) => m.checks.find((x) => x.id === c.id)));
  }
  lines.push(`| mean latency | ${report.models.map((m) => `${m.meanMs} ms${m.unavailable ? `, ${m.unavailable} unavailable` : ""}`).join(" | ")} |`);
  const regressions = rest.flatMap((m) => findRegressions(first, m).map((r) => `- ${m.model}: ${r.question} (${r.id}) ${r.from}% → ${r.to}%, confident-wrong ${r.confidentWrongFrom} → ${r.confidentWrongTo}`));
  const variantWins = report.models.flatMap((m) =>
    m.checks
      .filter((c) => c.variantOf)
      .map((v) => ({ v, base: m.checks.find((c) => c.id === v.variantOf) }))
      .filter(({ v, base }) => base && v.accuracy > base.accuracy)
      .map(({ v, base }) => `- ${m.model}: "${v.question}" beats ${base!.id} (${base!.accuracy}% → ${v.accuracy}%)`),
  );
  return [
    ...head,
    ...lines,
    "",
    "acc = confident and right; unsure = below the confidence threshold; conf-wrong = confident and wrong (the dangerous kind).",
    ...(regressions.length ? ["", `### Regressions vs ${first.model}`, ...regressions] : rest.length ? ["", `No regressions vs ${first.model}.`] : []),
    ...(variantWins.length ? ["", "### Better phrasings", ...variantWins] : []),
  ].join("\n");
}
