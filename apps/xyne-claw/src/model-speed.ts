/**
 * Provider "fast mode" (Anthropic `speed: "fast"`).
 *
 * Distinct from claw's existing top-level `agentConfig.fastMode` — that one is
 * the tool-catalog / no-delegation mode toggled with `/fast`. THIS is the
 * inference-speed knob: the same provider credential, same model, same
 * request — but the provider serves it from its faster (premium-priced) tier.
 *
 * Wire contract (Anthropic research preview, Opus 5 / Opus 4.8 only):
 *   - request body gets `speed: "fast"`
 *   - request carries the beta flag `anthropic-beta: fast-mode-2026-02-01`
 *
 * Other providers/models don't understand the parameter: sending it anyway
 * would 400, which the provider-fallback chain reads as a provider failure and
 * silently drops the run to the next provider. So `fastModeEligibility` gates
 * it to the one combination that works, and `installFastMode` is a no-op
 * (with a logged reason) everywhere else.
 *
 * Setting lives on `agentConfig.modelSettings.speed` (agent owner default) and
 * can be overridden per run by the caller (claw-auth's chat composer merges the
 * per-message toggle into the same field before dispatch).
 */

import type { Api, Context, Model, SimpleStreamOptions, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createLogger } from "./logger.js";

const log = createLogger("model-speed");

export const MODEL_SPEEDS = ["standard", "fast"] as const;
export type ModelSpeed = (typeof MODEL_SPEEDS)[number];

export const FAST_MODE_BETA = "fast-mode-2026-02-01";

/** Direct-Anthropic provider name registered by resolveModel's `claude` branch. */
export const ANTHROPIC_USER_PROVIDER = "anthropic-user";

/** Models the Anthropic fast-mode preview accepts `speed: "fast"` for. Opus 4.7
 *  had it and lost it (now errors); nothing else ever had it. */
export function isFastModeCapableModel(modelId: string | undefined): boolean {
  return /^claude-opus-(5|4-8)(?:$|[-@.])/i.test((modelId ?? "").trim());
}

/** Claude 4.6+ (Opus/Sonnet 4.6, 4.7, 4.8, the 5 family, Fable/Mythos) take
 *  adaptive thinking; budget_tokens is deprecated on 4.6 and a 400 from 4.7 on.
 *  pi-ai only knows this for its built-in catalogue, so custom-registered
 *  models need `compat.forceAdaptiveThinking` spelled out. */
export function isAdaptiveThinkingClaudeModel(modelId: string | undefined): boolean {
  const id = (modelId ?? "").trim().toLowerCase();
  if (/^claude-(fable|mythos)-/.test(id)) return true;
  const m = /^claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d+))?/.exec(id);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = m[2] !== undefined ? Number(m[2]) : 0;
  if (major >= 5) return true;
  return major === 4 && minor >= 6;
}

export interface FastModeEligibility {
  eligible: boolean;
  reason: string;
}

export function fastModeEligibility(model: Pick<Model<Api>, "api" | "provider" | "id">): FastModeEligibility {
  if (model.api !== "anthropic-messages") {
    return { eligible: false, reason: `provider api "${model.api}" has no fast mode (Anthropic Messages only)` };
  }
  if (model.provider !== ANTHROPIC_USER_PROVIDER) {
    return { eligible: false, reason: `provider "${model.provider}" is not the direct Anthropic API (Copilot/gateway shims don't forward speed)` };
  }
  if (!isFastModeCapableModel(model.id)) {
    return { eligible: false, reason: `model "${model.id}" does not support fast mode (Claude Opus 5 / Opus 4.8 only)` };
  }
  return { eligible: true, reason: "direct Anthropic API + fast-mode-capable model" };
}

export function parseModelSpeed(raw: unknown): ModelSpeed | undefined {
  return typeof raw === "string" && (MODEL_SPEEDS as readonly string[]).includes(raw) ? (raw as ModelSpeed) : undefined;
}

type StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

type StreamAgent = { streamFn: StreamFn };

/** Build the `anthropic-beta` value: extend whatever the caller already set
 *  with the fast-mode beta. (The OAuth-identity betas re-injection is gone —
 *  Claude OAuth was removed; credentials are API keys now.) */
export function fastModeBetaHeader(existing: string | undefined, apiKey: string | undefined): string {
  void apiKey; // kept for signature compatibility with callers/tests
  const base = existing
    ? existing.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (!base.includes(FAST_MODE_BETA)) base.push(FAST_MODE_BETA);
  return base.join(",");
}

export interface FastModeInstallResult {
  applied: boolean;
  reason: string;
}

/**
 * Wrap the session's streamFn so every LLM call for this run carries
 * `speed: "fast"` + the beta header. Only wraps calls whose model is eligible
 * (the session model can be swapped mid-run by compaction/fallback code, so
 * eligibility is re-checked per call, not once at install time).
 */
export function installFastMode(agent: StreamAgent, sessionModel: Pick<Model<Api>, "api" | "provider" | "id">): FastModeInstallResult {
  const eligibility = fastModeEligibility(sessionModel);
  if (!eligibility.eligible) {
    log.warn(`fast mode requested but NOT applied: ${eligibility.reason}`);
    return { applied: false, reason: eligibility.reason };
  }
  const baseStreamFn = agent.streamFn;
  agent.streamFn = (model, context, options) => {
    if (!fastModeEligibility(model).eligible) {
      return baseStreamFn(model, context, options);
    }
    const opts = options ?? {};
    const headers = {
      ...(opts.headers ?? {}),
      "anthropic-beta": fastModeBetaHeader(opts.headers?.["anthropic-beta"], opts.apiKey),
    };
    const baseOnPayload = opts.onPayload;
    const onPayload: NonNullable<SimpleStreamOptions["onPayload"]> = async (payload, payloadModel) => {
      const next = (await baseOnPayload?.(payload, payloadModel)) ?? payload;
      if (next && typeof next === "object" && !Array.isArray(next)) {
        return { ...(next as Record<string, unknown>), speed: "fast" };
      }
      return next;
    };
    return baseStreamFn(model, context, { ...opts, headers, onPayload });
  };
  log.info(`fast mode ON for ${sessionModel.provider}/${sessionModel.id} (speed=fast, beta=${FAST_MODE_BETA})`);
  return { applied: true, reason: eligibility.reason };
}
