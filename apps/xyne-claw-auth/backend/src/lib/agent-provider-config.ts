import { agentProviderCredentialsRepository, sharedProviderCredentialRepository, userProviderCredentialsRepository } from "../repositories/index.js";
import { errMsg } from "./errors.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("agent-provider-config");

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  authType?: string;
  reasoningEffort?: string;
}

export interface ResolvedAgentProviders {
  /** Resolved parent provider (first ordered entry that has creds). undefined ⇒ platform default. */
  provider?: string;
  /** Decrypted, ready-to-use creds keyed by provider. Empty ⇒ run on the platform default (spaces/LiteLLM). */
  providerConfigs: Record<string, ProviderConfig>;
  /** The fallback chain claw-pod may walk on quota exhaustion. */
  providerOrder: string[];
  /**
   * The PRIMARY provider the pod should run on (the first provider in the order
   * that has creds). Callers must forward this as the dispatch body's `provider`
   * field — the pod keys its primary model off `provider`, NOT `providerOrder[0]`,
   * and defaults to "spaces" (LiteLLM/kimi) when it's unset. Undefined ⇒ run on
   * the platform default (kimi-first agents, or no premium creds).
   */
  parent?: string;
}

/** The provider keys valid in an agent's config.providerOrder / config.provider.
 *  SINGLE SOURCE OF TRUTH — imported by every dispatch site (webhook, agent-chat,
 *  run-stream, flow-action) so adding a provider means editing ONE list. */
export const KNOWN_PROVIDERS = new Set(["codex", "claude", "copilot", "openrouter", "litellm", "spaces"]);

/**
 * Per-agent setting controlling which provider a SUBAGENT runs on when it has no
 * explicit per-subagent override (`userSubagentConfig`):
 *
 *  - `"spaces"` (DEFAULT): subagents run on the Spaces platform default (LiteLLM)
 *    — cheaper/faster, and what nearly every agent already does today (premium
 *    parents on Claude plan-tokens already fall through to LiteLLM for subagents).
 *  - `"parent"`: subagents inherit the parent agent's resolved provider (e.g. the
 *    parent on Claude Opus → subagents on Claude Opus). On paid/premium plans this
 *    consumes noticeably more tokens/credits.
 *  - `"fast-model"` (opt-in, 2026-07-15): subagents run on `LITELLM_FAST_MODEL`.
 *    NOT the default — no faster grid model exists yet, so flipping the default
 *    would only change behavior without a win. Revisit when one is provisioned
 *    (fast-mode-plan.md Slice A).
 *
 * An explicit `subagentProviders[name]` override ALWAYS wins over this default.
 * Stored on the agent's JSONB config as `subagentProviderMode`, alongside the
 * existing `provider` / `providerOrder` settings. Undefined ⇒
 * "spaces".
 */
export type SubagentProviderMode = "parent" | "spaces" | "fast-model";

// ── Fast-mode provider profile ───────────────────────────────────────────────
//
// Fast mode (modelSettings.speed = "fast", or the per-message chat toggle) can
// run on its OWN provider setup, configured in the agent's Model & provider tab
// under the "Fast mode" view:
//
//   config.fastModeProfile = {
//     providers: "inherit" | "custom",   // default inherit — same providers +
//                                        // credentials as standard mode
//     providerOrder?: string[],          // custom: fast-mode preference order
//     models?: Record<provider, model>,  // custom: per-provider model override
//                                        // (same credential key, different model)
//   }
//
// Credential KEYS are per agent per provider and shared by both modes; the
// profile only decides which providers are tried (and on which model). With
// "inherit", fast mode is purely the provider-side speed tier (Anthropic
// `speed: "fast"`) on the standard setup.
//
// NOT `config.fastMode` — that key is the legacy tool-catalog flag (`/fast`).

export type ModelSpeed = "standard" | "fast";

export interface FastModeProfile {
  providers: "inherit" | "custom";
  providerOrder: string[];
  models: Record<string, string>;
}

