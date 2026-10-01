/**
 * Signing in with Xyne SSO — one flow behind two entry points.
 *
 * `spaces_login` (the tool) and `xyne-spaces-mcp login` (the command) both call
 * `startLogin`: it asks Spaces for an approval link, opens it, and polls in the
 * background. On approval the session is saved to `~/.xyne/agent/spaces.json`
 * and handed to `onSession`, so the running server picks it up without a restart.
 *
 * The tool cannot block for the minutes approval may take, so `startLogin`
 * resolves as soon as the link exists and exposes the rest as `done`. The
 * command simply awaits `done`.
 *
 * Nothing here may write to stdout: under stdio MCP, stdout is the protocol.
 * The SDK prints the link itself only when no `onUserCode` is given, so one
 * always is.
 */

import { xyneSsoLoginAndWait, type SsoSession } from "@xyne/spaces-sdk";
import { saveSession } from "./config.js";

export interface LoginAttempt {
	/** The approval page, with the request's code filled in. */
	readonly link: string;
	/** The code the approval page shows; the user checks the two match. */
	readonly userCode: string;
	/** Settles when the user approves (with the saved session) or the attempt fails. */
	readonly done: Promise<SsoSession>;
}

/** The attempt in flight, shared so a second call reuses its link. */
let pending: LoginAttempt | undefined;

/** An attempt still waiting for its link, so concurrent calls share it too. */
let starting: Promise<LoginAttempt> | undefined;

/** Why the most recent attempt ended without a session, if it did. */
let lastFailure: unknown;

/**
 * Start sign-in, or join the one already in flight.
 *
 * Resolves with the link once Spaces has issued it; rejects if it cannot
 * (network, bad base URL). `onSession` runs after the session is saved.
 */
export function startLogin(
	baseUrl: string,
	onSession: (session: SsoSession) => void,
): Promise<LoginAttempt> {
	// A second caller joins the attempt in flight and gets its link. Its own
	// `onSession` is not registered: every caller passes the same callback
	// (put the session on the running server), so the first one's is enough.
	if (pending) return Promise.resolve(pending);
	starting ??= begin(baseUrl, onSession).finally(() => {
		starting = undefined;
	});
	return starting;
}

async function begin(baseUrl: string, onSession: (session: SsoSession) => void): Promise<LoginAttempt> {
	let resolveLink!: (value: { link: string; userCode: string }) => void;
	let rejectLink!: (reason: unknown) => void;
	const linkReady = new Promise<{ link: string; userCode: string }>((resolve, reject) => {
		resolveLink = resolve;
		rejectLink = reject;
	});

	const done = xyneSsoLoginAndWait({
		baseUrl,
		openBrowser: true,
		onUserCode: (userCode, _verificationUrl, link) => resolveLink({ link, userCode }),
	}).then((session) => {
		saveSession(session);
		onSession(session);
		return session;
	});

	// If init itself fails, the link never arrives: fail the caller with it.
	// Rejecting after the link resolved is a no-op.
	done.catch(rejectLink);

	const attempt: LoginAttempt = { ...(await linkReady), done };
	pending = attempt;
	// Clear on either outcome so the next call starts afresh. The catch keeps
	// a denial or expiry from surfacing as an unhandled rejection when nobody
	// is awaiting `done` — the tool reports it on its next call instead.
	done.then(
		() => clearPending(attempt),
		(error: unknown) => {
			lastFailure = error;
			clearPending(attempt);
		},
	);
	return attempt;
}

function clearPending(attempt: LoginAttempt): void {
	if (pending === attempt) pending = undefined;
}

/** The attempt in flight, if any. */
export function pendingLogin(): LoginAttempt | undefined {
	return pending;
}

/** Take (and clear) the most recent failure, so it is reported once. */
export function takeLoginFailure(): unknown {
	const failure = lastFailure;
	lastFailure = undefined;
	return failure;
}
