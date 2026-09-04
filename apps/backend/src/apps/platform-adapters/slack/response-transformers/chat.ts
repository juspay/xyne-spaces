import type { ChatActionResponse } from "@/apps/types";
import type {
	SlackChatDeleteResponse,
	SlackChatPostMessageResponse,
	SlackChatUpdateResponse,
} from "../types";

export function transformPostMessageResponse(
	result: ChatActionResponse,
	channelId: string,
	text: string,
	appId: string,
	username?: string,
): SlackChatPostMessageResponse {
	return {
		ok: true,
		channel: channelId,
		ts: result.messageId,
		message: {
			type: "message",
			subtype: "bot_message",
			ts: result.messageId,
			bot_id: appId,
			text,
			...(username ? { username } : {}),
		},
	};
}

export function transformUpdateResponse(
	result: ChatActionResponse,
	channelId: string,
	text: string,
	userId: string,
): SlackChatUpdateResponse {
	return {
		ok: true,
		channel: channelId,
		ts: result.messageId,
		text,
		message: {
			text,
			user: userId,
		},
	};
}

export function transformDeleteResponse(
	result: ChatActionResponse,
	channelId: string,
): SlackChatDeleteResponse {
	return { ok: true, channel: channelId, ts: result.messageId };
}
