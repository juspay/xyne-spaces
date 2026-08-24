/**
 * Internal platform model listing — called by claw-auth's litellm-models
 * endpoint when an agent has no own-key LiteLLM credential (the normal case:
 * agents on the keyless "spaces" platform provider).
 *
 * Why on claw, not claw-auth: LITELLM_API_KEY lives on claw (the agent
 * runtime). Listing models here keeps that credential scoped to one pod, same
 * as entity-llm and /eval-models. Only model ids leave this process — never
 * the key.
 *
 * Filtering: chat-scoped, deliberately broader than /eval-models'
 * listJudgeModels (hosted_vllm only — kimi is litellm_proxy and would vanish,
 * despite being the platform default). We keep INTERNAL providers
 * (hosted_vllm, litellm_proxy) and drop embeddings; external paid providers
 * (vertex_ai etc.) are budget-blocked on the proxy and would fail at run
 * time. If /model/info is unavailable, fall back to /v1/models minus
 * claude/gemini (the same exclusion modelSyncService applies) and embeddings.
 *
 * S2S-protected via the existing x-s2s-key middleware.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { LITELLM } from "../config.js";

import { createLogger } from "../logger.js";
const log = createLogger("litellm-models");

const INTERNAL_PROVIDERS = new Set(["hosted_vllm", "litellm_proxy"]);
const EXCLUDED_NAME = /^(claude|gemini)/i;

async function listPlatformChatModels(): Promise<string[]> {
  if (!LITELLM.apiKey) return [];
  const headers = { Authorization: `Bearer ${LITELLM.apiKey}` };
  const root = LITELLM.url.replace(/\/+$/, "");
  try {
    const res = await fetch(`${root}/model/info`, { headers, signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const data = (await res.json()) as {
        data?: Array<{ model_name?: unknown; litellm_params?: { custom_llm_provider?: unknown } }>;
      };
      const usable = new Set<string>();
      for (const m of data.data ?? []) {
        const name = typeof m.model_name === "string" ? m.model_name : "";
        const prov = typeof m.litellm_params?.custom_llm_provider === "string" ? m.litellm_params.custom_llm_provider : "";
        if (name && INTERNAL_PROVIDERS.has(prov) && !/embed/i.test(name)) usable.add(name);
      }
      if (usable.size > 0) return [...usable].sort();
    }
  } catch {
    /* fall through to the visibility list */
  }
  const res = await fetch(`${root}/v1/models`, { headers, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Models endpoint ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ id?: unknown }> };
  return (data.data ?? [])
    .map((m) => (typeof m.id === "string" ? m.id : ""))
    .filter((id) => id && !EXCLUDED_NAME.test(id) && !/embed/i.test(id))
    .sort();
}

export const litellmModelsRouter = Router();

litellmModelsRouter.get("/internal/litellm/models", validateS2SKey, async (_req: Request, res: Response) => {
  try {
    // Empty when LITELLM_API_KEY is unset — the caller's "hide the picker"
    // contract, not an error.
    const names = await listPlatformChatModels();
    const models = names.map((id) => ({ id, name: id }));
    res.json({ success: true, data: models, defaultModel: LITELLM.model || null });
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    const message = err instanceof Error ? err.message : "Failed to fetch models";
    log.error(`[litellm-models] platform listing failed: ${message}${cause}`);
    res.status(500).json({ success: false, error: `${message}${cause}` });
  }
});
