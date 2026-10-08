import { AsyncLocalStorage } from "node:async_hooks";

import { OPTIMIZATIONS, OPTIMIZATION_KEYS, OPTIMIZATION_TIER_DEFAULTS, type OptimizationKey } from "xyne-claw-shared";

// The catalog (labels, copy, defaults) lives in xyne-claw-shared so the
// agent-config UI renders the same list this module decides at run time.
export { OPTIMIZATIONS, OPTIMIZATION_KEYS, type OptimizationKey, type OptimizationSpec } from "xyne-claw-shared";

export type OptimizationOverrides = Partial<Record<OptimizationKey, boolean>>;

const store = new AsyncLocalStorage<{ overrides: OptimizationOverrides; tierDefaults?: OptimizationOverrides }>();

/**
 * Defaults that follow from an agent's delegation tier. They sit BELOW every
 * explicit choice — the run's spec, the agent's own `optimizations`, and the
 * XYNE_OPT_* env flags (so ops can still switch one off fleet-wide) — and
 * above the fleet default.
 *
 * Orchestrators get `active_tool_cap`: with nothing selected they receive every
 * tool the run can resolve, so only their most-used tools stay always-active
 * and the rest wait behind search-tools / load-tools.
 */
export function tierOptimizationDefaults(delegationMode: string | undefined): OptimizationOverrides {
  return { ...(delegationMode ? OPTIMIZATION_TIER_DEFAULTS[delegationMode] : undefined) };
}

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

export function pinRunOptimizations(
  spec: unknown,
  agentSpec?: unknown,
  tierDefaults: OptimizationOverrides = {},
): OptimizationOverrides {
  const overrides = { ...parseOptimizationSpec(agentSpec), ...parseOptimizationSpec(spec) };
  store.enterWith({ overrides, tierDefaults });
  return overrides;
}

export function optEnabled(key: OptimizationKey): boolean {
  const pinned = store.getStore()?.overrides[key];
  if (pinned !== undefined) return pinned;
  const own = envFlag(`XYNE_OPT_${key.toUpperCase()}`);
  if (own !== undefined) return own;
  const all = envFlag("XYNE_OPT_ALL");
  if (all !== undefined) return all;
  const tier = store.getStore()?.tierDefaults?.[key];
  if (tier !== undefined) return tier;
  return OPTIMIZATIONS[key].defaultOn;
}

export function effectiveOptimizations(): Record<OptimizationKey, boolean> {
  const out = {} as Record<OptimizationKey, boolean>;
  for (const key of OPTIMIZATION_KEYS) out[key] = optEnabled(key);
  return out;
}
