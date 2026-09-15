/**
 * Spaces → claw attachment-ingestion proxy.
 *
 * The Spaces backend talks to LiteLLM directly and has no document parsers, so
 * it posts document attachments here; we forward them to the xyne-claw runtime's
 * `/internal/attachments/ingest`, which runs the converter pipeline and returns
 * extracted markdown.
 *
 * Mounted under `requireInternalS2S` — the caller is the Spaces backend
 * (INTERNAL_S2S_KEY), not the claw runtime. The onward hop to the runtime uses
 * the runtime's own S2S key (XYNE_CLAW_S2S_KEY), same as the other proxies here.
 */

import { Router, type Request, type Response } from "express";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("attachments-ingest");

export const attachmentsInternalRouter = Router();

// Extraction of a large deck / multi-MB PDF can take a while; give the runtime
// generous headroom before we give up and let the caller fall back to text-only.
const INGEST_TIMEOUT_MS = 120_000;

attachmentsInternalRouter.post("/ingest", async (req: Request, res: Response) => {
  try {
    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/internal/attachments/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
    });

    const data = await clawRes
      .json()
      .catch(() => ({ success: false, error: "invalid JSON from ingest service" }));
    res.status(clawRes.status).json(data);
  } catch (err) {
    log.error("[attachments] ingest proxy error:", err);
    res.status(502).json({ success: false, error: "Failed to reach attachment ingest service" });
  }
});
