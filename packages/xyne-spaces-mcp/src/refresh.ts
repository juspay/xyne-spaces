/**
 * Renewing the saved session, shared between processes.
 *
 * Every MCP client runs its own server, and they all read one
 * `~/.xyne/agent/spaces.json`. A renewal replaces the refresh token, and
 * Spaces ends the sign-in if a replaced token is used again. So renewal runs
 * under a lock file and re-reads the file first, and never uses this process's
 * token once the file holds a newer one. The server's 30s grace window covers
 * a process that renews without the lock.
 */

import { closeSync, openSync, statSync, unlinkSync } from "node:fs";
import { SsoAuthError, xyneSsoRefresh, type SpacesSession, type SsoSession } from "@xyne/spaces-sdk";
import { configPath, loadSavedSession, saveSession } from "./config.js";

/** How long to wait for another process's renewal before renewing anyway. */
const LOCK_WAIT_MS = 10_000;

/** A lock older than this was left by a process that died mid-renewal. */
const STALE_LOCK_MS = 30_000;

const RETRY_MS = 100;

/** A saved session with less than this left is not worth taking over. */
const MIN_REMAINING_MS = 60_000;

/** Renew `current`, or use what another process renewed it to. Saves the result. */
export async function renewSharedSession(baseUrl: string, current: SpacesSession): Promise<SsoSession> {
	return withSessionLock(async () => {
		const saved = loadSavedSession();
		const newer =
			saved?.refreshToken &&
			saved.refreshToken !== current.refreshToken &&
			saved.workspaceId === current.workspaceId
				? saved
				: undefined;
		// A newer token in the file means ours is spent: use it, never ours.
		if (newer && newer.expiresAt - Date.now() > MIN_REMAINING_MS) return newer;

		const renewed = await refreshOnce(baseUrl, newer?.refreshToken ?? current.refreshToken!);
		saveSession(renewed);
		return renewed;
	});
}

/** Run `fn` holding `spaces.json.lock`. Renewal and sign-in both take it. */
export async function withSessionLock<T>(fn: () => Promise<T>): Promise<T> {
	const release = await acquireLock(`${configPath()}.lock`);
	try {
		return await fn();
	} finally {
		release();
	}
}

/** One renewal, retried once if the server says another is under way with the same token. */
async function refreshOnce(baseUrl: string, refreshToken: string): Promise<SsoSession> {
	try {
		return await xyneSsoRefresh({ baseUrl, refreshToken });
	} catch (error) {
		if (!(error instanceof SsoAuthError) || error.code !== "temporarily_unavailable") throw error;
		await sleep(1_000);
		return xyneSsoRefresh({ baseUrl, refreshToken });
	}
}

/** Take the lock file and return its release; after `LOCK_WAIT_MS`, go on without it. */
async function acquireLock(path: string): Promise<() => void> {
	const deadline = Date.now() + LOCK_WAIT_MS;
	for (;;) {
		try {
			closeSync(openSync(path, "wx", 0o600));
			return () => {
				try {
					unlinkSync(path);
				} catch {
					// Already removed as stale by another process
				}
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") return () => {};
		}

		if (isStale(path)) {
			try {
				unlinkSync(path);
			} catch {
				// Another process removed it first
			}
			continue;
		}
		if (Date.now() >= deadline) return () => {};
		await sleep(RETRY_MS);
	}
}

function isStale(path: string): boolean {
	try {
		return Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS;
	} catch {
		return false;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
