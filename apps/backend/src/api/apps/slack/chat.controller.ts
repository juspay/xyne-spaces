import { api, MessageType, collectAllSlackGroupIds, collectAllSlackUserIds, conversationsSendClient, derivedNames, findSlackMentionIds, findSlackMentionTokens, mergeSlackMentionIds, slackChatContentTemplate, type ExtractorName, type FieldFacts, type RouteBody, type UnreadableString } from '@xyne/shared';
import { config } from '@/config/env';
import { findOrCreateConversation, updateConversation } from '@/apps/core/conversationUtils';
import { deliverEphemeralMessage } from '@/apps/core/ephemeralDelivery';
import { repositories } from '@/database/repositories';
import { composeForStorage, deriveStoredFacts } from '@/services/encryption/compose';
import { resolveSlackMentionTargets } from '@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver';
import { resolveBlockKitIdMaps } from '@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitToFlowJSON';
import type { AppCaller } from '@/framework/api';
import type { AuthenticatedUser } from '@/types/express';
import { slackError, type SlackChannel } from '../../../apps/platform-adapters/slack/access';
import { resolveSlackUserId } from '../../../apps/platform-adapters/slack/middleware';
import { resolveSlackHandleReplacements } from '../../../apps/platform-adapters/slack/request-transformers/handleMentions';
import { transformPostEphemeralResponse, transformPostMessageResponse, transformUpdateResponse } from '../../../apps/platform-adapters/slack/response-transformers/chat';

/**
 * The Slack-compatible write methods (/apps/slack/chat.postMessage, chat.postEphemeral,
 * chat.update), for the controllers in slack.controller.ts. Same answers as the old controller
 * handlers. `text` is an UnreadableString: the handlers never read it. The content is built by
 * compose (template slackChatContent): by the encryption service while DB encryption is on,
 * here otherwise, from the ids looked up here, which come from the facts of `text` (from the
 * encryption service, or derived from plaintext by the framework) and from `blocks` /
 * `attachments`, which stay plaintext.
 */

const XYNE_MESSAGE_CONTENT_MAX_LENGTH = 10000;

/** The facts the message insert side effects read from the content (as for conversations.send). */
const MESSAGE_CONTENT_FACTS = (derivedNames(conversationsSendClient).content ?? []) as ExtractorName[];

type SlackWriteInput<B> = {
	body: B;
	user: AuthenticatedUser | undefined;
	app: AppCaller | undefined;
	channel: SlackChannel;
	/** Facts of `text` (Slack ids, rawLength). */
	textFacts: FieldFacts | undefined;
};

/**
 * `msg_too_long` as before: the body's JSON over 10k characters, `text` counted by the length
 * measured from its plaintext (`rawLength`), since it is not readable here.
 */
