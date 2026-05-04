import type {
	SlackConversationsHistoryRequest,
	SlackConversationsListRequest,
	SlackConversationsRepliesRequest,
} from "../types";

export interface HistoryArgs {
	channelId: string;
	limit: number;
	cursor?: string;
}

export function transformHistory(
	slackReq: SlackConversationsHistoryRequest,
): HistoryArgs {
	return {
		channelId: slackReq.channel,
		limit: Math.min(slackReq.limit ?? 100, 1000),
		cursor: slackReq.cursor,
	};
}

export interface RepliesArgs {
	channelId: string;
	conversationId: string;
	limit: number;
	cursor?: string;
}

export function transformReplies(
	slackReq: SlackConversationsRepliesRequest,
): RepliesArgs {
	return {
		channelId: slackReq.channel,
		conversationId: slackReq.ts,
		limit: Math.min(slackReq.limit ?? 100, 1000),
		cursor: slackReq.cursor,
	};
}

export interface ListArgs {
	where: Record<string, unknown>;
	limit: number;
	cursor?: string;
}

const SLACK_TYPE_TO_XYNE: Record<string, Record<string, unknown>> = {
	im: { scopeType: "DM" },
	mpim: { scopeType: "GROUP_DM" },
	public_channel: { scopeType: "DEFAULT", visibility: "PUBLIC" },
	private_channel: { scopeType: "DEFAULT", visibility: "PRIVATE" },
};

export function transformList(
	slackReq: SlackConversationsListRequest,
): ListArgs {
	const types = (slackReq.types ?? "public_channel")
		.split(",")
		.map((type) => type.trim())
		.filter(Boolean);
	const filters = types
		.map((type) => SLACK_TYPE_TO_XYNE[type])
		.filter((filter): filter is Record<string, unknown> => !!filter);

	const where =
		filters.length === 1 ? { ...filters[0] } : { OR: filters };

	return {
		where,
		limit: Math.min(slackReq.limit ?? 100, 1000),
		cursor: slackReq.cursor,
	};
}
