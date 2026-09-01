/**
 * Direct object-storage access for session archive/restore.
 *
 * Why this exists: session archive/restore normally round-trips through
 * claw-auth's S2S endpoint (`/internal/sessions/archive` + `/restore`). During a
 * claw-auth rollout that endpoint is unreachable (`503 no healthy upstream`), so
 * archiving fails exactly when runs are being SIGTERM-killed and need to be
 * checkpointed for recovery (prod incident 2026-06-09T08:14–08:22). This module
 * lets xyne-claw read/write the store DIRECTLY so the critical path no longer
 * depends on claw-auth being up. `session-store.ts` uses it as the PRIMARY path
 * and falls back to the claw-auth round-trip when it's unavailable.
 *
 * Storage goes through the shared @xyne/storage provider factory — GCS or S3
 * selected by STORAGE.provider (STORAGE_PROVIDER env), same as claw-auth and
 * the Spaces backend. GCS auth: Application Default Credentials — Workload
 * Identity on GKE, `gcloud auth application-default login` / service-account
 * JSON locally. When no credentials are resolvable at all, every function
 * degrades (returns false/null) and callers ride the claw-auth fallback; the
 * failure is sticky so we don't pay a probe timeout on every archive.
 *
 * Object layout MUST stay byte-identical to claw-auth's sessions-archive.ts:
 *   {bucket}/claw-sessions/{conversationId}/{relativePath}
 */

import { mkdir, rename, rm, stat } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  createStorageService,
  isPreconditionFailed,
  setStorageLogger,
  type StorageService,
} from "@xyne/storage";
import { GCS, STORAGE } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("gcs");

setStorageLogger({
  info: (msg, ...meta) => log.info(msg, ...meta),
  warn: (msg, ...meta) => log.warn(msg, ...meta),
  error: (msg, ...meta) => log.error(msg, ...meta),
});

const BUCKET = STORAGE.provider === "s3" ? STORAGE.s3BucketName : GCS.bucketName;
// MUST equal SESSION_PREFIX in claw-auth/routes/sessions-archive.ts.
const SESSION_PREFIX = "claw-sessions";
// Per-run debugger snapshots live OUTSIDE the session prefix on purpose:
// gcsRestoreSession pulls everything under claw-sessions/{id}/ back onto the
// PVC, and these snapshots are exactly the unbounded O(turns²) growth that
// filled a pod's disk (prod ENOSPC incident 2026-06-12). They are written
// straight to GCS after each run and read back only by the debug route.
const DEBUG_RUN_PREFIX = "claw-debug-runs";
// Terminal-result markers for run idempotency. Written by xyne-claw the moment
// a run produces its terminal result (BEFORE the result callback, which a
// deploy/SIGTERM can drop). The recovery worker + xyne-claw /run check this
// before (re-)executing, so an already-finished run is never re-run — the fix
// for the 2026-06-11 "completed sessions re-executed on restart" incident.
// Source of truth for "did this finish?", independent of the lossy callback.
const RESULT_MARKER_PREFIX = "claw-results";

// Per-request write timeout. SIGTERM drain gives the pod ~30s; a hung upload
// must fail fast enough for the claw-auth fallback to still run within it.
const STORAGE_TIMEOUT_MS = 15_000;

export interface SessionFile {
  path: string;
  contentBase64: string;
}

export interface SessionArchiveObject {
  path: string;
  sizeBytes: number;
  updatedMs: number;
}

// Sticky: once we learn there are no usable credentials (local dev without
// ADC), stop trying — mirrors the old metadata-server probe behavior.
let credentialsUnavailable = false;
let storage: StorageService | null = null;

export function gcsDirectConfigured(): boolean {
  return BUCKET.length > 0 && !credentialsUnavailable;
}

function getStorage(): StorageService | null {
  if (!gcsDirectConfigured()) return null;
  if (!storage) {
    storage = createStorageService(
      {
        provider: STORAGE.provider,
        gcs: {
          bucketName: GCS.bucketName,
          // apiEndpoint also flips the SDK into customEndpoint mode, which is
          // what lets the emulator work without any credentials at all.
          ...(GCS.fakeHost ? { apiEndpoint: GCS.fakeHost } : {}),
        },
        s3: {
          region: STORAGE.s3Region,
          bucketName: STORAGE.s3BucketName,
          ...(STORAGE.s3Endpoint ? { endpoint: STORAGE.s3Endpoint } : {}),
          ...(STORAGE.s3AccessKeyId
            ? { accessKeyId: STORAGE.s3AccessKeyId, secretAccessKey: STORAGE.s3SecretAccessKey }
            : {}),
        },
      },
      BUCKET,
    );
  }
  return storage;
}

