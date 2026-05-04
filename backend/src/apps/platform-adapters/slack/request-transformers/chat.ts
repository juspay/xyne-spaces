import { SlackBlockKitParser } from "@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser";
import type { TransformContext } from "../../types";
import type {
	SlackChatPostMessageRequest,
	SlackChatUpdateRequest,
} from "../types";

export interface PostMessageArgs {
	channelId: string;
	userId: string;
	content: string;
	isMarkdown: boolean;
	conversationId?: string;
	metadata?: Record<string, unknown>;
}

export interface UpdateMessageArgs {
	messageId: string;
	content: string;
}

const blockKitParser = new SlackBlockKitParser();

function processContent(
	req: Pick<
		SlackChatPostMessageRequest,
		"text" | "blocks" | "attachments" | "mrkdwn"
	>,
): { content: string; isMarkdown: boolean } {
	if (req.blocks || req.attachments) {
		return {
			content: blockKitParser.parse({
				text: req.text,
				blocks: req.blocks,
				attachments: req.attachments,
			}),
			isMarkdown: false,
		};
	}

	if (req.mrkdwn !== false && req.text) {
		return { content: req.text, isMarkdown: true };
	}

	if (req.text) {
		return {
			content: blockKitParser.parse({ text: req.text }),
			isMarkdown: false,
		};
	}

	return { content: "", isMarkdown: false };
}

export function transformPostMessage(
	slackReq: SlackChatPostMessageRequest,
	context: TransformContext,
): PostMessageArgs {
	const { content, isMarkdown } = processContent(slackReq);

	return {
		channelId: slackReq.channel,
		userId: context.userId,
		content,
		isMarkdown,
		conversationId: slackReq.thread_ts,
		metadata: slackReq.metadata,
	};
}

export function transformUpdate(
	slackReq: SlackChatUpdateRequest,
): UpdateMessageArgs {
	const { content } = processContent(slackReq);

	return {
		messageId: slackReq.ts,
		content,
	};
}