export function parseFastModeProfile(config?: unknown): FastModeProfile {
  const cfg = (config as Record<string, unknown> | null) ?? null;
  const raw = cfg?.["fastModeProfile"];
  const inherit: FastModeProfile = { providers: "inherit", providerOrder: [], models: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return inherit;
  const r = raw as Record<string, unknown>;
  if (r["providers"] !== "custom") return inherit;
  const providerOrder = Array.isArray(r["providerOrder"])
    ? (r["providerOrder"] as unknown[]).filter((p): p is string => typeof p === "string" && KNOWN_PROVIDERS.has(p))
    : [];
  const models: Record<string, string> = {};
  const rawModels = r["models"];
  if (rawModels && typeof rawModels === "object" && !Array.isArray(rawModels)) {
    for (const [k, v] of Object.entries(rawModels as Record<string, unknown>)) {
      if (KNOWN_PROVIDERS.has(k) && typeof v === "string" && v.trim()) models[k] = v.trim();
    }
  }
  return { providers: "custom", providerOrder, models };
}

/** The agent's default speed (modelSettings.speed); per-run overrides win over it. */
export function agentDefaultSpeed(config?: unknown): ModelSpeed {
  const cfg = (config as Record<string, unknown> | null) ?? null;
  const ms = cfg?.["modelSettings"] as Record<string, unknown> | undefined;
  return ms?.["speed"] === "fast" ? "fast" : "standard";
}

/**
 * The config whose providerOrder / provider the run should resolve against.
 * Standard speed, or fast with an inherited profile ⇒ the config unchanged.
 * Fast with a custom profile ⇒ providerOrder swapped for the fast-mode order
 * (legacy single `provider` dropped so it can't leak the standard pick back in).
 */
export function providerConfigForSpeed(config: unknown, speed: ModelSpeed): Record<string, unknown> {
  const cfg = { ...((config as Record<string, unknown> | null) ?? {}) };
  if (speed !== "fast") return cfg;
  const profile = parseFastModeProfile(cfg);
  if (profile.providers !== "custom") return cfg;
  cfg["providerOrder"] = profile.providerOrder;
  delete cfg["provider"];
  return cfg;
}

/** Apply the fast profile's per-provider model overrides to resolved configs (in place). */
export function applyFastModeModels<T extends { model: string }>(
  providerConfigs: Record<string, T>,
  config: unknown,
  speed: ModelSpeed,
): void {
  if (speed !== "fast") return;
  const profile = parseFastModeProfile(config);
  if (profile.providers !== "custom") return;
  for (const [provider, model] of Object.entries(profile.models)) {
    const c = providerConfigs[provider];
    if (c) c.model = model;
  }
}

export function resolveSubagentProviderMode(config?: unknown): SubagentProviderMode {
  const cfg = (config as Record<string, unknown> | null) ?? null;
  if (cfg?.["subagentProviderMode"] === "parent") return "parent";
  if (cfg?.["subagentProviderMode"] === "fast-model") return "fast-model";
  return "spaces";
}

export type CredRow = {
  encryptedKey: string | null;
  iv: string | null;
  authTag: string | null;
  model: string | null;
  baseUrl: string | null;
  authType: string | null;
  reasoningEffort: string | null;
};

/**
 * Decrypt + shape one credential row into a ProviderConfig (null on failure).
 * SINGLE SOURCE OF TRUTH for per-provider default models + OAuth-bundle
 * extraction — imported by webhook / agent-chat / flow-action so a provider's
 * default model lives in ONE place (they previously drifted).
 */
export function buildProviderConfig(provider: string, row: CredRow): ProviderConfig | null {
  if (!row.encryptedKey || !row.iv || !row.authTag) return null;
  try {
    const decrypted = decrypt(row.encryptedKey, row.iv, row.authTag, CONFIG.encryptionKey);
    // All claude/codex creds are plain API keys (both OAuth flows were removed).
    const apiKey = decrypted;
    // Keep in sync with defaultModelForProvider() in services/providerCredentials.ts,
    // which documents the measured ok-rates behind these choices. A stale id here
    // fails silently — ~300ms error, read as an empty completion, fallback to
    // spaces, no ERROR logged.
    const defaultModel =
      // gpt-4o is NOT servable through Copilot OAuth here (0 ok / 21 fail over
      // 72h) — every defaulted call fell back to spaces.
      provider === "copilot" ? "claude-sonnet-4.6" :
      provider === "codex" ? "gpt-5.5" :
      provider === "litellm" ? "private-large" :
      "claude-opus-4-8";
    return {
      apiKey,
      model: row.model ?? defaultModel,
      ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
      ...(row.authType ? { authType: row.authType } : {}),
      ...(row.reasoningEffort ? { reasoningEffort: row.reasoningEffort } : {}),
    };
  } catch (err) {
    log.error(`Failed to decrypt ${provider} key for agent`, { error: errMsg(err) });
    return null;
  }
}

/**
 * Resolve the provider credentials + fallback order for a HEADLESS run (event
 * trigger, scheduled job, automation) that executes under the agent's app
 * identity — no human session and no personal creds.
 *
 * This is the agent-scoped subset of the human-chat resolver in webhook.ts
 * (~1465–1648): agent-level credentials only, agent's configured provider order,
 * ranking. Without it, headless runs
 * silently drop to the platform default (spaces/LiteLLM) instead of the agent's
 * configured premium provider.
 *
 * Policy:
 *    used as a default, so we return NO order ⇒ the run uses the platform
 *    default (the owner's deliberate cheap-by-default choice). Creds are still
 *    returned for callers that gate on their own order.
 */
export async function resolveAgentProviderConfigs(
  agent: { id: string; config?: unknown },
  opts: { headlessBulk?: boolean; speed?: ModelSpeed } = {},
): Promise<ResolvedAgentProviders> {
  // Fast mode may run on its own provider profile (see providerConfigForSpeed).
  // Callers that know a per-run speed pass it; otherwise the agent default applies.
  const speed = opts.speed ?? agentDefaultSpeed(agent.config);
  const cfg = providerConfigForSpeed(agent.config, speed);
  if (speed === "fast" && parseFastModeProfile(agent.config).providers === "custom") {
    log.info(`Provider resolution: agent=${agent.id} fast-mode profile → order=[${(cfg["providerOrder"] as string[]).join(",")}]`);
  }

  // Per-agent model downgrade for headless bulk traffic (automations, the
  // error pipeline, scheduled jobs). These paths fire on every PR / message /
  // cron tick and were observed burning ~88% of an agent's premium-provider
  // quota (doctor-agent: 3,063 of 3,499 daily LLM turns from automations).
  // `automationProvider` in agent config redirects ONLY these dispatches:
  //   "platform"        → platform default model (kimi) — creds resolved but
  //                        no premium order, mirroring the kimi-first mode
  //   any known provider → force that provider as the sole parent
  // Human-facing paths (chat, mentions, a2a) are untouched.
  const rawAutomationProvider = cfg?.["automationProvider"];
  const automationProvider = typeof rawAutomationProvider === "string" ? rawAutomationProvider : undefined;
  if (opts.headlessBulk && automationProvider) {
    if (automationProvider === "platform") {
      log.info(`Provider resolution (headless-bulk): agent=${agent.id} automationProvider=platform → platform default`);
      return { providerConfigs: {}, providerOrder: [] };
    }
    if (KNOWN_PROVIDERS.has(automationProvider)) {
      const bulkAgent = {
        id: agent.id,
        config: { ...(cfg ?? {}), provider: automationProvider, providerOrder: [automationProvider] },
      };
      log.info(`Provider resolution (headless-bulk): agent=${agent.id} automationProvider=${automationProvider} → forced parent`);
      return resolveAgentProviderConfigs(bulkAgent, { speed });
    }
    log.warn(`Provider resolution (headless-bulk): agent=${agent.id} unknown automationProvider="${automationProvider}" — ignoring`);
  }

  const rawOrder = cfg?.["providerOrder"];
  const agentProviderOrder: string[] = Array.isArray(rawOrder)
    ? rawOrder.filter((p): p is string => typeof p === "string" && KNOWN_PROVIDERS.has(p))
    : [];
  const rawProvider = cfg?.["provider"];
  const agentLevelProvider = typeof rawProvider === "string" ? rawProvider : undefined;

  const agentCreds = await agentProviderCredentialsRepository.listByAgent(agent.id).catch(() => []);
  const agentCredsByProvider = new Map(agentCreds.map((c) => [c.provider, c] as const));

  const providerConfigs: Record<string, ProviderConfig> = {};
  for (const [provider, row] of agentCredsByProvider) {
    const built = buildProviderConfig(provider, row);
    if (built) providerConfigs[provider] = built;
  }
  applyFastModeModels(providerConfigs, agent.config, speed);

  // No pre-run OAuth-bearer refresh needed: Claude + Codex OAuth were
  // removed — all creds are API keys (no expiry, no refresh).

  // STRICT RANKING — the order is the source of truth, top first. "spaces" is
  // the keyless platform provider and can ALWAYS serve, so an explicit spaces
  // entry wins over lower-ranked saved credentials; a credential only routes
  // when its provider outranks spaces (or spaces is absent). Entries without
  // creds are skipped. No order at all → the platform default: a credential
  // that was saved but never selected as a provider never routes a run.
  // (Legacy `config.provider` still counts as an explicit selection for
  // agents predating providerOrder.) Mirrors agent-chat.ts.
  let parent: string | undefined;
  if (agentProviderOrder.length > 0) {
    parent = agentProviderOrder.find((p) => p === "spaces" || providerConfigs[p]) ?? agentProviderOrder[0];
  }
  if (!parent && agentLevelProvider && providerConfigs[agentLevelProvider]) parent = agentLevelProvider;

  const providerOrder = agentProviderOrder.length > 0 ? agentProviderOrder : parent ? [parent] : [];
  log.info(`Provider resolution (headless): agent=${agent.id} mode=always-on parent=${parent ?? "spaces"} creds=[${Object.keys(providerConfigs).join(",")}] order=[${providerOrder.join(",")}]`);
  // The primary is only usable if it names a provider we actually built creds
  // for; "spaces" (or undefined) means fall through to the platform default,
  // so leave it unset in that case. Returned under BOTH field names — run-
  // stream reads `provider` (matches the dispatch-body field), the scheduled
  // worker / automation webhook / run proxy read `parent`. Keep them in
  // lockstep until consumers converge on one name.
  const primaryParent = parent && providerConfigs[parent] ? parent : undefined;
  return {
    providerConfigs,
    providerOrder,
    ...(primaryParent ? { provider: primaryParent, parent: primaryParent } : {}),
  };
}
