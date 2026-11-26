import express, { Router } from "express";
import { uploadConfig } from "@/middleware/upload";
import { SlackController } from "./controller";
import {
	slackAuthenticateApp,
	slackChannelValidation,
	slackRawBodyAuthenticateApp,
} from "./middleware";
import { requirePermission } from "@/middleware/requirePermission";
import { API } from "@xyne/shared";
import { api } from "@/framework/api";
import { appPermission } from "@/apps/access";
import { checkBotMessageDelete } from "@/apps/core/botMessageDelete";
import { deleteConversationMessage } from "@/apps/core/conversationUtils";
import { slackChannel, slackError, slackHandle } from "./access";
import { slackChatPostEphemeral, slackChatPostMessage, slackChatUpdate } from "./chatWrite";
import {
	slackAuthTest,
	slackConversationsInfo,
	slackConversationsList,
	slackConversationsOpen,
	slackUsergroupsList,
	slackUsersConversations,
	slackUsersInfo,
	slackUsersLookupByEmail,
} from "./reads";

/** What every Slack-compatible route has: the bot token with Slack-style answers, invalid_arguments for a bad request. */
const slackRoute = () => ({ auth: "slack-app" as const, invalidRequest: () => slackError("invalid_arguments") });

/** The bot's workspace: whose key the encrypted `text` is stored under. */
const encryptUnderBotWorkspace = {
	resolveWorkspaceId: async (req: { user?: { workspaceId: string } }) => req.user!.workspaceId,
};
import { transformDeleteResponse } from "./response-transformers/chat";

const router = Router();
const controller = new SlackController();

router.post(
	"/_upload/:fileId",
	express.raw({ type: "*/*", limit: "50mb" }),
	slackRawBodyAuthenticateApp,
	requirePermission("files:write"),
	controller.filesUploadV2Binary,
);

router.use(slackAuthenticateApp);

