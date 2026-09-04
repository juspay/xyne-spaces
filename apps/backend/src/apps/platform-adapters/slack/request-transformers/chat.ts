import { SlackBlockKitParser } from "@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser";
import { convertBlockKitToFlowJSON } from "@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitToFlowJSON";
import {
	resolveSlackMessageParts,
	resolveSlackText,
} from "@/integrations/adapters/slack-webhook-tickets/utils/slackUtils";
import { config } from "@/config/env";
import type { TransformContext } from "../../types";
import type {
	SlackChatDeleteRequest,
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

export interface DeleteMessageArgs {
	messageId: string;
	channelId: string;
}

const blockKitParser = new SlackBlockKitParser();

/**
 * Convert BlockKit payload to content string.
 * When blocks or attachments are present, try to produce a FlowJSON data-div.
 * Falls back to the HTML BlockKitParser if the converter returns null.
 * mrkdwn:false returns resolved plain text (isMarkdown: true); mrkdwn:true (default) converts via blockKitParser.
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
		const resolvedReq = await resolveSlackMessageParts(req, botToken, workspaceId);
		return {
			content: blockKitParser.parse({
				text: resolvedReq.text,
				blocks: resolvedReq.blocks,
				attachments: resolvedReq.attachments,
			}),
			isMarkdown: false,
		};
	}

	// mrkdwn:false disables formatting but Slack still resolves mention tokens
	if (req.mrkdwn !== true && req.text) {
		const resolvedText = await resolveSlackText(req.text, botToken, workspaceId);
		return { content: resolvedText, isMarkdown: false };
	}

	if (req.text) {
		const resolvedText = await resolveSlackText(req.text, botToken, workspaceId);
		return {
			content: blockKitParser.parse({ text: resolvedText }),
			isMarkdown: false,
		};
	}

	return { content: "", isMarkdown: false };
}

export async function transformPostMessage(
	slackReq: SlackChatPostMessageRequest,
	context: TransformContext,
): Promise<PostMessageArgs> {
	const { content, isMarkdown } = await processContent(slackReq, config.slackBotToken, context.workspaceId ?? config.defaultWorkspaceId);

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
	context?: Pick<TransformContext, "workspaceId">,
): Promise<UpdateMessageArgs> {
	const { content } = await processContent(slackReq, config.slackBotToken, context?.workspaceId ?? config.defaultWorkspaceId);

	return {
		messageId: slackReq.ts,
		content,
	};
}

export function transformDelete(
	slackReq: SlackChatDeleteRequest,
): DeleteMessageArgs {
	return { messageId: slackReq.ts, channelId: slackReq.channel };
}
