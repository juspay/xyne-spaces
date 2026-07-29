/**
 * Eval-side provider credential helpers: decrypt a stored credential row into
 * a usable runtime config, plus the user-Copilot resolution the eval workers
 * use for extraction/judging. (webhook/agent-chat keep their own inline
 * versions — they evolve with provider features like Claude OAuth refresh.)
 */
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { extractCodexBearer } from "../lib/codex-creds.js";

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

/** Per-provider model used when the credential row doesn't pin one. */
function defaultModelForProvider(provider: string): string {
  if (provider === "copilot") return "gpt-4o";
  // gpt-4.1 is NOT servable through Codex ChatGPT-account OAuth (400
  // "model is not supported when using Codex with a ChatGPT account").
  if (provider === "codex") return "gpt-5.5";
  return "claude-sonnet-4-5";
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
    // Codex OAuth-mode stores a JSON bundle ({access_token, refresh_token, …});
    // pull out the bare access_token so downstream sees a usable Bearer string.
    const apiKey = provider === "codex" ? extractCodexBearer(decrypted) : decrypted;
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