/**
 * ADC resolution failures (no metadata server, no gcloud login, no key file)
 * mean direct storage can never work in this process — disable it so callers
 * stop paying the probe cost and go straight to the claw-auth fallback.
 * Anything else (network blip, 5xx, IAM denial) stays retryable per call.
 */
function noteIfCredsError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (/could not load the default credentials|unable to detect.*project|metadata|Could not load credentials/i.test(msg)) {
    credentialsUnavailable = true;
    log.warn("[gcs] no application default credentials — direct storage disabled (using claw-auth fallback)");
  }
}

function objectName(conversationId: string, relPath: string): string {
  return `${SESSION_PREFIX}/${conversationId}/${relPath}`;
}

function sessionPrefix(conversationId: string): string {
  return `${SESSION_PREFIX}/${conversationId}/`;
}

// Cap concurrent uploads so the SIGTERM mass-flush (every active session at
// once) doesn't open an unbounded number of streams.
const UPLOAD_CONCURRENCY = 4;
// Above this, use GCS's resumable protocol (recommended cutoff ~8 MiB); below
// it the extra session-initiation round-trip isn't worth it. S3 ignores this.
const RESUMABLE_THRESHOLD_BYTES = 8 * 1024 * 1024;

export interface SessionDiskFile {
  /** Relative path inside the session dir (becomes the object suffix). */
  path: string;
  /** Absolute path on local disk to stream from. */
  absPath: string;
  sizeBytes: number;
}

export interface GcsUploadSessionOptions {
  createOnly?: boolean;
}

/**
 * Stream every session file from DISK to storage. Returns true only on FULL
 * success. Streaming (vs. the old read-all-into-base64) means memory use is
 * O(concurrency × chunk), not O(session size) — huge sessions used to die in
 * collectSessionFiles with "Invalid string length" before upload even began.
 */
