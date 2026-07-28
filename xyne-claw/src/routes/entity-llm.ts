/**
 * Internal entity-extraction LLM endpoint — called by claw-auth's
 * entity-extraction pipeline.
 *
 * Why on claw, not claw-auth: LITELLM_API_KEY lives on claw (the agent
 * runtime). Keeping the completion here scopes that credential to one pod and
 * preserves the "all LLM calls happen on claw" invariant. claw-auth still owns
 * the pipeline — prompts, JSON-schema validation, the repair loop — and treats
 * this as a raw text completion.
 *
 * S2S-protected via the existing x-s2s-key middleware.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { completeEntityPrompt, parseEntityLlmMessages, EntityLlmError } from "../entity-llm.js";

import { createLogger } from "../logger.js";
const log = createLogger("entity-llm");

export const entityLlmRouter = Router();

entityLlmRouter.post("/internal/entity-llm/complete", validateS2SKey, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { messages?: unknown; purpose?: unknown };
  const purpose = typeof body.purpose === "string" ? body.purpose.slice(0, 80) : undefined;

  try {
    const messages = parseEntityLlmMessages(body.messages);
    const content = await completeEntityPrompt(messages, purpose);
    res.json({ success: true, content });
  } catch (err) {
    const status = err instanceof EntityLlmError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Internal error";
    // 4xx is a caller bug and already explicit; 5xx is worth a log line.
    if (status >= 500) log.error(`[entity-llm-route] complete failed purpose=${purpose ?? "-"}: ${message}`);
    res.status(status).json({ success: false, error: message });
  }
});
