import { agentProviderCredentialsRepository, sharedProviderCredentialRepository, userProviderCredentialsRepository, orgProviderCredentialsRepository } from "../repositories/index.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { extractCodexBearer } from "./codex-creds.js";
import { extractClaudeBearer } from "./claude-creds.js";
import { getValidClaudeBearer } from "./claude-oauth-refresh.js";
import { getValidCodexBearer } from "./codex-oauth-refresh.js";
import { resolveClawUserIdForSpacesIdentity } from "./users-jit.js";
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
 * existing `provider` / `providerOrder` / `providerAlwaysOn` settings. Undefined ⇒
 * "spaces".
 */
export type SubagentProviderMode = "parent" | "spaces" | "fast-model";

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
 * Where an agent-scoped credential's OAuth refresh must single-flight and
 * persist. Binding rows (sharedCredentialId set) refresh against the SHARED
 * row — one live provider session for every bound agent — while dedicated
 * rows keep the per-agent key/write-back. Used by every agent-cred refresh
 * site (this file, webhook.ts, agent-chat.ts) so the target logic can't drift.
 */
export function agentCredRefreshTarget(
  agentId: string,
  provider: string,
  row: { sharedCredentialId?: string | null },
): { credKey: string; persist: (enc: { encryptedKey: string; iv: string; authTag: string }) => Promise<void> } {
  const sharedId = row.sharedCredentialId;
  if (sharedId) {
    return {
      credKey: `shared:${sharedId}:${provider}`,
      persist: async (enc) => {
        await sharedProviderCredentialRepository.persistBundle(sharedId, enc);
      },
    };
  }
  return {
    credKey: `agent:${agentId}:${provider}`,
    persist: async (enc) => {
      await agentProviderCredentialsRepository.upsert(agentId, provider, enc);
    },
  };
}

/** User-scope twin of agentCredRefreshTarget: personal credential rows can
 *  also be bindings to a shared credential (the "connect once personally,
 *  share to agents" flow), in which case the refresh must target the shared
 *  row — otherwise the personal copy and the shared copy would hold two
 *  OAuth sessions of the same account and invalidate each other. */