function isTooLong(body: object, textFacts: FieldFacts | undefined): boolean {
	const rest = JSON.stringify({ ...body, text: undefined }).length;
	return rest + (textFacts?.rawLength ?? 0) > XYNE_MESSAGE_CONTENT_MAX_LENGTH;
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
 * A Slack-format message's content, built by compose (slackChatContent): the processContent
 * steps, with every lookup done here first: legacy handle mentions (postMessage only), Slack
 * mentions, and the Slack → Xyne id maps for a flow card. Returns the stored value.
 */
async function buildSlackChatContent(input: {
	text: UnreadableString | undefined;
	blocks?: unknown[];
	attachments?: unknown[];
	mrkdwn?: boolean;
	textFacts: FieldFacts | undefined;
	workspaceId: string;
	resolveHandles: boolean;
	ephemeral?: { appId: string; token: string } | null;
}): Promise<string> {
	const facts = input.textFacts ?? {};
	const json = [input.blocks, input.attachments].filter((v): v is unknown[] => !!v?.length).map((v) => JSON.stringify(v));
	const textIds = {
		users: facts.slackMentionUserIds ?? [],
		groups: facts.slackMentionGroupIds ?? [],
		channels: facts.slackMentionChannels ?? [],
	};
	const found = mergeSlackMentionIds([textIds, ...json.map(findSlackMentionIds)]);

	// Legacy handle mentions (`<@harry.sharma>`) first, as transformPostMessage did: a handle
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
	const structured = { blocks: input.blocks as never, attachments: input.attachments as never };

	const [mentions, idMaps] = await Promise.all([
		resolveSlackMentionTargets(ids, config.slackBotToken, input.workspaceId),
		json.length
			? resolveBlockKitIdMaps(
					{
						userIds: [...new Set([...users, ...collectAllSlackUserIds(structured)])],
						groupIds: [...new Set([...ids.groups, ...collectAllSlackGroupIds(structured)])],
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
				text: input.text ?? null,
				blocks: input.blocks ?? null,
				attachments: input.attachments ?? null,
				mrkdwn: input.mrkdwn ?? null,
				handles,
				mentions,
				idMaps,
				screenId: crypto.randomUUID(),
				ephemeral: input.ephemeral ?? null,
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
export async function postSlackMessage(input: SlackWriteInput<RouteBody<typeof api.apps.slack.chatPostMessage>>) {
	const { body, user, app, channel, textFacts } = input;
	if (isTooLong(body, textFacts)) throw slackError("msg_too_long");

	const userId = user?.id ?? "";
	const appId = app?.appId ?? "";
	const workspaceId = requireWorkspace(user);
	const channelId = channel.channelId;

	const content = await buildSlackChatContent({
		text: body.text,
		blocks: body.blocks,
		attachments: body.attachments,
		mrkdwn: body.mrkdwn,
		textFacts,
		workspaceId,
		resolveHandles: true,
	});

	const thread = await resolveSlackThreadConversationId(body.thread_ts, channelId);
	if (thread.error) throw slackError(thread.error);

	const contentFacts = await deriveStoredFacts(content, MESSAGE_CONTENT_FACTS, { workspaceId });
	const result = await findOrCreateConversation(
		channelId,
		userId,
		content,
		false,
		thread.conversationId,
		undefined,
		MessageType.BOT,
		body.metadata,
		{ version: 2, fields: { content: contentFacts } },
	);
	// `text` goes back as the bot sent it: an UnreadableString, written readable by the framework
	// at the response (makeReadable), then re-encrypted for the caller if it is ciphertext.
	return transformPostMessageResponse(result, channelId, (body.text ?? "") as unknown as string, appId, body.username);
}

/** POST /apps/slack/chat.postEphemeral */
export async function postSlackEphemeral(input: SlackWriteInput<RouteBody<typeof api.apps.slack.chatPostEphemeral>>) {
	const { body, user, app, channel, textFacts } = input;
	if (isTooLong(body, textFacts)) throw slackError("msg_too_long");

	const userId = user?.id ?? "";
	const appId = app?.appId ?? "";
	const workspaceId = requireWorkspace(user);
	const channelId = channel.channelId;

	const recipientId = await resolveSlackUserId(body.user, workspaceId);
	if (!recipientId) throw slackError("user_not_found");

	const thread = await resolveSlackThreadConversationId(body.thread_ts, channelId);
	if (thread.error) throw slackError(thread.error);

	const sender = await repositories.users.findById(userId);
	const result = await deliverEphemeralMessage({
		channelId,
		conversationId: thread.conversationId,
		recipientId,
		senderId: userId,
		senderName: sender?.name,
		messageDelivery: "EPHEMERAL",
		appId,
		// Built once the card's capability token is minted, so a flow card stays interactive.
		buildContent: (capability) =>
			buildSlackChatContent({
				text: body.text,
				blocks: body.blocks,
				attachments: body.attachments,
				mrkdwn: body.mrkdwn,
				textFacts,
				workspaceId,
				resolveHandles: false,
				ephemeral: capability,
			}),
		metadata: body.metadata,
	});
	if (!result.ok) {
		throw slackError(result.reason === "not_in_channel" ? "user_not_in_channel" : "invalid_arguments");
	}
	return transformPostEphemeralResponse(result.messageId);
}

/** POST /apps/slack/chat.update */
export async function updateSlackMessage(input: SlackWriteInput<RouteBody<typeof api.apps.slack.chatUpdate>>) {
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

	const content = await buildSlackChatContent({
		text: body.text,
		blocks: body.blocks,
		attachments: body.attachments,
		textFacts,
		workspaceId: requireWorkspace(user),
		resolveHandles: false,
	});

	const result = await updateConversation(messageId, content);
	return transformUpdateResponse(result, channelId, (body.text ?? "") as unknown as string, userId);
}