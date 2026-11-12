/**
 * Spaces → claw attachment-ingestion proxy.
 *
 * The Spaces backend talks to LiteLLM directly and has no document parsers, so
 * it posts document attachments here; we forward them to the xyne-claw runtime's
 * `/internal/attachments/ingest`, which runs the converter pipeline and returns
 * extracted markdown.
 *
 * Mounted under requireAnyService (service assertion; callers: claw-auth's own
 * MCP tools and the runtime). The onward hop to the runtime carries claw-auth's
 * service assertion, same as the other proxies here.
 */

import { Router, type Request, type Response } from "express";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { serviceAuthHeaders } from "../lib/service-assertion.js";

const log = createLogger("attachments-ingest");

export const attachmentsInternalRouter = Router();

// Extraction of a large deck / multi-MB PDF can take a while; give the runtime
// generous headroom before we give up and let the caller fall back to text-only.
const INGEST_TIMEOUT_MS = 120_000;

attachmentsInternalRouter.post("/ingest", async (req: Request, res: Response) => {
  try {
    const ingestUrl = `${CONFIG.xyneClawUrl}/internal/attachments/ingest`;
    const clawRes = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...serviceAuthHeaders("xyne-claw", "POST", ingestUrl),
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
