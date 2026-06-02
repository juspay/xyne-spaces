/**
 * TEMPORARY admin endpoint to backfill `agents.signingSecret` for agents
 * that existed before the column was introduced.
 *
 * Reads each agent's signing secret directly from the Spaces DB
 * (`installed_apps.signingSecret`) via the existing SPACES_DB_URL read-only
 * connection — the same path used for user-session reads. Decrypts with
 * SPACES_ENCRYPTION_KEY, re-encrypts with claw-auth's own AES-256-GCM,
 * persists. No per-user Spaces ACL involved (the API path was subject to
 * Spaces' "admin or app creator" check, which failed for agents created by
 * other users — the DB path sidesteps it entirely).
 *
 * Mount: see `main.ts` — exposed at POST /admin/backfill-signing-secrets.
 *
 * DELETE THIS FILE (and the import + app.use line in main.ts) once all
 * agents have been backfilled and verification is in enforce mode. Re-running
 * is safe — only touches rows where signingSecret IS NULL.
 *
 * Auth: the existing `requireAuth` middleware on `/admin/*` validates the
 * Spaces user JWT; we additionally require `isClawAdmin` so a non-admin
 * can't trigger the backfill or enumerate agents via the response.
 *
 * Pre-reqs:
 *   - SPACES_ENCRYPTION_KEY set (= xyne-spaces backend's ENCRYPTION_KEY)
 *   - SPACES_DB_URL configured with GRANT SELECT ON public.installed_apps
 */
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";
import { backfillSigningSecretFromSpacesDb } from "../lib/spaces-app-secret.js";

const router = Router();

router.post("/backfill-signing-secrets", async (req: Request, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "x-user-id required" });
    return;
  }
  if (!(await isClawAdmin(requesterId))) {
    res.status(403).json({ success: false, error: "admin only" });
    return;
  }

  const agents = await prisma.agent.findMany({
    where: { spacesAppId: { not: null }, signingSecret: null },
    select: { id: true, slug: true, spacesAppId: true },
  });

  console.log(`[admin-backfill] requesterId=${requesterId} agents-to-backfill=${agents.length}`);

  const results: Array<{ slug: string; agentId: string; ok: boolean }> = [];
  let okCount = 0;
  let failCount = 0;
  for (const agent of agents) {
    const ok = await backfillSigningSecretFromSpacesDb({
      agentId: agent.id,
      spacesAppId: agent.spacesAppId!,
    });
    results.push({ slug: agent.slug, agentId: agent.id, ok });
    if (ok) okCount += 1; else failCount += 1;
  }

  console.log(`[admin-backfill] requesterId=${requesterId} ok=${okCount} failed=${failCount}`);

  res.json({
    success: true,
    data: { total: agents.length, ok: okCount, failed: failCount, results },
  });
});

export { router as adminBackfillSigningSecretsRouter };
