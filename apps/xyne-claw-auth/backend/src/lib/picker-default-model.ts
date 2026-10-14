/**
 * The model-picker "Default" row: which model a no-pin run of this agent will
 * actually start on, and its people-facing name.
 *
 * GET /agent-chat/:slug/litellm-models used to derive this on its own, from a
 * spaces/litellm-only slice of providerOrder, so an agent ranked
 * [claude, spaces] was labelled with the Spaces model while every run went to
 * Claude (XYNE-66318), and fast mode was ignored entirely (XYNE-66323). The
 * label is now derived from the SAME resolver the run paths use
 * (resolveAgentProviderConfigs, at the same speed) plus the model precedence
 * claw applies on the platform branch:
 *
 *   parent provider with a credential → that credential's model (with the
 *                                       fast profile's per-provider override)
 *   otherwise ("spaces")              → fast: fastModeProfile.modelSettings.model
 *                                       then modelSettings.model
 *                                       then claw's LITELLM.model
 *
 * Mirrors xyne-claw: agent.ts (platform branch reads modelSettings.model,
 * else LITELLM.model) and agent-model-settings.ts (fast overlays
 * fastModeProfile.modelSettings field-by-field).
 */

import type { ModelSpeed, ResolvedAgentProviders } from "./agent-provider-config.js";
import { modelDisplayName } from "./model-catalog.js";

function trimmedModel(settings: unknown): string | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const raw = (settings as Record<string, unknown>)["model"];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/** The agent's own Spaces (platform) model at this speed, or null ⇒ claw's LITELLM.model. */
export function spacesModelForSpeed(config: unknown, speed: ModelSpeed): string | null {
  const cfg = (config as Record<string, unknown> | null) ?? {};
  if (speed === "fast") {
    const fastModel = trimmedModel(
      (cfg["fastModeProfile"] as Record<string, unknown> | undefined)?.["modelSettings"],
    );
    if (fastModel) return fastModel;
  }
  return trimmedModel(cfg["modelSettings"]);
}

/** `?speed=` on the models endpoint; anything else ⇒ the agent's default speed. */
export function parseSpeedParam(raw: unknown): ModelSpeed | undefined {
  return raw === "fast" || raw === "standard" ? raw : undefined;
}

export interface PickerDefault {
  /** The provider a no-pin run starts on ("spaces" = keyless platform). */
  provider: string;
  defaultModel: string | null;
  defaultModelName: string | null;
}

export function resolvePickerDefault(input: {
  config: unknown;
  speed: ModelSpeed;
  resolved: Pick<ResolvedAgentProviders, "provider" | "providerConfigs"> | null;
  /** claw's LITELLM.model, as reported by /internal/litellm/models. */
  platformDefaultModel: string | null;
}): PickerDefault {
  const parent = input.resolved?.provider;
  const parentModel = parent ? input.resolved?.providerConfigs[parent]?.model?.trim() : undefined;
  if (parent && parent !== "spaces" && parentModel) {
    return { provider: parent, defaultModel: parentModel, defaultModelName: modelDisplayName(parentModel) };
  }
  const model = spacesModelForSpeed(input.config, input.speed) ?? input.platformDefaultModel ?? null;
  return { provider: "spaces", defaultModel: model, defaultModelName: model ? modelDisplayName(model) : null };
}
