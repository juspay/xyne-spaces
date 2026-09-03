/**
 * Audit trail for per-agent model settings (`Agent.config.modelSettings`).
 *
 * `modelSettings.model` is the Spaces/platform-default model override: it
 * decides which model on the shared LiteLLM proxy actually serves the agent's
 * runs (xyne-claw/src/agent.ts → resolveModel, default LiteLLM branch). Changing
 * it silently re-points EVERY run of that agent at a different model, so each
 * edit gets its own audit row with before/after values and the acting user.
 *
 * Event type is the existing AGENT_CONFIG_UPDATED — Postgres enums are frozen
 * (scripts/validate-no-new-enums.sh), so a model change is distinguished by
 * `metadata.kind = "modelSettings"`, not by a new enum value.
 *
 * Called from the PUT /agents/:slug handler, which is the single write path for
 * every model-settings edit (claw-auth's own console and the Spaces dashboard
 * both PUT there).
 */
import { writeAuditLog } from "./audit.js";

/** The modelSettings keys we track. Mirrors agent-config-validation.ts. */
export const AUDITED_MODEL_SETTING_KEYS = ["model", "temperature", "maxTokens", "thinkingLevel", "speed"] as const;
export type AuditedModelSettingKey = (typeof AUDITED_MODEL_SETTING_KEYS)[number];

export type ModelSettingsSnapshot = Record<AuditedModelSettingKey, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Reads the audited modelSettings keys out of an agent `config` bag. */
export function readModelSettingsSnapshot(config: unknown): ModelSettingsSnapshot {
  const ms = asRecord(asRecord(config)?.["modelSettings"]) ?? {};
  return {
    model: ms["model"],
    temperature: ms["temperature"],
    maxTokens: ms["maxTokens"],
    thinkingLevel: ms["thinkingLevel"],
    speed: ms["speed"],
  };
}

/** Keys whose value differs between two config bags. Empty = nothing to audit. */
export function diffModelSettings(beforeConfig: unknown, afterConfig: unknown): AuditedModelSettingKey[] {
  const before = readModelSettingsSnapshot(beforeConfig);
  const after = readModelSettingsSnapshot(afterConfig);
  return AUDITED_MODEL_SETTING_KEYS.filter((k) => before[k] !== after[k]);
}

/** Renders an audited value for the human-readable description. */
function formatSetting(v: unknown): string {
  return v === undefined || v === null || v === "" ? "platform default" : String(v);
}

export interface ModelSettingsAuditArgs {
  agentId: string;
  agentName: string;
  agentSlug: string;
  orgId: string;
  /** Verified requester; undefined for non-HTTP/system writes. */
  actorUserId: string | undefined;
  beforeConfig: unknown;
  afterConfig: unknown;
}

/**
 * Writes an AGENT_CONFIG_UPDATED row when modelSettings actually changed.
 * No-ops otherwise, so the high-frequency config writes that don't touch the
 * model (tools, memory status, scope flips, prompt denorm) don't spam the
 * audit table.
 *
 * Never throws — writeAuditLog swallows its own errors, and a failed audit must
 * not fail the agent update it observes.
 */
export async function auditModelSettingsChange(args: ModelSettingsAuditArgs): Promise<void> {
  const changed = diffModelSettings(args.beforeConfig, args.afterConfig);
  if (changed.length === 0) return;

  const before = readModelSettingsSnapshot(args.beforeConfig);
  const after = readModelSettingsSnapshot(args.afterConfig);
  const parts = changed.map((k) => `${k}: ${formatSetting(before[k])} → ${formatSetting(after[k])}`);

  await writeAuditLog({
    ...(args.actorUserId ? { actorUserId: args.actorUserId } : {}),
    eventType: "AGENT_CONFIG_UPDATED",
    targetId: args.agentId,
    description:
      `Agent "${args.agentName}" (${args.agentSlug}) model settings changed — ${parts.join("; ")}` +
      (args.actorUserId ? "" : " [no actor — non-HTTP/system write]"),
    metadata: {
      kind: "modelSettings",
      orgId: args.orgId,
      changed,
      before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
      after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])),
    },
  });
}
