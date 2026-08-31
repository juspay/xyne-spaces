/**
 * Session archive / restore — S2S endpoints used by xyne-claw to move
 * old session JSONLs off PVC into GCS before TTL deletion, and to lazy-
 * restore them on cold reads.
 *
 * Why on claw-auth: GCS creds live here (Application Default Credentials,
 * via gcsService). claw has no GCS deps. Same boundary as the curator —
 * heavy / credentialed work runs on claw-auth; claw makes thin S2S calls.
 *
 * Storage layout: gs://{bucket}/claw-sessions/{conversationId}/{relativePath}
 *
 * Both endpoints are gated by `requireS2S` at the mount point in main.ts.
 */

import { Router } from "express";
import { errMsg } from "../lib/errors.js";
import type { Request, Response } from "express";
import { gcsService } from "../services/storageService.js";
import { redisService } from "../redis.js";

import { createLogger } from "../logger.js";
const log = createLogger("sessions-archive");

const SESSION_PREFIX = "claw-sessions";

// ── Distributed per-conversation lock (HA) ───────────────────────────────────
// Ensures only one xyne-claw pod runs a given conversation's session at a time,
// so two pods can't restore the same session from GCS and corrupt the JSONL.
// claw holds no Redis client of its own — it acquires/refreshes/releases via
// these S2S endpoints, same boundary as archive/restore. Holder-token scoped so
// only the owner can release/refresh; TTL-bounded so a dead pod's lock frees up.
const LOCK_PREFIX = "claw-session-lock:";
const LOCK_TTL_MAX_MS = 30 * 60 * 1000; // clamp caller-supplied TTLs

function lockKey(conversationId: string): string {
  return `${LOCK_PREFIX}${conversationId}`;
}

/**
 * Per-file size cap. A single session JSONL ~10MB is typical; cap at 100MB
 * to defend against runaway payloads. Cap is on the raw bytes; base64
 * inflates ~33% so 100MB raw ≈ 134MB on the wire.
 */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** Per-request file count cap — sessions are typically 1-2 files. */
const MAX_FILES_PER_ARCHIVE = 50;

interface ArchiveFileInput {
  path: string;
  contentBase64: string;
}

interface ArchiveRequestBody {
  conversationId?: string;
  files?: ArchiveFileInput[];
}

/**
 * Reject path segments that try to escape the conversation prefix
 * (../, leading /, drive letters, NUL). Keep the validation tight — the
 * caller is supposed to send relative paths from inside the session dir.
 */
function isSafeRelativePath(p: string): boolean {
  if (!p || p.length > 500) return false;
  if (p.includes("..") || p.startsWith("/") || p.startsWith("\\")) return false;
  if (/[\x00]/.test(p)) return false;
  if (/^[a-zA-Z]:/.test(p)) return false; // windows drive letter
  return true;
}

/**
 * Allow only conversation IDs that look like ULIDs / UUIDs / similar.
 * Keep this aligned with xyne-claw's isSafeId: store keys append the agent
 * slug to a valid conversation id and may therefore exceed 100 characters.
 * The runtime accepts these filesystem/GCS-safe identifiers through 128.
 */
export function isSafeConversationId(id: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(id);
}

export const sessionsArchiveRouter = Router();

/**
 * POST /archive
 * Body: { conversationId, files: [{ path, contentBase64 }] }
 *
 * Uploads each file to `gs://{bucket}/claw-sessions/{conversationId}/{path}`.
 * Caller (claw) writes a manifest of every regular file inside the session
 * dir; we just persist them verbatim. If any single upload fails, the whole
 * request returns 500 — caller MUST treat that as "do not delete locally".
 */
