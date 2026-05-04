/**
 * Persistent session storage.
 *
 * Sessions are stored as directories under {dataDir}/sessions/{conversationId}/
 * Each directory contains the pi-coding-agent JSONL session file.
 * Sessions older than SESSION_TTL_DAYS are cleaned up on startup and periodically.
 */

import { mkdir, readdir, stat, rm } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { PATHS } from "./config.js";

const SESSION_TTL_DAYS = 7;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

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

/** Clean up sessions older than TTL */
export async function cleanupSessions(): Promise<void> {
  const root = sessionsRoot();
  if (!existsSync(root)) return;

  try {
    const entries = await readdir(root);
    const now = Date.now();
    let cleaned = 0;

    for (const entry of entries) {
      const dir = path.join(root, entry);
      try {
        const stats = await stat(dir);
        if (now - stats.mtimeMs > SESSION_TTL_MS) {
          await rm(dir, { recursive: true, force: true });
          cleaned++;
        }
      } catch {
        // skip unreadable entries
      }
    }

    if (cleaned > 0) {
      console.log(`[session-store] Cleaned up ${cleaned} expired session(s)`);
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
