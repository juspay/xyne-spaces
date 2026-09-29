import { AsyncLocalStorage } from "node:async_hooks";

export interface SystemOneBackendSpec {
  label: string;
  envPrefix: string;
  sharedEnvPrefix?: string;
  defaultUrl?: string;
  defaultModel?: string;
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
  },
  ourtrainedjev: {
    label: "Our Jev — trained",
    envPrefix: "OUR_TRAINED_JEV",
    sharedEnvPrefix: "OUR_JEV",
  },
  // Grid's calibrated classifier. Its key allows only a handful of parallel
  // requests, so it is explicit-only (see EXPLICIT_ONLY_BACKENDS).
  xor: {
    label: "XOR (Grid)",
    envPrefix: "XOR",
    defaultUrl: "https://grid.ai.juspay.net/v1/systemone",
    defaultModel: "jev-latest",
  },
} as const satisfies Record<string, SystemOneBackendSpec>;

export type SystemOneBackendName = keyof typeof SYSTEM_ONE_BACKENDS;
export const SYSTEM_ONE_BACKEND_NAMES = Object.keys(SYSTEM_ONE_BACKENDS) as SystemOneBackendName[];

/**
 * Backends a call site must name itself (`jevAskOn("xor", ...)`). They can never
 * be a run's pinned judge, a JUDGE_SHADOW mirror target, or an eval-UI option:
 * each of those would fan every Jev call onto a rate-limited key.
 */
export const EXPLICIT_ONLY_BACKENDS = ["xor"] as const satisfies readonly SystemOneBackendName[];

export function isExplicitOnlyBackend(backend: JudgeBackendName): boolean {
  return (EXPLICIT_ONLY_BACKENDS as readonly string[]).includes(backend);
}

/** System One backends that may be selected per run, mirrored, or listed in the eval UI. */
export const SELECTABLE_SYSTEM_ONE_BACKEND_NAMES = SYSTEM_ONE_BACKEND_NAMES.filter(
  (name) => !(EXPLICIT_ONLY_BACKENDS as readonly string[]).includes(name),
);

export const JUDGE_BACKENDS = [...SELECTABLE_SYSTEM_ONE_BACKEND_NAMES, "llm"] as const;
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
}

const store = new AsyncLocalStorage<JudgeRunContext>();

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
    return;
  }
  store.enterWith({ backend: envDefault(), calls: [], shadows: [], sink });
}

function emit(kind: JudgeDebugKind, data: Record<string, unknown>): void {
  try {
    store.getStore()?.sink?.(kind, data);
  } catch {
    return;
  }
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
