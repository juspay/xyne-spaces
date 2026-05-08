import { SlackBlockKitParser } from "@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser";
import { convertBlockKitToFlowJSON } from "@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitToFlowJSON";
import { config } from "@/config/env";
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

/**
 * Convert BlockKit payload to content string.
 * When blocks or attachments are present, try to produce a FlowJSON data-div.
 * Falls back to the HTML BlockKitParser if the converter returns null.
 * Plain mrkdwn text is returned as-is (isMarkdown: true).
 */
async function processContent(
	req: Pick<
		SlackChatPostMessageRequest,
		"text" | "blocks" | "attachments" | "mrkdwn"
	>,
	botToken?: string,
	workspaceId?: string,
): Promise<{ content: string; isMarkdown: boolean }> {
	if (req.blocks?.length || req.attachments?.length) {
		const flowJSON = await convertBlockKitToFlowJSON({
			text: req.text,
			blocks: req.blocks,
			attachments: req.attachments,
		}, botToken, workspaceId);

		if (flowJSON) {
			const escapedJSON = JSON.stringify(flowJSON).replace(/"/g, "&quot;");
			return {
				content: `<div data-flow-json="${escapedJSON}">Flow JSON</div>`,
				isMarkdown: false,
			};
		}

		// Fallback: convert to HTML
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

export async function transformPostMessage(
	slackReq: SlackChatPostMessageRequest,
	context: TransformContext,
): Promise<PostMessageArgs> {
	const { content, isMarkdown } = await processContent(slackReq, config.slackBotToken, config.defaultWorkspaceId);

	return {
		channelId: slackReq.channel,
		userId: context.userId,
		content,
		isMarkdown,
		conversationId: slackReq.thread_ts,
		metadata: slackReq.metadata,
	};
}

export async function transformUpdate(
	slackReq: SlackChatUpdateRequest,
): Promise<UpdateMessageArgs> {
	const { content } = await processContent(slackReq, config.slackBotToken, config.defaultWorkspaceId);

	return {
		messageId: slackReq.ts,
		content,
	};
}
