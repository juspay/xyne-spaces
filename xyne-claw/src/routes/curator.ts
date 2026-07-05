/**
 * Internal curator endpoint — called by claw-auth at batch-approval time.
 *
 * Why on claw, not claw-auth: LITELLM_API_KEY lives on claw (the agent
 * runtime). Running the curator here keeps that credential scoped to one
 * pod and preserves the "all LLM calls happen on claw" invariant.
 *
 * S2S-protected via the existing x-s2s-key middleware.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { distillSession } from "../curator.js";
import type { SessionTranscriptForCurator } from "xyne-claw-shared";

import { createLogger } from "../logger.js";
const log = createLogger("curator");

export const curatorRouter = Router();

curatorRouter.post("/internal/curator/distill", validateS2SKey, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Partial<SessionTranscriptForCurator>;

    // Minimum validation — anything else flagged at the LLM/validation layer.
    if (!body.sessionId || !body.agentSlug || !body.userId || typeof body.task !== "string") {
      res.status(400).json({
        success: false,
        error: "Missing required fields: sessionId, agentSlug, userId, task",
      });
      return;
    }

    const transcript: SessionTranscriptForCurator = {
      sessionId: body.sessionId,
      agentSlug: body.agentSlug,
      userId: body.userId,
      task: body.task,
      result: typeof body.result === "string" ? body.result : "",
      toolsUsed: Array.isArray(body.toolsUsed) ? body.toolsUsed.filter((t): t is string => typeof t === "string") : [],
      ...(typeof body.transcript === "string" ? { transcript: body.transcript } : {}),
    };

    const updates = await distillSession(transcript);
    res.json({ success: true, updates });
  } catch (err) {
    log.error(`[curator-route] distill failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Internal error",
    });
  }
});
