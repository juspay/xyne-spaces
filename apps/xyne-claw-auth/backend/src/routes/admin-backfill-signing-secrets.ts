/**
 * TEMPORARY admin endpoint to backfill `agents.signingSecret` for agents
 * that existed before the column was introduced.
 *
 * Reads each agent's signing secret directly from the Spaces DB
 * (`installed_apps.signingSecret`) via the existing SPACES_DB_URL read-only
 * connection — the same path used for user-session reads. Decrypts with
 * the original Spaces key or optional key ring, re-encrypts with claw-auth's own AES-256-GCM,
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
import { errMsg } from "../lib/errors.js";
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { decrypt, decryptSpacesCbc } from "../crypto.js";
import { getRequesterId, isClawAdmin } from "../middleware/agent-acl.js";
import { backfillSigningSecretFromSpacesDbDetailed } from "../lib/spaces-app-secret.js";
import { getInstalledAppSigningSecret } from "../lib/spaces-db.js";
import { loadSpacesEncryptionRuntimeConfig } from "../spaces-encryption-key-ring-config.js";

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
        stored = { ok: false, error: errMsg(err) };
      }
    }
  }

  // Fresh secret from the Spaces DB.
  let db: {
    ok: boolean;
    fp?: string;
    len?: number;
    error?: string;
  };

  if (!agent.spacesAppId) {
    db = {
      ok: false,
      error: "agent has no spacesAppId",
    };
  } else {
    const spacesEncryptionConfig =
      loadSpacesEncryptionRuntimeConfig();

    const legacyKeyAvailable =
      CONFIG.spacesEncryptionKey.length === 32;

    if (
      !legacyKeyAvailable &&
      spacesEncryptionConfig.mode === "legacy"
    ) {
      db = {
        ok: false,
        error:
          "no usable Spaces encryption configuration",
      };
    } else {
      try {
        const blob =
          await getInstalledAppSigningSecret(
            agent.spacesAppId,
          );

        if (!blob) {
          db = {
            ok: false,
            error:
              "no installed_apps row / null signingSecret",
          };
        } else {
          const plaintext = decryptSpacesCbc(
            blob,
            CONFIG.spacesEncryptionKey,
            "admin-diagnose-signing-secret",
          );

          db = {
            ok: true,
            fp: fingerprint(plaintext),
            len: plaintext.length,
          };
        }
      } catch (err) {
        db = {
          ok: false,
          error: errMsg(err),
        };
      }
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
 *
 * `?dryRun=true`: decrypt and re-encrypt each secret
 * without changing the agents table.
 *
 * `?limit=100&after=<agentId>`: process a bounded,
 * resumable page. Pass `nextAfter` into the next request.
 */
type BackfillRouteResult =
  | {
      slug: string;
      agentId: string;
      ok: true;
      action: "validated" | "updated";
    }
  | {
      slug: string;
      agentId: string;
      ok: false;
      reason: string;
    };

router.post(
  "/backfill-signing-secrets",
  async (
    req: Request,
    res: Response,
  ) => {
    const requesterId = getRequesterId(req);

    if (!requesterId) {
      res.status(401).json({
        success: false,
        error: "x-user-id required",
      });
      return;
    }

    if (!(await isClawAdmin(requesterId))) {
      res.status(403).json({
        success: false,
        error: "admin only",
      });
      return;
    }

    const rawDryRun = req.query["dryRun"];

    if (
      rawDryRun !== undefined &&
      rawDryRun !== "true" &&
      rawDryRun !== "false"
    ) {
      res.status(400).json({
        success: false,
        error:
          "dryRun must be true or false",
      });
      return;
    }

    const dryRun = rawDryRun === "true";
    const overwrite =
      req.query["overwrite"] === "true";

    const rawSlug = req.query["slug"];

    if (
      rawSlug !== undefined &&
      (
        typeof rawSlug !== "string" ||
        !rawSlug.trim()
      )
    ) {
      res.status(400).json({
        success: false,
        error:
          "slug must be a non-empty string",
      });
      return;
    }

    const slug =
      typeof rawSlug === "string"
        ? rawSlug.trim()
        : undefined;

    const rawAfter = req.query["after"];

    if (
      rawAfter !== undefined &&
      (
        typeof rawAfter !== "string" ||
        !rawAfter.trim()
      )
    ) {
      res.status(400).json({
        success: false,
        error:
          "after must be a non-empty agent ID",
      });
      return;
    }

    const after =
      typeof rawAfter === "string"
        ? rawAfter.trim()
        : undefined;

    const rawLimit = req.query["limit"];
    let limit: number | undefined;

    if (rawLimit !== undefined) {
      if (
        typeof rawLimit !== "string" ||
        !/^[1-9][0-9]*$/.test(rawLimit)
      ) {
        res.status(400).json({
          success: false,
          error:
            "limit must be a positive integer",
        });
        return;
      }

      limit = Number(rawLimit);

      if (
        !Number.isSafeInteger(limit) ||
        limit > 500
      ) {
        res.status(400).json({
          success: false,
          error:
            "limit must be between 1 and 500",
        });
        return;
      }
    }

    const agents = await prisma.agent.findMany({
      where: {
        spacesAppId: {
          not: null,
        },
        ...(overwrite
          ? {}
          : {
              signingSecret: null,
            }),
        ...(slug
          ? {
              slug,
            }
          : {}),
      },
      select: {
        id: true,
        slug: true,
        spacesAppId: true,
      },
      orderBy: {
        id: "asc",
      },
      ...(after
        ? {
            cursor: {
              id: after,
            },
            skip: 1,
          }
        : {}),
      ...(limit !== undefined
        ? {
            take: limit,
          }
        : {}),
    });

    log.info(
      `[admin-backfill] requesterId=${requesterId} dryRun=${dryRun} overwrite=${overwrite} slug=${slug ?? "(all)"} after=${after ?? "(start)"} limit=${limit ?? "(all)"} agents-to-sync=${agents.length}`,
    );

    const results: BackfillRouteResult[] = [];
    let okCount = 0;
    let failCount = 0;

    for (const agent of agents) {
      const result =
        await backfillSigningSecretFromSpacesDbDetailed({
          agentId: agent.id,
          spacesAppId: agent.spacesAppId!,
          dryRun,
        });

      if (result.ok) {
        results.push({
          slug: agent.slug,
          agentId: agent.id,
          ok: true,
          action: result.action,
        });

        okCount += 1;
      } else {
        results.push({
          slug: agent.slug,
          agentId: agent.id,
          ok: false,
          reason: result.reason,
        });

        failCount += 1;
      }
    }

    const finalAgent = agents.at(-1);

    const nextAfter =
      limit !== undefined &&
      agents.length === limit &&
      finalAgent
        ? finalAgent.id
        : null;

    log.info(
      `[admin-backfill] requesterId=${requesterId} dryRun=${dryRun} overwrite=${overwrite} ok=${okCount} failed=${failCount} nextAfter=${nextAfter ?? "(complete)"}`,
    );

    res.json({
      success: true,
      data: {
        dryRun,
        overwrite,
        slug: slug ?? null,
        after: after ?? null,
        limit: limit ?? null,
        nextAfter,
        total: agents.length,
        ok: okCount,
        failed: failCount,
        results,
      },
    });
  },
);

export { router as adminBackfillSigningSecretsRouter };
