/**
 * Spaces → claw workflow code-execution proxy (workflow v2 CODE step, run_code).
 *
 * The Spaces backend has no access to the Kata sandbox cluster; the xyne-claw runtime does. The
 * backend posts a run here; we check it and forward it to the runtime's
 * `/internal/workflow-sandbox/run`, which runs it in a fresh sandbox and returns stdout/stderr and
 * output files.
 *
 * Mounted under `requireInternalS2S`: the caller is the Spaces backend (INTERNAL_S2S_KEY). The
 * onward hop uses the runtime's own S2S key (XYNE_CLAW_S2S_KEY), same as the other proxies here.
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import { parseWorkflowSandboxRunRequest, WorkflowSandboxRequestError } from "xyne-claw-shared";
import { CONFIG } from "../config.js";
import { streamDispatcher } from "../lib/consume-claw-stream.js";
import { createLogger } from "../logger.js";

const log = createLogger("workflow-sandbox");

export const workflowSandboxInternalRouter = Router();

/** Past the run's own timeout: sandbox start-up (no warm pool), file transfer and teardown. */
const OVERHEAD_MS = 5 * 60 * 1000;
const DEFAULT_RUN_TIMEOUT_MS = 30_000;

const RUN_PATH = "/claw/api/v1/internal/workflow-sandbox/run";

/**
 * Serve only the exact path. Express matches routes (and the mount prefix) case-insensitively and Istio matches paths
 * exactly, so without this a variant like /claw/api/v1/internal/Workflow-Sandbox/run would be served while slipping past
 * the mesh rules that admit only the workflow worker (AuthorizationPolicy xyne-claw-auth, xyne-claw-auth-deny-workflow-sandbox).
 */
function exactPathOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.originalUrl.split("?")[0] !== RUN_PATH) {
    res.status(404).json({ success: false, error: "not found" });
    return;
  }
  next();
}

workflowSandboxInternalRouter.post("/run", exactPathOnly, async (req: Request, res: Response) => {
  // Reject a bad request here rather than spending a hop on it; claw checks it again.
  let timeoutMs: number;
  try {
    timeoutMs = parseWorkflowSandboxRunRequest(req.body).timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  } catch (err) {
    if (err instanceof WorkflowSandboxRequestError) {
      res.status(400).json({ success: false, error: err.message });
      return;
    }
    // Express 4 doesn't catch a rejection from an async handler: answer here, never re-throw.
    log.error(`[workflow-sandbox] request check failed: ${(err as Error).message}`);
    res.status(500).json({ success: false, error: "internal error" });
    return;
  }

  try {
    const clawRes = await fetch(`${CONFIG.xyneClawUrl}/internal/workflow-sandbox/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(timeoutMs + OVERHEAD_MS),
      // The response only starts when the run ends: no undici header/body timeout (default 300s);
      // the signal above bounds it. `dispatcher` is an undici extension not in the DOM type.
      dispatcher: streamDispatcher,
    } as unknown as RequestInit);
    const data = await clawRes
      .json()
      .catch(() => ({ success: false, error: "invalid JSON from the sandbox runtime" }));
    res.status(clawRes.status).json(data);
  } catch (err) {
    log.error("[workflow-sandbox] proxy error:", err);
    res.status(502).json({ success: false, error: "Failed to reach the sandbox runtime" });
  }
});
