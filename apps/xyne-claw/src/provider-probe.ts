/**
 * Penny-drop provider availability probe.
 *
 * When a run dies because the model provider is over capacity (429 / overloaded
 * / 5xx), we don't know WHEN it will recover — so claw-auth polls this to decide
 * whether to auto-retry. The only honest signal is a real, minimal completion
 * against the EXACT model with the EXACT key the run used: a "penny drop". A
 * health endpoint would answer "gateway up", not "this model has capacity", and
 * LiteLLM team keys have disjoint allowed-model lists, so the wrong key 403s and
 * looks down forever — hence "same key, same model" is load-bearing, not a nicety.
 *
 * Three outcomes, because the poller must treat them differently:
 *   - available  → the real path would work now; re-dispatch the run.
 *   - capacity   → still throttled; keep polling with backoff.
 *   - permanent  → a non-capacity error (bad key, model not allowed, 400); this
 *                  will NOT self-heal by waiting, so the poller must STOP and
 *                  say so rather than retry into the same wall.
 */

import { LITELLM } from "./config.js";
import { isQuotaExhaustedError, isTransientProviderError } from "./agent.js";
import { createHash } from "node:crypto";
import { createLogger } from "./logger.js";

const log = createLogger("provider-probe");

export type ProbeState = "available" | "capacity" | "permanent";

export interface ProbeResult {
  state: ProbeState;
  status?: number;
  detail?: string;
}

/** Config for a bring-your-own provider run; omitted for platform-default
 *  (spaces/litellm) runs, which use claw's own LiteLLM env credentials. */
export interface ProbeProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  authType?: string;
}

export interface ProbeInput {
  provider: string;
  /** Model the failed run used. Falls back to the config/env model. */
  model?: string;
  providerConfig?: ProbeProviderConfig;
  /** Automation runs used the low-priority key; probe with the same one so we
   *  measure the pool the retry will actually land in. */
  automation?: boolean;
}

const PROBE_TIMEOUT_MS = Number(process.env["PROVIDER_PROBE_TIMEOUT_MS"] ?? 12_000);
const PROBE_CACHE_TTL_MS = Number(process.env["PROVIDER_PROBE_CACHE_TTL_MS"] ?? 30_000);

/** Cache so a fleet of runs failing on the same model shares ONE penny drop
 *  instead of each adding load to an already-gasping provider. Keyed by the
 *  probe target (provider+model+key fingerprint), never the raw key. */
const probeCache = new Map<string, { at: number; result: ProbeResult }>();

function keyFingerprint(apiKey: string): string {
  return apiKey ? createHash("sha256").update(apiKey).digest("hex").slice(0, 12) : "none";
}

/**
 * Resolve the endpoint + key + model to probe. BYO config wins; otherwise the
 * platform LiteLLM credentials (automation vs interactive key, matching how the
 * run was dispatched).
 */
function resolveTarget(input: ProbeInput): { url: string; apiKey: string; model: string } | null {
  const cfg = input.providerConfig;
  if (cfg?.apiKey && (cfg.baseUrl || cfg.model)) {
    const base = (cfg.baseUrl ?? LITELLM.url).replace(/\/+$/, "");
    return { url: `${base}/chat/completions`, apiKey: cfg.apiKey, model: input.model || cfg.model };
  }
  // Platform default (spaces / litellm): claw's own env key.
  if (input.provider === "litellm" || input.provider === "spaces") {
    const apiKey = input.automation ? LITELLM.automationApiKey : LITELLM.apiKey;
    if (!apiKey) return null;
    return {
      url: `${LITELLM.url.replace(/\/+$/, "")}/chat/completions`,
      apiKey,
      model: input.model || LITELLM.model,
    };
  }
  // A BYO provider (claude/codex/copilot) with no config passed can't be probed
  // here — claw-auth must supply the reconstructed config.
  return null;
}

/**
 * Classify a probe response into the three poller-relevant states.
 * Order matters: capacity is checked before generic transient so a 429 is
 * "capacity" (keep polling) rather than lumped with network blips.
 */
function classify(status: number | null, body: string): ProbeResult {
  if (status !== null && status >= 200 && status < 300) return { state: "available", status };
  const marker = `${status ?? ""} ${body}`;
  const withStatus = (state: ProbeState, detail: string): ProbeResult =>
    status === null ? { state, detail } : { state, status, detail };
  if (isQuotaExhaustedError(marker) || status === 429 || status === 529) {
    return withStatus("capacity", "rate limited / over capacity");
  }
  if (isTransientProviderError(marker) || (status !== null && status >= 500)) {
    return withStatus("capacity", "provider transient/5xx");
  }
  // 400/401/403 and friends: a real, non-self-healing error. Waiting won't fix
  // a rejected key or a model the key isn't allowed to call.
  return withStatus("permanent", `non-capacity error (${status ?? "no status"})`);
}

/**
 * Penny-drop the provider: a 1-token completion on the exact model/key. Cached
 * briefly so concurrent callers share the request.
 */
export async function probeProvider(input: ProbeInput): Promise<ProbeResult> {
  const target = resolveTarget(input);
  if (!target) {
    return { state: "permanent", detail: `no probe target for provider "${input.provider}" (need providerConfig or platform litellm)` };
  }

  const cacheKey = `${input.provider}:${target.model}:${keyFingerprint(target.apiKey)}`;
  const cached = probeCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.at < PROBE_CACHE_TTL_MS) return cached.result;

  let result: ProbeResult;
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${target.apiKey}`,
        "Content-Type": "application/json",
      },
      // max_tokens:1 keeps the drop as cheap as the API allows. A fixed short
      // prompt so identical probes are cache-friendly upstream too.
      body: JSON.stringify({
        model: target.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const body = res.ok ? "" : (await res.text().catch(() => "")).slice(0, 300);
    result = classify(res.status, body);
  } catch (err) {
    // A timeout / socket error IS a capacity/transient signal here — keep polling.
    const msg = err instanceof Error ? err.message : String(err);
    result = { state: "capacity", detail: `probe request failed: ${msg.slice(0, 160)}` };
  }

  probeCache.set(cacheKey, { at: now, result });
  log.info(`[probe] ${cacheKey} -> ${result.state}${result.status ? ` (${result.status})` : ""}`);
  return result;
}

/** Test hook: clear the shared cache. */
export function _clearProbeCache(): void {
  probeCache.clear();
}
