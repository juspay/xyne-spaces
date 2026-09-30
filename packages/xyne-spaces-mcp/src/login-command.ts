/**
 * `xyne-spaces-mcp login` — sign in from a terminal.
 *
 * The same flow as the `spaces_login` tool (`src/login.ts`), but it waits for
 * approval and prints to the terminal. The saved session is what the server
 * reads the next time it starts.
 */

import { configPath, resolveConfig } from "./config.js";
import { describeError } from "./errors.js";
import { startLogin } from "./login.js";
import { toIST } from "./render.js";

/** Run the sign-in; resolves with the process exit code. */
export async function runLoginCommand(): Promise<number> {
	const { baseUrl, sessionSource } = resolveConfig();
	try {
		const attempt = await startLogin(baseUrl, () => {});
		console.log(`To sign in to Xyne Spaces at ${baseUrl}, open this link:\n\n  ${attempt.link}\n`);
		console.log(`Check the page shows the code  ${attempt.userCode}  before approving.\n`);
		console.log("Waiting for approval (the link expires in 5 minutes)...");

		const session = await attempt.done;
		console.log(`\nSigned in as user ${session.userId} (workspace ${session.workspaceId}).`);
		console.log(`Session saved to ${configPath()}, valid until ${toIST(session.expiresAt)} IST.`);
		if (sessionSource === "env") {
			console.log("Note: XYNE_SPACES_COOKIE is set and takes precedence over the saved session; unset it to use this one.");
		}
		return 0;
	} catch (error) {
		console.error(`Sign-in failed: ${describeError(error, baseUrl)}`);
		return 1;
	}
}
