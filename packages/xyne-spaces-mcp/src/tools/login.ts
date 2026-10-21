/**
 * Signing in, from inside the agent.
 *
 * Starts Xyne SSO and returns the approval link straight away; approval is
 * collected in the background (see `src/login.ts`), and the session goes live
 * on this server without a restart.
 */

import type { SsoSession } from "@xyne/spaces-sdk";
import { describeError } from "../errors.js";
import { pendingLogin, startLogin, takeLoginFailure } from "../login.js";
import { ok, optionalBoolean, toIST } from "../render.js";
import type { ToolContext, ToolDef } from "./shared.js";

/** Put a freshly approved session on the running server. */
export function useSession(ctx: ToolContext, session: SsoSession): void {
	ctx.config.session = session;
	ctx.config.sessionSource = "file";
	ctx.sdk.setSession(session);
}

const login: ToolDef = {
	name: "spaces_login",
	description:
		"Sign in to Xyne Spaces with Xyne SSO. Returns a link for the user to open and approve (it is also opened in " +
		"their browser when possible); the session is picked up automatically once they approve, and lasts as long as a Spaces login (24 hours by default). " +
		"Call this when another tool reports that you are not signed in or the session has expired, then ask the user " +
		"to approve and call spaces_whoami to confirm. Does nothing if already signed in unless force is true.",
	inputSchema: {
		type: "object",
		properties: {
			force: { type: "boolean", default: false, description: "Sign in again even if the current session is still valid." },
		},
		additionalProperties: false,
	},
	async handler(args, ctx) {
		const previous = takeLoginFailure();
		const note = previous ? `\n\n(The previous sign-in attempt ended: ${describeError(previous, ctx.baseUrl)})` : "";

		const current = ctx.config.session;
		if (!optionalBoolean(args, "force") && !pendingLogin() && current && current.expiresAt > Date.now()) {
			return ok(
				`Already signed in to Xyne Spaces at ${ctx.baseUrl} as user ${current.userId} (workspace ` +
					`${current.workspaceId}) until ${toIST(current.expiresAt)} IST. Pass force: true to sign in again.`,
			);
		}

		const attempt = await startLogin(ctx.baseUrl, (session) => useSession(ctx, session));
		return ok(
			`To sign in to Xyne Spaces, open this link:\n\n  ${attempt.link}\n\n` +
				`Check the page shows the code ${attempt.userCode}, then tick the confirmation and click Approve.\n\n` +
				"Show the user both the link and the code: the code is how they know the request is theirs. The link " +
				"has been opened in the browser if one is available, and expires in 5 minutes. The session is picked " +
				"up automatically once approved — then call spaces_whoami to confirm." +
				note,
		);
	},
};

export const loginTools: ToolDef[] = [login];
