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

router.get("/auth.test", controller.authTest);
router.post("/auth.test", controller.authTest);

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

router.get(
	"/conversations.info",
	requirePermission("channels:read"),
	slackChannelValidation("query"),
	controller.conversationsInfo,
);
router.post(
	"/conversations.info",
	requirePermission("channels:read"),
	slackChannelValidation("body"),
	controller.conversationsInfo,
);

router.get("/conversations.list", requirePermission("channels:read"), controller.conversationsList);
router.post("/conversations.list", requirePermission("channels:read"), controller.conversationsList);

router.post("/conversations.open", requirePermission("im:write"), controller.conversationsOpen);

router.get("/users.info", requirePermission("users:read"), controller.usersInfo);
router.post("/users.info", requirePermission("users:read"), controller.usersInfo);

router.get("/users.lookupByEmail", requirePermission("users:read"), controller.usersLookupByEmail);
router.post("/users.lookupByEmail", requirePermission("users:read"), controller.usersLookupByEmail);

router.get(
	"/users.conversations",
	requirePermission("channels:read"),
	controller.usersConversations,
);
router.post(
	"/users.conversations",
	requirePermission("channels:read"),
	controller.usersConversations,
);

router.get("/usergroups.list", requirePermission("usergroups:read"), controller.usergroupsList);
router.post("/usergroups.list", requirePermission("usergroups:read"), controller.usergroupsList);

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
