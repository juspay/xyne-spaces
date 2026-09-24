/**
 * Internal UsagePatternCurator endpoint — called by claw-auth's daily synthesizer.
 *
 * Mirrors /internal/failure-curator/distill: claw owns the LLM call, claw-auth
 * has the DB, the redaction and the aggregation thresholds. S2S-protected.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { curateUsagePatterns, type UsagePatternRequest } from "../usage-pattern-curator.js";

import { createLogger } from "../logger.js";
const log = createLogger("usage-pattern-curator");

export const usagePatternCuratorRouter = Router();

usagePatternCuratorRouter.post("/internal/usage-pattern-curator/distill", validateS2SKey, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Partial<UsagePatternRequest>;
    if (!body.agentSlug || !Array.isArray(body.samples)) {
      res.status(400).json({ success: false, error: "Missing agentSlug or samples[]" });
      return;
    }
    if (body.samples.length === 0) {
      res.json({ success: true, ok: true, patterns: [], capabilities: [], markdown: "" });
      return;
    }
    const result = await curateUsagePatterns({
      agentSlug: body.agentSlug,
      ...(body.agentDescription ? { agentDescription: body.agentDescription } : {}),
      windowStart: body.windowStart ?? "",
      windowEnd: body.windowEnd ?? "",
      runCount: body.runCount ?? body.samples.length,
      distinctUsers: body.distinctUsers ?? 1,
      samples: body.samples,
      toolFrequency: Array.isArray(body.toolFrequency) ? body.toolFrequency : [],
    });
    res.json({ success: true, ...result });
  } catch (err) {
    log.error(`[usage-pattern-curator-route] distill failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ success: false, ok: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});
