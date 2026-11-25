import {
	MessageType,
	UnreadableString,
	collectAllSlackGroupIds,
	collectAllSlackUserIds,
	conversationsSendClient,
	derivedNames,
	findSlackMentionIds,
	findSlackMentionTokens,
	isCiphertextValue,
	mergeSlackMentionIds,
	slackChatContentTemplate,
	type DerivedFacts,
	type ExtractorName,
	type FieldFacts,
	type RouteBody,
	type appsSlackChatPostEphemeral,
	type appsSlackChatPostMessage,
	type appsSlackChatUpdate,
} from "@xyne/shared";
import { config } from "@/config/env";
import { findOrCreateConversation, updateConversation } from "@/apps/core/conversationUtils";
import { deliverEphemeralMessage } from "@/apps/core/ephemeralDelivery";
import { repositories } from "@/database/repositories";
import { composeForStorage, deriveStoredFacts } from "@/services/encryption/compose";
import { resolveSlackMentionTargets } from "@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver";
import { resolveBlockKitIdMaps } from "@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitToFlowJSON";
import type { AppCaller } from "@/framework/api";
import type { AuthenticatedUser } from "@/types/express";
import { slackError, type SlackChannel } from "./access";
import { resolveSlackUserId } from "./middleware";
import { resolveSlackHandleReplacements } from "./request-transformers/handleMentions";
import { transformPostEphemeral, transformPostMessage, transformUpdate } from "./request-transformers/chat";
import {
	transformPostEphemeralResponse,
	transformPostMessageResponse,
	transformUpdateResponse,
} from "./response-transformers/chat";

/**
 * The Slack-compatible write methods (/apps/slack/chat.postMessage, chat.postEphemeral,
 * chat.update) on the typed framework (slack/routes.ts). Same answers as the old controller
 * handlers. With `text` encrypted by the ingress transit proxy, the content is built by the
 * encryption service (compose slackChatContent) from the ids the backend looks up here: the
 * backend never reads the text. With `text` plain, the old transformers build it, unchanged.
 */

const XYNE_MESSAGE_CONTENT_MAX_LENGTH = 10000;

/** The facts the message insert side effects read from the content (as for conversations.send). */
const MESSAGE_CONTENT_FACTS = (derivedNames(conversationsSendClient).content ?? []) as ExtractorName[];

type SlackWriteInput<B> = {
	body: B;
	user: AuthenticatedUser | undefined;
	app: AppCaller | undefined;
	channel: SlackChannel;
	/** Facts the encryption service extracted from the encrypted `text`. */
	textFacts: FieldFacts | undefined;
};

function isEncryptedText(text: string | undefined): text is string {
	return !!text && isCiphertextValue(text);
}

/**
 * `msg_too_long` as before: the body's JSON over 10k characters. Encrypted `text` is longer
 * than the text it holds, so it is counted by the length the encryption service measured.
 */
function isTooLong(body: { text?: string }, textFacts: FieldFacts | undefined): boolean {
	if (isEncryptedText(body.text)) {
		const rest = JSON.stringify({ ...body, text: undefined }).length;
		return rest + (textFacts?.rawLength ?? 0) > XYNE_MESSAGE_CONTENT_MAX_LENGTH;
	}
	return JSON.stringify(body).length > XYNE_MESSAGE_CONTENT_MAX_LENGTH;
}

/** The conversation a Slack `thread_ts` (a message id) starts, if it is in `channelId`. */
export async function resolveSlackThreadConversationId(
	threadTs: string | undefined,
	channelId: string,
): Promise<{ conversationId?: string; error?: "thread_not_found" }> {
	if (!threadTs) return {};
	const parentMsg = await repositories.messages.findById(threadTs);
	if (!parentMsg) return { error: "thread_not_found" };
	const parentConversation = await repositories.conversations.findById(parentMsg.conversationId);
	if (!parentConversation || parentConversation.channelId !== channelId) return { error: "thread_not_found" };
	return { conversationId: parentMsg.conversationId };
}

