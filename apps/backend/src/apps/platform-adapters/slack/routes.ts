import express, { Router } from "express";
import { uploadConfig } from "@/middleware/upload";
import { SlackController } from "./controller";
import {
	slackAuthenticateApp,
	slackChannelValidation,
	slackRawBodyAuthenticateApp,
} from "./middleware";
import { requirePermission } from "@/middleware/requirePermission";

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

router.post(
	"/chat.postMessage",
	requirePermission("chat:write"),
	slackChannelValidation("body"),
	controller.chatPostMessage,
);

router.post(
	"/chat.update",
	requirePermission("chat:write"),
	slackChannelValidation("body"),
	controller.chatUpdate,
);

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
