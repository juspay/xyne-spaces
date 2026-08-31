/**
 * session-lock.ts — distributed per-conversation lock for HA.
 *
 * With replicas > 1, two pods must not run the same conversation's session
 * concurrently (both would restore the same JSONL from GCS and corrupt it).
 * The lock lives in Redis on claw-auth (claw holds no Redis client); we
 * acquire / refresh / release it over the same S2S boundary as archive/restore.
 *
 * Design choices:
 *  - Holder token is per-process (POD_ID) so only this pod can refresh/release
 *    its own locks; a different pod that grabbed the lock after a TTL expiry
 *    can't be released out from under it.
 *  - TTL-bounded: if this pod dies, the lock auto-frees so another pod (or a
 *    run-recovery refire) can take over. A background heartbeat (see
 *    startSessionLockHeartbeat) refreshes it every LOCK_HEARTBEAT_INTERVAL_MS
 *    independent of turn boundaries, so the TTL can stay short (~90s) without
 *    a slow model turn expiring a live run's lock; the per-turn refresh in
 *    agent.ts remains as belt-and-suspenders.
 *  - FAIL-CLOSED by default: if the lock service is unreachable, acquire()
 *    resolves false so claw-auth's queue/recovery layer can retry instead of
 *    risking a split-brain session. Set SESSION_LOCK_REQUIRED=false only for
 *    local dev without Redis.
 */
import { randomUUID } from "node:crypto";
import { SERVER } from "./config.js";
import { metric } from "./metrics.js";

const POD_ID = randomUUID();
export const SESSION_LOCK_TTL_MS = Number(process.env["SESSION_LOCK_TTL_MS"] ?? 90_000);
// HTTP budget for a single lock acquire/refresh/release call to claw-auth.
// 5s was too tight: under claw-auth S2S latency (prod 2026-07-07 saw multi-second
// /mcp/tools responses), the acquire fetch timed out and — because acquisition
// is FAIL-CLOSED by default — every affected run was rejected with
// `session_locked` (metric session_lock_failclosed reason=exception). A larger,
// env-tunable budget lets a slow-but-alive lock service respond instead of
// spuriously fail-closing. Kept well under the run's own timeout.
const LOCK_CALL_TIMEOUT_MS = Number(process.env["SESSION_LOCK_CALL_TIMEOUT_MS"] ?? 15_000);
const LOCK_RETRY_INTERVAL_MS = 1_500;
const configuredSessionLockWaitMs = Number(process.env["SESSION_LOCK_WAIT_MS"] ?? 25_000);
export const SESSION_LOCK_WAIT_MS = Number.isFinite(configuredSessionLockWaitMs)
  ? Math.max(0, configuredSessionLockWaitMs)
  : 25_000;
const SESSION_LOCK_REQUIRED = (process.env["SESSION_LOCK_REQUIRED"] ?? "true").toLowerCase() !== "false";

function lockUrl(conversationId: string, suffix = ""): string {
  const base = SERVER.authServiceUrl.replace(/\/$/, "");
  return `${base}/claw/api/v1/internal/sessions/lock/${encodeURIComponent(conversationId)}${suffix}`;
}

function holderToken(conversationId: string): string {
  return `${POD_ID}:${conversationId}`;
}

/**
 * Try to acquire the lock for `conversationId`. Returns true if this pod now
 * owns it, false if another pod owns it or the lock service failed while
 * SESSION_LOCK_REQUIRED=true.
 */
async function tryAcquireSessionLock(conversationId: string, timeoutMs = LOCK_CALL_TIMEOUT_MS): Promise<boolean> {
  if (!SERVER.s2sKey) return !SESSION_LOCK_REQUIRED; // local dev escape hatch
  try {
    const res = await fetch(lockUrl(conversationId), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": SERVER.s2sKey },
      body: JSON.stringify({ holder: holderToken(conversationId), ttlMs: SESSION_LOCK_TTL_MS }),
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
    });
    if (!res.ok) {
      metric.count(SESSION_LOCK_REQUIRED ? "session_lock_failclosed" : "session_lock_failopen", { reason: `http_${res.status}` });
      return !SESSION_LOCK_REQUIRED;
    }
    const data = (await res.json()) as { acquired?: boolean; degraded?: boolean };
    if (data.degraded === true) {
      metric.count(SESSION_LOCK_REQUIRED ? "session_lock_failclosed" : "session_lock_failopen", { reason: "degraded" });
      return !SESSION_LOCK_REQUIRED;
    }
    return data.acquired !== false;
  } catch {
    metric.count(SESSION_LOCK_REQUIRED ? "session_lock_failclosed" : "session_lock_failopen", { reason: "exception" });
    return !SESSION_LOCK_REQUIRED;
  }
}

