/**
 * Internal FailureCurator endpoint — called by claw-auth's hourly worker.
 *
 * Mirrors /internal/user-memory/distill: claw owns the LLM call, claw-auth
 * has the DB and the negative-session detection. S2S-protected.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { curateImprovements, type CuratorRequest } from "../failure-curator.js";

import { createLogger } from "../logger.js";
const log = createLogger("failure-curator");

export const failureCuratorRouter = Router();

failureCuratorRouter.post("/internal/failure-curator/distill", validateS2SKey, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Partial<CuratorRequest>;
    if (!body.agentSlug || !Array.isArray(body.newNegatives)) {
      res.status(400).json({ success: false, error: "Missing agentSlug or newNegatives[]" });
      return;
    }
    if (body.newNegatives.length === 0) {
      res.json({ success: true, candidates: [] });
      return;
    }
    const candidates = await curateImprovements(body as CuratorRequest);
    res.json({ success: true, candidates });
  } catch (err) {
    log.error(`[failure-curator-route] distill failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});
