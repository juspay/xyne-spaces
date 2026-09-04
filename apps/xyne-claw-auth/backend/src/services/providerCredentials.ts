/**
 * Eval-side provider credential helpers: decrypt a stored credential row into
 * a usable runtime config, plus the user-Copilot resolution the eval workers
 * use for extraction/judging. (webhook/agent-chat keep their own inline
 * versions — they evolve with provider features like Claude OAuth refresh.)
 */
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";

interface ProviderCredRow {
  encryptedKey: string | null;
  iv: string | null;
  authTag: string | null;
  model: string | null;
  baseUrl: string | null;
  authType: string | null;
  reasoningEffort: string | null;
}

interface ProviderRuntimeConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  authType?: string;
  reasoningEffort?: string;
}

/** Per-provider model used when the credential row doesn't pin one.
 *
 *  These ids GO STALE, and a stale one fails silently: the call errors in
 *  ~300ms, `producedNothing` treats it as an empty completion, and the run
 *  falls through to spaces/private-large-spaces with no ERROR logged. Users
 *  still get answers — from the wrong model — so nobody notices.
 *
 *  Measured over 72h of prod before this change:
 *    claude-sonnet-4-5     0 ok / 1425 fail   (100%)
 *    gpt-4o                0 ok /   21 fail   (100%)
 *    claude-opus-4-8    3033 ok /  191 fail   (5.9%)
 *    claude-sonnet-4.6  2608 ok /   39 fail   (1.5%)
 *
 *  Keep this list in sync with agent-provider-config.ts, and re-check it
 *  against llm_call ok-rates whenever a provider deprecates a model. */
function defaultModelForProvider(provider: string): string {
  // gpt-4o is NOT servable through Copilot OAuth here — every defaulted call
  // failed and fell back to spaces.
  if (provider === "copilot") return "claude-sonnet-4.6";
  if (provider === "codex") return "gpt-5.5";
  // claude-sonnet-4-5 is no longer servable on the anthropic-user OAuth path.
  return "claude-opus-4-8";
}

/** Decrypt a credential row into the runtime config shape claw's /run expects.
 *  Returns null when the row has no usable key or decryption fails (the caller
 *  treats that provider as not-configured). */
function buildProviderConfig(
  provider: string,
  row: ProviderCredRow,
  onError?: (provider: string, err: unknown) => void,
): ProviderRuntimeConfig | null {
  if (!row.encryptedKey || !row.iv || !row.authTag) return null;
  try {
    const decrypted = decrypt(row.encryptedKey, row.iv, row.authTag, CONFIG.encryptionKey);
    // All creds are plain API keys now — Claude and Codex OAuth were removed.
    const apiKey = decrypted;
    return {
      apiKey,
      model: row.model ?? defaultModelForProvider(provider),
      ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
      ...(row.authType ? { authType: row.authType } : {}),
      ...(row.reasoningEffort ? { reasoningEffort: row.reasoningEffort } : {}),
    };
  } catch (err) {
    onError?.(provider, err);
    return null;
  }
}

/** Providers a caller may name in configs/overrides. */
/** Sentinel the eval UI uses for "the user's Copilot connection with their
 *  configured model" in model dropdowns (extraction / judging). */
export const COPILOT_MODEL_SENTINEL = "prov:copilot";

/** Resolve the user's Copilot connection into { token, model } for direct
 *  Copilot API calls (eval extraction/judging). Null when not connected. */
export async function getUserCopilotConfig(userId: string): Promise<{ token: string; model: string } | null> {
  const { userProviderCredentialsRepository } = await import("../repositories/index.js");
  const row = await userProviderCredentialsRepository.findByUserAndProvider(userId, "copilot").catch(() => null);
  if (!row) return null;
  const cfg = buildProviderConfig("copilot", row);
  if (!cfg) return null;
  return { token: cfg.apiKey, model: cfg.model };
}
