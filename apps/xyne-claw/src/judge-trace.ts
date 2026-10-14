import { AsyncLocalStorage } from "node:async_hooks";
import type { ClassifierExchange } from "xyne-claw-shared";

export interface JudgeCallRecord {
  backend: string;
  purpose: string;
  ms: number;
  questions: number;
  ok: boolean;
}

export type JudgeExchange = JudgeCallRecord & Omit<ClassifierExchange, "backend">;

export type JudgeDebugKind = "judge_call" | "judge_outcome";
export type JudgeDebugSink = (kind: JudgeDebugKind, data: Record<string, unknown>) => void;

interface JudgeRunContext {
  calls: JudgeCallRecord[];
  sink?: JudgeDebugSink;
  pending?: Array<{ kind: JudgeDebugKind; data: Record<string, unknown> }>;
}

const store = new AsyncLocalStorage<JudgeRunContext>();
const collectors = new AsyncLocalStorage<JudgeExchange[]>();
const MAX_PENDING = 100;

export function beginJudgeRun(): void {
  store.enterWith({ calls: [] });
}

export function setJudgeDebugSink(sink: JudgeDebugSink): void {
  const ctx = store.getStore();
  if (ctx) {
    ctx.sink = sink;
    for (const e of ctx.pending?.splice(0) ?? []) emit(e.kind, e.data);
    return;
  }
  store.enterWith({ calls: [], sink });
}

function emit(kind: JudgeDebugKind, data: Record<string, unknown>): void {
  try {
    const ctx = store.getStore();
    if (!ctx) return;
    if (ctx.sink) ctx.sink(kind, data);
    else if ((ctx.pending ??= []).length < MAX_PENDING) ctx.pending.push({ kind, data });
  } catch {
    return;
  }
}

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n)}… [${s.length - n} more chars]`);

export function storableExchange(x: JudgeExchange, stateChars = 8_000): JudgeExchange {
  return x.state.length <= stateChars ? x : { ...x, state: clip(x.state, stateChars) };
}

export async function collectJudgeExchanges<T>(fn: () => Promise<T>): Promise<{ result: T; exchanges: JudgeExchange[] }> {
  const exchanges: JudgeExchange[] = [];
  const result = await collectors.run(exchanges, fn);
  return { result, exchanges };
}

export function recordJudgeExchange(x: JudgeExchange): void {
  const slim: JudgeCallRecord = { backend: x.backend, purpose: x.purpose, ms: x.ms, questions: x.questions, ok: x.ok };
  store.getStore()?.calls.push(slim);
  collectors.getStore()?.push(x);
  emit("judge_call", {
    ...slim,
    ...(x.error ? { error: x.error } : {}),
    state: clip(x.state, 20_000),
    questionSpec: JSON.stringify(x.questionSpec),
    answers: x.answers ? JSON.stringify(x.answers) : null,
  });
}

export function recordJudgeOutcome(purpose: string, summary: string, detail?: Record<string, unknown>): void {
  emit("judge_outcome", {
    backend: "xor",
    purpose,
    summary,
    ...(detail ? { detail: JSON.stringify(detail) } : {}),
  });
}

export interface JudgeRunSummary {
  backend: string;
  calls: number;
  failed: number;
  questions: number;
  totalMs: number;
  byPurpose: Record<string, { calls: number; failed: number; totalMs: number }>;
}

export function judgeRunSummary(): JudgeRunSummary | null {
  const ctx = store.getStore();
  if (!ctx) return null;
  const byPurpose: JudgeRunSummary["byPurpose"] = {};
  for (const call of ctx.calls) {
    const slot = (byPurpose[call.purpose] ??= { calls: 0, failed: 0, totalMs: 0 });
    slot.calls += 1;
    slot.totalMs += call.ms;
    if (!call.ok) slot.failed += 1;
  }
  return {
    backend: ctx.calls[0]?.backend ?? "xor",
    calls: ctx.calls.length,
    failed: ctx.calls.filter((c) => !c.ok).length,
    questions: ctx.calls.reduce((n, c) => n + c.questions, 0),
    totalMs: ctx.calls.reduce((n, c) => n + c.ms, 0),
    byPurpose,
  };
}
