import { validateDecideQuestions, type DecideQuestion, type DecideType } from "xyne-claw-shared";
import { xor, type XorAnswer, type XorAsk, type XorQuestion } from "./xor.js";

export type { DecideQuestion, DecideType };

export const DEFAULT_THRESHOLD = 0.7;
export const MAX_ITEMS = 200;
const CONCURRENCY = 8;

export interface DecideItem {
  id: string;
  text?: string;
  image?: string;
}

export interface DecideAnswer {
  value: string | number | boolean | null;
  confidence: number | null;
  unsure: boolean;
  ok?: boolean;
}

export interface DecideItemResult {
  id: string;
  answers: Record<string, DecideAnswer>;
  error?: string;
}

export interface DecideQuestionSummary {
  id: string;
  type: DecideType;
  answered: number;
  unsure: number;
  failedExpect: number;
  distribution?: Record<string, number>;
  mean?: number;
}

export interface DecideResult {
  items: DecideItemResult[];
  summary: DecideQuestionSummary[];
  unavailable: number;
}

export const validateQuestions = validateDecideQuestions;

export function toXorQuestions(questions: DecideQuestion[]): Record<string, XorQuestion> {
  const out: Record<string, XorQuestion> = {};
  for (const q of questions) {
    if (q.type === "yesno") out[q.id] = { type: "noul", instructions: q.question };
    else if (q.type === "choice") out[q.id] = { type: "choice", instructions: q.question, criteria: q.options as Record<string, string> };
    else if (q.type === "score") out[q.id] = { type: "score", instructions: q.question, criteria: (q.options as string[]).map(String) };
    else out[q.id] = { type: "value", instructions: q.question, dtype: q.dtype ?? "string", ...(q.pattern ? { pattern: q.pattern } : {}) };
  }
  return out;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const norm = (v: unknown): string => String(v).trim().replace(/\s+/g, " ").toLowerCase();

export function readAnswer(q: DecideQuestion, a: XorAnswer | undefined): DecideAnswer {
  const threshold = q.threshold ?? DEFAULT_THRESHOLD;
  let value: DecideAnswer["value"] = null;
  let confidence: number | null = null;
  if (a) {
    if (q.type === "yesno" && typeof a.noul === "number") {
      value = a.noul >= 0.5;
      confidence = round2(Math.abs(a.noul - 0.5) * 2);
    } else if (q.type === "choice" && typeof a.choice === "string") {
      value = a.choice;
      confidence = typeof a.confidence === "number" ? round2(a.confidence) : null;
    } else if (q.type === "score" && typeof a.score === "number") {
      const levels = q.options as string[];
      const top = levels.length - 1;
      const idx = Math.min(top, Math.max(0, Math.round(a.score <= 1 && top > 1 ? a.score * top : a.score)));
      value = levels[idx] ?? a.score;
      confidence = typeof a.confidence === "number" ? round2(a.confidence) : null;
    } else if (q.type === "value") {
      value = a.value ?? null;
      confidence = typeof a.confidence === "number" ? round2(a.confidence) : null;
    }
  }
  const unsure = value === null || confidence === null || confidence < threshold;
  const answer: DecideAnswer = { value, confidence, unsure };
  if (q.expect !== undefined && value !== null) answer.ok = norm(value) === norm(q.expect);
  return answer;
}

function itemState(item: DecideItem, context: string | undefined): string {
  const parts: string[] = [];
  if (context?.trim()) parts.push(context.trim());
  if (item.text?.trim()) parts.push(item.text.trim());
  if (parts.length === 0 && item.image) parts.push("An image to evaluate.");
  return parts.join("\n\n");
}

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

export function summarize(questions: DecideQuestion[], items: DecideItemResult[]): DecideQuestionSummary[] {
  return questions.map((q) => {
    const answers = items.map((it) => it.answers[q.id]).filter((a): a is DecideAnswer => Boolean(a));
    const answered = answers.filter((a) => a.value !== null);
    const s: DecideQuestionSummary = {
      id: q.id,
      type: q.type,
      answered: answered.length,
      unsure: answers.filter((a) => a.unsure).length,
      failedExpect: answers.filter((a) => a.ok === false).length,
    };
    if (q.type !== "value" || answered.every((a) => typeof a.value !== "number")) {
      const dist: Record<string, number> = {};
      for (const a of answered) {
        if (a.unsure) continue;
        const k = String(a.value);
        dist[k] = (dist[k] ?? 0) + 1;
      }
      if (q.type !== "value") s.distribution = dist;
    }
    if (q.type === "value") {
      const ns = answered.map((a) => a.value).filter((v): v is number => typeof v === "number");
      if (ns.length) s.mean = round2(ns.reduce((x, y) => x + y, 0) / ns.length);
    }
    return s;
  });
}

export async function decideBatch(input: {
  items: DecideItem[];
  questions: DecideQuestion[];
  context?: string;
  purpose?: string;
  signal?: AbortSignal;
  ask?: XorAsk;
}): Promise<DecideResult> {
  const ask = input.ask ?? xor;
  const xq = toXorQuestions(input.questions);
  let unavailable = 0;
  const items = await mapLimit(input.items, CONCURRENCY, async (item): Promise<DecideItemResult> => {
    const answers = await ask({
      state: itemState(item, input.context),
      questions: xq,
      purpose: input.purpose ?? "xor-decide",
      ...(item.image ? { images: [item.image] } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    }).catch(() => null);
    if (!answers) unavailable += 1;
    return {
      id: item.id,
      answers: Object.fromEntries(input.questions.map((q) => [q.id, readAnswer(q, answers?.[q.id])])),
      ...(answers ? {} : { error: "xor unavailable" }),
    };
  });
  return { items, summary: summarize(input.questions, items), unavailable };
}

export function formatDecisions(questions: DecideQuestion[], result: DecideResult, maxRows = 60): string {
  const head = `xor-decide: ${result.items.length} item(s) × ${questions.length} question(s)` + (result.unavailable ? ` — ${result.unavailable} unavailable` : "");
  const sum = result.summary.map((s) => {
    const dist = s.distribution && Object.keys(s.distribution).length ? " " + Object.entries(s.distribution).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(", ") : "";
    const mean = s.mean !== undefined ? ` mean=${s.mean}` : "";
    const exp = s.failedExpect ? ` expect-failed=${s.failedExpect}` : "";
    return `- ${s.id} (${s.type}): answered ${s.answered}, unsure ${s.unsure}${exp}${dist}${mean}`;
  });
  const cols = questions.map((q) => q.id);
  const rows = result.items.slice(0, maxRows).map((it) => {
    const cells = cols.map((c) => {
      const a = it.answers[c];
      if (!a || a.value === null) return "—";
      const mark = a.unsure ? "?" : "";
      const exp = a.ok === false ? "✗" : a.ok === true ? "✓" : "";
      return `${String(a.value).slice(0, 40)}${mark}${exp} (${a.confidence ?? "-"})`;
    });
    return `| ${it.id} | ${cells.join(" | ")} |`;
  });
  const table = [`| item | ${cols.join(" | ")} |`, `|${"---|".repeat(cols.length + 1)}`, ...rows];
  const more = result.items.length > maxRows ? [`… ${result.items.length - maxRows} more item(s) in the JSON`] : [];
  return [head, "", "Summary:", ...sum, "", ...table, ...more, "", "? = below the confidence threshold (unsure), ✓/✗ = matches / does not match expect."].join("\n");
}