/**
 * The content of a Slack-format message whose `text` arrived encrypted, built by the
 * encryption service (compose slackChatContent): the processContent steps, with every lookup
 * done here first: legacy handle mentions (postMessage only), Slack mentions, and the Slack →
 * Xyne id maps for a flow card. The ids come from `textFacts` for the encrypted text and are
 * found here in `blocks` / `attachments`, which stay plaintext. Returns the stored value
 * (ciphertext under the workspace key).
 */
async function buildEncryptedSlackChatContent(input: {
	text: string;
	blocks?: unknown[];
	attachments?: unknown[];
	mrkdwn?: boolean;
	textFacts: FieldFacts | undefined;
	workspaceId: string;
	resolveHandles: boolean;
}): Promise<string> {
	const facts = input.textFacts ?? {};
	const json = [input.blocks, input.attachments].filter((v): v is unknown[] => !!v?.length).map((v) => JSON.stringify(v));
	const textIds = {
		users: facts.slackMentionUserIds ?? [],
		groups: facts.slackMentionGroupIds ?? [],
		channels: facts.slackMentionChannels ?? [],
	};
	const found = mergeSlackMentionIds([textIds, ...json.map(findSlackMentionIds)]);

	// Legacy handle mentions (`<@harry.sharma>`) first, as transformPostMessage does: a handle
	// that names one user becomes `<@xyneUserId>`, which is then looked up like any id.
	const handles = input.resolveHandles
		? await resolveSlackHandleReplacements([...textIds.users, ...json.flatMap(findSlackMentionTokens)], input.workspaceId)
		: {};
	const users = [
		...new Set(
			found.users.flatMap((id) => {
				const replacement = handles[id];
				if (replacement === undefined) return [id];
				const rewritten = /^<@(.+)>$/.exec(replacement);
				return rewritten ? [rewritten[1]] : [];
			}),
		),
	];
	const ids = { ...found, users };

	const [mentions, idMaps] = await Promise.all([
		resolveSlackMentionTargets(ids, config.slackBotToken, input.workspaceId),
		json.length
			? resolveBlockKitIdMaps(
					{
						userIds: [
							...new Set([...users, ...collectAllSlackUserIds({ blocks: input.blocks as never, attachments: input.attachments as never })]),
						],
						groupIds: [
							...new Set([...ids.groups, ...collectAllSlackGroupIds({ blocks: input.blocks as never, attachments: input.attachments as never })]),
						],
					},
					config.slackBotToken,
					input.workspaceId,
				)
			: Promise.resolve({ users: {}, groups: {} }),
	]);

	return composeForStorage(
		{
			template: slackChatContentTemplate,
			inputs: {
				text: UnreadableString.make(input.text),
				blocks: input.blocks ?? null,
				attachments: input.attachments ?? null,
				mrkdwn: input.mrkdwn ?? null,
				handles,
				mentions,
				idMaps,
				screenId: crypto.randomUUID(),
			},
		},
		{ workspaceId: input.workspaceId },
	);
}

function requireWorkspace(user: AuthenticatedUser | undefined): string {
	const workspaceId = user?.workspaceId;
	if (!workspaceId) throw slackError("not_authed");
	return workspaceId;
}

/** POST /apps/slack/chat.postMessage */
export async function slackChatPostMessage(input: SlackWriteInput<RouteBody<typeof appsSlackChatPostMessage>>) {
	const { body, user, app, channel, textFacts } = input;
	if (isTooLong(body, textFacts)) throw slackError("msg_too_long");

	const userId = user?.id ?? "";
	const appId = app?.appId ?? "";
	const workspaceId = user?.workspaceId;
	const channelId = channel.channelId;

	let content: string;
	let isMarkdown = false;
	let derived: DerivedFacts | undefined;
	if (isEncryptedText(body.text)) {
		const ws = requireWorkspace(user);
		content = await buildEncryptedSlackChatContent({
			text: body.text,
			blocks: body.blocks,
			attachments: body.attachments,
			mrkdwn: body.mrkdwn,
			textFacts,
			workspaceId: ws,
			resolveHandles: true,
		});
		derived = { version: 2, fields: { content: await deriveStoredFacts(content, MESSAGE_CONTENT_FACTS, { workspaceId: ws }) } };
	} else {
		const args = await transformPostMessage({ ...body, channel: channelId } as never, { userId, appId, workspaceId });
		content = args.content;
		isMarkdown = args.isMarkdown;
	}

	const thread = await resolveSlackThreadConversationId(body.thread_ts, channelId);
	if (thread.error) throw slackError(thread.error);

	const result = await findOrCreateConversation(
		channelId,
		userId,
		content,
		isMarkdown,
		thread.conversationId,
		undefined,
		MessageType.BOT,
		body.metadata,
		derived,
	);
	return transformPostMessageResponse(result, channelId, body.text ?? "", appId, body.username);
}

