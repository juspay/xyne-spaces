/**
 * Which model a run is REPORTED as having used — the value written to
 * agent_runs.model and shown to the user as "Answered by …".
 *
 * Must mirror how agent.ts actually picks the model (runTask → resolveModel):
 *   - an attempt WITH a provider credential runs the credential's model;
 *   - an attempt WITHOUT one runs on the platform LiteLLM branch, where the
 *     precedence is per-agent `modelSettings.model` (also how a per-run
 *     "spaces" pin is applied), then the automation default model for
 *     automation/scheduled runs, then the platform default model.
 *
 * Before this helper the platform branch always reported LITELLM.model, so an
 * agent pinned to a non-default Spaces model — or a user who picked one in the
 * Xyne AI model picker — was shown the default model (XYNE-66321).
 */

export interface ModelReportAttempt {
  provider: string | undefined;
  config: { model?: string | undefined } | undefined;
}

export interface PlatformModelDefaults {
  /** agentConfig.modelSettings.model (per-agent or per-run "spaces" pin). */
  modelSettingsModel?: string | undefined;
  /** Automation/scheduled run — the platform branch uses the automation model. */
  automationRun: boolean;
  /** LITELLM.model */
  defaultModel: string;
  /** LITELLM.automationModel */
  automationModel: string;
}

/** The model the platform (LiteLLM) branch runs — same precedence as agent.ts. */
export function platformModel(d: PlatformModelDefaults): string {
  const pinned = d.modelSettingsModel?.trim();
  if (pinned) return pinned;
  return d.automationRun ? d.automationModel : d.defaultModel;
}

/**
 * The model to report for one attempt. Premium attempts report their
 * credential's model; the credential-less "spaces" attempt reports the platform
 * model. A non-spaces attempt without a credential model reports undefined
 * (column left unset) rather than a model that never ran — unchanged from the
 * 2026-08-28 fix.
 */
export function reportedModelForAttempt(
  attempt: ModelReportAttempt | undefined,
  d: PlatformModelDefaults,
): string | undefined {
  const fromCredential = attempt?.config?.model?.trim();
  if (fromCredential) return fromCredential;
  const provider = attempt?.provider ?? "spaces";
  return provider === "spaces" ? platformModel(d) : undefined;
}

export type ModelFallbackReason = "quota" | "auth" | "transient" | "empty" | "unknown";

/** What the user asked for when the run had to fall back to another provider. */
export interface ModelFallbackReport {
  fromProvider: string;
  fromModel?: string;
  reason: ModelFallbackReason;
}

/**
 * Fallback descriptor for the result callback: present only when the attempt
 * that produced the answer is not the first (requested) attempt.
 */
export function buildModelFallbackReport(args: {
  attempts: readonly ModelReportAttempt[];
  completedAttempt: ModelReportAttempt | undefined | null;
  reason: ModelFallbackReason | undefined;
  defaults: PlatformModelDefaults;
}): ModelFallbackReport | undefined {
  const requested = args.attempts[0];
  if (!requested || !args.completedAttempt || args.completedAttempt === requested) return undefined;
  const fromModel = reportedModelForAttempt(requested, args.defaults);
  return {
    fromProvider: requested.provider ?? "spaces",
    ...(fromModel ? { fromModel } : {}),
    reason: args.reason ?? "unknown",
  };
}
