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
 *    run-recovery refire) can take over. We refresh on every turn to keep it
 *    alive across long runs.
 *  - FAIL-OPEN: if the lock service is unreachable, acquire() resolves true so
 *    runs aren't blocked by a Redis/claw-auth blip. The lock is anti-corruption
 *    insurance, not a gate that should halt the fleet.
 */
import { randomUUID } from "node:crypto";
import { SERVER } from "./config.js";

const POD_ID = randomUUID();
export const SESSION_LOCK_TTL_MS = Number(process.env["SESSION_LOCK_TTL_MS"] ?? 15 * 60 * 1000);
const LOCK_CALL_TIMEOUT_MS = 5_000;

function lockUrl(conversationId: string, suffix = ""): string {
  const base = SERVER.authServiceUrl.replace(/\/$/, "");
  return `${base}/claw/api/v1/internal/sessions/lock/${encodeURIComponent(conversationId)}${suffix}`;
}

function holderToken(conversationId: string): string {
  return `${POD_ID}:${conversationId}`;
}

/**
 * Try to acquire the lock for `conversationId`. Returns true if this pod now
 * owns it (or if locking is disabled / unreachable — fail-open), false if
 * another pod currently owns it.
 */
export async function acquireSessionLock(conversationId: string): Promise<boolean> {
  if (!SERVER.s2sKey) return true; // locking disabled without an S2S key
  try {
    const res = await fetch(lockUrl(conversationId), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": SERVER.s2sKey },
      body: JSON.stringify({ holder: holderToken(conversationId), ttlMs: SESSION_LOCK_TTL_MS }),
      signal: AbortSignal.timeout(LOCK_CALL_TIMEOUT_MS),
    });
    if (!res.ok) return true; // fail-open
    const data = (await res.json()) as { acquired?: boolean };
    return data.acquired !== false;
  } catch {
    return true; // fail-open — never block a run because the lock service hiccupped
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