sessionsArchiveRouter.post("/archive", async (req: Request, res: Response) => {
  const body = req.body as ArchiveRequestBody;
  const conversationId = body.conversationId;
  const files = body.files;

  if (!conversationId || !isSafeConversationId(conversationId)) {
    res.status(400).json({ success: false, error: "invalid conversationId" });
    return;
  }
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ success: false, error: "files array required and non-empty" });
    return;
  }
  if (files.length > MAX_FILES_PER_ARCHIVE) {
    res.status(400).json({ success: false, error: `too many files (max ${MAX_FILES_PER_ARCHIVE})` });
    return;
  }

  try {
    let uploaded = 0;
    for (const f of files) {
      if (!f.path || !isSafeRelativePath(f.path)) {
        res.status(400).json({ success: false, error: `invalid file path: ${f.path}` });
        return;
      }
      if (typeof f.contentBase64 !== "string") {
        res.status(400).json({ success: false, error: `missing contentBase64 for ${f.path}` });
        return;
      }
      const buf = Buffer.from(f.contentBase64, "base64");
      if (buf.length > MAX_FILE_BYTES) {
        res.status(413).json({ success: false, error: `file ${f.path} exceeds ${MAX_FILE_BYTES} bytes` });
        return;
      }
      const destPath = `${SESSION_PREFIX}/${conversationId}/${f.path}`;
      await gcsService.uploadFile(buf, destPath, "application/octet-stream");
      uploaded += 1;
    }

    log.info(`[sessions-archive] archived conversationId=${conversationId} files=${uploaded}`);
    res.json({ success: true, uploaded });
  } catch (err) {
    const msg = errMsg(err);
    log.error(`[sessions-archive] archive failed conversationId=${conversationId}: ${msg}`);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /restore/:conversationId
 *
 * Lists every object under `claw-sessions/{conversationId}/` and returns
 * them as { files: [{ path, contentBase64 }] }. `path` is the *relative*
 * path inside the session dir (the prefix is stripped). Empty array when
 * the conversation was never archived — caller treats that as "not found,
 * start fresh", not as an error.
 */
sessionsArchiveRouter.get("/restore/:conversationId", async (req: Request, res: Response) => {
  const rawParam = req.params["conversationId"];
  const conversationId = typeof rawParam === "string" ? rawParam : undefined;

  if (!conversationId || !isSafeConversationId(conversationId)) {
    res.status(400).json({ success: false, error: "invalid conversationId" });
    return;
  }

  const prefix = `${SESSION_PREFIX}/${conversationId}/`;
  try {
    const objectNames = await gcsService.listFiles(prefix);
    if (objectNames.length === 0) {
      res.json({ success: true, files: [] });
      return;
    }

    const files: ArchiveFileInput[] = [];
    for (const name of objectNames) {
      const relPath = name.slice(prefix.length);
      if (!relPath) continue; // the prefix itself, skip
      const buf = await gcsService.getFileBuffer(name);
      files.push({ path: relPath, contentBase64: buf.toString("base64") });
    }

    log.info(`[sessions-archive] restored conversationId=${conversationId} files=${files.length}`);
    res.json({ success: true, files });
  } catch (err) {
    const msg = errMsg(err);
    log.error(`[sessions-archive] restore failed conversationId=${conversationId}: ${msg}`);
    res.status(500).json({ success: false, error: msg });
  }
});

/**
 * GET /lock/:conversationId
 * Non-mutating status check for migration/backfill tooling.
 */
sessionsArchiveRouter.get("/lock/:conversationId", async (req: Request<{ conversationId: string }>, res: Response) => {
  const { conversationId } = req.params;
  if (!isSafeConversationId(conversationId)) {
    res.status(400).json({ success: false, error: "conversationId required" });
    return;
  }
  try {
    const redis = redisService.getConnection();
    const holder = await redis.get(lockKey(conversationId));
    res.json({ success: true, locked: !!holder });
  } catch (err) {
    log.warn(`[sessions-archive] lock status error for ${conversationId}:`, err instanceof Error ? err.message : err);
    res.status(503).json({ success: false, error: "lock status unavailable" });
  }
});

/**
 * POST /lock/:conversationId  body { holder, ttlMs }
 * Acquire the conversation lock. Returns { success, acquired }. `acquired` is
 * false when another holder already owns it. SET NX PX = atomic acquire+expire.
 */
sessionsArchiveRouter.post("/lock/:conversationId", async (req: Request<{ conversationId: string }>, res: Response) => {
  const { conversationId } = req.params;
  const { holder, ttlMs } = (req.body ?? {}) as { holder?: string; ttlMs?: number };
  if (!isSafeConversationId(conversationId) || !holder) {
    res.status(400).json({ success: false, error: "conversationId and holder required" });
    return;
  }
  const ttl = Math.min(Math.max(Number(ttlMs) || 0, 1000), LOCK_TTL_MAX_MS);
  try {
    const redis = redisService.getConnection();
    const ok = await redis.set(lockKey(conversationId), holder, "PX", ttl, "NX");
    res.json({ success: true, acquired: ok === "OK" });
  } catch (err) {
    // Fail-open: if Redis is unreachable, don't block runs — report acquired so
    // claw proceeds. The lock is an anti-corruption optimization, not a gate
    // that should take the whole fleet down during a Redis blip.
    log.warn(`[sessions-archive] lock acquire error for ${conversationId}:`, err instanceof Error ? err.message : err);
    res.json({ success: true, acquired: true, degraded: true });
  }
});

/**
 * POST /lock/:conversationId/refresh  body { holder, ttlMs }
 * Extend the TTL, but only if the caller still owns the lock.
 */
sessionsArchiveRouter.post("/lock/:conversationId/refresh", async (req: Request<{ conversationId: string }>, res: Response) => {
  const { conversationId } = req.params;
  const { holder, ttlMs } = (req.body ?? {}) as { holder?: string; ttlMs?: number };
  if (!isSafeConversationId(conversationId) || !holder) {
    res.status(400).json({ success: false, error: "conversationId and holder required" });
    return;
  }
  const ttl = Math.min(Math.max(Number(ttlMs) || 0, 1000), LOCK_TTL_MAX_MS);
  try {
    const redis = redisService.getConnection();
    // Refresh only if we're still the owner — defends against extending a lock
    // that already expired and was re-acquired by another pod.
    const refreshed = await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
      1,
      lockKey(conversationId),
      holder,
      String(ttl),
    );
    res.json({ success: true, refreshed: refreshed === 1 });
  } catch (err) {
    log.warn(`[sessions-archive] lock refresh error for ${conversationId}:`, err instanceof Error ? err.message : err);
    res.json({ success: true, refreshed: false, degraded: true });
  }
});

/**
 * DELETE /lock/:conversationId  body { holder }
 * Release the lock, but only if the caller owns it (compare-and-delete).
 */
sessionsArchiveRouter.delete("/lock/:conversationId", async (req: Request<{ conversationId: string }>, res: Response) => {
  const { conversationId } = req.params;
  const { holder } = (req.body ?? {}) as { holder?: string };
  if (!isSafeConversationId(conversationId) || !holder) {
    res.status(400).json({ success: false, error: "conversationId and holder required" });
    return;
  }
  try {
    const redis = redisService.getConnection();
    const released = await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lockKey(conversationId),
      holder,
    );
    res.json({ success: true, released: released === 1 });
  } catch (err) {
    log.warn(`[sessions-archive] lock release error for ${conversationId}:`, err instanceof Error ? err.message : err);
    res.json({ success: true, released: false, degraded: true });
  }
});
