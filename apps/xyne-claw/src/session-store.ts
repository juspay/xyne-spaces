/**
 * Persistent session storage.
 *
 * Sessions are stored as directories under {dataDir}/sessions/{conversationId}/
 * Each directory contains the pi-coding-agent JSONL session file.
 * Sessions older than SESSION_TTL_DAYS are archived to GCS (via claw-auth's
 * S2S /internal/sessions/archive endpoint) and then removed from PVC.
 *
 * On cold load (`restoreSessionFromArchive`), the dir is lazy-fetched from
 * GCS so a thread that's been silent past TTL can still resume.
 *
 * Archive failure semantics: STRICT — if the upload fails for ANY reason
 * (GCS down, claw-auth down, transient HTTP error), the local dir is NOT
 * deleted. Next sweep retries. This trades PVC headroom for zero data loss.
 */

import { cp, mkdir, readdir, readFile, rename, stat, statfs, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { PATHS, SERVER } from "./config.js";
import { gcsRestoreSessionToDisk, gcsUploadSessionFromDisk, gcsDeleteSession, gcsSessionUpdatedAt, type SessionDiskFile } from "./storage.js";
import { metric } from "./metrics.js";

import { createLogger } from "./logger.js";
const log = createLogger("session-store");

// Local session dirs are a CACHE, not the system of record: every run flushes
// to GCS before releasing the conversation lock, and ensureFreshSession
// restores on resume (any pod). The TTL therefore only trades disk footprint
// against a GCS restore download on cold resume. The old 7-day default made
// every pod hold a week of every session it touched (ENOSPC, 2026-06-12);
// a few hours keeps active threads warm without the pile-up.
const SESSION_TTL_HOURS = Number(process.env["SESSION_TTL_HOURS"] ?? 6);
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 min — also the disk-pressure check cadence
const ARCHIVE_TIMEOUT_MS = Math.max(1, Number(process.env["SESSION_ARCHIVE_TIMEOUT_MS"] ?? 120_000)); // 2 min — sessions can be tens of MB
const ARCHIVE_RETRY_ATTEMPTS = Math.max(1, Number(process.env["SESSION_ARCHIVE_RETRY_ATTEMPTS"] ?? 3));
const ARCHIVE_RETRY_BACKOFF_MS = Math.max(0, Number(process.env["SESSION_ARCHIVE_RETRY_BACKOFF_MS"] ?? 1_000));
// Disk-pressure backstop: when the sessions volume crosses the high-water
// mark, evict least-recently-used idle sessions (archive-then-delete, same
// strictness as the TTL path) until usage drops below the low-water mark —
// regardless of TTL. Makes ENOSPC structurally unreachable under burst load.
const DISK_HIGH_WATER_PCT = Number(process.env["SESSION_DISK_HIGH_WATER_PCT"] ?? 80);
const DISK_LOW_WATER_PCT = Number(process.env["SESSION_DISK_LOW_WATER_PCT"] ?? 70);
const SESSIONS_PVC_FALLBACK = (process.env["SESSIONS_PVC_FALLBACK"] ?? "true").toLowerCase() !== "false";
const SESSIONS_PVC_FALLBACK_DIR = process.env["SESSIONS_PVC_FALLBACK_DIR"] ?? "/pvc-sessions";
log.warn(`[session-store] PVC fallback mode=${SESSIONS_PVC_FALLBACK ? "enabled" : "disabled"} dir=${SESSIONS_PVC_FALLBACK_DIR}`);

function sessionsRoot(): string {
  return path.join(PATHS.dataDir, "sessions");
}

/** Get the session directory for a conversationId */
export function sessionDir(conversationId: string): string {
  return path.join(sessionsRoot(), conversationId);
}

/** Debug artifacts are stored under the session dir so they archive/restore with the session. */
export function sessionDebugDir(conversationId: string): string {
  return path.join(sessionDir(conversationId), "debug");
}

/**
 * Base dir under which over-large tool results are offloaded (see
 * tool-output.ts `promoteIfOversized`). Prefer the PERSISTENT session dir: it
 * survives the per-run ephemeral workspace teardown, is archived to GCS and
 * restored on resume / cross-pod, and shares the same host mount the sandbox
 * sees — so the agent can still `read`/`grep` an offloaded file on a later
 * turn. Falls back to the ephemeral workspace only for conversation-less
 * (in-memory) runs where there is no session dir.
 */
export function toolOutputBaseDir(conversationId: string | undefined, workspaceDir: string): string {
  return conversationId ? sessionDir(conversationId) : workspaceDir;
}

/** Check if a persistent session exists for this conversationId */
export function hasSession(conversationId: string): boolean {
  return existsSync(sessionDir(conversationId));
}

/** Ensure the session directory exists */
export async function ensureSessionDir(conversationId: string): Promise<string> {
  const dir = sessionDir(conversationId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Ensure the per-session debug artifact directory exists. */
export async function ensureSessionDebugDir(conversationId: string): Promise<string> {
  const dir = sessionDebugDir(conversationId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Delete a specific session — BOTH the local dir AND the GCS archive.
 *  Deleting only local disk left the GCS snapshot behind, so the next message
 *  resumed the archived session from storage — making `/clear` unable to rescue
 *  a poisoned thread (prod 2026-08-24: an unsupported image block kept 400-ing
 *  every provider through `/clear` because the archive was re-restored). */
export async function deleteSession(conversationId: string): Promise<void> {
  const dir = sessionDir(conversationId);
  try {
    await rm(dir, { recursive: true, force: true });
    log.info(`[session-store] Deleted session ${conversationId}`);
  } catch {
    // ignore
  }
  // Purge the archive too so a resume-from-GCS can't bring the session back.
  // Best-effort: on GKE with ADC this deletes directly; if direct storage is
  // unavailable the local delete still stands and the archive expires by TTL.
  try {
    await gcsDeleteSession(conversationId);
  } catch (err) {
    log.warn(`[session-store] GCS archive delete failed for ${conversationId}:`, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Walk a session dir and list every regular file (path + size, NO contents).
 * The direct-GCS path streams from these; only the claw-auth fallback ever
 * materializes file contents in memory.
 */
async function listSessionFiles(dir: string): Promise<SessionDiskFile[]> {
  const out: SessionDiskFile[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(current, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(abs, rel);
      } else if (e.isFile()) {
        const s = await stat(abs);
        out.push({ path: rel, absPath: abs, sizeBytes: s.size });
      }
    }
  }
  await walk(dir, "");
  return out;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function sessionSizeBytes(files: SessionDiskFile[]): number {
  return files.reduce((sum, f) => sum + f.sizeBytes, 0);
}

function bareConversationIdForStoreKey(storeKey: string): string | null {
  const i = storeKey.lastIndexOf("_");
  if (i <= 0 || i >= storeKey.length - 1) return null;
  return storeKey.slice(0, i);
}

function isActiveSessionOrBareSpillDir(name: string): boolean {
  if (activeSessions.has(name)) return true;
  for (const active of activeSessions) {
    if (bareConversationIdForStoreKey(active) === name) return true;
  }
  return false;
}

/**
 * Upload a single session's files to GCS — directly when running on GKE
 * (Workload Identity), via claw-auth's S2S archive endpoint otherwise.
 * Returns true on success. On any failure (GCS error, claw-auth down, S2S
 * mismatch), returns false — the caller MUST leave the local dir intact.
 */
interface ArchiveSessionOptions {
  createOnly?: boolean;
}

async function archiveSessionDirToGcs(
  conversationId: string,
  options: ArchiveSessionOptions = {},
): Promise<boolean> {
  const started = Date.now();
  const dir = sessionDir(conversationId);
  if (!existsSync(dir)) return true; // already gone, treat as archived

  let diskFiles: SessionDiskFile[];
  try {
    diskFiles = await listSessionFiles(dir);
  } catch (err) {
    metric.count("session_archive", { result: "fail", path: "read", reason: "list_error" });
    log.warn(`[session-store] Failed to list session ${conversationId} for archive:`, err);
    return false;
  }
  if (diskFiles.length === 0) return true; // empty session dir, nothing to archive

  // PRIMARY path: stream to GCS directly (ADC / Workload Identity). The
  // claw-auth round-trip below is the fallback — during a claw-auth rollout
  // its S2S endpoint 503s exactly when SIGTERM'd runs need checkpointing
  // (prod incident 2026-06-09). Returns false when direct GCS is unavailable
  // (no credentials) or any upload fails.
  if (await gcsUploadSessionFromDisk(conversationId, diskFiles, options.createOnly ? { createOnly: true } : {})) {
    metric.count("session_archive", { result: "ok", path: "gcs" });
    metric.observe("session_archive_duration_ms", Date.now() - started, {
      result: "ok",
      path: "gcs",
      files: diskFiles.length,
      bytes: sessionSizeBytes(diskFiles),
    });
    log.info(`[session-store] Archived ${conversationId} (${diskFiles.length} files, direct GCS)`);
    return true;
  }

  if (options.createOnly) {
    metric.count("session_archive", { result: "fail", path: "gcs", reason: "create_only_failed" });
    log.warn(`[session-store] Create-only direct GCS archive failed for ${conversationId}`);
    return false;
  }

  if (!SERVER.s2sKey) {
    metric.count("session_archive", { result: "fail", path: "none", reason: "no_s2s" });
    log.warn(`[session-store] No S2S key configured — cannot archive ${conversationId} via claw-auth fallback`);
    return false;
  }

  // Fallback manifest is base64-in-memory — this is where a too-large session
  // dies ("Invalid string length"). Only the fallback pays that cost now; the
  // streaming primary path above has no per-session memory ceiling.
  let files: { path: string; contentBase64: string }[];
  try {
    files = await Promise.all(
      diskFiles.map(async (f) => ({ path: f.path, contentBase64: (await readFile(f.absPath)).toString("base64") })),
    );
  } catch (err) {
    metric.count("session_archive", { result: "fail", path: "read", reason: "collect_error" });
    log.warn(`[session-store] Failed to read session ${conversationId} for archive:`, err);
    return false;
  }

  const url = `${SERVER.authServiceUrl.replace(/\/$/, "")}/claw/api/v1/internal/sessions/archive`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-s2s-key": SERVER.s2sKey,
      },
      body: JSON.stringify({ conversationId, files }),
      signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      metric.count("session_archive", { result: "fail", path: "clawauth", reason: `http_${res.status}` });
      log.warn(`[session-store] Archive HTTP ${res.status} for ${conversationId}: ${body.slice(0, 200)}`);
      return false;
    }
    const data = (await res.json()) as { success?: boolean; uploaded?: number };
    if (!data.success) {
      metric.count("session_archive", { result: "fail", path: "clawauth", reason: "rejected" });
      log.warn(`[session-store] Archive rejected for ${conversationId}`);
      return false;
    }
    metric.count("session_archive", { result: "ok", path: "clawauth" });
    metric.observe("session_archive_duration_ms", Date.now() - started, {
      result: "ok",
      path: "clawauth",
      files: diskFiles.length,
      bytes: sessionSizeBytes(diskFiles),
    });
    log.info(`[session-store] Archived ${conversationId} (${data.uploaded ?? files.length} files)`);
    return true;
  } catch (err) {
    metric.count("session_archive", { result: "fail", path: "clawauth", reason: "exception" });
    log.warn(`[session-store] Archive call failed for ${conversationId}:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function archiveBareSpillDirWithRetries(
  storeKey: string,
  attempts: number,
  options: ArchiveSessionOptions = {},
): Promise<boolean> {
  const bareConversationId = bareConversationIdForStoreKey(storeKey);
  if (!bareConversationId) return true;
  if (!existsSync(sessionDir(bareConversationId))) return true;

  let lastAttempt = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    lastAttempt = attempt;
    const ok = await archiveSessionDirToGcs(bareConversationId, options);
    if (ok) return true;
    if (attempt < attempts) {
      await sleep(ARCHIVE_RETRY_BACKOFF_MS * attempt);
    }
  }
  metric.count("session_spill_archive_failed", { conversationId: bareConversationId, storeKey, attempts: lastAttempt });
  log.warn(`[session-store] Bare spill archive failed for ${storeKey} companion ${bareConversationId}; leaving spill dir on disk`);
  return false;
}

export async function archiveSessionToGcs(
  conversationId: string,
  options: ArchiveSessionOptions = {},
): Promise<boolean> {
  const ok = await archiveSessionDirToGcs(conversationId, options);
  if (ok) {
    await archiveBareSpillDirWithRetries(conversationId, 1, options);
  }
  return ok;
}

export async function archiveSessionToGcsWithRetries(
  conversationId: string,
  attempts = ARCHIVE_RETRY_ATTEMPTS,
  options: ArchiveSessionOptions = {},
): Promise<boolean> {
  let lastAttempt = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    lastAttempt = attempt;
    const ok = await archiveSessionDirToGcs(conversationId, options);
    if (ok) {
      await archiveBareSpillDirWithRetries(conversationId, attempts, options);
      return true;
    }
    if (attempt < attempts) {
      await sleep(ARCHIVE_RETRY_BACKOFF_MS * attempt);
    }
  }
  metric.count("session_archive_failed", { conversationId, attempts: lastAttempt });
  log.error(`session_archive_failed conversationId=${conversationId} attempts=${lastAttempt}`);
  return false;
}

export type SessionRestoreOutcome = "restored" | "missing" | "failed";

async function restoreBareSpillFromPvcFallback(storeKey: string): Promise<void> {
  const bareConversationId = bareConversationIdForStoreKey(storeKey);
  if (!bareConversationId) return;
  const source = path.join(SESSIONS_PVC_FALLBACK_DIR, bareConversationId);
  const local = sessionDir(bareConversationId);
  if (!existsSync(source) || existsSync(local)) return;

  const tmp = `${local}.pvc-${Date.now()}`;
  try {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    await cp(source, tmp, { recursive: true, force: false, errorOnExist: false });
    if (existsSync(local)) {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
      return;
    }
    await rename(tmp, local);
    metric.count("session_spill_pvc_fallback_hit", { conversationId: bareConversationId, storeKey });
    log.error(`session_spill_pvc_fallback_hit conversationId=${bareConversationId} storeKey=${storeKey} source=${source}`);
    const healed = await archiveSessionToGcsWithRetries(bareConversationId, ARCHIVE_RETRY_ATTEMPTS, { createOnly: true });
    if (!healed) {
      log.error(`session_spill_pvc_fallback_self_heal_failed conversationId=${bareConversationId} storeKey=${storeKey}`);
    }
  } catch (err) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    log.error(`[session-store] PVC fallback spill restore failed for ${storeKey}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function restoreFromPvcFallback(conversationId: string): Promise<boolean> {
  if (!SESSIONS_PVC_FALLBACK) return false;
  const source = path.join(SESSIONS_PVC_FALLBACK_DIR, conversationId);
  if (!existsSync(source)) return false;
  const local = sessionDir(conversationId);
  const tmp = `${local}.pvc-${Date.now()}`;
  try {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    await cp(source, tmp, { recursive: true, force: false, errorOnExist: false });
    await rm(local, { recursive: true, force: true }).catch(() => {});
    await rename(tmp, local);
    metric.count("session_pvc_fallback_hit", { conversationId });
    log.error(`session_pvc_fallback_hit conversationId=${conversationId} source=${source}`);
    await restoreBareSpillFromPvcFallback(conversationId);
    const healed = await archiveSessionToGcsWithRetries(conversationId, ARCHIVE_RETRY_ATTEMPTS, { createOnly: true });
    if (!healed) {
      log.error(`session_pvc_fallback_self_heal_failed conversationId=${conversationId}`);
    }
    return true;
  } catch (err) {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    log.error(`[session-store] PVC fallback restore failed for ${conversationId}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function restoreBareSpillFromArchive(storeKey: string): Promise<void> {
  const bareConversationId = bareConversationIdForStoreKey(storeKey);
  if (!bareConversationId) return;
  if (existsSync(sessionDir(bareConversationId))) return;

  const restored = await gcsRestoreSessionToDisk(bareConversationId, sessionDir(bareConversationId));
  if (restored === "restored") {
    metric.count("session_spill_restore", { result: "ok", path: "gcs", storeKey });
    log.info(`[session-store] Restored bare spill ${bareConversationId} for ${storeKey} (direct GCS stream)`);
  } else if (restored === "missing") {
    await restoreBareSpillFromPvcFallback(storeKey);
  } else if (restored === null) {
    metric.count("session_spill_restore", { result: "fail", path: "gcs", storeKey });
    log.warn(`[session-store] Bare spill restore unavailable for ${storeKey} companion ${bareConversationId}; proceeding without spill files`);
    await restoreBareSpillFromPvcFallback(storeKey);
  }
}

/**
 * Lazy-restore a session from GCS — directly when running on GKE, via
 * claw-auth's capped S2S restore endpoint only as a deprecated fallback, then
 * finally from the read-only PVC canary mount if enabled.
 */
export async function restoreSessionFromArchiveDetailed(conversationId: string): Promise<SessionRestoreOutcome> {
  if (existsSync(sessionDir(conversationId))) {
    await restoreBareSpillFromArchive(conversationId);
    return "restored"; // already local, nothing to do
  }

  const started = Date.now();
  const direct = await gcsRestoreSessionToDisk(conversationId, sessionDir(conversationId));
  if (direct === "restored") {
    await restoreBareSpillFromArchive(conversationId);
    metric.count("session_restore", { result: "ok", path: "gcs" });
    metric.observe("session_restore_duration_ms", Date.now() - started, { result: "ok", path: "gcs" });
    log.info(`[session-store] Restored ${conversationId} (direct GCS stream)`);
    return "restored";
  }
  if (direct === "missing") {
    if (await restoreFromPvcFallback(conversationId)) {
      await restoreBareSpillFromArchive(conversationId);
      metric.count("session_restore", { result: "ok", path: "pvc_fallback" });
      metric.observe("session_restore_duration_ms", Date.now() - started, { result: "ok", path: "pvc_fallback" });
      return "restored";
    }
    metric.count("session_restore", { result: "missing", path: "gcs" });
    return "missing";
  }

  if (!SERVER.s2sKey) {
    metric.count("session_restore", { result: "fail", path: "none", reason: "no_s2s" });
    log.error(`session_restore_failed conversationId=${conversationId} reason=gcs_restore_failed_no_s2s`);
    return "failed";
  }

  const url = `${SERVER.authServiceUrl.replace(/\/$/, "")}/claw/api/v1/internal/sessions/restore/${encodeURIComponent(conversationId)}`;
  try {
    log.warn(`[session-store] deprecated claw-auth restore fallback used for ${conversationId}`);
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-s2s-key": SERVER.s2sKey },
      signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
    });

    if (!res.ok) {
      log.warn(`[session-store] Restore HTTP ${res.status} for ${conversationId}`);
      metric.count("session_restore", { result: "fail", path: "clawauth", reason: `http_${res.status}` });
      log.error(`session_restore_failed conversationId=${conversationId} reason=clawauth_http_${res.status}`);
      return "failed";
    }
    const data = (await res.json()) as { success?: boolean; files?: { path: string; contentBase64: string }[] };
    if (!data.success || !Array.isArray(data.files) || data.files.length === 0) {
      if (data.success && Array.isArray(data.files) && data.files.length === 0) {
        if (await restoreFromPvcFallback(conversationId)) {
          await restoreBareSpillFromArchive(conversationId);
          metric.count("session_restore", { result: "ok", path: "pvc_fallback" });
          metric.observe("session_restore_duration_ms", Date.now() - started, { result: "ok", path: "pvc_fallback" });
          return "restored";
        }
        metric.count("session_restore", { result: "missing", path: "clawauth" });
        return "missing";
      }
      metric.count("session_restore", { result: "fail", path: "clawauth", reason: "rejected" });
      log.error(`session_restore_failed conversationId=${conversationId} reason=clawauth_rejected`);
      return "failed";
    }

    await writeRestoredFiles(conversationId, data.files);
    await restoreBareSpillFromArchive(conversationId);
    metric.count("session_restore", { result: "ok", path: "clawauth" });
    metric.observe("session_restore_duration_ms", Date.now() - started, { result: "ok", path: "clawauth" });
    log.info(`[session-store] Restored ${conversationId} (${data.files.length} files) from archive`);
    return "restored";
  } catch (err) {
    log.warn(`[session-store] Restore call failed for ${conversationId}:`, err instanceof Error ? err.message : String(err));
    metric.count("session_restore", { result: "fail", path: "clawauth", reason: "exception" });
    log.error(`session_restore_failed conversationId=${conversationId} reason=clawauth_exception`);
    return "failed";
  }
}

export async function restoreSessionFromArchive(conversationId: string): Promise<boolean> {
  return (await restoreSessionFromArchiveDetailed(conversationId)) === "restored";
}

async function writeRestoredFiles(conversationId: string, files: { path: string; contentBase64: string }[]): Promise<void> {
  const dir = await ensureSessionDir(conversationId);
  for (const f of files) {
    // Defense in depth — even though claw-auth validates, double-check here.
    if (!f.path || f.path.includes("..") || f.path.startsWith("/")) continue;
    const dest = path.join(dir, f.path);
    const parent = path.dirname(dest);
    if (parent !== dir) await mkdir(parent, { recursive: true });
    await writeFile(dest, Buffer.from(f.contentBase64, "base64"));
  }
}

// ── Freshness-aware resume (multi-pod / PVC-less HA) ────────────────────────
//
// With >1 runtime pod (or local-disk-as-cache after the PVC is dropped), the
// previous turn of a conversation may have run on ANOTHER pod: this pod's
// local copy exists but is STALE, and the plain `hasSession()` check would
// happily resume from it, silently forking the conversation. GCS is the
// source of truth — the finishing pod always flushes the session to GCS
// BEFORE releasing the conversation lock (agent.ts finally block), and this
// check runs AFTER acquiring that lock, so "GCS newer than local" is a
// reliable staleness signal, not a race.
//
// Decisions (logged + metric'd, grep `[session-store] freshness` to verify
// during chaos testing):
//   fresh-start      — no local copy, no GCS archive → new conversation
//   restored-missing — no local copy, GCS archive restored (pod restart /
//                      other-pod history / post-TTL resume)
//   local-fresh      — local copy at least as new as GCS → use local
//   restored-stale   — GCS newer than local → local wiped, GCS restored
//   local-unverified — GCS unreachable → use local and log loudly
//   restore-failed   — GCS newer but restore FAILED → reject the run loudly

/** Clock-skew + write-latency margin for the local-vs-GCS comparison. */
const FRESHNESS_SKEW_MS = Number(process.env["SESSION_FRESHNESS_SKEW_MS"] ?? 2_000);

/** Newest mtime across every regular file in the session dir (0 if none). */
async function localSessionUpdatedAt(conversationId: string): Promise<number> {
  let newest = 0;
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(current, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        const s = await stat(p);
        if (s.mtimeMs > newest) newest = s.mtimeMs;
      }
    }
  }
  try {
    await walk(sessionDir(conversationId));
  } catch {
    return 0;
  }
  return newest;
}

export type SessionFreshness =
  | "fresh-start"
  | "restored-missing"
  | "local-fresh"
  | "restored-stale"
  | "local-unverified"
  | "restore-failed";

export class SessionRestoreStaleError extends Error {
  constructor(
    public readonly conversationId: string,
    public readonly localAt: number,
    public readonly gcsAt: number,
  ) {
    super(
      `Failed to restore newer GCS archive for ${conversationId}; refusing to run against stale local session`,
    );
    this.name = "SessionRestoreStaleError";
  }
}

export class SessionRestoreFailedError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Failed to verify or restore GCS archive for ${conversationId}; refusing to start a fresh local session`);
    this.name = "SessionRestoreFailedError";
  }
}

/**
 * Make the local session dir current before a resume. Call AFTER acquiring
 * the conversation lock. Throws only for the corruption-prone case where GCS is
 * known newer than local but restore failed; that is safer than silently
 * forking a stale JSONL.
 */
export async function ensureFreshSession(conversationId: string): Promise<SessionFreshness> {
  const localAt = hasSession(conversationId) ? await localSessionUpdatedAt(conversationId) : 0;

  let decision: SessionFreshness;
  let gcsAt: number | null = null;
  if (localAt === 0) {
    // An EMPTY local dir would short-circuit restoreSessionFromArchive
    // ("already local") — remove it so the restore actually runs.
    if (hasSession(conversationId)) {
      await rm(sessionDir(conversationId), { recursive: true, force: true }).catch(() => {});
    }
    const restore = await restoreSessionFromArchiveDetailed(conversationId).catch((): SessionRestoreOutcome => "failed");
    if (restore === "restored") {
      decision = "restored-missing";
    } else if (restore === "missing") {
      decision = "fresh-start";
    } else {
      decision = "restore-failed";
      metric.count("session_freshness", { decision });
      log.error(`session_restore_failed conversationId=${conversationId} reason=restore_failed_missing_local`);
      throw new SessionRestoreFailedError(conversationId);
    }
  } else {
    gcsAt = await gcsSessionUpdatedAt(conversationId);
    if (gcsAt === null) {
      decision = "local-unverified";
    } else if (gcsAt <= localAt + FRESHNESS_SKEW_MS) {
      decision = "local-fresh";
    } else {
      // Local is stale — the last flush came from another pod. Move it aside
      // (NOT delete) so a failed restore can roll back before rejecting.
      const dir = sessionDir(conversationId);
      const backup = `${dir}.stale-${Date.now()}`;
      try {
        await rename(dir, backup);
      } catch {
        decision = "restore-failed";
        metric.count("session_freshness", { decision });
        log.error(`session_restore_failed conversationId=${conversationId} reason=stale_local_move_failed local=${new Date(localAt).toISOString()} gcs=${new Date(gcsAt).toISOString()}`);
        throw new SessionRestoreStaleError(conversationId, localAt, gcsAt);
      }
      const restore = await restoreSessionFromArchiveDetailed(conversationId).catch((): SessionRestoreOutcome => "failed");
      if (restore === "restored") {
        const restoredAt = await localSessionUpdatedAt(conversationId);
        if (restoredAt + FRESHNESS_SKEW_MS < gcsAt) {
          decision = "restore-failed";
          await rm(sessionDir(conversationId), { recursive: true, force: true }).catch(() => {});
          await rename(backup, dir).catch(() => {});
          metric.count("session_freshness", { decision });
          log.error(
            `session_restore_failed conversationId=${conversationId} reason=restored_copy_stale local=${new Date(localAt).toISOString()} gcs=${new Date(gcsAt).toISOString()} restored=${restoredAt ? new Date(restoredAt).toISOString() : "none"}`,
          );
          throw new SessionRestoreStaleError(conversationId, localAt, gcsAt);
        }
        decision = "restored-stale";
        await rm(backup, { recursive: true, force: true }).catch(() => {});
      } else {
        decision = "restore-failed";
        await rename(backup, dir).catch(() => {});
        log.error(
          `session_restore_failed conversationId=${conversationId} reason=restore_failed_stale_local local=${new Date(localAt).toISOString()} gcs=${new Date(gcsAt).toISOString()}`,
        );
        metric.count("session_freshness", { decision });
        throw new SessionRestoreStaleError(conversationId, localAt, gcsAt);
      }
    }
  }

  log.info(
    `[session-store] freshness ${conversationId}: local=${localAt ? new Date(localAt).toISOString() : "none"} gcs=${gcsAt !== null ? (gcsAt ? new Date(gcsAt).toISOString() : "none") : "unknown"} → ${decision}`,
  );
  metric.count("session_freshness", { decision });
  return decision;
}

// ── Per-turn checkpoint to GCS (HA) ──────────────────────────────────────────
// A live session lives only on this pod's PVC until the TTL sweep. If the pod
// is SIGTERM'd mid-run (deploy/eviction), that in-flight work is lost. To bound
// the loss to ≈one turn, we checkpoint the session dir to GCS after each
// assistant turn (`message_end`), debounced + single-flight so we don't upload
// on every token. On graceful shutdown we flush all active sessions.
const CHECKPOINT_DEBOUNCE_MS = Number(process.env["SESSION_CHECKPOINT_DEBOUNCE_MS"] ?? 30_000);

interface CheckpointState {
  lastAt: number;
  inFlight: boolean;
  pending: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}
const checkpointState = new Map<string, CheckpointState>();
/** conversationIds with a run currently executing on this pod. */
const activeSessions = new Set<string>();

export function markSessionActive(conversationId: string): void {
  activeSessions.add(conversationId);
}
export function markSessionIdle(conversationId: string): void {
  activeSessions.delete(conversationId);
  const st = checkpointState.get(conversationId);
  if (st?.timer) clearTimeout(st.timer);
  checkpointState.delete(conversationId);
}

async function runCheckpoint(conversationId: string): Promise<void> {
  const st = checkpointState.get(conversationId);
  if (!st) return;
  st.inFlight = true;
  st.pending = false;
  try {
    await archiveSessionToGcs(conversationId);
  } catch {
    // best-effort — TTL sweep + next checkpoint retry
  } finally {
    st.inFlight = false;
    st.lastAt = Date.now();
    if (st.pending) scheduleSessionCheckpoint(conversationId);
  }
}

/**
 * Fire-and-forget checkpoint of a session to GCS. Debounced per conversation
 * (no more than once / CHECKPOINT_DEBOUNCE_MS) and single-flight (a checkpoint
 * requested while one is uploading coalesces into one trailing run). Never
 * throws; never blocks the caller.
 */
export function scheduleSessionCheckpoint(conversationId: string): void {
  let st = checkpointState.get(conversationId);
  if (!st) {
    st = { lastAt: 0, inFlight: false, pending: false, timer: null };
    checkpointState.set(conversationId, st);
  }
  if (st.inFlight) {
    st.pending = true;
    return;
  }
  const since = Date.now() - st.lastAt;
  if (since >= CHECKPOINT_DEBOUNCE_MS) {
    void runCheckpoint(conversationId);
  } else if (!st.timer) {
    st.timer = setTimeout(() => {
      if (st) st.timer = null;
      void runCheckpoint(conversationId);
    }, CHECKPOINT_DEBOUNCE_MS - since);
  }
}

/** Synchronously flush one session to GCS now (cancels any pending debounce). */
export async function flushSessionNow(conversationId: string): Promise<boolean> {
  const st = checkpointState.get(conversationId);
  if (st?.timer) {
    clearTimeout(st.timer);
    st.timer = null;
  }
  return archiveSessionToGcsWithRetries(conversationId).catch((err) => {
    metric.count("session_archive_failed", { conversationId, attempts: ARCHIVE_RETRY_ATTEMPTS, reason: "exception" });
    log.error(`session_archive_failed conversationId=${conversationId} attempts=${ARCHIVE_RETRY_ATTEMPTS} error=${err instanceof Error ? err.message : String(err)}`);
    return false;
  });
}

/**
 * Flush every active session to GCS, bounded by `budgetMs`. Called from the
 * SIGTERM handler so an in-flight run survives a pod replacement / eviction.
 */
export async function flushAllActiveSessions(budgetMs: number): Promise<void> {
  const ids = [...activeSessions];
  if (ids.length === 0) return;
  log.info(`[session-store] SIGTERM flush: ${ids.length} active session(s) → GCS`);
  const result = await Promise.race([
    Promise.allSettled(ids.map((id) => flushSessionNow(id))),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), budgetMs)),
  ]);
  if (result === "timeout") {
    metric.count("session_archive_failed", { reason: "flush_timeout", active: ids.length });
    log.error(`session_archive_failed reason=flush_timeout active=${ids.length} budgetMs=${budgetMs}`);
  }
}

/**
 * Branch a session from sourceConversationId to targetConversationId using
 * PI's native tree branching. Opens the source session, finds the relevant
 * branch point (last user entry, or the entry before it for edit-user), calls
 * SessionManager.createBranchedSession, and moves the resulting file into the
 * target session directory.
 *
 * Modes:
 *   - "lastUser"       — branch AT the last user entry → cloned session ends on
 *                        that user turn → regenerate replays it as a sibling
 *                        assistant.
 *   - "beforeLastUser" — branch at the entry BEFORE the last user → cloned
 *                        session ends just before the user wrote → edit-user
 *                        runs a new user message as a sibling user branch.
 *
 * Returns true on success. Lazy-restores the source from GCS if archived.
 */
/** "lastUser"/"beforeLastUser" branch AT a user message (regenerate / edit).
 *  "full" copies the ENTIRE session — used to fork a finished run into a
 *  per-user thread, where the run's final assistant turn (e.g. the RCA the
 *  user is reading) must stay in context. */
export type BranchSessionMode = "lastUser" | "beforeLastUser" | "full";

export interface LiveSessionHandle {
  conversationId: string | undefined;
  getCwd(): string;
  getHeader(): unknown;
  getLeafId(): string | null;
  getBranch(fromId?: string): unknown[];
  getEntries(): unknown[];
  isPersisted(): boolean;
}

const liveSessions = new Map<string, LiveSessionHandle>();

export function registerLiveSession(keys: Array<string | undefined>, handle: LiveSessionHandle): void {
  for (const k of keys) {
    if (k) liveSessions.set(k, handle);
  }
}

export function unregisterLiveSession(keys: Array<string | undefined>): void {
  for (const k of keys) {
    if (k) liveSessions.delete(k);
  }
}

export function getLiveSession(key: string): LiveSessionHandle | undefined {
  return liveSessions.get(key);
}

export interface SnapshotLiveSessionResult {
  ok: boolean;
  targetDir?: string;
  sessionFile?: string;
  entryCount?: number;
  reason?: string;
}

export async function snapshotLiveSession(
  sourceKey: string,
  targetConversationId: string,
  opts?: { overwrite?: boolean | undefined },
): Promise<SnapshotLiveSessionResult> {
  const handle = liveSessions.get(sourceKey);
  if (!handle) {
    log.warn(`[session-store] snapshot: no live session registered for ${sourceKey}`);
    return { ok: false, reason: "no_live_session" };
  }
  return snapshotLiveSessionHandle(handle, targetConversationId, sourceKey, opts);
}

/** Snapshot from a handle the caller already holds.
 *
 *  Callers that must survive the source run finishing take the handle
 *  SYNCHRONOUSLY (getLiveSession) before their first await and pass it here.
 *  Looking it up later races runTask's `finally`, which calls
 *  unregisterLiveSession — and for a PR-creation trigger, which fires near the
 *  end of a run, the handle is routinely already gone. */
export async function snapshotLiveSessionHandle(
  handle: LiveSessionHandle,
  targetConversationId: string,
  sourceKey: string,
  opts?: { overwrite?: boolean | undefined },
): Promise<SnapshotLiveSessionResult> {
  if (!handle.isPersisted()) {
    log.warn(`[session-store] snapshot: live session ${sourceKey} is in-memory only — nothing to snapshot`);
    return { ok: false, reason: "in_memory_session" };
  }

  let header: unknown;
  let entries: unknown[];
  try {
    header = handle.getHeader();
    const leafId = handle.getLeafId();
    entries = leafId ? handle.getBranch(leafId) : handle.getEntries();
  } catch (err) {
    log.warn(
      `[session-store] snapshot: reading live entries failed for ${sourceKey}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: false, reason: "read_failed" };
  }
  if (!header || !Array.isArray(entries) || entries.length === 0) {
    log.warn(`[session-store] snapshot: live session ${sourceKey} had no usable entries`);
    return { ok: false, reason: "empty_session" };
  }

  const overwrite = opts?.overwrite !== false;
  const targetDir = sessionDir(targetConversationId);
  if (existsSync(targetDir)) {
    if (!overwrite) {
      log.info(`[session-store] snapshot: target exists and overwrite=false ${targetConversationId}`);
      return { ok: false, reason: "target_exists" };
    }
    try {
      await rm(targetDir, { recursive: true, force: true });
    } catch (err) {
      log.warn(
        `[session-store] snapshot: could not clear target ${targetConversationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false, reason: "clear_failed" };
    }
  }

  const timestamp = new Date().toISOString();
  const newSessionId = randomUUID();
  const snapshotHeader = {
    ...(header as Record<string, unknown>),
    id: newSessionId,
    timestamp,
    cwd: handle.getCwd(),
    parentSession: undefined,
  };

  const lines: string[] = [];
  try {
    lines.push(JSON.stringify(snapshotHeader));
    for (const e of entries) {
      if (!e || typeof e !== "object") continue;
      if ((e as { type?: string }).type === "session") continue;
      lines.push(JSON.stringify(e));
    }
  } catch (err) {
    log.warn(
      `[session-store] snapshot: serialize failed for ${sourceKey}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: false, reason: "serialize_failed" };
  }

  try {
    await mkdir(targetDir, { recursive: true });
    const fileName = `${timestamp.replace(/[:.]/g, "-")}_${newSessionId}.jsonl`;
    const sessionFile = path.join(targetDir, fileName);
    const tmpFile = `${sessionFile}.partial`;
    await writeFile(tmpFile, `${lines.join("\n")}\n`, "utf8");
    await rename(tmpFile, sessionFile);
    log.info(
      `[session-store] snapshot ${sourceKey} → ${targetConversationId} entries=${lines.length - 1} file=${sessionFile}`,
    );
    return { ok: true, targetDir, sessionFile, entryCount: lines.length - 1 };
  } catch (err) {
    log.warn(
      `[session-store] snapshot: write failed ${sourceKey} → ${targetConversationId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: false, reason: "write_failed" };
  }
}

export async function branchSession(
  sourceConversationId: string,
  targetConversationId: string,
  mode: BranchSessionMode = "lastUser",
): Promise<boolean> {
  const sourceDir = sessionDir(sourceConversationId);
  const targetDir = sessionDir(targetConversationId);
  log.info(
    `[session-store] Branch requested ${sourceConversationId} → ${targetConversationId} mode=${mode} sourceExists=${existsSync(sourceDir)} targetExists=${existsSync(targetDir)}`,
  );

  // Lazy-restore source if archived to GCS.
  if (!existsSync(sourceDir)) {
    log.info(`[session-store] Branch source missing locally; attempting archive restore for ${sourceConversationId}`);
    await restoreSessionFromArchive(sourceConversationId).catch(() => false);
  }
  if (!existsSync(sourceDir)) {
    log.warn(`[session-store] Cannot branch: source session not found ${sourceConversationId}`);
    return false;
  }

  // Full clone: copy the session verbatim (no branch point) so the fork keeps
  // every turn, including the last assistant reply.
  if (mode === "full") {
    if (existsSync(targetDir)) {
      log.info(`[session-store] Full clone skipped — target already exists ${targetConversationId}`);
      return true;
    }
    try {
      await cp(sourceDir, targetDir, { recursive: true });
      log.info(`[session-store] Full clone ${sourceConversationId} → ${targetConversationId}`);
      return true;
    } catch (err) {
      log.warn(`[session-store] Full clone failed ${sourceConversationId} → ${targetConversationId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  let files: string[];
  try {
    files = await readdir(sourceDir);
  } catch (err) {
    log.warn(`[session-store] Branch readdir failed for ${sourceConversationId}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  const jsonlFile = files.find((f) => f.endsWith(".jsonl"));
  if (!jsonlFile) {
    log.warn(`[session-store] Cannot branch: no .jsonl file in ${sourceConversationId}`);
    return false;
  }

  const sourcePath = path.join(sourceDir, jsonlFile);

  try {
    const sm = SessionManager.open(sourcePath);
    const entries = sm.getEntries();
    log.info(
      `[session-store] Source session entries loaded ${sourceConversationId} count=${entries.length} leaf=${sm.getLeafId() ?? "null"}`,
    );

    let lastUserMsgId: string | null = null;
    let beforeLastUserEntryId: string | null = null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as { type: string; id: string; message?: { role?: string } };
      if (entry.type === "message" && entry.message?.role === "user") {
        lastUserMsgId = entry.id;
        beforeLastUserEntryId = i > 0 ? (entries[i - 1] as { id: string }).id : null;
        break;
      }
    }

    const branchFromId = mode === "beforeLastUser" ? beforeLastUserEntryId : lastUserMsgId;
    if (!branchFromId) {
      log.warn(
        `[session-store] Cannot branch: no user message found ${sourceConversationId} mode=${mode} lastUser=${lastUserMsgId} beforeLastUser=${beforeLastUserEntryId}`,
      );
      return false;
    }

    const branchedPath = sm.createBranchedSession(branchFromId);
    if (!branchedPath) {
      log.warn(`[session-store] createBranchedSession returned undefined for ${sourceConversationId}`);
      return false;
    }

    // PI defers the write to disk if the branch contains no assistant
    // messages — force a rewrite so the file actually exists on disk before
    // we try to rename it into the target dir.
    if (!existsSync(branchedPath)) {
      log.info(`[session-store] Branched path missing on disk; forcing rewrite for ${sourceConversationId}`);
      (sm as unknown as { _rewriteFile(): void })._rewriteFile();
    }

    await mkdir(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, path.basename(branchedPath));
    await rename(branchedPath, targetPath);
    log.info(
      `[session-store] Branched session complete ${sourceConversationId} → ${targetConversationId} at ${targetPath}`,
    );
    return true;
  } catch (err) {
    log.error(
      `[session-store] Branch failed ${sourceConversationId} → ${targetConversationId}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
    );
    return false;
  }
}

/** Clean up sessions older than TTL — archive to GCS first, only delete on success. */
export async function cleanupSessions(): Promise<void> {
  const root = sessionsRoot();
  if (!existsSync(root)) return;

  try {
    const entries = await readdir(root);
    const now = Date.now();
    let cleaned = 0;
    let archiveFailed = 0;
    let skippedActive = 0;

    for (const entry of entries) {
      try {
        if (!entry.includes(".stale-")) {
          const stats = await stat(path.join(root, entry));
          if (now - stats.mtimeMs <= SESSION_TTL_MS) continue;
        }
        const outcome = await disposeSessionDir(entry);
        if (outcome === "archived") cleaned++;
        else if (outcome === "archive-failed") archiveFailed++;
        else if (outcome === "skipped-active") skippedActive++;
      } catch {
        // skip unreadable entries
      }
    }

    if (cleaned > 0 || archiveFailed > 0 || skippedActive > 0) {
      log.info(`[session-store] Sweep: archived+deleted=${cleaned}, archive-failed=${archiveFailed} (left on disk for retry), skipped-active=${skippedActive}`);
    }
  } catch {
    // root dir may not exist yet
  }

  await evictForDiskPressure().catch(() => {});
}

type DisposeOutcome = "skipped-active" | "removed-stale" | "archived" | "archive-failed";

/**
 * The single disposal action both sweeps share. Selection policy (TTL vs
 * LRU-under-pressure) stays with the callers; the invariants live here:
 * never touch a dir backing an active run, never archive `.stale-` rollback
 * debris (delete it), and never delete anything that failed to archive.
 */
async function disposeSessionDir(name: string): Promise<DisposeOutcome> {
  if (isActiveSessionOrBareSpillDir(name)) return "skipped-active";
  const dir = path.join(sessionsRoot(), name);
  if (name.includes(".stale-")) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return "removed-stale";
  }
  if (await archiveSessionToGcsWithRetries(name)) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return "archived";
  }
  return "archive-failed";
}

/** Used fraction (0–100) of the filesystem holding the sessions root, or null. */
async function sessionsVolumeUsedPct(): Promise<number | null> {
  try {
    const s = await statfs(sessionsRoot());
    if (s.blocks <= 0) return null;
    return ((s.blocks - s.bfree) / s.blocks) * 100;
  } catch {
    return null;
  }
}

/**
 * Disk-pressure backstop: when the sessions volume is above the high-water
 * mark, archive+evict idle sessions LRU-first (TTL ignored) until below the
 * low-water mark. Sessions with a run in flight and entries whose archive
 * fails are skipped — same zero-data-loss strictness as the TTL sweep.
 */
async function evictForDiskPressure(): Promise<void> {
  let usedPct = await sessionsVolumeUsedPct();
  if (usedPct === null || usedPct < DISK_HIGH_WATER_PCT) return;
  log.warn(`[session-store] Disk pressure: sessions volume at ${usedPct.toFixed(1)}% (high-water ${DISK_HIGH_WATER_PCT}%) — evicting LRU sessions`);
  metric.count("session_disk_pressure", { stage: "triggered" });

  const root = sessionsRoot();
  let entries: { name: string; mtimeMs: number }[];
  try {
    const names = await readdir(root);
    entries = (
      await Promise.all(
        names.map(async (name) => {
          try {
            return { name, mtimeMs: (await stat(path.join(root, name))).mtimeMs };
          } catch {
            return null;
          }
        }),
      )
    ).filter((e): e is { name: string; mtimeMs: number } => e !== null);
  } catch {
    return;
  }
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first

  let evicted = 0;
  let skipped = 0;
  for (const entry of entries) {
    usedPct = await sessionsVolumeUsedPct();
    if (usedPct === null || usedPct <= DISK_LOW_WATER_PCT) break;
    const outcome = await disposeSessionDir(entry.name);
    if (outcome === "archived") evicted++;
    else if (outcome === "skipped-active" || outcome === "archive-failed") skipped++;
  }
  metric.count("session_disk_pressure", { stage: "done" });
  log.warn(
    `[session-store] Disk pressure: evicted=${evicted}, skipped=${skipped}, volume now ${usedPct === null ? "unknown" : `${usedPct.toFixed(1)}%`}`,
  );
}

/** Start periodic cleanup */
export function startSessionCleanup(): void {
  // Run once on startup
  cleanupSessions().catch(() => {});

  // Then periodically
  setInterval(() => {
    cleanupSessions().catch(() => {});
  }, CLEANUP_INTERVAL_MS).unref();
}
