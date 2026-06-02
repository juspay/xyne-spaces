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

import { mkdir, readdir, readFile, stat, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { PATHS, SERVER } from "./config.js";

const SESSION_TTL_DAYS = 7;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const ARCHIVE_TIMEOUT_MS = 120_000; // 2 min — sessions can be tens of MB

function sessionsRoot(): string {
  return path.join(PATHS.dataDir, "sessions");
}

/** Get the session directory for a conversationId */
export function sessionDir(conversationId: string): string {
  return path.join(sessionsRoot(), conversationId);
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

/** Delete a specific session */
export async function deleteSession(conversationId: string): Promise<void> {
  const dir = sessionDir(conversationId);
  try {
    await rm(dir, { recursive: true, force: true });
    console.log(`[session-store] Deleted session ${conversationId}`);
  } catch {
    // ignore
  }
}

/**
 * Walk a session dir and collect every regular file as { relativePath, contents }.
 * Used as the manifest sent to the archive endpoint.
 */
async function collectSessionFiles(dir: string): Promise<{ path: string; contentBase64: string }[]> {
  const out: { path: string; contentBase64: string }[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(current, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(abs, rel);
      } else if (e.isFile()) {
        const buf = await readFile(abs);
        out.push({ path: rel, contentBase64: buf.toString("base64") });
      }
    }
  }
  await walk(dir, "");
  return out;
}

/**
 * Upload a single session's files to GCS via claw-auth's S2S archive endpoint.
 * Returns true on success. On any failure (claw-auth down, S2S mismatch, GCS
 * error), returns false — the caller MUST leave the local dir intact.
 */
export async function archiveSessionToGcs(conversationId: string): Promise<boolean> {
  if (!SERVER.s2sKey) {
    console.warn(`[session-store] No S2S key configured — refusing to archive ${conversationId}`);
    return false;
  }

  const dir = sessionDir(conversationId);
  if (!existsSync(dir)) return true; // already gone, treat as archived

  let files: { path: string; contentBase64: string }[];
  try {
    files = await collectSessionFiles(dir);
  } catch (err) {
    console.warn(`[session-store] Failed to read session ${conversationId} for archive:`, err);
    return false;
  }
  if (files.length === 0) return true; // empty session dir, nothing to archive

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
      console.warn(`[session-store] Archive HTTP ${res.status} for ${conversationId}: ${body.slice(0, 200)}`);
      return false;
    }
    const data = (await res.json()) as { success?: boolean; uploaded?: number };
    if (!data.success) {
      console.warn(`[session-store] Archive rejected for ${conversationId}`);
      return false;
    }
    console.log(`[session-store] Archived ${conversationId} (${data.uploaded ?? files.length} files)`);
    return true;
  } catch (err) {
    console.warn(`[session-store] Archive call failed for ${conversationId}:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * Lazy-restore a session from GCS via claw-auth's S2S restore endpoint.
 * If files are returned, writes them to the local session dir and returns
 * true. If no archive exists for this conversationId, returns false (the
 * caller treats it as "start fresh"). Throws nothing — restore is best
 * effort; failures degrade to "no session" instead of blocking the run.
 */
export async function restoreSessionFromArchive(conversationId: string): Promise<boolean> {
  if (!SERVER.s2sKey) return false;
  if (existsSync(sessionDir(conversationId))) return true; // already local, nothing to do

  const url = `${SERVER.authServiceUrl.replace(/\/$/, "")}/claw/api/v1/internal/sessions/restore/${encodeURIComponent(conversationId)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-s2s-key": SERVER.s2sKey },
      signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn(`[session-store] Restore HTTP ${res.status} for ${conversationId}`);
      return false;
    }
    const data = (await res.json()) as { success?: boolean; files?: { path: string; contentBase64: string }[] };
    if (!data.success || !Array.isArray(data.files) || data.files.length === 0) {
      return false;
    }

    const dir = await ensureSessionDir(conversationId);
    for (const f of data.files) {
      // Defense in depth — even though claw-auth validates, double-check here.
      if (!f.path || f.path.includes("..") || f.path.startsWith("/")) continue;
      const dest = path.join(dir, f.path);
      const parent = path.dirname(dest);
      if (parent !== dir) await mkdir(parent, { recursive: true });
      await writeFile(dest, Buffer.from(f.contentBase64, "base64"));
    }
    console.log(`[session-store] Restored ${conversationId} (${data.files.length} files) from archive`);
    return true;
  } catch (err) {
    console.warn(`[session-store] Restore call failed for ${conversationId}:`, err instanceof Error ? err.message : String(err));
    return false;
  }
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
export async function flushSessionNow(conversationId: string): Promise<void> {
  const st = checkpointState.get(conversationId);
  if (st?.timer) {
    clearTimeout(st.timer);
    st.timer = null;
  }
  await archiveSessionToGcs(conversationId).catch(() => {});
}

/**
 * Flush every active session to GCS, bounded by `budgetMs`. Called from the
 * SIGTERM handler so an in-flight run survives a pod replacement / eviction.
 */
export async function flushAllActiveSessions(budgetMs: number): Promise<void> {
  const ids = [...activeSessions];
  if (ids.length === 0) return;
  console.log(`[session-store] SIGTERM flush: ${ids.length} active session(s) → GCS`);
  await Promise.race([
    Promise.allSettled(ids.map((id) => flushSessionNow(id))),
    new Promise((resolve) => setTimeout(resolve, budgetMs)),
  ]);
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

    for (const entry of entries) {
      const dir = path.join(root, entry);
      try {
        const stats = await stat(dir);
        if (now - stats.mtimeMs <= SESSION_TTL_MS) continue;

        const archived = await archiveSessionToGcs(entry);
        if (!archived) {
          archiveFailed++;
          continue; // leave on disk, next sweep retries
        }

        await rm(dir, { recursive: true, force: true });
        cleaned++;
      } catch {
        // skip unreadable entries
      }
    }

    if (cleaned > 0 || archiveFailed > 0) {
      console.log(`[session-store] Sweep: archived+deleted=${cleaned}, archive-failed=${archiveFailed} (left on disk for retry)`);
    }
  } catch {
    // root dir may not exist yet
  }
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
