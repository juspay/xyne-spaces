import express, { Router } from "express";
import { uploadConfig } from "@/middleware/upload";
import { SlackController } from "./controller";
import {
	slackAuthenticateApp,
	slackChannelValidation,
	slackRawBodyAuthenticateApp,
} from "./middleware";

const router = Router();
const controller = new SlackController();

router.post(
	"/_upload/:fileId",
	express.raw({ type: "*/*", limit: "50mb" }),
	slackRawBodyAuthenticateApp,
	controller.filesUploadV2Binary,
);

router.use(slackAuthenticateApp);

router.get("/auth.test", controller.authTest);
router.post("/auth.test", controller.authTest);

router.post(
	"/chat.postMessage",
	slackChannelValidation("body"),
	controller.chatPostMessage,
);

router.post(
	"/chat.update",
	slackChannelValidation("body"),
	controller.chatUpdate,
);

router.get(
	"/conversations.history",
	slackChannelValidation("query"),
	controller.conversationsHistory,
);
router.post(
	"/conversations.history",
	slackChannelValidation("body"),
	controller.conversationsHistory,
);

router.get(
	"/conversations.replies",
	slackChannelValidation("query"),
	controller.conversationsReplies,
);
router.post(
	"/conversations.replies",
	slackChannelValidation("body"),
	controller.conversationsReplies,
);

router.get(
	"/conversations.info",
	slackChannelValidation("query"),
	controller.conversationsInfo,
);
router.post(
	"/conversations.info",
	slackChannelValidation("body"),
	controller.conversationsInfo,
);

router.get("/conversations.list", controller.conversationsList);
router.post("/conversations.list", controller.conversationsList);

router.post("/conversations.open", controller.conversationsOpen);

router.get("/users.info", controller.usersInfo);
router.post("/users.info", controller.usersInfo);

router.get("/users.lookupByEmail", controller.usersLookupByEmail);
router.post("/users.lookupByEmail", controller.usersLookupByEmail);

router.get("/usergroups.list", controller.usergroupsList);
router.post("/usergroups.list", controller.usergroupsList);

router.post(
	"/files.upload",
	uploadConfig.fields([
		{ name: "file", maxCount: 1 },
		{ name: "files", maxCount: 10 },
	]),
	controller.filesUpload,
);

router.post(
	"/files.getUploadURLExternal",
	controller.filesGetUploadURLExternal,
);

router.post(
	"/files.completeUploadExternal",
	controller.filesCompleteUploadExternal,
);

export default router;
