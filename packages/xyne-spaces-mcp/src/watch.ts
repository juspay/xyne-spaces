/**
 * Following changes to `~/.xyne/agent/spaces.json` while the server runs.
 *
 * The file is shared by every server on this computer and written from outside
 * them: `xyne-spaces-mcp writes on|off`, a sign-in from another client, or the
 * Xyne Spaces desktop app. Watching it lets those take effect without a restart.
 *
 * The directory is watched, not the file: a writer that replaces the file
 * (write to a temporary file, then rename) would end a watch on the old one.
 * Changes arrive in bursts, so they are settled for a moment before reading.
 *
 * Watching is best effort. Where it is unavailable, `resolveWrites` is still
 * read on every tool list and write call, so the setting holds; only the
 * prompt to refresh the list, and picking up a new sign-in, wait for a restart.
 */

import { mkdirSync, watch } from "node:fs";
import { basename, dirname } from "node:path";
import type { SsoSession } from "@xyne/spaces-sdk";
import { configPath, loadSavedSession, resolveWrites } from "./config.js";

const SETTLE_MS = 200;

export interface SharedConfigState {
	/** Whether write tools are on now, env override included. */
	writes: boolean;
	/** The session saved in the file, if any. */
	session: SsoSession | undefined;
}

/** Call `onChange` with the file's current state whenever it changes. */
export function watchSharedConfig(onChange: (state: SharedConfigState) => void): void {
	const path = configPath();
	const directory = dirname(path);
	const file = basename(path);

	let timer: NodeJS.Timeout | undefined;
	const settle = (): void => {
		clearTimeout(timer);
		timer = setTimeout(() => onChange({ writes: resolveWrites().enabled, session: loadSavedSession() }), SETTLE_MS);
	};

	try {
		// The directory may not exist before the first sign-in; created as
		// `saveSession` would, owner-only.
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const watcher = watch(directory, { persistent: false }, (_event, changed) => {
			// Some platforms do not report the name; then any change counts.
			if (!changed || changed === file) settle();
		});
		watcher.on("error", () => watcher.close());
	} catch {
		// Not watchable here; see the note above.
	}
}
