/**
 * Internal follow-up-suggestion endpoint — called by claw-auth's instant KB
 * answer path (lib/instant-ask.ts) so it can offer the same suggested
 * next-message chips the full agentic loop already generates (run.ts).
 *
 * Why on claw, not claw-auth: generateFollowUpSuggestions (follow-up-generator.ts)
 * calls LiteLLM directly with LITELLM_API_KEY, which only lives on claw — same
 * "all LLM calls happen on claw" invariant as entity-llm.ts/instant-ask.ts.
 * claw-auth still owns everything else about the feature (the request-level
 * enable flag, conversation history, persisting the result into the run's
 * toolInvocations so the existing chip-rendering/debug-panel code — which
 * already just scans toolInvocations for these entries — picks it up
 * unchanged).
 *
 * S2S-protected via the existing x-s2s-key middleware.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import {
  generateFollowUpSuggestions,
  normalizeFollowUpAgentContext,
  normalizeFollowUpConversationHistory,
} from "../follow-up-generator.js";

import { createLogger } from "../logger.js";
const log = createLogger("follow-up-route");

export const followUpRouter = Router();

followUpRouter.post("/internal/follow-up-suggestions", validateS2SKey, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    task?: unknown;
    agentContext?: unknown;
    conversationHistory?: unknown;
  };
  if (typeof body.task !== "string" || !body.task.trim()) {
    res.status(400).json({ success: false, error: "task is required" });
    return;
  }

  try {
    const generation = await generateFollowUpSuggestions(
      body.task,
      normalizeFollowUpAgentContext(body.agentContext),
      normalizeFollowUpConversationHistory(body.conversationHistory),
      AbortSignal.timeout(60_000),
    );
    res.json({ success: true, generation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    log.error(`[follow-up-route] generation failed: ${message}`);
    res.status(500).json({ success: false, error: message });
  }
});
