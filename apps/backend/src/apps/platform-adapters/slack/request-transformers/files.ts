import type { SlackFilesUploadRequest } from "../types";

export interface FilesUploadArgs {
	channelId: string;
	text?: string;
	conversationId?: string;
	metadata?: Record<string, unknown>;
}

export function transformFilesUpload(
	slackReq: SlackFilesUploadRequest,
): FilesUploadArgs {
	const [channelId] = slackReq.channels
		.split(",")
		.map((channel) => channel.trim())
		.filter(Boolean);

	return {
		channelId,
		text: slackReq.initial_comment,
		conversationId: slackReq.thread_ts,
		metadata: slackReq.title ? { title: slackReq.title } : undefined,
	};
}
