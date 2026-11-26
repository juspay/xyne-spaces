import { api } from '@xyne/shared';
import { router } from '@/framework/api';
import { slackChatPostEphemeral, slackChatPostMessage, slackChatUpdate } from './chat.controller';
import { slackAuthTest, slackConversationsInfo, slackConversationsList, slackConversationsOpen, slackUsergroupsList, slackUsersConversations, slackUsersInfo, slackUsersLookupByEmail } from './reads.controller';
import { appPermission } from '@/apps/access';
import { checkBotMessageDelete } from '@/apps/core/botMessageDelete';
import { deleteConversationMessage } from '@/apps/core/conversationUtils';
import { slackChannel, slackError, slackHandle } from '@/apps/platform-adapters/slack/access';
import { transformDeleteResponse } from '@/apps/platform-adapters/slack/response-transformers/chat';

/** The bot's workspace: whose key the encrypted `text` is stored under. */
const encryptUnderBotWorkspace = {
  resolveWorkspaceId: async (req: { user?: { workspaceId: string } }) => req.user!.workspaceId,
};

/** `/apps/slack`: the Slack-compatible API (bot token, Slack's answers: HTTP 200, `{ ok: false, error }`). */
export const slackRouter = router(api.apps.slack, { auth: 'slack-app', invalidRequest: () => slackError('invalid_arguments') }, (serve) => ({
	// Same check as the native chat/deleteMessage (core/botMessageDelete), Slack's answers.
	chatDelete: serve("chatDelete", {
		access: { permission: appPermission("chat:delete"), channel: slackChannel() },
		controller: ({ body, user, access }) =>
			slackHandle(async () => {
				const userId = user?.id ?? "";
				const channelId = access.channel.channelId;
				const check = await checkBotMessageDelete(body.ts, channelId, userId);
				if (!check.ok) {
					throw slackError(check.reason === "not_own" ? "cant_delete_message" : "message_not_found");
				}
				if (check.alreadyDeleted) {
					return { ok: true as const, channel: channelId, ts: body.ts };
				}
				const result = await deleteConversationMessage(body.ts, userId);
				return transformDeleteResponse(result, channelId);
			}),
	}),
	// `text` encrypted by the ingress proxy: the content is built by the encryption service
	// (chatWrite.ts). Plain `text` takes the old transformers, unchanged.
	chatPostMessage: serve("chatPostMessage", {
		access: { permission: appPermission("chat:write"), channel: slackChannel() },
		encryption: encryptUnderBotWorkspace,
		controller: ({ body, user, app, access, derived }) =>
			slackHandle(() => slackChatPostMessage({ body, user, app, channel: access.channel, textFacts: derived?.fields.text })),
	}),
	chatPostEphemeral: serve("chatPostEphemeral", {
		access: { permission: appPermission("chat:write"), channel: slackChannel() },
		encryption: encryptUnderBotWorkspace,
		controller: ({ body, user, app, access, derived }) =>
			slackHandle(() => slackChatPostEphemeral({ body, user, app, channel: access.channel, textFacts: derived?.fields.text })),
	}),
	chatUpdate: serve("chatUpdate", {
		access: { permission: appPermission("chat:write"), channel: slackChannel() },
		encryption: encryptUnderBotWorkspace,
		controller: ({ body, user, app, access, derived }) =>
			slackHandle(() => slackChatUpdate({ body, user, app, channel: access.channel, textFacts: derived?.fields.text })),
	}),
	// ─── Reads: GET (query) and POST (body), as Slack answers both ───────────────
	authTestGet: serve("authTestGet", { controller: ({ user, app }) => slackHandle(() => slackAuthTest({ user, app })) }),
	authTestPost: serve("authTestPost", { controller: ({ user, app }) => slackHandle(() => slackAuthTest({ user, app })) }),
	conversationsInfoGet: serve("conversationsInfoGet", {
		access: { permission: appPermission("channels:read"), channel: slackChannel("query") },
		controller: ({ access }) => slackHandle(() => slackConversationsInfo({ channel: access.channel })),
	}),
	conversationsInfoPost: serve("conversationsInfoPost", {
		access: { permission: appPermission("channels:read"), channel: slackChannel("body") },
		controller: ({ access }) => slackHandle(() => slackConversationsInfo({ channel: access.channel })),
	}),
	conversationsListGet: serve("conversationsListGet", {
		access: { permission: appPermission("channels:read") },
		controller: ({ query }) => slackHandle(() => slackConversationsList(query)),
	}),
	conversationsListPost: serve("conversationsListPost", {
		access: { permission: appPermission("channels:read") },
		controller: ({ body }) => slackHandle(() => slackConversationsList(body)),
	}),
	conversationsOpen: serve("conversationsOpen", {
		access: { permission: appPermission("im:write") },
		controller: ({ body, user, app }) => slackHandle(() => slackConversationsOpen({ body, user, app })),
	}),
	usersInfoGet: serve("usersInfoGet", {
		access: { permission: appPermission("users:read") },
		controller: ({ query }) => slackHandle(() => slackUsersInfo(query)),
	}),
	usersInfoPost: serve("usersInfoPost", {
		access: { permission: appPermission("users:read") },
		controller: ({ body }) => slackHandle(() => slackUsersInfo(body)),
	}),
	usersLookupByEmailGet: serve("usersLookupByEmailGet", {
		access: { permission: appPermission("users:read") },
		controller: ({ query, user, app }) => slackHandle(() => slackUsersLookupByEmail({ args: query, user, app })),
	}),
	usersLookupByEmailPost: serve("usersLookupByEmailPost", {
		access: { permission: appPermission("users:read") },
		controller: ({ body, user, app }) => slackHandle(() => slackUsersLookupByEmail({ args: body, user, app })),
	}),
	usersConversationsGet: serve("usersConversationsGet", {
		access: { permission: appPermission("channels:read") },
		controller: ({ query, user, app }) => slackHandle(() => slackUsersConversations({ args: query, user, app })),
	}),
	usersConversationsPost: serve("usersConversationsPost", {
		access: { permission: appPermission("channels:read") },
		controller: ({ body, user, app }) => slackHandle(() => slackUsersConversations({ args: body, user, app })),
	}),
	usergroupsListGet: serve("usergroupsListGet", {
		access: { permission: appPermission("usergroups:read") },
		controller: ({ query }) => slackHandle(() => slackUsergroupsList(query)),
	}),
	usergroupsListPost: serve("usergroupsListPost", {
		access: { permission: appPermission("usergroups:read") },
		controller: ({ body }) => slackHandle(() => slackUsergroupsList(body)),
	}),
}));
