import { Router, type Request, type Response } from "express";
import { errMsg } from "../lib/errors.js";
import {
  decideGitScope,
  gitScopeSigningKey,
  parseGitScopeRequest,
  resolveGitScopeRunScope,
} from "../lib/git-scope-signing.js";
import { loadEffectiveRepoConfigs } from "../lib/sandbox-repo-configs.js";
import { requireRuntime } from "../lib/service-assertion.js";
import { requireSessionToken } from "../middleware/require-session-token.js";
import { createLogger } from "../logger.js";

const log = createLogger("git-scope");
const router = Router();

// Scoped to /git-scope: a bare "/:sessionId" guard shadows other /sessions/:id routes (see routes/mcp.ts).
router.use("/:sessionId/git-scope", requireRuntime, requireSessionToken);

/**
 * POST /claw/api/v1/sessions/:sessionId/git-scope
 * body { profile, claimName, namespace, template, endTime }  →  200 { token }
 * 400 bad input · 404 unknown, disabled or another workspace's profile · 503 not configured.
 * One log line per decision; never the token.
 */
router.post("/:sessionId/git-scope", async (req: Request, res: Response) => {
  const session = req.session!;
  const refuse = (status: number, error: string, profile?: string) => {
    log.warn(`[git-scope] refused status=${status} session=${session.sessionId} profile=${profile ?? "-"} reason=${error}`);
    res.status(status).json({ success: false, error });
  };

  const key = gitScopeSigningKey();
  if (!key) {
    refuse(503, "git-scope signing is not configured (CLAW_GIT_SCOPE_PRIVATE_KEY, CLAW_GIT_SCOPE_KEY_ID)");
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const parsed = parseGitScopeRequest(req.body, now);
  if (!parsed.ok) {
    refuse(400, parsed.error);
    return;
  }
  const { request } = parsed;
  try {
    const run = await resolveGitScopeRunScope(session);
    const configs = await loadEffectiveRepoConfigs(run.workspaceId);
    const decision = decideGitScope({ request, run, configs, key, now });
    if (!decision.ok) {
      refuse(decision.status, decision.error, request.profile);
      return;
    }
    log.info(
      `[git-scope] signed session=${session.sessionId} profile=${request.profile} claim=${request.namespace}/${request.claimName} template=${request.template} exp=${request.endTime} repos=${decision.repoCount} kid=${key.kid}`,
    );
    res.json({ token: decision.token });
  } catch (err) {
    log.error(`[git-scope] failed session=${session.sessionId} profile=${request.profile}: ${errMsg(err)}`);
    res.status(500).json({ success: false, error: "git-scope signing failed" });
  }
});

export { router as gitScopeRouter };