export function userCredRefreshTarget(
  userId: string,
  provider: string,
  row: { sharedCredentialId?: string | null },
): { credKey: string; persist: (enc: { encryptedKey: string; iv: string; authTag: string }) => Promise<void> } {
  const sharedId = row.sharedCredentialId;
  if (sharedId) {
    return {
      credKey: `shared:${sharedId}:${provider}`,
      persist: async (enc) => {
        await sharedProviderCredentialRepository.persistBundle(sharedId, enc);
      },
    };
  }
  return {
    credKey: `user:${userId}:${provider}`,
    persist: async (enc) => {
      await userProviderCredentialsRepository.upsert(userId, provider, enc);
    },
  };
}

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
    // Codex & Claude OAuth-mode store a JSON bundle; pull the bare access_token.
    const apiKey =
      provider === "codex" ? extractCodexBearer(decrypted) :
      provider === "claude" ? extractClaudeBearer(decrypted) :
      decrypted;
    // Keep in sync with defaultModelForProvider() in services/providerCredentials.ts,
    // which documents the measured ok-rates behind these choices. A stale id here
    // fails silently — ~300ms error, read as an empty completion, fallback to
    // spaces, no ERROR logged.
    const defaultModel =
      // gpt-4o is NOT servable through Copilot OAuth here (0 ok / 21 fail over
      // 72h) — every defaulted call fell back to spaces.
      provider === "copilot" ? "claude-sonnet-4.6" :
      // gpt-4.1 is NOT servable through Codex ChatGPT-account OAuth (OpenAI
      // 400s "model is not supported when using Codex with a ChatGPT
      // account") — every defaulted call failed and fell back to spaces.
      provider === "codex" ? "gpt-5.5" :
      // Provisioned LiteLLM credentials do not carry a per-key model. Honor
      // the deployment's configured model so existing rows created before the
      // config was set do not keep falling back to private-large.
      provider === "litellm" ? (CONFIG.litellmModel ?? "private-large") :
      // claude-sonnet-4-5 is no longer servable on the anthropic-user OAuth
      // path (0 ok / 1425 fail over 72h).
      "claude-opus-4-8";
    return {
      apiKey,
      model: row.model ?? defaultModel,
      ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
      ...(row.authType ? { authType: row.authType } : {}),
      ...(row.reasoningEffort ? { reasoningEffort: row.reasoningEffort } : {}),
    };
  } catch (err) {
    log.error(`Failed to decrypt ${provider} key for agent`, { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/** User's litellm key for an S2S judge/curator call: personal USER-managed, else
 *  SYSTEM-provisioned, else undefined (caller omits; claw fails-open). Agent-level
 *  creds are NOT considered here — the worker turn already prefers them.
 *
 *  The caller may pass a raw Spaces userId; provisioning stores the key under the
 *  canonical claw userId (which differs when ensureUserExists email-linked the
 *  Spaces id to a pre-existing claw row). Translate first so the lookup matches. */
export async function resolveUserLitellmApiKey(userId: string): Promise<string | undefined> {
  // Translate a raw Spaces id → canonical claw id (no-op when they're the same).
  const canonicalId = (await resolveClawUserIdForSpacesIdentity(userId).catch(() => undefined)) ?? userId;
  for (const managedBy of ["USER", "SYSTEM"] as const) {
    const row = await userProviderCredentialsRepository
      .findByUserAndProvider(canonicalId, "litellm", managedBy)
      .catch(() => null);
    if (row) {
      const cfg = buildProviderConfig("litellm", row);
      if (cfg?.apiKey) return cfg.apiKey;
    }
  }
  return undefined;
}

/** Org's litellm key for an org-identity call (no user context). NOT a universal
 *  fallback — a user's key is resolved instead where meaningful; a missing user key
 *  does NOT fall through to the org key (would re-attribute spend). Miss → claw fails-open. */
export async function resolveOrgLitellmApiKey(orgId: string): Promise<string | undefined> {
  const row = await orgProviderCredentialsRepository
    .findByOrgAndProvider(orgId, "litellm")
    .catch(() => null);
  if (!row) return undefined;
  // OrgProviderCredential has no model/baseUrl/authType — fill null; buildProviderConfig applies litellm defaults.
  return buildProviderConfig("litellm", {
    encryptedKey: row.encryptedKey,
    iv: row.iv,
    authTag: row.authTag,
    model: CONFIG.litellmModel,
    baseUrl: null,
    authType: null,
    reasoningEffort: null,
  })?.apiKey ?? undefined;
}

/** CredRow + `provider` key; user rows also carry `managedBy` (picks the tier).
 *  Agent-level rows lack `managedBy` and are always tier 2. */
export type TieredCredRow = CredRow & { provider: string; managedBy?: string | null };

export type ProviderScope = "user" | "system" | "agent";

/** Per-provider config map for a HUMAN chat dispatch, 3-tier precedence (single
 *  source of truth — webhook.ts and agent-chat.ts both call this): personal
 *  USER-managed > agent-level shared > system-managed/provisioned. `allCreds` =
 *  user rows (USER+SYSTEM), `agentCreds` = agent-level (incl. shared). When
 *  `userDeferredToAgent` is set (user picked "spaces") tier 1 is skipped so the
 *  run uses the agent's/shared creds + the system key, not the user's personal keys. */
export function buildProviderConfigsTiered(
  allCreds: TieredCredRow[],
  agentCreds: TieredCredRow[],
  opts: { userDeferredToAgent?: boolean } = {},
): {
  providerConfigs: Record<string, ProviderConfig>;
  providerScope: Record<string, ProviderScope>;
} {
  const providerConfigs: Record<string, ProviderConfig> = {};
  const providerScope: Record<string, ProviderScope> = {};
  // Tier 1 — personal USER-managed (highest). Skipped on defer-to-agent.
  if (!opts.userDeferredToAgent) {
    for (const row of allCreds) {
      if (row.managedBy === "SYSTEM") continue; // system applied last (tier 3)
      const cfg = buildProviderConfig(row.provider, row);
      if (cfg) {
        providerConfigs[row.provider] = cfg;
        providerScope[row.provider] = "user";
      }
    }
  }
  // Tier 2 — agent-level (incl. shared bindings). Beats system-managed.
  for (const row of agentCreds) {
    if (providerConfigs[row.provider]) continue; // personal USER wins
    const cfg = buildProviderConfig(row.provider, row);
    if (cfg) {
      providerConfigs[row.provider] = cfg;
      providerScope[row.provider] = "agent";
    }
  }
  // Tier 3 — system-managed / provisioned. Fills remaining gaps.
  for (const row of allCreds) {
    if (row.managedBy !== "SYSTEM") continue;
    if (providerConfigs[row.provider]) continue; // personal USER or shared already set
    const cfg = buildProviderConfig(row.provider, row);
    if (cfg) {
      providerConfigs[row.provider] = cfg;
      providerScope[row.provider] = "system";
    }
  }
  return { providerConfigs, providerScope };
}

/** Provider creds + fallback order for a HEADLESS run (agent's app identity, no
 *  human session): agent-level creds + providerOrder + the `providerAlwaysOn` switch.
 *  kimi-first (`=== false`) ⇒ empty order → platform default (no escalation path
 *  headless; creds still returned); else the agent's provider wins. */
export async function resolveAgentProviderConfigs(
  agent: { id: string; config?: unknown },
  opts: { headlessBulk?: boolean; userId?: string; orgId?: string } = {},
): Promise<ResolvedAgentProviders> {
  const cfg = (agent.config as Record<string, unknown> | null) ?? null;

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
        config: { ...(cfg ?? {}), provider: automationProvider, providerOrder: [automationProvider], providerAlwaysOn: true },
      };
      log.info(`Provider resolution (headless-bulk): agent=${agent.id} automationProvider=${automationProvider} → forced parent`);
      return resolveAgentProviderConfigs(bulkAgent);
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

  // Gap-fill the user's provisioned (SYSTEM) creds below agent-level (incl. shared)
  // — a shared cred wins, but the provisioned key serves agents with no premium cred.
  // Only when a userId is in scope (headless; a user may not be meaningful, e.g. callee_app).
  if (opts?.userId) {
    const userSystemCreds = await userProviderCredentialsRepository
      .listByUser(opts.userId, { managedBy: "SYSTEM" })
      .catch(() => []);
    for (const row of userSystemCreds) {
      if (providerConfigs[row.provider]) continue; // agent-level (incl. shared) wins
      const built = buildProviderConfig(row.provider, row);
      if (built) providerConfigs[row.provider] = built;
    }
  }

  // Gap-fill the ORG's litellm key (below agent-level AND user SYSTEM). For A2A
  // `callee_app` runs, which run under the callee's own app identity — NOT the
  // delegating user — so the user's key is NOT folded (would mis-attribute their
  // budget; confused-deputy). The org owns the agent's app identity, so it's the
  // honest spend-owner. Litellm-only; miss → no slot → shared server key (main run
  // path only). NOT a universal fallback.
  if (opts?.orgId && !providerConfigs["litellm"]) {
    const orgRow = await orgProviderCredentialsRepository
      .findByOrgAndProvider(opts.orgId, "litellm")
      .catch(() => null);
    if (orgRow) {
      const built = buildProviderConfig("litellm", {
        encryptedKey: orgRow.encryptedKey,
        iv: orgRow.iv,
        authTag: orgRow.authTag,
        model: CONFIG.litellmModel,
        baseUrl: null,
        authType: null,
        reasoningEffort: null,
      });
      if (built) providerConfigs["litellm"] = built;
    }
  }

  // Refresh short-lived OAuth tokens before use (persist the rotated token back
  // to the agent cred row), same as the chat path. api_key / not-yet-expired
  // tokens pass through with no network call.
  const claudeCfg = providerConfigs["claude"];
  if (claudeCfg && claudeCfg.authType === "oauth_token") {
    const credRow = agentCredsByProvider.get("claude");
    if (credRow) {
      const target = agentCredRefreshTarget(agent.id, "claude", credRow);
      try {
        claudeCfg.apiKey = await getValidClaudeBearer(target.credKey, credRow, target.persist);
      } catch (err) {
        log.warn("Claude OAuth refresh failed for agent — credential likely needs reconnect", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  const codexCfg = providerConfigs["codex"];
  if (codexCfg && codexCfg.authType === "oauth_token") {
    const credRow = agentCredsByProvider.get("codex");
    if (credRow) {
      const target = agentCredRefreshTarget(agent.id, "codex", credRow);
      try {
        codexCfg.apiKey = await getValidCodexBearer(target.credKey, credRow, target.persist);
      } catch (err) {
        log.warn("Codex OAuth refresh failed for agent — credential likely needs reconnect", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // kimi-first: no escalation path headless. If a provisioned litellm cred is
  // present, run on IT as the primary (carries the user's budget; the platform
  // default would use the pod's shared server key). Else empty order → shared server.
  const providerAlwaysOn = cfg?.["providerAlwaysOn"] !== false;
  if (!providerAlwaysOn) {
    const kimiParent = providerConfigs["litellm"] ? "litellm" : undefined;
    log.info(`Provider resolution (headless): agent=${agent.id} mode=kimi-first parent=${kimiParent ?? "spaces"} creds=[${Object.keys(providerConfigs).join(",")}]`);
    return {
      providerConfigs,
      providerOrder: kimiParent ? [kimiParent] : [],
      ...(kimiParent ? { provider: kimiParent, parent: kimiParent } : {}),
    };
  }

  // always-on: the agent's provider wins. Resolve the parent, then the order.
  // When an order exists but nothing in it has creds, fall back to its FIRST
  // entry (`primaryParent` maps a credential-less name like `spaces` to the
  // platform default) — never to a key the user saved but didn't select.
  // Mirrors agent-chat.ts. Bare-credential fallback: only when no order is set.
  let parent: string | undefined;
  if (agentProviderOrder.length > 0) {
    parent = agentProviderOrder.find((p) => providerConfigs[p]) ?? agentProviderOrder[0];
  }
  if (!parent && agentLevelProvider && providerConfigs[agentLevelProvider]) parent = agentLevelProvider;
  if (!parent && agentProviderOrder.length === 0) parent = Object.keys(providerConfigs)[0];
  // Provisioned litellm fallback: if nothing higher resolved, default to the user's
  // provisioned key so the run uses their budgeted identity, not the pod server key.
  if (!parent && providerConfigs["litellm"]) parent = "litellm";

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