/** POST /apps/slack/chat.postEphemeral */
export async function slackChatPostEphemeral(input: SlackWriteInput<RouteBody<typeof appsSlackChatPostEphemeral>>) {
	const { body, user, app, channel, textFacts } = input;
	if (isTooLong(body, textFacts)) throw slackError("msg_too_long");

	const userId = user?.id ?? "";
	const appId = app?.appId ?? "";
	const workspaceId = user?.workspaceId;
	const channelId = channel.channelId;

	const recipientId = await resolveSlackUserId(body.user, workspaceId ?? "");
	if (!recipientId) throw slackError("user_not_found");

	const thread = await resolveSlackThreadConversationId(body.thread_ts, channelId);
	if (thread.error) throw slackError(thread.error);

	let args: { flow?: Parameters<typeof deliverEphemeralMessage>[0]["flow"]; content?: string; isMarkdown: boolean; metadata?: Record<string, unknown> };
	if (isEncryptedText(body.text)) {
		// Built as content, never as a flow object: the encryption service returns the card
		// already rendered (`<div data-flow-json>`), so it shows but is not an interactive,
		// signed ephemeral flow.
		const content = await buildEncryptedSlackChatContent({
			text: body.text,
			blocks: body.blocks,
			attachments: body.attachments,
			mrkdwn: body.mrkdwn,
			textFacts,
			workspaceId: requireWorkspace(user),
			resolveHandles: false,
		});
		args = { content, isMarkdown: false, metadata: body.metadata };
	} else {
		args = await transformPostEphemeral({ ...body, channel: channelId, recipientId } as never, { userId, appId, workspaceId });
	}

	const sender = await repositories.users.findById(userId);
	const result = await deliverEphemeralMessage({
		channelId,
		conversationId: thread.conversationId,
		recipientId,
		senderId: userId,
		senderName: sender?.name,
		messageDelivery: "EPHEMERAL",
		...(args.flow ? { appId, flow: args.flow } : {}),
		content: args.content,
		isMarkdown: args.isMarkdown,
		metadata: args.metadata,
	});
	if (!result.ok) {
		throw slackError(result.reason === "not_in_channel" ? "user_not_in_channel" : "invalid_arguments");
	}
	return transformPostEphemeralResponse(result.messageId);
}

/** POST /apps/slack/chat.update */
export async function slackChatUpdate(input: SlackWriteInput<RouteBody<typeof appsSlackChatUpdate>>) {
	const { body, user, channel, textFacts } = input;
	if (isTooLong(body, textFacts)) throw slackError("msg_too_long");

	const userId = user?.id ?? "";
	const channelId = channel.channelId;
	const messageId = body.ts;

	// Checked before the content is built (the old handler built it first; the answers are the same).
	const existingMessage = await repositories.messages.findById(messageId);
	if (!existingMessage) throw slackError("message_not_found");
	if (existingMessage.senderId !== userId) throw slackError("cant_update_message");
	const existingConversation = await repositories.conversations.findById(existingMessage.conversationId);
	if (!existingConversation) throw slackError("thread_not_found");
	if (existingConversation.channelId !== channelId) throw slackError("message_not_found");

	const content = isEncryptedText(body.text)
		? await buildEncryptedSlackChatContent({
				text: body.text,
				blocks: body.blocks,
				attachments: body.attachments,
				textFacts,
				workspaceId: requireWorkspace(user),
				resolveHandles: false,
			})
		: (await transformUpdate(body as never, { workspaceId: user?.workspaceId })).content;

	const result = await updateConversation(messageId, content);
	return transformUpdateResponse(result, channelId, body.text ?? "", userId);
}
