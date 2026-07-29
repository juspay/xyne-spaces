/**
 * lock.ts — file-based advisory lock for session files.
 *
 * Protects against cross-process concurrent writes to the same session JSONL.
 * Uses O_EXCL (wx flag) for atomic creation — same approach as OpenClaw's
 * session-write-lock.ts but minimal: just what we need.
 *
 * Stale detection: lock is stale if owning PID is dead OR lock is >5 minutes old.
 * Cleanup: registered on SIGINT/SIGTERM/exit.
 */
import { existsSync, rmSync } from "node:fs";
import { open, rm, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";

interface LockPayload {
  pid: number;
  ts: number; // unix ms
}

const STALE_MS = 5 * 60 * 1000;  // 5 minutes
const TIMEOUT_MS = 15_000;        // give up after 15s
const RETRY_DELAY_MS = 100;

// Track locks held by this process for cleanup
const held = new Set<string>();

function lockPath(sessionFile: string): string {
  return `${resolve(sessionFile)}.lock`;
}

function isPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

async function readPayload(lp: string): Promise<LockPayload | null> {
  try {
    const raw = await import("node:fs/promises").then(m => m.readFile(lp, "utf-8"));
    return JSON.parse(raw) as LockPayload;
  } catch { return null; }
}

function isStale(payload: LockPayload | null): boolean {
  if (!payload) return true;                          // unreadable = stale
  if (!isPidAlive(payload.pid)) return true;          // dead process
  if (Date.now() - payload.ts > STALE_MS) return true; // too old
  return false;
}

export interface Lock {
  release(): Promise<void>;
}

export async function acquireFileLock(sessionFile: string): Promise<Lock> {
  const lp = lockPath(sessionFile);
  mkdirSync(dirname(lp), { recursive: true });

  const deadline = Date.now() + TIMEOUT_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    let handle;
    try {
      // O_EXCL — fails if file exists (atomic)
      handle = await open(lp, "wx");
      const payload: LockPayload = { pid: process.pid, ts: Date.now() };
      await handle.writeFile(JSON.stringify(payload), "utf-8");
      await handle.close();
      held.add(lp);

      return {
        release: async () => {
          held.delete(lp);
          await rm(lp, { force: true });
        },
      };
    } catch (err) {
      await handle?.close().catch(() => {});
      const code = (err as { code?: string }).code;
      if (code !== "EEXIST") throw err;

      // Lock exists — check if stale
      const payload = await readPayload(lp);
      if (isStale(payload)) {
        await rm(lp, { force: true }).catch(() => {});
        continue; // retry immediately
      }

      await new Promise(r => setTimeout(r, Math.min(RETRY_DELAY_MS * attempt, 1000)));
    }
  }

  throw new Error(`Could not acquire lock on ${sessionFile} after ${TIMEOUT_MS}ms`);
}

// ── Cleanup on exit/signal ────────────────────────────────────────────────

function releaseAllSync(): void {
  for (const lp of held) {
    try { rmSync(lp, { force: true }); } catch { /* best effort */ }
  }
  held.clear();
}

process.on("exit", releaseAllSync);
for (const sig of ["SIGINT", "SIGTERM", "SIGQUIT"] as const) {
  process.on(sig, () => { releaseAllSync(); process.exit(); });
}
