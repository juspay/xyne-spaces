import type { Request, Response } from "express";
import { logger } from "@/utils/logger";
import type { SlackErrorResponse } from "./types";

export function transformSlackError(error: unknown): SlackErrorResponse {
	if (!(error instanceof Error)) {
		return { ok: false, error: "internal_error" };
	}

	const message = error.message.toLowerCase();

	if (message.includes("channel") && message.includes("not found")) {
		return { ok: false, error: "channel_not_found" };
	}
	if (message.includes("user") && message.includes("not found")) {
		return { ok: false, error: "user_not_found" };
	}
	if (message.includes("message") && message.includes("not found")) {
		return { ok: false, error: "message_not_found" };
	}
	if (message.includes("conversation") && message.includes("not found")) {
		return { ok: false, error: "thread_not_found" };
	}
	if (message.includes("not found")) {
		return { ok: false, error: "channel_not_found" };
	}
	if (message.includes("required") || message.includes("validation")) {
		return { ok: false, error: "invalid_arguments" };
	}
	if (message.includes("invalid cursor")) {
		return { ok: false, error: "invalid_cursor" };
	}
	if (
		message.includes("access") ||
		message.includes("forbidden") ||
		message.includes("does not have")
	) {
		return { ok: false, error: "not_in_channel" };
	}
	if (
		message.includes("unauthorized") ||
		message.includes("not authed") ||
		message.includes("invalid token")
	) {
		return { ok: false, error: "not_authed" };
	}

	return { ok: false, error: "internal_error" };
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

export function wrapSlackHandler(handler: AsyncHandler): AsyncHandler {
	return async (req: Request, res: Response): Promise<void> => {
		try {
			await handler(req, res);
		} catch (error) {
			logger.error("[SlackAdapter] Unhandled error:", error);
			const slackError = transformSlackError(error);
			res.status(200).json(slackError);
		}
	};
}
