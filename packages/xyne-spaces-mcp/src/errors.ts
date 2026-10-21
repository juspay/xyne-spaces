/**
 * Turning a failure into something the model can act on.
 *
 * A bare "401" tells an agent nothing. Naming how to sign in, or which host
 * could not be reached, lets it tell the user what to do instead of retrying
 * into the same wall.
 */

import { AuthError, NotFoundError, SdkError } from "@xyne/spaces-sdk";
import { LOGIN_HINT } from "./config.js";

/**
 * No usable session: none configured, or the one configured has expired.
 *
 * Raised before any network call, so the message works offline and costs
 * nothing. The session's expiry is known locally, so sending it anyway would be
 * a round trip to learn something already known.
 */
export class NotSignedInError extends Error {
	constructor(reason: "missing" | "expired", fromEnv: boolean) {
		super(
			reason === "missing"
				? `Not signed in to Xyne Spaces. To sign in, ${LOGIN_HINT}.`
				: `Your Xyne Spaces session has expired. To sign in again, ${LOGIN_HINT}.` +
						(fromEnv ? " XYNE_SPACES_COOKIE is set and takes precedence, so update or unset it first." : ""),
		);
		this.name = "NotSignedInError";
	}
}

/**
 * Prose for a thrown error, aimed at the model rather than at a log.
 *
 * `baseUrl` is passed in because `SdkError` does not carry it and a network
 * failure is unactionable without knowing which host was unreachable — a
 * misconfigured `XYNE_SPACES_BASE_URL` is the usual cause.
 */
export function describeError(err: unknown, baseUrl: string): string {
	const text = describe(err, baseUrl);
	// The server's id for a failed request, kept by @xyne/spaces-sdk from 0.1.3.
	// Read loosely so an older SDK, which has no such field, just omits it.
	const requestId = (err as { requestId?: unknown } | null)?.requestId;
	return typeof requestId === "string" && requestId ? `${text} [request id: ${requestId}]` : text;
}

function describe(err: unknown, baseUrl: string): string {
	if (err instanceof NotSignedInError) return err.message;

	if (err instanceof AuthError) {
		// Expiry is caught locally before any request, so a 401 here means a
		// session the server no longer accepts: the user was removed from the
		// workspace or org, an admin forced every session to sign out
		// (FORCE_LOGOUT_BEFORE), or the session belongs to another deployment
		// than XYNE_SPACES_BASE_URL. Signing out of Spaces does not end it.
		return (
			`${err.message} Xyne Spaces no longer accepts this session — usually because the account was removed from ` +
			`the workspace, all sessions were force-signed-out, or it was issued by a different deployment than ` +
			`${baseUrl}. To sign in again, ${LOGIN_HINT}.`
		);
	}

	if (err instanceof NotFoundError) {
		return `${err.message} (Not found, or not visible to your user — these are deliberately indistinguishable. Re-resolve the id through a list tool and copy it verbatim.)`;
	}

	if (err instanceof SdkError) {
		if (err.code === "forbidden") {
			return `${err.message} (The session acts as your Spaces user, so it can only reach what that user can.)`;
		}
		if (err.code === "timeout") {
			return `Xyne Spaces at ${baseUrl} did not respond in time. Narrow the request with a smaller limit, or raise XYNE_SPACES_TIMEOUT_MS.`;
		}
		if (err.code === "network_error") {
			return `Could not reach Xyne Spaces at ${baseUrl}: ${err.message}`;
		}
		// 400 lands here, and its message is the useful part: the server passes
		// business-rule refusals through verbatim.
		return `${err.message}${err.serverCode ? ` (${err.serverCode})` : ""}`;
	}

	return err instanceof Error ? err.message : String(err);
}
