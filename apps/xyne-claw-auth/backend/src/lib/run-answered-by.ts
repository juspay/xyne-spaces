/**
 * "Answered by" — which provider/model actually produced an assistant reply,
 * and whether it got there by falling back off the requested one
 * (XYNE-66319 / XYNE-66326).
 *
 * Source of truth is the AgentRun row: `provider` / `model` hold the COMPLETED
 * attempt (claw reports the finisher), and the fallback provenance lives in
 * `metadata.modelFallback` (written by the run-stream callback). No ChatMessage
 * column is needed — /messages already pairs runs to assistant rows via
 * AgentRun.chatMessageId.
 */

export interface AnsweredBy {
  provider: string;
  model?: string;
  /** True when the run fell back off the requested provider/model. Absent
   *  when the reporting claw pod pre-dates fallback reporting. */
  fellBack?: boolean;
  requestedProvider?: string;
  requestedModel?: string;
}

export interface ModelFallbackMetadata {
  fellBack: boolean;
  requestedProvider?: string;
  requestedModel?: string;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Fallback provenance from a claw /result callback body (or the persisted
 *  metadata.modelFallback), or undefined when it was not reported. */
export function modelFallbackFromCallback(body: Record<string, unknown>): ModelFallbackMetadata | undefined {
  if (typeof body["fellBack"] !== "boolean") return undefined;
  const requestedProvider = str(body["requestedProvider"]);
  const requestedModel = str(body["requestedModel"]);
  return {
    fellBack: body["fellBack"],
    ...(requestedProvider ? { requestedProvider } : {}),
    ...(requestedModel ? { requestedModel } : {}),
  };
}

export function buildAnsweredBy(
  provider: unknown,
  model: unknown,
  fallback: ModelFallbackMetadata | undefined,
): AnsweredBy | undefined {
  const p = str(provider);
  if (!p) return undefined;
  const m = str(model);
  return {
    provider: p,
    ...(m ? { model: m } : {}),
    ...(fallback
      ? {
          fellBack: fallback.fellBack,
          ...(fallback.fellBack && fallback.requestedProvider ? { requestedProvider: fallback.requestedProvider } : {}),
          ...(fallback.fellBack && fallback.requestedModel ? { requestedModel: fallback.requestedModel } : {}),
        }
      : {}),
  };
}

/** Read the provenance back off a persisted AgentRun row. */
export function answeredByFromRun(run: {
  provider?: string | null;
  model?: string | null;
  metadata?: unknown;
}): AnsweredBy | undefined {
  const meta = run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
    ? (run.metadata as Record<string, unknown>)["modelFallback"]
    : undefined;
  const fallback = meta && typeof meta === "object" && !Array.isArray(meta)
    ? modelFallbackFromCallback(meta as Record<string, unknown>)
    : undefined;
  return buildAnsweredBy(run.provider, run.model, fallback);
}