// ─── Typed routes (contracts in @xyne/shared, API.apps.slack) ──────────────────
// Served by the API router behind the contract gate, not by this router.
api.routes(API.apps.slack, (serve) => ({
	// Same check as the native chat/deleteMessage (core/botMessageDelete), Slack's answers.
	chatDelete: serve("chatDelete", {
		auth: "slack-app",
		invalidRequest: () => slackError("invalid_arguments"),
		access: { permission: appPermission("chat:delete"), channel: slackChannel() },
		handle: ({ body, user, access }) =>
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
		auth: "slack-app",
		invalidRequest: () => slackError("invalid_arguments"),
		access: { permission: appPermission("chat:write"), channel: slackChannel() },
		encryption: encryptUnderBotWorkspace,
		handle: ({ body, user, app, access, derived }) =>
			slackHandle(() => slackChatPostMessage({ body, user, app, channel: access.channel, textFacts: derived?.fields.text })),
	}),
	chatPostEphemeral: serve("chatPostEphemeral", {
		auth: "slack-app",
		invalidRequest: () => slackError("invalid_arguments"),
		access: { permission: appPermission("chat:write"), channel: slackChannel() },
		encryption: encryptUnderBotWorkspace,
		handle: ({ body, user, app, access, derived }) =>
			slackHandle(() => slackChatPostEphemeral({ body, user, app, channel: access.channel, textFacts: derived?.fields.text })),
	}),
	chatUpdate: serve("chatUpdate", {
		auth: "slack-app",
		invalidRequest: () => slackError("invalid_arguments"),
		access: { permission: appPermission("chat:write"), channel: slackChannel() },
		encryption: encryptUnderBotWorkspace,
		handle: ({ body, user, app, access, derived }) =>
			slackHandle(() => slackChatUpdate({ body, user, app, channel: access.channel, textFacts: derived?.fields.text })),
	}),
	// ─── Reads: GET (query) and POST (body), as Slack answers both ───────────────
	authTestGet: serve("authTestGet", { ...slackRoute(), handle: ({ user, app }) => slackHandle(() => slackAuthTest({ user, app })) }),
	authTestPost: serve("authTestPost", { ...slackRoute(), handle: ({ user, app }) => slackHandle(() => slackAuthTest({ user, app })) }),
	conversationsInfoGet: serve("conversationsInfoGet", {
		...slackRoute(),
		access: { permission: appPermission("channels:read"), channel: slackChannel("query") },
		handle: ({ access }) => slackHandle(() => slackConversationsInfo({ channel: access.channel })),
	}),
	conversationsInfoPost: serve("conversationsInfoPost", {
		...slackRoute(),
		access: { permission: appPermission("channels:read"), channel: slackChannel("body") },
		handle: ({ access }) => slackHandle(() => slackConversationsInfo({ channel: access.channel })),
	}),
	conversationsListGet: serve("conversationsListGet", {
		...slackRoute(),
		access: { permission: appPermission("channels:read") },
		handle: ({ query }) => slackHandle(() => slackConversationsList(query)),
	}),
	conversationsListPost: serve("conversationsListPost", {
		...slackRoute(),
		access: { permission: appPermission("channels:read") },
		handle: ({ body }) => slackHandle(() => slackConversationsList(body)),
	}),
	conversationsOpen: serve("conversationsOpen", {
		...slackRoute(),
		access: { permission: appPermission("im:write") },
		handle: ({ body, user, app }) => slackHandle(() => slackConversationsOpen({ body, user, app })),
	}),
	usersInfoGet: serve("usersInfoGet", {
		...slackRoute(),
		access: { permission: appPermission("users:read") },
		handle: ({ query }) => slackHandle(() => slackUsersInfo(query)),
	}),
	usersInfoPost: serve("usersInfoPost", {
		...slackRoute(),
		access: { permission: appPermission("users:read") },
		handle: ({ body }) => slackHandle(() => slackUsersInfo(body)),
	}),
	usersLookupByEmailGet: serve("usersLookupByEmailGet", {
		...slackRoute(),
		access: { permission: appPermission("users:read") },
		handle: ({ query, user, app }) => slackHandle(() => slackUsersLookupByEmail({ args: query, user, app })),
	}),
	usersLookupByEmailPost: serve("usersLookupByEmailPost", {
		...slackRoute(),
		access: { permission: appPermission("users:read") },
		handle: ({ body, user, app }) => slackHandle(() => slackUsersLookupByEmail({ args: body, user, app })),
	}),
	usersConversationsGet: serve("usersConversationsGet", {
		...slackRoute(),
		access: { permission: appPermission("channels:read") },
		handle: ({ query, user, app }) => slackHandle(() => slackUsersConversations({ args: query, user, app })),
	}),
	usersConversationsPost: serve("usersConversationsPost", {
		...slackRoute(),
		access: { permission: appPermission("channels:read") },
		handle: ({ body, user, app }) => slackHandle(() => slackUsersConversations({ args: body, user, app })),
	}),
	usergroupsListGet: serve("usergroupsListGet", {
		...slackRoute(),
		access: { permission: appPermission("usergroups:read") },
		handle: ({ query }) => slackHandle(() => slackUsergroupsList(query)),
	}),
	usergroupsListPost: serve("usergroupsListPost", {
		...slackRoute(),
		access: { permission: appPermission("usergroups:read") },
		handle: ({ body }) => slackHandle(() => slackUsergroupsList(body)),
	}),
}));

router.get(
	"/conversations.history",
	requirePermission("channels:read"),
	slackChannelValidation("query"),
	controller.conversationsHistory,
);
router.post(
	"/conversations.history",
	requirePermission("channels:read"),
	slackChannelValidation("body"),
	controller.conversationsHistory,
);

router.get(
	"/conversations.replies",
	requirePermission("channels:read"),
	slackChannelValidation("query"),
	controller.conversationsReplies,
);
router.post(
	"/conversations.replies",
	requirePermission("channels:read"),
	slackChannelValidation("body"),
	controller.conversationsReplies,
);

router.post(
	"/files.upload",
	requirePermission("files:write"),
	uploadConfig.fields([
		{ name: "file", maxCount: 1 },
		{ name: "files", maxCount: 10 },
	]),
	controller.filesUpload,
);

router.post(
	"/files.getUploadURLExternal",
	requirePermission("files:write"),
	controller.filesGetUploadURLExternal,
);

router.post(
	"/files.completeUploadExternal",
	requirePermission("files:write"),
	controller.filesCompleteUploadExternal,
);

export default router;
