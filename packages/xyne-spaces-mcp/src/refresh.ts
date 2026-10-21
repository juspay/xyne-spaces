/**
 * Renewing the saved session, safely shared between processes.
 *
 * Every MCP client starts its own server, and they all read one
 * `~/.xyne/agent/spaces.json`. Each renewal replaces the refresh token, and
 * Spaces ends the whole sign-in if a replaced token is presented again — so a
 * process renewing with a token another process already spent would sign
 * everyone out. Two guards prevent that:
 *
 * - A lock file around the renewal, and a re-read of the saved session inside
 *   it: a process that finds the session already renewed by another takes that
 *   one instead of renewing again, or renews with that one's refresh token if
 *   its cookie has run out too. A process never renews with its own token once
 *   the file holds a newer one, however long it has been idle.
 * - The server's grace window: for 30 seconds the old token still answers with
 *   the renewed session, which covers a process that does not take the lock in
 *   time and renews anyway.
 *
 * The SDK client calls `renewSharedSession` (as `refreshSession`) shortly
 * before the cookie expires, and once on a 401.
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

/**
 * Renew `current`, or take over the session another process already renewed
 * it to. Saves what it renews, so other processes pick it up too.
 */
export async function renewSharedSession(baseUrl: string, current: SpacesSession): Promise<SsoSession> {
	const release = await acquireLock(`${configPath()}.lock`);
	try {
		const saved = loadSavedSession();
		const newer =
			saved?.refreshToken &&
			saved.refreshToken !== current.refreshToken &&
			saved.workspaceId === current.workspaceId
				? saved
				: undefined;
		if (newer && newer.expiresAt - Date.now() > MIN_REMAINING_MS) return newer;

		const renewed = await refreshOnce(baseUrl, newer?.refreshToken ?? current.refreshToken!);
		saveSession(renewed);
		return renewed;
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

/**
 * Take the lock file, waiting for another holder. Returns its release. After
 * `LOCK_WAIT_MS` without it, renews unlocked rather than fail the request: the
 * server's grace window still covers a race.
 */
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
