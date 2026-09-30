import { AsyncLocalStorage } from "node:async_hooks";

export interface SystemOneBackendSpec {
  label: string;
  envPrefix: string;
  sharedEnvPrefix?: string;
  defaultUrl?: string;
  defaultModel?: string;
  /**
   * Served through our LiteLLM gateway: when no own URL/key is set, use
   * `${LITELLM_URL}/v1/systemone` with LITELLM_API_KEY.
   */
  viaLitellm?: boolean;
}

export const SYSTEM_ONE_BACKENDS = {
  jev: {
    label: "Jev (typed evaluator)",
    envPrefix: "JEV",
    defaultUrl: "https://api.typesafe.ai/v1/systemone",
    defaultModel: "jev-latest",
  },
  ournormaljev: {
    label: "Our Jev — normal",
    envPrefix: "OUR_NORMAL_JEV",
    sharedEnvPrefix: "OUR_JEV",
    defaultModel: "jev-latest",
    viaLitellm: true,
  },
  ourtrainedjev: {
    label: "Our Jev — trained",
    envPrefix: "OUR_TRAINED_JEV",
    sharedEnvPrefix: "OUR_JEV",
  },
} as const satisfies Record<string, SystemOneBackendSpec>;

export type SystemOneBackendName = keyof typeof SYSTEM_ONE_BACKENDS;
export const SYSTEM_ONE_BACKEND_NAMES = Object.keys(SYSTEM_ONE_BACKENDS) as SystemOneBackendName[];

export const JUDGE_BACKENDS = [...SYSTEM_ONE_BACKEND_NAMES, "llm"] as const;
export type JudgeBackendName = SystemOneBackendName | "llm";

export function judgeBackendLabel(backend: JudgeBackendName): string {
  return backend === "llm" ? "LLM judge" : SYSTEM_ONE_BACKENDS[backend].label;
}

export interface JudgeCallRecord {
  backend: JudgeBackendName;
  purpose: string;
  ms: number;
  questions: number;
  ok: boolean;
}

/**
 * The full exchange of one Jev call — what it was told (state), what it was
 * asked (questions) and what it answered — so no classifier decision is a
 * black box. Recorded for EVERY call, by jev.ts, in one place.
 */
export interface JudgeExchange extends JudgeCallRecord {
  state: string;
  questionSpec: Record<string, unknown>;
  answers: Record<string, unknown> | null;
  error?: string;
  at: string;
}

export interface JudgeShadowRecord {
  primary: JudgeBackendName;
  shadow: JudgeBackendName;
  purpose: string;
  questions: number;
  agreed: number;
  meanAbsDiff: number;
  primaryMs: number;
  shadowMs: number;
}

export type JudgeDebugKind = "judge_call" | "judge_outcome";
export type JudgeDebugSink = (kind: JudgeDebugKind, data: Record<string, unknown>) => void;

interface JudgeRunContext {
  backend: JudgeBackendName;
  calls: JudgeCallRecord[];
  shadows: JudgeShadowRecord[];
  sink?: JudgeDebugSink;
  /** Events raised before the run's trace sink exists (pre-run sites: mode
   *  router, prefetch gate, plan gate, persona pick). Flushed on attach. */
  pending?: Array<{ kind: JudgeDebugKind; data: Record<string, unknown> }>;
}

const store = new AsyncLocalStorage<JudgeRunContext>();
const collectors = new AsyncLocalStorage<JudgeExchange[]>();
const MAX_PENDING = 100;

export function isJudgeBackend(value: unknown): value is JudgeBackendName {
  return typeof value === "string" && (JUDGE_BACKENDS as readonly string[]).includes(value);
}

function envDefault(): JudgeBackendName {
  const raw = process.env["JUDGE_BACKEND"]?.trim().toLowerCase();
  return isJudgeBackend(raw) ? raw : "jev";
}

export function pinRunJudgeBackend(requested: unknown): JudgeBackendName {
  const backend = isJudgeBackend(requested) ? requested : envDefault();
  store.enterWith({ backend, calls: [], shadows: [] });
  return backend;
}

export function activeJudgeBackend(): JudgeBackendName {
  return store.getStore()?.backend ?? envDefault();
}

export function shadowJudgeBackends(primary: JudgeBackendName): JudgeBackendName[] {
  return (process.env["JUDGE_SHADOW"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is JudgeBackendName => isJudgeBackend(s) && s !== primary);
}

export function setJudgeDebugSink(sink: JudgeDebugSink): void {
  const ctx = store.getStore();
  if (ctx) {
    ctx.sink = sink;
    for (const e of ctx.pending?.splice(0) ?? []) {
      try {
        sink(e.kind, e.data);
      } catch {
        // a trace write must never break the run
      }
    }
    return;
  }
  store.enterWith({ backend: envDefault(), calls: [], shadows: [], sink });
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

/** An exchange sized for storing in a DB trace row (state capped). */
export function storableExchange(x: JudgeExchange, stateChars = 8_000): JudgeExchange {
  return x.state.length <= stateChars ? x : { ...x, state: `${x.state.slice(0, stateChars)}… [${x.state.length - stateChars} more chars]` };
}

/**
 * Run `fn` and collect every Jev exchange it makes — for call sites outside a
 * run (twin gate, memory checks) that persist the exchange into their own trace.
 */
export async function collectJudgeExchanges<T>(fn: () => Promise<T>): Promise<{ result: T; exchanges: JudgeExchange[] }> {
  const exchanges: JudgeExchange[] = [];
  const result = await collectors.run(exchanges, fn);
  return { result, exchanges };
}

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n)}… [${s.length - n} more chars]`);

/**
 * One record per Jev call, with its full input and output, into the storage
 * that already holds LLM exchanges: the run's debug trace (judge_call event),
 * or — for sites outside a run — the caller's collector, which persists it
 * into its own trace (Digital Twin pipeline events).
 */
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

export function recordJudgeCall(record: JudgeCallRecord): void {
  store.getStore()?.calls.push(record);
  emit("judge_call", { ...record });
}

export function recordJudgeOutcome(purpose: string, summary: string, detail?: Record<string, unknown>): void {
  emit("judge_outcome", {
    backend: activeJudgeBackend(),
    purpose,
    summary,
    ...(detail ? { detail: JSON.stringify(detail) } : {}),
  });
}

export function recordJudgeShadow(record: JudgeShadowRecord): void {
  store.getStore()?.shadows.push(record);
}

export interface JudgeRunSummary {
  backend: JudgeBackendName;
  calls: number;
  failed: number;
  questions: number;
  totalMs: number;
  byPurpose: Record<string, { calls: number; failed: number; totalMs: number }>;
  shadows: JudgeShadowRecord[];
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
    backend: ctx.backend,
    calls: ctx.calls.length,
    failed: ctx.calls.filter((c) => !c.ok).length,
    questions: ctx.calls.reduce((n, c) => n + c.questions, 0),
    totalMs: ctx.calls.reduce((n, c) => n + c.ms, 0),
    byPurpose,
    shadows: ctx.shadows,
  };
}
