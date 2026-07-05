/**
 * Direct GCS access for session archive/restore.
 *
 * Why this exists: session archive/restore normally round-trips through
 * claw-auth's S2S endpoint (`/internal/sessions/archive` + `/restore`). During a
 * claw-auth rollout that endpoint is unreachable (`503 no healthy upstream`), so
 * archiving fails exactly when runs are being SIGTERM-killed and need to be
 * checkpointed for recovery (prod incident 2026-06-09T08:14–08:22). This module
 * lets xyne-claw read/write GCS DIRECTLY so the critical path no longer depends
 * on claw-auth being up. `session-store.ts` uses it as the PRIMARY path and
 * falls back to the claw-auth round-trip when it's unavailable.
 *
 * Auth: `@google-cloud/storage` with Application Default Credentials — Workload
 * Identity on GKE, `gcloud auth application-default login` / service-account
 * JSON locally (same credential chain claw-auth uses). When no credentials are
 * resolvable at all, every function degrades (returns false/null) and callers
 * ride the claw-auth fallback; the failure is sticky so we don't pay a probe
 * timeout on every archive.
 *
 * Object layout MUST stay byte-identical to claw-auth's sessions-archive.ts:
 *   gs://{GCS_BUCKET_NAME}/claw-sessions/{conversationId}/{relativePath}
 */

import { Storage } from "@google-cloud/storage";
import { createLogger } from "./logger.js";

const log = createLogger("gcs");

// Keep the default in sync with claw-auth config (CONFIG.gcsBucketName).
const BUCKET = process.env["GCS_BUCKET_NAME"] ?? "xyne-claw-chat-attachments";
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

const GCS_TIMEOUT_MS = 15_000;

export interface SessionFile {
  path: string;
  contentBase64: string;
}

// Sticky: once we learn there are no usable credentials (local dev without
// ADC), stop trying — mirrors the old metadata-server probe behavior.
let credentialsUnavailable = false;
let storage: Storage | null = null;

export function gcsDirectConfigured(): boolean {
  return BUCKET.length > 0 && !credentialsUnavailable;
}

function getStorage(): Storage | null {
  if (!gcsDirectConfigured()) return null;
  if (!storage) {
    storage = new Storage({
      retryOptions: { autoRetry: true, maxRetries: 3 },
    });
  }
  return storage;
}

/**
 * ADC resolution failures (no metadata server, no gcloud login, no key file)
 * mean direct GCS can never work in this process — disable it so callers stop
 * paying the probe cost and go straight to the claw-auth fallback. Anything
 * else (network blip, 5xx, IAM denial) stays retryable per call.
 */
function noteIfCredsError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (/could not load the default credentials|unable to detect.*project|metadata/i.test(msg)) {
    credentialsUnavailable = true;
    log.warn("[gcs] no application default credentials — direct GCS disabled (using claw-auth fallback)");
  }
}

function objectName(conversationId: string, relPath: string): string {
  return `${SESSION_PREFIX}/${conversationId}/${relPath}`;
}

// Cap concurrent uploads so the SIGTERM mass-flush (every active session at
// once) doesn't open an unbounded number of streams.
const UPLOAD_CONCURRENCY = 4;
// Above this, use the SDK's resumable protocol (recommended cutoff ~8 MiB);
// below it the extra session-initiation round-trip isn't worth it.
const RESUMABLE_THRESHOLD_BYTES = 8 * 1024 * 1024;

export interface SessionDiskFile {
  /** Relative path inside the session dir (becomes the GCS object suffix). */
  path: string;
  /** Absolute path on local disk to stream from. */
  absPath: string;
  sizeBytes: number;
}

/**
 * Stream every session file from DISK to GCS. Returns true only on FULL
 * success. Streaming (vs. the old read-all-into-base64) means memory use is
 * O(concurrency × chunk), not O(session size) — huge sessions used to die in
 * collectSessionFiles with "Invalid string length" before upload even began.
 */
