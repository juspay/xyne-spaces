import express, { Router } from "express";
import { uploadConfig } from "@/middleware/upload";
import { SlackController } from "./controller";
import {
	slackAuthenticateApp,
	slackChannelValidation,
	slackRawBodyAuthenticateApp } from "./middleware";
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
// Typed routes: src/api (the router tree), contracts in @xyne/shared (packages/shared/src/api).


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
