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
 * Reuses listJudgeModels() (the /eval-models source) rather than a raw
 * /v1/models fetch: that list is filtered to models the key can actually
 * CALL (self-hosted chat models, no budget gate), whereas /v1/models is only
 * what the key can SEE — offering budget-blocked external models in the chat
 * picker would fail at run time. The one difference from /eval-models is the
 * default: chat runs default to LITELLM.model, not the judge fastModel.
 *
 * Only claw-auth may call it (signed service assertion, middleware/auth.ts).
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { requireClawAuthService } from "../middleware/auth.js";
import { listJudgeModels } from "../eval-judge.js";
import { LITELLM } from "../config.js";

import { createLogger } from "../logger.js";
const log = createLogger("litellm-models");

export const litellmModelsRouter = Router();

litellmModelsRouter.get("/internal/litellm/models", requireClawAuthService, async (_req: Request, res: Response) => {
  try {
    // Empty when LITELLM_API_KEY is unset — the caller's "hide the picker"
    // contract, not an error.
    const names = await listJudgeModels();
    const models = names.map((id) => ({ id, name: id }));
    res.json({ success: true, data: models, defaultModel: LITELLM.model || null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch models";
    log.error(`[litellm-models] platform listing failed: ${message}`);
    res.status(500).json({ success: false, error: message });
  }
});
