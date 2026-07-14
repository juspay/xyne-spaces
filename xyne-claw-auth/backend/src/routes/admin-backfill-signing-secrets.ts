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
import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { decrypt, decryptSpacesCbc } from "../crypto.js";
import { getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";
import { backfillSigningSecretFromSpacesDb } from "../lib/spaces-app-secret.js";
import { getInstalledAppSigningSecret } from "../lib/spaces-db.js";

import { createLogger } from "../logger.js";
const log = createLogger("admin-backfill-signing-secrets");

const router = Router();

/** sha256(secret) truncated — lets us compare two secrets without revealing them. */
function fingerprint(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 12);
}

/**
 * READ-ONLY diagnostic: for a given agent slug, compare the signingSecret
 * claw-auth has STORED (decrypted with claw-auth's GCM key) against the secret
 * it would read FRESH from the Spaces DB (decrypted with SPACES_ENCRYPTION_KEY,
 * CBC). Returns only fingerprints + lengths + a match flag — never plaintext.
 *
 * Interpreting the result for a webhook `reason=mismatch` agent:
 *   - storedOk=false  → claw-auth can't even decrypt its own stored blob (key/format bug).
 *   - dbOk=false      → can't read/decrypt the Spaces DB secret (SPACES_DB_URL / SPACES_ENCRYPTION_KEY).
 *   - secretsMatch=false → stored secret is STALE vs Spaces → a forced DB re-sync fixes verification.
 *   - secretsMatch=true  → secrets agree, yet webhooks mismatch → root cause is body
 *                          canonicalization (rawBody differs from what Spaces signed), NOT the secret.
 */
router.get("/diagnose-signing-secret/:slug", async (req: Request<{ slug: string }>, res: Response) => {
  const requesterId = getRequesterId(req);
  if (!requesterId) {
    res.status(401).json({ success: false, error: "x-user-id required" });
    return;
  }
  if (!(await isClawAdmin(requesterId))) {
    res.status(403).json({ success: false, error: "admin only" });
    return;
  }

  const slug = req.params.slug;
  const agent = await prisma.agent.findFirst({
    where: { slug },
    select: { id: true, slug: true, spacesAppId: true, signingSecret: true },
  });
  if (!agent) {
    res.status(404).json({ success: false, error: `no agent with slug=${slug}` });
    return;
  }
  const duplicateAgent = await prisma.agent.findFirst({
    where: { slug, id: { not: agent.id } },
    select: { id: true },
  });
  if (duplicateAgent) {
    res.status(409).json({ success: false, error: `ambiguous agent slug=${slug}` });
    return;
  }

  // Stored secret (claw-auth GCM, format `ct:iv:tag` base64).
  let stored: { ok: boolean; fp?: string; len?: number; error?: string };
  if (!agent.signingSecret) {
    stored = { ok: false, error: "signingSecret is NULL" };
  } else {
    const parts = agent.signingSecret.split(":");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      stored = { ok: false, error: "stored blob not 3-part GCM" };
    } else {
      try {
        const p = decrypt(parts[0], parts[1], parts[2], CONFIG.encryptionKey);
        stored = { ok: true, fp: fingerprint(p), len: p.length };
      } catch (err) {
        stored = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  // Fresh secret from the Spaces DB (CBC, SPACES_ENCRYPTION_KEY).
  let db: { ok: boolean; fp?: string; len?: number; error?: string };
  if (!agent.spacesAppId) {
    db = { ok: false, error: "agent has no spacesAppId" };
  } else if (CONFIG.spacesEncryptionKey.length === 0) {
    db = { ok: false, error: "SPACES_ENCRYPTION_KEY unset" };
  } else {
    try {
      const blob = await getInstalledAppSigningSecret(agent.spacesAppId);
      if (!blob) {
        db = { ok: false, error: "no installed_apps row / null signingSecret" };
      } else {
        const p = decryptSpacesCbc(blob, CONFIG.spacesEncryptionKey);
        db = { ok: true, fp: fingerprint(p), len: p.length };
      }
    } catch (err) {
      db = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const secretsMatch = stored.ok && db.ok ? stored.fp === db.fp : null;

  res.json({
    success: true,
    data: { slug: agent.slug, agentId: agent.id, spacesAppId: agent.spacesAppId, stored, db, secretsMatch },
  });
});

/**
 * Backfill / re-sync `agents.signingSecret` from the authoritative Spaces DB.
 *
 * Default (no params): only fills agents whose `signingSecret IS NULL` — the
 * original safe backfill.
 *
 * `?overwrite=true`: ALSO re-syncs agents that already have a secret. Use this
 * to fix the `reason=mismatch` agents whose stored secret is present but stale
 * (set via the old agent-registration API path) — the DB value is authoritative
 * and `backfillSigningSecretFromSpacesDb` overwrites unconditionally.
 *
 * `?slug=<slug>`: restrict to a single agent — run this first with
 * `overwrite=true` to fix one mismatching agent, confirm its webhook starts
 * verifying, then run the full overwrite.
 */
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

  const overwrite = req.query["overwrite"] === "true";
  const slug = typeof req.query["slug"] === "string" ? req.query["slug"] : undefined;

  const agents = await prisma.agent.findMany({
    where: {
      spacesAppId: { not: null },
      // Default only touches NULL rows; overwrite also re-syncs existing secrets.
      ...(overwrite ? {} : { signingSecret: null }),
      ...(slug ? { slug } : {}),
    },
    select: { id: true, slug: true, spacesAppId: true },
  });

  log.info(`[admin-backfill] requesterId=${requesterId} overwrite=${overwrite} slug=${slug ?? "(all)"} agents-to-sync=${agents.length}`);

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

  log.info(`[admin-backfill] requesterId=${requesterId} overwrite=${overwrite} ok=${okCount} failed=${failCount}`);

  res.json({
    success: true,
    data: { overwrite, slug: slug ?? null, total: agents.length, ok: okCount, failed: failCount, results },
  });
});

export { router as adminBackfillSigningSecretsRouter };
