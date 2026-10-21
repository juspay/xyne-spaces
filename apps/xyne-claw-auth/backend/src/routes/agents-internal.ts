/**
 * Spaces → claw: "is this Spaces app a Claw agent?"
 *
 * Spaces decides a new app user's `userType` (AGENT vs APP) at install time and
 * cannot tell on its own — only claw-auth records which app an agent is
 * published as (`Agent.spacesAppId`, unique). This answers from that link alone.
 *
 * Deliberately NOT the `/agents` list: that one applies visibility (global only
 * for S2S), org scope and the `enabled` filter, so personal/cloned and disabled
 * agents would read as "not an agent" and be stamped APP permanently.
 *
 * Mounted under `requireInternalS2S` — the caller is the Spaces backend, which
 * holds INTERNAL_S2S_KEY (not XYNE_CLAW_S2S_KEY).
 */

import { Router, type Request, type Response } from "express";
import { agentRepository } from "../repositories/index.js";
import { createLogger } from "../logger.js";

const log = createLogger("agents-internal");

export const agentsInternalRouter = Router();

agentsInternalRouter.get("/by-spaces-app/:spacesAppId", async (req: Request<{ spacesAppId: string }>, res: Response) => {
  const spacesAppId = req.params.spacesAppId.trim();
  if (!spacesAppId) {
    res.status(400).json({ success: false, error: "spacesAppId required" });
    return;
  }
  try {
    const agent = await agentRepository.findBySpacesAppId(spacesAppId);
    res.json({ success: true, data: { isAgent: agent !== null } });
  } catch (err) {
    // Fail loudly: the caller must not read an error as "not an agent".
    log.error(`[agents-internal] by-spaces-app lookup failed spacesAppId=${spacesAppId}:`, err);
    res.status(500).json({ success: false, error: "Agent lookup failed" });
  }
});
