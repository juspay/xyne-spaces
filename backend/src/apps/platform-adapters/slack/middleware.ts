import type { NextFunction, Request, Response } from "express";
import { authenticateApp } from "@/apps/middelware/authenticator";
import { repositories } from "@/database/repositories";
import { logger } from "@/utils/logger";
import { transformSlackError } from "./error-transformer";

export function getSlackAuthContext(req: Request): {
	userId: string;
	appId: string;
	workspaceId?: string;
} {
	return {
		userId:
			(req.body?.userId as string | undefined) ?? req._slackAuth?.userId ?? "",
		appId:
			(req.body?.appId as string | undefined) ?? req._slackAuth?.appId ?? "",
		workspaceId: req.user?.workspaceId,
	};
}

export function getResolvedChannelId(req: Request): string {
	const channelId = req._resolvedChannelId;
	if (!channelId) {
		throw new Error(
			"Resolved channel ID missing — ensure slackChannelValidation middleware runs first",
		);
	}
	return channelId;
}

export async function resolveSlackChannel(channel: string): Promise<string> {
	const existing = await repositories.channels.findById(channel);
	if (existing) return existing.id;

	const byName = await repositories.channels.findByName(channel);
	if (byName) return byName.id;

	throw new Error("Channel not found");
}

function wrapSlackResponseAndAuth(
	req: Request,
	res: Response,
	next: NextFunction,
	onAuthSuccess: () => void,
): void {
	const originalStatus = res.status.bind(res);
	const originalJson = res.json.bind(res);
	let statusCode = 200;

	res.status = ((code: number) => {
		statusCode = code;
		return originalStatus(code);
	}) as Response["status"];

	res.json = ((body?: unknown) => {
		if (statusCode >= 400) {
			originalStatus(200);
			// If the body already has an error/message, pass it through so callers
			// get the real reason (e.g. missing_permission from requirePermission)
			if (body && typeof body === 'object' && ('error' in body || 'message' in body)) {
				return originalJson({ ok: false, ...(body as object) });
			}
			// Fallback to generic Slack-style wrapper
			const error = statusCode === 500 ? "internal_error" : "not_authed";
			return originalJson({ ok: false, error });
		}
		return originalJson(body);
	}) as Response["json"];

	void authenticateApp(req, res, (error?: unknown) => {
		if (error) {
			next(error);
			return;
		}

		const { userId, appId } = req.body;
		req._slackAuth = { userId, appId };
		onAuthSuccess();
	});
}

export function slackAuthenticateApp(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	req.body = req.body || {};
	wrapSlackResponseAndAuth(req, res, next, () => next());
}

export function slackRawBodyAuthenticateApp(
	req: Request,
	res: Response,
	next: NextFunction,
): void {
	const rawBuffer = req.body;
	req.body = {};
	wrapSlackResponseAndAuth(req, res, next, () => {
		req.body = rawBuffer;
		next();
	});
}

export function slackChannelValidation(source: "body" | "query") {
	return async (
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> => {
		try {
			const channel =
				source === "body"
					? ((req.body as Record<string, unknown>).channel as
							| string
							| undefined)
					: (req.query.channel as string | undefined);

			if (!channel) {
				res.status(200).json({ ok: false, error: "channel_not_found" });
				return;
			}

			const channelId = await resolveSlackChannel(channel);
			const { userId } = getSlackAuthContext(req);

			const isParticipant =
				await repositories.channelParticipants.isParticipant(channelId, userId);
			if (!isParticipant) {
				res.status(200).json({ ok: false, error: "not_in_channel" });
				return;
			}

			req._resolvedChannelId = channelId;
			next();
		} catch (error) {
			logger.warn("[SlackAdapter] Channel validation failed:", error);
			const slackError = transformSlackError(error);
			res.status(200).json(slackError);
		}
	};
}