export async function gcsUploadSessionFromDisk(conversationId: string, files: SessionDiskFile[]): Promise<boolean> {
  const client = getStorage();
  if (!client) return false;
  const bucket = client.bucket(BUCKET);
  try {
    const queue = [...files];
    let failed = false;
    const worker = async (): Promise<void> => {
      for (let f = queue.shift(); f && !failed; f = queue.shift()) {
        try {
          await bucket.upload(f.absPath, {
            destination: objectName(conversationId, f.path),
            resumable: f.sizeBytes > RESUMABLE_THRESHOLD_BYTES,
            timeout: GCS_TIMEOUT_MS,
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
    await client
      .bucket(BUCKET)
      .file(`${DEBUG_RUN_PREFIX}/${storeKey}/${fileName}`)
      .save(data, { resumable: false, timeout: GCS_TIMEOUT_MS, contentType: "application/json" });
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
    const [files] = await client.bucket(BUCKET).getFiles({ prefix });
    return files.map((f) => f.name.slice(prefix.length)).filter(Boolean);
  } catch (err) {
    noteIfCredsError(err);
    log.warn(`[gcs] debug-run list failed for ${storeKey}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Download one per-run debug snapshot. Returns null on error/missing. */
export async function gcsDownloadDebugRun(storeKey: string, fileName: string): Promise<Buffer | null> {
  const client = getStorage();
  if (!client) return null;
  try {
    const [buf] = await client
      .bucket(BUCKET)
      .file(`${DEBUG_RUN_PREFIX}/${storeKey}/${fileName}`)
      .download();
    return buf;
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
    await client
      .bucket(BUCKET)
      .file(`${RESULT_MARKER_PREFIX}/${idempotencyKey}.json`)
      .save(data, { resumable: false, timeout: GCS_TIMEOUT_MS, contentType: "application/json" });
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
  try {
    const [buf] = await client
      .bucket(BUCKET)
      .file(`${RESULT_MARKER_PREFIX}/${idempotencyKey}.json`)
      .download();
    return buf;
  } catch (err) {
    // A missing marker is the common case (run not finished) — not an error.
    if ((err as { code?: number }).code === 404) return null;
    noteIfCredsError(err);
    log.warn(`[gcs] result-marker download failed for ${idempotencyKey}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Newest `updated` timestamp (epoch ms) across a session's GCS objects —
 * a cheap freshness probe (metadata-only list, no downloads) used by
 * ensureFreshSession() to decide whether the local PVC copy is stale
 * (last turn ran on another pod). Returns:
 *   - epoch ms of the newest object on success
 *   - 0 when GCS is reachable and no archive exists
 *   - null on error/disabled — caller treats freshness as unknown
 */
export async function gcsSessionUpdatedAt(conversationId: string): Promise<number | null> {
  const client = getStorage();
  if (!client) return null;
  try {
    // NOTE: no `fields` filter — restricting to items(updated) leaves the
    // SDK's File.metadata undefined and the probe throws (prod 2026-06-12).
    const [files] = await client.bucket(BUCKET).getFiles({ prefix: `${SESSION_PREFIX}/${conversationId}/` });
    let newest = 0;
    for (const f of files) {
      const t = f.metadata?.updated ? Date.parse(f.metadata.updated) : NaN;
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
 * List + download every session file directly from GCS. Returns:
 *   - an array (possibly EMPTY = no archive exists) on success
 *   - null on error/disabled — the caller falls back to claw-auth
 */
export async function gcsRestoreSession(conversationId: string): Promise<SessionFile[] | null> {
  const client = getStorage();
  if (!client) return null;
  const prefix = `${SESSION_PREFIX}/${conversationId}/`;
  try {
    const [files] = await client.bucket(BUCKET).getFiles({ prefix });
    const out: SessionFile[] = [];
    for (const f of files) {
      const rel = f.name.slice(prefix.length);
      if (!rel) continue; // the prefix placeholder object, if any
      const [buf] = await f.download();
      out.push({ path: rel, contentBase64: buf.toString("base64") });
    }
    return out;
  } catch (err) {
    noteIfCredsError(err);
    log.warn(`[gcs] direct restore failed for ${conversationId}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}