export async function acquireSessionLock(conversationId: string): Promise<boolean> {
  const deadline = Date.now() + SESSION_LOCK_WAIT_MS;
  let attempts = 0;

  for (;;) {
    const remaining = deadline - Date.now();
    if (attempts > 0 && remaining <= 0) {
      metric.count("session_lock_wait_retry", { result: "exhausted", attempts: String(attempts) });
      return false;
    }

    attempts++;
    const acquired = await tryAcquireSessionLock(
      conversationId,
      SESSION_LOCK_WAIT_MS === 0 ? LOCK_CALL_TIMEOUT_MS : Math.min(LOCK_CALL_TIMEOUT_MS, Math.max(1, remaining)),
    );
    if (acquired) {
      if (attempts > 1) {
        metric.count("session_lock_wait_retry", { result: "acquired", attempts: String(attempts) });
      }
      return true;
    }

    const remainingAfterAttempt = deadline - Date.now();
    if (remainingAfterAttempt <= 0) {
      if (attempts > 1) metric.count("session_lock_wait_retry", { result: "exhausted", attempts: String(attempts) });
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(LOCK_RETRY_INTERVAL_MS, remainingAfterAttempt)));
  }
}

/** Non-mutating lock check for inventory/backfill tooling. */
export async function isSessionLockActive(conversationId: string): Promise<boolean> {
  if (!SERVER.s2sKey) return false;
  try {
    const res = await fetch(lockUrl(conversationId), {
      method: "GET",
      headers: { "x-s2s-key": SERVER.s2sKey },
      signal: AbortSignal.timeout(LOCK_CALL_TIMEOUT_MS),
    });
    if (!res.ok) return SESSION_LOCK_REQUIRED;
    const data = (await res.json()) as { locked?: boolean };
    return data.locked === true;
  } catch {
    return SESSION_LOCK_REQUIRED;
  }
}

/** Extend the lock TTL (called each turn). Best-effort, never throws. */
export async function refreshSessionLock(conversationId: string): Promise<void> {
  if (!SERVER.s2sKey) return;
  try {
    await fetch(lockUrl(conversationId, "/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": SERVER.s2sKey },
      body: JSON.stringify({ holder: holderToken(conversationId), ttlMs: SESSION_LOCK_TTL_MS }),
      signal: AbortSignal.timeout(LOCK_CALL_TIMEOUT_MS),
    });
  } catch {
    // best-effort
  }
}

const LOCK_HEARTBEAT_INTERVAL_MS = Number(
  process.env["SESSION_LOCK_HEARTBEAT_MS"] ?? Math.max(10_000, Math.floor(SESSION_LOCK_TTL_MS / 3)),
);

export function startSessionLockHeartbeat(conversationId: string): () => void {
  const timer = setInterval(() => {
    void refreshSessionLock(conversationId);
  }, LOCK_HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Release the lock (compare-and-delete; only frees it if we still own it). */
export async function releaseSessionLock(conversationId: string): Promise<void> {
  if (!SERVER.s2sKey) return;
  try {
    await fetch(lockUrl(conversationId), {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "x-s2s-key": SERVER.s2sKey },
      body: JSON.stringify({ holder: holderToken(conversationId) }),
      signal: AbortSignal.timeout(LOCK_CALL_TIMEOUT_MS),
    });
  } catch {
    // best-effort — TTL will free it anyway
  }
}

/** Raised by runTask when another pod already owns the conversation lock. */
export class SessionLockedError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Conversation ${conversationId} is locked by another worker`);
    this.name = "SessionLockedError";
  }
}
