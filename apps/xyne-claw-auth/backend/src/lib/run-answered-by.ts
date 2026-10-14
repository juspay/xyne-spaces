/**
 * "Answered by" — which provider/model produced an assistant reply, and the
 * provider/model the run originally asked for when it had to fall back
 * (XYNE-66319 / XYNE-66326).
 *
 * Source of truth is the AgentRun row: claw reports the attempt that actually
 * finished (`provider`/`model`, already stored on agent_runs) and, only when a
 * later attempt answered, a `modelFallback` descriptor (stored under
 * agent_runs.metadata.modelFallback — no schema change). The SSE `done` frame
 * and GET /messages both expose the same shape so live and reloaded replies
 * render identically.
 */

export type ModelFallbackReason = "quota" | "auth" | "transient" | "empty" | "unknown";

export interface ModelFallbackInfo {
  fromProvider: string;
  fromModel?: string;
  reason: ModelFallbackReason;
}

export interface AnsweredBy {
  provider: string;
  model?: string;
  fallbackFrom?: ModelFallbackInfo;
}

const REASONS: ReadonlySet<string> = new Set(["quota", "auth", "transient", "empty", "unknown"]);
const MAX_LABEL = 200;

function shortString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() && v.length <= MAX_LABEL ? v.trim() : undefined;
}

/** Validate claw's `modelFallback` callback field (or the stored metadata copy). */
export function parseModelFallback(raw: unknown): ModelFallbackInfo | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const fromProvider = shortString(r["fromProvider"]);
  if (!fromProvider) return undefined;
  const fromModel = shortString(r["fromModel"]);
  const reason = typeof r["reason"] === "string" && REASONS.has(r["reason"]) ? (r["reason"] as ModelFallbackReason) : "unknown";
  return { fromProvider, ...(fromModel ? { fromModel } : {}), reason };
}

/** Build the client-facing descriptor; undefined when no provider is known. */
export function answeredByFrom(
  provider: unknown,
  model: unknown,
  fallback: ModelFallbackInfo | undefined,
): AnsweredBy | undefined {
  const p = shortString(provider);
  if (!p) return undefined;
  const m = shortString(model);
  return { provider: p, ...(m ? { model: m } : {}), ...(fallback ? { fallbackFrom: fallback } : {}) };
}

/** Read `modelFallback` out of an agent_runs.metadata JSON value. */
export function modelFallbackFromRunMetadata(metadata: unknown): ModelFallbackInfo | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  return parseModelFallback((metadata as Record<string, unknown>)["modelFallback"]);
}
