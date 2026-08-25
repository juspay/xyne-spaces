/**
 * Turning a failure into something the model can act on.
 *
 * A bare "401" tells an agent nothing. Naming where keys come from, or which
 * host could not be reached, lets it tell the user what to do instead of
 * retrying into the same wall.
 */

import { AuthError, NotFoundError, SdkError } from "@xyne/spaces-sdk";
import { KEY_SOURCE } from "./config.js";

/**
 * No key configured at all.
 *
 * Raised before any network call, so the message works offline and costs
 * nothing. The SDK would simply omit the `Authorization` header and let the
 * server answer 401, which is a round trip to learn something already known.
 */
export class MissingApiKeyError extends Error {
	constructor() {
		super(`No Xyne Spaces API key configured. Set XYNE_SPACES_API_KEY to a key minted in ${KEY_SOURCE}.`);
		this.name = "MissingApiKeyError";
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
	if (err instanceof MissingApiKeyError) return err.message;

	if (err instanceof AuthError) {
		// One 401 covers missing, malformed, expired and revoked — the server
		// deliberately does not distinguish them, and the fix is the same for
		// all four. Its message says which; this adds what to do about it.
		return `${err.message} Set XYNE_SPACES_API_KEY to a key minted in ${KEY_SOURCE}. Keys last at most 90 days, and can be revoked from that page.`;
	}

	if (err instanceof NotFoundError) {
		return `${err.message} (Not found, or not visible to your user — these are deliberately indistinguishable. Re-resolve the id through a list tool and copy it verbatim.)`;
	}

	if (err instanceof SdkError) {
		if (err.code === "forbidden") {
			return `${err.message} (Your key acts as your Spaces user, so it can only reach what that user can.)`;
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
