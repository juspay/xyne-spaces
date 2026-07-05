import { agentProviderCredentialsRepository } from "../repositories/index.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { extractCodexBearer } from "./codex-creds.js";
import { extractClaudeBearer } from "./claude-creds.js";
import { getValidClaudeBearer } from "./claude-oauth-refresh.js";
import { getValidCodexBearer } from "./codex-oauth-refresh.js";
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
  /** Decrypted, ready-to-use creds keyed by provider. Empty ⇒ run on the platform default (spaces/LiteLLM). */
  providerConfigs: Record<string, ProviderConfig>;
  /** The fallback chain claw-pod may walk on quota exhaustion. */
  providerOrder: string[];
}

const KNOWN_PROVIDERS = new Set(["codex", "claude", "copilot", "openrouter", "spaces"]);

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
 *
 * An explicit `subagentProviders[name]` override ALWAYS wins over this default.
 * Stored on the agent's JSONB config as `subagentProviderMode`, alongside the
 * existing `provider` / `providerOrder` / `providerAlwaysOn` settings. Undefined ⇒
 * "spaces".
 */
export type SubagentProviderMode = "parent" | "spaces";

export function resolveSubagentProviderMode(config?: unknown): SubagentProviderMode {
  const cfg = (config as Record<string, unknown> | null) ?? null;
  return cfg?.["subagentProviderMode"] === "parent" ? "parent" : "spaces";
}

type CredRow = {
  encryptedKey: string | null;
  iv: string | null;
  authTag: string | null;
  model: string | null;
  baseUrl: string | null;
  authType: string | null;
  reasoningEffort: string | null;
};

/** Decrypt + shape one credential row into a ProviderConfig (null on failure). Mirrors webhook.ts:buildProviderConfig. */
function buildProviderConfig(provider: string, row: CredRow): ProviderConfig | null {
  if (!row.encryptedKey || !row.iv || !row.authTag) return null;
  try {
    const decrypted = decrypt(row.encryptedKey, row.iv, row.authTag, CONFIG.encryptionKey);
    // Codex & Claude OAuth-mode store a JSON bundle; pull the bare access_token.
    const apiKey =
      provider === "codex" ? extractCodexBearer(decrypted) :
      provider === "claude" ? extractClaudeBearer(decrypted) :
      decrypted;
    const defaultModel =
      provider === "copilot" ? "gpt-4o" :
      provider === "codex" ? "gpt-4.1" :
      "claude-sonnet-4-5";
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

/**
 * Resolve the provider credentials + fallback order for a HEADLESS run (event
 * trigger, scheduled job, automation) that executes under the agent's app
 * identity — no human session, no personal creds, no `/upgrade` escalation.
 *
 * This is the agent-scoped subset of the human-chat resolver in webhook.ts
 * (~1465–1648): agent-level credentials only, agent's configured provider order,
 * and the same `providerAlwaysOn` policy switch. Without it, headless runs
 * silently drop to the platform default (spaces/LiteLLM) instead of the agent's
 * configured premium provider.
 *
 * Policy:
 *  - `providerAlwaysOn !== false` (default / legacy): the agent's provider wins
 *    — providerOrder → legacy `config.provider` → any provider with creds.
 *  - `providerAlwaysOn === false` (kimi-first): the agent's provider is
 *    escalation-only, and headless runs have no escalation path, so we return
 *    NO order ⇒ the run uses the platform default (the owner's deliberate
 *    cheap-by-default choice). Creds are still returned so a future escalation
 *    path could use them.
 */
export async function resolveAgentProviderConfigs(
  agent: { id: string; config?: unknown },
): Promise<ResolvedAgentProviders> {
  const cfg = (agent.config as Record<string, unknown> | null) ?? null;

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

  // Refresh short-lived OAuth tokens before use (persist the rotated token back
  // to the agent cred row), same as the chat path. api_key / not-yet-expired
  // tokens pass through with no network call.
  const claudeCfg = providerConfigs["claude"];
  if (claudeCfg && claudeCfg.authType === "oauth_token") {
    const credRow = agentCredsByProvider.get("claude");
    if (credRow) {
      try {
        claudeCfg.apiKey = await getValidClaudeBearer(`agent:${agent.id}:claude`, credRow, async (enc) => {
          await agentProviderCredentialsRepository.upsert(agent.id, "claude", enc);
        });
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
      try {
        codexCfg.apiKey = await getValidCodexBearer(`agent:${agent.id}:codex`, credRow, async (enc) => {
          await agentProviderCredentialsRepository.upsert(agent.id, "codex", enc);
        });
      } catch (err) {
        log.warn("Codex OAuth refresh failed for agent — credential likely needs reconnect", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // kimi-first agents: no escalation path headless ⇒ defer to the platform default.
  const providerAlwaysOn = cfg?.["providerAlwaysOn"] !== false;
  if (!providerAlwaysOn) {
    log.info(`Provider resolution (headless): agent=${agent.id} mode=kimi-first → platform default; creds=[${Object.keys(providerConfigs).join(",")}]`);
    return { providerConfigs, providerOrder: [] };
  }

  // always-on: the agent's provider wins. Resolve the parent, then the order.
  let parent: string | undefined;
  if (agentProviderOrder.length > 0) parent = agentProviderOrder.find((p) => providerConfigs[p]);
  if (!parent && agentLevelProvider && providerConfigs[agentLevelProvider]) parent = agentLevelProvider;
  if (!parent) parent = Object.keys(providerConfigs)[0];

  const providerOrder = agentProviderOrder.length > 0 ? agentProviderOrder : parent ? [parent] : [];
  log.info(`Provider resolution (headless): agent=${agent.id} mode=always-on parent=${parent ?? "spaces"} creds=[${Object.keys(providerConfigs).join(",")}] order=[${providerOrder.join(",")}]`);
  return { providerConfigs, providerOrder };
}
