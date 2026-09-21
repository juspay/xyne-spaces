import { AsyncLocalStorage } from "node:async_hooks";

export interface OptimizationSpec {
  summary: string;
  defaultOn: boolean;
}

export const OPTIMIZATIONS = {
  jev_tool_sift: {
    summary: "search-tools adds tools Jev scores as relevant on top of keyword hits",
    defaultOn: true,
  },
  jev_compaction: {
    summary: "compaction tries Jev call/result selection before LLM summarisation",
    defaultOn: true,
  },
  jev_auto_continue: {
    summary: "an answer Jev judges incomplete gets one automatic continuation turn",
    defaultOn: true,
  },
  auto_continue_strict: {
    summary: "auto-continue only when the reply is intent-only or reads as unfinished, not merely 'did not answer'",
    defaultOn: false,
  },
  lean_palette: {
    summary: "with the open palette on, tools it admitted (not ones the agent was granted) stay hidden in the catalog — including write tools — and under a reads+writes palette the forced `spaces` wrapper is dropped since its tools are loadable directly",
    defaultOn: false,
  },
} as const satisfies Record<string, OptimizationSpec>;

export type OptimizationKey = keyof typeof OPTIMIZATIONS;
export const OPTIMIZATION_KEYS = Object.keys(OPTIMIZATIONS) as OptimizationKey[];

export type OptimizationOverrides = Partial<Record<OptimizationKey, boolean>>;

const store = new AsyncLocalStorage<{ overrides: OptimizationOverrides }>();

function isKey(value: string): value is OptimizationKey {
  return Object.prototype.hasOwnProperty.call(OPTIMIZATIONS, value);
}

function envFlag(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return undefined;
  if (["1", "true", "on", "yes"].includes(raw)) return true;
  if (["0", "false", "off", "no"].includes(raw)) return false;
  return undefined;
}

export function parseOptimizationSpec(input: unknown): OptimizationOverrides {
  const out: OptimizationOverrides = {};
  const setAll = (value: boolean): void => {
    for (const key of OPTIMIZATION_KEYS) out[key] = value;
  };
  if (typeof input === "string") {
    for (const token of input.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)) {
      if (token === "all") setAll(true);
      else if (token === "none") setAll(false);
      else if (token.startsWith("-") && isKey(token.slice(1))) out[token.slice(1) as OptimizationKey] = false;
      else if (isKey(token.replace(/^\+/, ""))) out[token.replace(/^\+/, "") as OptimizationKey] = true;
    }
    return out;
  }
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (isKey(key) && typeof value === "boolean") out[key] = value;
    }
  }
  return out;
}

export function pinRunOptimizations(spec: unknown): OptimizationOverrides {
  const overrides = parseOptimizationSpec(spec);
  store.enterWith({ overrides });
  return overrides;
}

export function optEnabled(key: OptimizationKey): boolean {
  const pinned = store.getStore()?.overrides[key];
  if (pinned !== undefined) return pinned;
  const own = envFlag(`XYNE_OPT_${key.toUpperCase()}`);
  if (own !== undefined) return own;
  const all = envFlag("XYNE_OPT_ALL");
  if (all !== undefined) return all;
  return OPTIMIZATIONS[key].defaultOn;
}

export function effectiveOptimizations(): Record<OptimizationKey, boolean> {
  const out = {} as Record<OptimizationKey, boolean>;
  for (const key of OPTIMIZATION_KEYS) out[key] = optEnabled(key);
  return out;
}