export async function gcsUploadSessionFromDisk(
  conversationId: string,
  files: SessionDiskFile[],
  options: GcsUploadSessionOptions = {},
): Promise<boolean> {
  const client = getStorage();
  if (!client) return false;
  try {
    const queue = [...files];
    let failed = false;
    const worker = async (): Promise<void> => {
      for (let f = queue.shift(); f && !failed; f = queue.shift()) {
        try {
          await client.uploadStreamToPath(createReadStream(f.absPath), {
            path: objectName(conversationId, f.path),
            contentType: "application/octet-stream",
            resumable: f.sizeBytes > RESUMABLE_THRESHOLD_BYTES,
            timeoutMs: STORAGE_TIMEOUT_MS,
            ...(options.createOnly ? { ifNotExists: true } : {}),
          });
        } catch (err) {
          failed = true; // stop the other workers draining the queue
          throw err;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker));
    return true;
  } catch (err) {
    if (options.createOnly && isPreconditionFailed(err)) {
      log.warn(`session_pvc_selfheal_lost_race conversationId=${conversationId}`);
      return true;
    }
    noteIfCredsError(err);
    log.warn(`[gcs] direct upload failed for ${conversationId}:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Upload one per-run debug snapshot. Returns true on success. */
export async function gcsUploadDebugRun(storeKey: string, fileName: string, data: Buffer): Promise<boolean> {
  const client = getStorage();
  if (!client) return false;
  try {
    await client.uploadFileV2(data, {
      path: `${DEBUG_RUN_PREFIX}/${storeKey}/${fileName}`,
      contentType: "application/json",
      timeoutMs: STORAGE_TIMEOUT_MS,
    });
    return true;
  } catch (err) {
    noteIfCredsError(err);
    log.warn(`[gcs] debug-run upload failed for ${storeKey}/${fileName}:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * List per-run debug snapshot file names for a session (bare names, no
 * prefix). Returns null on error/disabled — caller falls back to local files.
 */
export async function gcsListDebugRuns(storeKey: string): Promise<string[] | null> {
  const client = getStorage();
  if (!client) return null;
  const prefix = `${DEBUG_RUN_PREFIX}/${storeKey}/`;
  try {
    const files = await client.listFiles(prefix);
    return files.map((f) => f.name.slice(prefix.length)).filter(Boolean);
  } catch (err) {
    noteIfCredsError(err);
    log.warn(`[gcs] debug-run list failed for ${storeKey}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Download an arbitrary object by its full name. Used to pull run attachments
 * that claw-auth parked in the store instead of base64-inlining them into the
 * /run body (`gcsRef`). Returns null on error/disabled so the caller can decide
 * whether the attachment is droppable.
 */
export async function gcsDownloadObject(objectName: string): Promise<Buffer | null> {
  const client = getStorage();
  if (!client) return null;
  try {
    return await client.getFileBuffer(objectName);
  } catch (err) {
    noteIfCredsError(err);
    log.warn(`[gcs] object download failed for ${objectName}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Download one per-run debug snapshot. Returns null on error/missing. */
export async function gcsDownloadDebugRun(storeKey: string, fileName: string): Promise<Buffer | null> {
  const client = getStorage();
  if (!client) return null;
  try {
    return await client.getFileBuffer(`${DEBUG_RUN_PREFIX}/${storeKey}/${fileName}`);
  } catch (err) {
    noteIfCredsError(err);
    log.warn(`[gcs] debug-run download failed for ${storeKey}/${fileName}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Write a terminal-result marker for run idempotency. Returns true on success. */
export async function gcsUploadResultMarker(idempotencyKey: string, data: Buffer): Promise<boolean> {
  const client = getStorage();
  if (!client) return false;
  try {
    await client.uploadFileV2(data, {
      path: `${RESULT_MARKER_PREFIX}/${idempotencyKey}.json`,
      contentType: "application/json",
      timeoutMs: STORAGE_TIMEOUT_MS,
    });
    return true;
  } catch (err) {
    noteIfCredsError(err);
    log.warn(`[gcs] result-marker upload failed for ${idempotencyKey}:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Read a terminal-result marker. Returns null on missing/error (treat as "not done"). */
export async function gcsDownloadResultMarker(idempotencyKey: string): Promise<Buffer | null> {
  const client = getStorage();
  if (!client) return null;
  const markerPath = `${RESULT_MARKER_PREFIX}/${idempotencyKey}.json`;
  try {
    // A missing marker is the common case (run not finished) — not an error,
    // so probe existence first instead of letting the read fail noisily.
    if (!(await client.fileExists(markerPath))) return null;
    return await client.getFileBuffer(markerPath);
  } catch (err) {
    noteIfCredsError(err);
    log.warn(`[gcs] result-marker download failed for ${idempotencyKey}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Newest `updated` timestamp (epoch ms) across a session's objects —
 * a cheap freshness probe (metadata-only list, no downloads) used by
 * ensureFreshSession() to decide whether the local PVC copy is stale
 * (last turn ran on another pod). Returns:
 *   - epoch ms of the newest object on success
 *   - 0 when storage is reachable and no archive exists
 *   - null on error/disabled — caller treats freshness as unknown
 */
export async function gcsSessionUpdatedAt(conversationId: string): Promise<number | null> {
  const client = getStorage();
  if (!client) return null;
  try {
    const files = await client.listFiles(sessionPrefix(conversationId));
    let newest = 0;
    for (const f of files) {
      const t = f.updated?.getTime() ?? NaN;
      if (Number.isFinite(t) && t > newest) newest = t;
    }
    return newest;
  } catch (err) {
    noteIfCredsError(err);
    log.warn(`[gcs] freshness probe failed for ${conversationId}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * List every archived session file directly from storage. Returns null on
 * error/disabled, [] when storage is reachable and no archive exists.
 */
export async function gcsListSessionObjects(conversationId: string): Promise<SessionArchiveObject[] | null> {
  const client = getStorage();
  if (!client) return null;
  const prefix = sessionPrefix(conversationId);
  try {
    const files = await client.listFiles(prefix);
    return files
      .map((f) => {
        const rel = f.name.slice(prefix.length);
        if (!rel) return null;
        return {
          path: rel,
          sizeBytes: Number.isFinite(f.size) ? (f.size as number) : 0,
          updatedMs: f.updated?.getTime() ?? 0,
        };
      })
      .filter((f): f is SessionArchiveObject => f !== null);
  } catch (err) {
    noteIfCredsError(err);
    log.warn(`[gcs] direct list failed for ${conversationId}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Delete a session's ENTIRE archive from storage (every object under
 * `claw-sessions/{id}/`). Without this, deleting only the local session dir
 * (session-store `deleteSession`) leaves the GCS snapshot behind, so the next
 * message resumes the archived session from storage — which makes `/clear`
 * ineffective and lets a poisoned history (e.g. an unsupported image block that
 * 400s every provider) survive forever (prod 2026-08-24). Returns:
 *   - "deleted"  when storage was reachable (0+ objects removed)
 *   - null       on error/disabled — caller should treat the archive as possibly still present
 */
export async function gcsDeleteSession(conversationId: string): Promise<"deleted" | null> {
  const client = getStorage();
  if (!client) return null;
  const prefix = sessionPrefix(conversationId);
  try {
    const files = await client.listFiles(prefix);
    const targets = files.filter((f) => f.name.slice(prefix.length));
    let deleted = 0;
    for (const f of targets) {
      try {
        await client.deleteFile(f.name);
        deleted += 1;
      } catch (err) {
        // Best-effort per object; keep going so one stuck object doesn't strand
        // the rest of the archive.
        log.warn(`[gcs] session object delete failed ${f.name}:`, err instanceof Error ? err.message : String(err));
      }
    }
    log.info(`[gcs] Deleted session archive ${conversationId} (${deleted}/${targets.length} objects)`);
    return "deleted";
  } catch (err) {
    noteIfCredsError(err);
    log.warn(`[gcs] direct session-archive delete failed for ${conversationId}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * List + stream every session file directly from storage into `destDir`. Returns:
 *   - "restored" when at least one file was downloaded and size-verified
 *   - "missing" when storage is reachable and no archive exists
 *   - null on error/disabled — the caller falls back to claw-auth/PVC
 */
export async function gcsRestoreSessionToDisk(
  conversationId: string,
  destDir: string,
): Promise<"restored" | "missing" | null> {
  const client = getStorage();
  if (!client) return null;
  const prefix = sessionPrefix(conversationId);
  try {
    const files = await client.listFiles(prefix);
    const sessionFiles = files.filter((f) => f.name.slice(prefix.length));
    if (sessionFiles.length === 0) return "missing";

    const tmpDir = `${destDir}.restore-${Date.now()}`;
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(tmpDir, { recursive: true });
    try {
      const queue = [...sessionFiles];
      const worker = async (): Promise<void> => {
        for (let f = queue.shift(); f; f = queue.shift()) {
          const rel = f.name.slice(prefix.length);
          if (!rel || rel.includes("..") || rel.startsWith("/")) continue;
          const dest = path.join(tmpDir, rel);
          await mkdir(path.dirname(dest), { recursive: true });
          await pipeline(await client.createReadStream(f.name), createWriteStream(dest));
          const actual = (await stat(dest)).size;
          const expected = Number.isFinite(f.size) ? (f.size as number) : actual;
          if (actual !== expected) {
            throw new Error(`size mismatch for ${rel}: expected ${expected}, got ${actual}`);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, sessionFiles.length) }, worker));
      await rm(destDir, { recursive: true, force: true }).catch(() => {});
      await rename(tmpDir, destDir);
      return "restored";
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  } catch (err) {
    noteIfCredsError(err);
    log.warn(`[gcs] direct restore failed for ${conversationId}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Legacy direct restore helper. Kept for call sites that still need the
 * base64 manifest shape; runtime restore uses gcsRestoreSessionToDisk().
 *
 * List + download every session file directly from storage. Returns:
 *   - an array (possibly EMPTY = no archive exists) on success
 *   - null on error/disabled — the caller falls back to claw-auth
 */
export async function gcsRestoreSession(conversationId: string): Promise<SessionFile[] | null> {
  const client = getStorage();
  if (!client) return null;
  const prefix = sessionPrefix(conversationId);
  try {
    const files = await client.listFiles(prefix);
    const out: SessionFile[] = [];
    for (const f of files) {
      const rel = f.name.slice(prefix.length);
      if (!rel) continue; // the prefix placeholder object, if any
      const buf = await client.getFileBuffer(f.name);
      out.push({ path: rel, contentBase64: buf.toString("base64") });
    }
    return out;
  } catch (err) {
    noteIfCredsError(err);
    log.warn(`[gcs] direct restore failed for ${conversationId}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}
