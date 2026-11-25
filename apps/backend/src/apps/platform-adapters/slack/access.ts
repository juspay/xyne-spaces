import { ContractError, type AccessCheck } from "@/framework/api";
import { repositories } from "@/database/repositories";
import { logger } from "@/utils/logger";
import { transformSlackError } from "./error-transformer";
import { resolveSlackChannelForUser } from "./middleware";

/**
 * Access checks and error answers for typed Slack-compatible routes (/apps/slack/...). Every
 * answer is HTTP 200 with Slack's `{ ok: false, error }`, as slackChannelValidation and
 * wrapSlackHandler answer for the untyped ones.
 */

/** A Slack-style error answer: HTTP 200, `{ ok: false, error: <slack_code> }`. */
export function slackError(error: string): ContractError {
	return new ContractError(200, { ok: false, error });
}

/** The channel a Slack-style request names, as `slackChannel` resolved it. */
export type SlackChannel = { channelId: string; isDM: boolean };

/**
 * The body's `channel` (a channel id, `#name`, or a user id meaning the bot's DM with them)
 * must resolve, and the bot must be a participant of it (always so for its own DM). Same
 * answers as slackChannelValidation: `channel_not_found`, `not_in_channel`, or the error's
 * Slack code.
 */
export function slackChannel(): AccessCheck<SlackChannel> {
	return async ({ body, user }) => {
		const channel = (body as { channel?: unknown } | undefined)?.channel;
		if (typeof channel !== "string" || !channel) {
			throw slackError("channel_not_found");
		}
		const userId = user?.id ?? "";
		try {
			const { channelId, isDM } = await resolveSlackChannelForUser(channel, userId, user?.workspaceId ?? "");
			if (!isDM && !(await repositories.channelParticipants.isParticipant(channelId, userId))) {
				throw slackError("not_in_channel");
			}
			return { channelId, isDM };
		} catch (error) {
			if (error instanceof ContractError) throw error;
			logger.warn("[SlackAdapter] Channel validation failed:", error);
			throw new ContractError(200, { ...transformSlackError(error) });
		}
	};
}

/**
 * Runs a Slack-style handler body: an unexpected error becomes its Slack code (HTTP 200), as
 * wrapSlackHandler does for the untyped routes.
 */
export async function slackHandle<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (error) {
		if (error instanceof ContractError) throw error;
		logger.error("[SlackAdapter] Unhandled error:", error);
		throw new ContractError(200, { ...transformSlackError(error) });
	}
}
