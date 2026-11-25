/**
 * Code execution for the Spaces backend's workflow v2 (CODE step, run_code). Reached only through
 * xyne-claw-auth (/claw/api/v1/internal/workflow-sandbox/run), which forwards with claw's S2S key.
 *
 *   POST /internal/workflow-sandbox/run
 *     { language: "python" | "bash", source, files?: [{ path, content (base64) }], timeoutMs? }
 *     → { success, stdout, stderr, exitCode, durationMs, error?, artifacts, skippedArtifacts }
 *
 * Each request gets a fresh Kata sandbox from WORKFLOWS_SANDBOX_TEMPLATE, destroyed before the
 * response (xyne-claw-shared runWorkflowSandbox → kata-sdk runOnce), using claw's existing
 * KUBECONFIG, KATA_ROUTER_URL and KATA_NAMESPACE.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  createWorkflowSandboxClient,
  parseWorkflowSandboxRunRequest,
  runWorkflowSandbox,
  workflowSandboxConfigFromEnv,
  WorkflowSandboxRequestError,
  type WorkflowSandboxConfig,
} from "xyne-claw-shared";
import { validateS2SKey } from "../middleware/auth.js";
import { createLogger } from "../logger.js";

const log = createLogger("workflow-sandbox");
const router = Router();

/**
 * Concurrent runs on this pod. Workflow sandboxes share the sandbox namespace's quota with claw's
 * agent sandboxes, so a burst of workflow steps must not crowd them out.
 */
const MAX_CONCURRENT = Math.max(1, Number(process.env["WORKFLOWS_SANDBOX_MAX_CONCURRENT"]) || 5);
let running = 0;

type Runner = { client: ReturnType<typeof createWorkflowSandboxClient>; cfg: WorkflowSandboxConfig };
let runner: Runner | null | undefined;
/** Built on first use; null when WORKFLOWS_SANDBOX_TEMPLATE, KATA_ROUTER_URL or KATA_NAMESPACE is unset. */
function getRunner(): Runner | null {
  if (runner !== undefined) return runner;
  const cfg = workflowSandboxConfigFromEnv();
  if (!cfg) {
    log.warn("[workflow-sandbox] WORKFLOWS_SANDBOX_TEMPLATE, KATA_ROUTER_URL or KATA_NAMESPACE not set — disabled");
    runner = null;
    return runner;
  }
  try {
    runner = { client: createWorkflowSandboxClient(cfg), cfg };
    log.info(`[workflow-sandbox] enabled (template ${cfg.template}, namespace ${cfg.namespace})`);
  } catch (err) {
    log.error(`[workflow-sandbox] Kubernetes client failed to initialise: ${(err as Error).message}`);
    runner = null;
  }
  return runner;
}

const RUN_PATH = "/internal/workflow-sandbox/run";

/**
 * Serve only the exact path. Express matches routes case-insensitively and Istio matches paths exactly, so without this a
 * variant like /internal/Workflow-Sandbox/run would be served while slipping past the mesh DENY that keeps every caller
 * but claw-auth off this route (AuthorizationPolicy xyne-claw-deny-workflow-sandbox).
 */
function exactPathOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.originalUrl.split("?")[0] !== RUN_PATH) {
    res.status(404).json({ success: false, error: "not found" });
    return;
  }
  next();
}

router.post(RUN_PATH, exactPathOnly, validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  const r = getRunner();
  if (!r) {
    res.status(503).json({ success: false, error: "workflow sandboxes are not configured" });
    return;
  }

  let parsed;
  try {
    parsed = parseWorkflowSandboxRunRequest(req.body);
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

  if (running >= MAX_CONCURRENT) {
    res.status(429).json({ success: false, error: "too many workflow sandboxes running; retry later" });
    return;
  }
  running++;
  const startedAt = Date.now();
  try {
    const result = await runWorkflowSandbox(r.client, r.cfg, parsed);
    log.info(
      `[workflow-sandbox] ${parsed.language} run: exit ${String(result.exitCode)}, ${String(result.artifacts.length)} artifact(s), ${String(Date.now() - startedAt)}ms total`,
    );
    res.json({ success: true, ...result });
  } catch (err) {
    log.error(`[workflow-sandbox] run failed after ${String(Date.now() - startedAt)}ms: ${(err as Error).message}`);
    res.status(502).json({ success: false, error: `sandbox run failed: ${(err as Error).message}` });
  } finally {
    running--;
  }
});

export { router as workflowSandboxRouter };
