import path from "node:path";
import type { Readable } from "node:stream";
import mime from "mime";
import { MessageType } from "@xyne/shared";
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { logger } from "@/utils/logger";
import { config } from "@/config/env";
import { outageAlertService } from "@/services/outageAlertService";
import { extractMentionsFromContent } from "@/utils/mentionUtils";
import {
	findOrCreateConversation,
	getChannelHistory,
	getConversationReplies,
	updateConversation,
} from "@/apps/core/conversationUtils";
import { ingestAttachment } from "@/apps/core/fileUtils";
import { getAllUserGroups } from "@/apps/core/userGroupUtils";
import { getUserData } from "@/apps/core/userUtils";
import { unifiedDMService } from "@/bots/unified/services/unified-dm-service";
import { repositories } from "@/database/repositories";
import {
	type UploadedFileResult,
	uploadFiles,
} from "@/services/fileUploadService";
import { redisService } from "@/services/redisService";
import { wrapSlackHandler } from "./error-transformer";
import {
	getResolvedChannelId,
	getSlackAuthContext,
	resolveSlackChannel,
} from "./middleware";
import {
	transformPostMessage,
	transformUpdate,
} from "./request-transformers/chat";
import {
	transformHistory,
	transformList,
	transformReplies,
	transformUsersConversations,
} from "./request-transformers/conversations";
import { transformFilesUpload } from "./request-transformers/files";
import {
	transformUsersInfo,
	transformUsersLookupByEmail,
} from "./request-transformers/users";
import {
	transformPostEphemeralResponse,
	transformPostMessageResponse,
	transformUpdateResponse,
} from "./response-transformers/chat";
import {
	transformHistoryResponse,
	transformInfoResponse,
	transformListResponse,
	transformOpenResponse,
	transformRepliesResponse,
	transformUsersConversationsResponse,
} from "./response-transformers/conversations";
import { deriveFiletype, transformFilesUploadResponse } from "./response-transformers/files";
import { transformUsergroupsListResponse } from "./response-transformers/usergroups";
import { transformUsersInfoResponse } from "./response-transformers/users";
import type { SlackAuthTestResponse, SlackFileObject } from "./types";

// ========== Zod Schemas ==========

function parseJsonString(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function getSlackParams(req: Request): unknown {
	return req.method === "GET" ? req.query : req.body;
}

const SlackBooleanSchema = z.preprocess((value) => {
	if (value === "true") return true;
	if (value === "false") return false;
	return value;
}, z.boolean().optional());

const SlackArraySchema = z.preprocess(
	parseJsonString,
	z.array(z.any()).optional(),
);
const SlackRecordSchema = z.preprocess(
	parseJsonString,
	z.record(z.unknown()).optional(),
);
const SlackOptionalStringSchema = z
	.string()
	.nullable()
	.optional()
	.transform((value) => value ?? undefined);

const XYNE_MESSAGE_CONTENT_MAX_LENGTH = 10000;

async function resolveSlackThreadConversationId(
	threadTs: string | undefined,
	channelId: string,
): Promise<{ conversationId?: string; error?: "thread_not_found" }> {
	if (!threadTs) {
		return {};
	}

	const parentMsg = await repositories.messages.findById(threadTs);
	if (!parentMsg) {
		return { error: "thread_not_found" };
	}

	const parentConversation = await repositories.conversations.findById(
		parentMsg.conversationId,
	);
	if (!parentConversation || parentConversation.channelId !== channelId) {
		return { error: "thread_not_found" };
	}

	return { conversationId: parentMsg.conversationId };
}

const PostMessageSchema = z
	.object({
		channel: z.string().min(1, "channel is required"),
		text: z.string().optional(),
		blocks: SlackArraySchema,
		attachments: SlackArraySchema,
		thread_ts: SlackOptionalStringSchema,
		mrkdwn: SlackBooleanSchema.default(true),
		metadata: SlackRecordSchema,
		username: SlackOptionalStringSchema,
	})
	.refine(
		(data) =>
			!!data.text ||
			(data.blocks && data.blocks.length > 0) ||
			(data.attachments && data.attachments.length > 0),
		{
			message: "Either text, blocks, or attachments is required",
			path: ["text"],
		},
	);
const PostEphemeralSchema = z
	.object({
		channel: z.string().min(1, "channel is required"),
		user: z.string().min(1, "user is required"),
		text: z.string().optional(),
		blocks: SlackArraySchema,
		attachments: SlackArraySchema,
		thread_ts: SlackOptionalStringSchema,
		as_user: SlackBooleanSchema,
	})
	.refine(
		(data) =>
			!!data.text ||
			(data.blocks && data.blocks.length > 0) ||
			(data.attachments && data.attachments.length > 0),
		{
			message: "Either text, blocks, or attachments is required",
			path: ["text"],
		},
	);

const UpdateSchema = z
	.object({
		channel: z.string().min(1, "channel is required"),
		ts: z.string().min(1, "ts is required"),
		text: z.string().optional(),
		blocks: SlackArraySchema,
		attachments: SlackArraySchema,
	})
	.refine(
		(data) =>
			!!data.text ||
			(data.blocks && data.blocks.length > 0) ||
			(data.attachments && data.attachments.length > 0),
		{
			message: "Either text, blocks, or attachments is required",
			path: ["text"],
		},
	);

const HistorySchema = z.object({
	channel: z.string().min(1, "channel is required"),
	limit: z
		.union([z.number(), z.string()])
		.optional()
		.transform((val) => (val ? Number(val) : 100)),
	cursor: z.string().optional(),
});

const RepliesSchema = z.object({
	channel: z.string().min(1, "channel is required"),
	ts: z.string().min(1, "ts is required"),
	limit: z
		.union([z.number(), z.string()])
		.optional()
		.transform((val) => (val ? Number(val) : 100)),
	cursor: z.string().optional(),
});

const ConversationsInfoSchema = z.object({
	channel: z.string().min(1, "channel is required"),
});

const ConversationsListSchema = z.object({
	types: z.string().optional(),
	limit: z
		.union([z.number(), z.string()])
		.optional()
		.transform((val) => (val ? Number(val) : 100)),
	cursor: z.string().optional(),
});

const ConversationsOpenSchema = z
	.object({
		users: z.string().optional(),
		channel: z.string().optional(),
		return_im: SlackBooleanSchema,
	})
	.refine((data) => !!data.users || !!data.channel, {
		message: "users or channel is required",
		path: ["users"],
	});

const UsersInfoSchema = z.object({
	user: z.string().min(1, "user is required"),
});

const UsersConversationsSchema = z.object({
	user: z.string().optional(),
	types: z.string().optional(),
	limit: z
		.union([z.number(), z.string()])
		.optional()
		.transform((val) => (val ? Number(val) : 100)),
	cursor: z.string().optional(),
	exclude_archived: SlackBooleanSchema.default(false),
	team_id: z.string().optional(),
});

const UsersLookupByEmailSchema = z.object({
	email: z.string().email("email is required"),
});

const FilesUploadSchema = z.object({
	channels: z.string().min(1, "channels is required"),
	initial_comment: z.string().optional(),
	thread_ts: SlackOptionalStringSchema,
	title: z.string().optional(),
	filename: z.string().optional(),
	filetype: z.string().optional(),
	content: z.string().optional(),
});

const GetUploadURLExternalSchema = z.object({
	filename: z.string().min(1, "filename is required"),
	length: z.preprocess(
		(val) => (typeof val === "string" ? parseInt(val, 10) : val),
		z.number().int().positive(),
	),
});

const CompleteUploadExternalSchema = z.object({
	files: z.preprocess(
		parseJsonString,
		z
			.array(
				z.object({
					id: z.string().min(1),
					title: z.string().optional(),
				}),
			)
			.min(1),
	),
	channel_id: z.string().optional(),
	channels: z.string().optional(),
	initial_comment: z.string().optional(),
	thread_ts: SlackOptionalStringSchema,
});

const UsergroupsListSchema = z.object({
	include_users: SlackBooleanSchema.default(false),
	include_disabled: SlackBooleanSchema.default(false),
	include_count: SlackBooleanSchema.default(true),
	team_id: z.string().optional(),
});

// ========== File Upload V2 State ==========

const UPLOAD_REDIS_PREFIX = "slack_upload:";
const UPLOAD_TTL_SECONDS = 1800;

interface FileUploadV2State {
	filename: string;
	userId: string;
	appId: string;
	status: "pending" | "uploaded";
	uploadResult?: UploadedFileResult;
}

// ========== Controller ==========

export class SlackController {
	authTest = wrapSlackHandler(async (req: Request, res: Response) => {
		const context = getSlackAuthContext(req);
		const user = await repositories.users.findById(context.userId);
		if (!user) {
			res.status(200).json({ ok: false, error: "user_not_found" });
			return;
		}

		const workspaceId = user.workspaceId ?? context.workspaceId ?? "";
		const workspace = workspaceId
			? await repositories.workspaces.findById(workspaceId)
			: null;
		const response: SlackAuthTestResponse = {
			ok: true,
			url: "",
			team: workspace?.name ?? "",
			user: user.name ?? user.email,
			team_id: workspaceId,
			user_id: user.id,
			bot_id: context.appId,
			is_enterprise_install: false,
		};

		res.status(200).json(response);
	});

	chatPostMessage = wrapSlackHandler(async (req: Request, res: Response) => {
		logger.info("[SLACK-POST-MESSAGE] Received request", { body: req.body, query: req.query, headers: req.headers });
		const parsed = PostMessageSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(200).json({ ok: false, error: "invalid_arguments" });
			return;
		}

		const context = getSlackAuthContext(req);
		const channelId = getResolvedChannelId(req);
		const args = await transformPostMessage(
			{ ...parsed.data, channel: channelId },
			context,
		);
		if (args.content.length > XYNE_MESSAGE_CONTENT_MAX_LENGTH) {
			res.status(200).json({ ok: false, error: "msg_too_long" });
			return;
		}

		const threadResolution = await resolveSlackThreadConversationId(
			args.conversationId,
			channelId,
		);
		if (threadResolution.error) {
			res.status(200).json({ ok: false, error: threadResolution.error });
			return;
		}

		const result = await findOrCreateConversation(
			args.channelId,
			args.userId,
			args.content,
			args.isMarkdown,
			threadResolution.conversationId,
			undefined,
			MessageType.BOT,
			args.metadata,
		);

		const slackResponse = transformPostMessageResponse(
			result,
			channelId,
			parsed.data.text ?? "",
			context.appId,
			parsed.data.username,
		);
		res.status(200).json(slackResponse);

		// Outage Alert Verification - Process async after responding
		if (config.outageVerification.channelId && channelId === config.outageVerification.channelId && result.conversationId) {
			void (async () => {
				try {
					const alertText = args.content || parsed.data.text || "";
					const verificationResult = await outageAlertService.processOutageAlert(
						alertText,
						result.conversationId,
					);

					if (!verificationResult.uploadedFile) return;

					const mentions = await extractMentionsFromContent(alertText);

					const escapeHtml = (str: string): string =>
						str.replace(/&/g, "&amp;")
							.replace(/</g, "&lt;")
							.replace(/>/g, "&gt;")
							.replace(/"/g, "&quot;")
							.replace(/'/g, "&#039;");

					const reportMessage = mentions.length
						? `${mentions
								.map((m) => {
									const escapedUsername = escapeHtml(m.username);
									return `<span class="chat-input-mention" data-mention="" data-mention-type="user" data-user-id="${m.userId}" data-username="${escapedUsername}">@${escapedUsername}</span>`;
								})
								.join(" ")} False Outage Report`
						: "False Outage Report";

					await findOrCreateConversation(
						channelId,
						context.userId,
						reportMessage,
						false,
						result.conversationId,
						[verificationResult.uploadedFile],
						MessageType.BOT,
						{},
					);

					logger.info("[SLACK-POST-MESSAGE] False outage report posted", { sessionId: verificationResult.sessionId });
				} catch (err) {
					logger.error("[SLACK-POST-MESSAGE] Outage alert processing failed", { err });
				}
			})();
		}
	});

	chatPostEphemeral = wrapSlackHandler(async (req: Request, res: Response) => {
		const parsed = PostEphemeralSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(200).json({ ok: false, error: "invalid_arguments" });
			return;
		}

		const context = getSlackAuthContext(req);
		const channelId = getResolvedChannelId(req);
		const targetUserId = parsed.data.user;
		const targetUser =
			(await repositories.users.findById(targetUserId)) ??
			(await repositories.users.findByMetadataField(
				"slackId",
				targetUserId,
				context.workspaceId,
			));
		if (!targetUser) {
			res.status(200).json({ ok: false, error: "user_not_in_channel" });
			return;
		}

		// slackChannelValidation only covers the bot's own access to the channel. The
		// recipient needs checking too, the way the native route does at
		// chatController.postEphemeral — otherwise an app can address a message at
		// someone with no part in the channel it claims to come from.
		const isParticipant = await repositories.channelParticipants.isParticipant(
			channelId,
			targetUser.id,
		);
		if (!isParticipant) {
			res.status(200).json({ ok: false, error: "user_not_in_channel" });
			return;
		}

		const args = await transformPostMessage(
			{ ...parsed.data, channel: channelId },
			context,
		);
		if (args.content.length > XYNE_MESSAGE_CONTENT_MAX_LENGTH) {
			res.status(200).json({ ok: false, error: "msg_too_long" });
			return;
		}

		const messageId = uuidv4();

		// Same transport as the native chat.postEphemeral: user rooms are joined at
		// connect time, so delivery no longer depends on the recipient having this
		// channel open.
		await redisService.broadcastUserEvent(targetUser.id, {
			type: "ephemeral_message",
			userId: targetUser.id,
			data: {
				channelId,
				message: {
					messageId,
					conversationId: args.conversationId ?? channelId,
					senderId: context.userId,
					senderName: parsed.data.as_user ? "" : context.appId,
					content: args.content,
					msgType: MessageType.BOT,
					createdAt: new Date(),
					visibleTo: targetUser.id,
					ephemeral: true,
				},
			},
			timestamp: new Date(),
		});

		const slackResponse = transformPostEphemeralResponse(messageId);
		res.status(200).json(slackResponse);
	});


	chatUpdate = wrapSlackHandler(async (req: Request, res: Response) => {
		const parsed = UpdateSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(200).json({ ok: false, error: "invalid_arguments" });
			return;
		}

		const context = getSlackAuthContext(req);
		const args = await transformUpdate(parsed.data, context);
		if (args.content.length > XYNE_MESSAGE_CONTENT_MAX_LENGTH) {
			res.status(200).json({ ok: false, error: "msg_too_long" });
			return;
		}
		const channelId = getResolvedChannelId(req);

		const existingMessage = await repositories.messages.findById(args.messageId);
		if (!existingMessage) {
			res.status(200).json({ ok: false, error: "message_not_found" });
			return;
		}
		if (existingMessage.senderId !== context.userId) {
			res.status(200).json({ ok: false, error: "cant_update_message" });
			return;
		}

		const existingConversation = await repositories.conversations.findById(
			existingMessage.conversationId,
		);
		if (!existingConversation) {
			res.status(200).json({ ok: false, error: "thread_not_found" });
			return;
		}
		if (existingConversation.channelId !== channelId) {
			res.status(200).json({ ok: false, error: "message_not_found" });
			return;
		}

		const result = await updateConversation(args.messageId, args.content);

		const slackResponse = transformUpdateResponse(
			result,
			channelId,
			parsed.data.text ?? "",
			context.userId,
		);
		res.status(200).json(slackResponse);
	});

	conversationsHistory = wrapSlackHandler(
		async (req: Request, res: Response) => {
			const parsed = HistorySchema.safeParse(getSlackParams(req));
			if (!parsed.success) {
				res.status(200).json({ ok: false, error: "invalid_arguments" });
				return;
			}

			const channelId = getResolvedChannelId(req);
			const args = transformHistory({ ...parsed.data, channel: channelId });
			const result = await getChannelHistory(
				args.channelId,
				args.limit,
				args.cursor,
			);
			const slackResponse = transformHistoryResponse(result);
			res.status(200).json(slackResponse);
		},
	);

	conversationsReplies = wrapSlackHandler(
		async (req: Request, res: Response) => {
			const parsed = RepliesSchema.safeParse(getSlackParams(req));
			if (!parsed.success) {
				res.status(200).json({ ok: false, error: "invalid_arguments" });
				return;
			}

			const channelId = getResolvedChannelId(req);
			const args = transformReplies({ ...parsed.data, channel: channelId });

			const parentMsg = await repositories.messages.findById(
				args.conversationId,
			);
			if (!parentMsg) {
				res.status(200).json({ ok: false, error: "thread_not_found" });
				return;
			}

			const result = await getConversationReplies(
				args.channelId,
				parentMsg.conversationId,
				args.limit,
				args.cursor,
			);
			const slackResponse = transformRepliesResponse(result);
			res.status(200).json(slackResponse);
		},
	);

	conversationsInfo = wrapSlackHandler(async (req: Request, res: Response) => {
		const parsed = ConversationsInfoSchema.safeParse(getSlackParams(req));
		if (!parsed.success) {
			res.status(200).json({ ok: false, error: "invalid_arguments" });
			return;
		}

		const channelId = getResolvedChannelId(req);
		const channel = await repositories.channels.findById(channelId);
		if (!channel) {
			res.status(200).json({ ok: false, error: "channel_not_found" });
			return;
		}

		const slackResponse = transformInfoResponse({
			id: channel.id,
			name: channel.name,
			description: channel.description || undefined,
			type: channel.type,
			scopeType: channel.scopeType,
			visibility: channel.visibility,
			projectId: channel.projectId,
			createdBy: channel.createdBy,
			createdAt: channel.createdAt,
			participantCount: channel.participantCount,
		});
		res.status(200).json(slackResponse);
	});

	conversationsList = wrapSlackHandler(async (req: Request, res: Response) => {
		const parsed = ConversationsListSchema.safeParse(getSlackParams(req));
		if (!parsed.success) {
			res.status(200).json({ ok: false, error: "invalid_arguments" });
			return;
		}

		const args = transformList(parsed.data);
		const channels = await repositories.channels.findManyPaginated({
			where: args.where,
			limit: args.limit + 1,
			cursor: args.cursor,
		});

		const hasMore = channels.length > args.limit;
		const items = hasMore ? channels.slice(0, args.limit) : channels;
		const slackResponse = transformListResponse({
			items: items.map((channel) => ({
				id: channel.id,
				name: channel.name,
				description: channel.description || undefined,
				scopeType: channel.scopeType,
				visibility: channel.visibility,
				projectId: channel.projectId,
				createdBy: channel.createdBy,
				createdAt: channel.createdAt,
			})),
			hasMore,
			nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
		});
		res.status(200).json(slackResponse);
	});

	conversationsOpen = wrapSlackHandler(async (req: Request, res: Response) => {
		const parsed = ConversationsOpenSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(200).json({ ok: false, error: "invalid_arguments" });
			return;
		}

		const { userId } = getSlackAuthContext(req);
		const botUser = await repositories.users.findById(userId);
		if (!botUser?.workspaceId) {
			throw new Error("Workspace not found");
		}

		if (parsed.data.channel) {
			const channelId = await resolveSlackChannel(parsed.data.channel);
			const isParticipant =
				await repositories.channelParticipants.isParticipant(channelId, userId);
			if (!isParticipant) {
				res.status(200).json({ ok: false, error: "not_in_channel" });
				return;
			}

			const channel = await repositories.channels.findById(channelId);
			res
				.status(200)
				.json(transformOpenResponse(channelId, channel?.scopeType === "DM"));
			return;
		}

		const targetUserIds = (parsed.data.users ?? "")
			.split(",")
			.map((user) => user.trim())
			.filter(Boolean);
		if (targetUserIds.length === 0) {
			res.status(200).json({ ok: false, error: "user_not_found" });
			return;
		}

		if (targetUserIds.length === 1) {
			const channel = await unifiedDMService.getOrCreateBotDM(
				targetUserIds[0],
				userId,
				botUser.workspaceId,
			);
			res.status(200).json(transformOpenResponse(channel.id, true));
			return;
		}

		const channelId = await repositories.channels.findOrCreateDMChannel(
			userId,
			targetUserIds,
			repositories.channelParticipants,
			botUser.workspaceId,
		);
		res.status(200).json(transformOpenResponse(channelId, false));
	});

	usersInfo = wrapSlackHandler(async (req: Request, res: Response) => {
		const parsed = UsersInfoSchema.safeParse(getSlackParams(req));
		if (!parsed.success) {
			res.status(200).json({ ok: false, error: "invalid_arguments" });
			return;
		}

		const args = transformUsersInfo(parsed.data);
		const result = await getUserData(args.userId);
		const slackResponse = transformUsersInfoResponse(result);
		res.status(200).json(slackResponse);
	});

	usersLookupByEmail = wrapSlackHandler(async (req: Request, res: Response) => {
		const parsed = UsersLookupByEmailSchema.safeParse(getSlackParams(req));
		if (!parsed.success) {
			res.status(200).json({ ok: false, error: "invalid_arguments" });
			return;
		}

		const args = transformUsersLookupByEmail(parsed.data);
		const { userId } = getSlackAuthContext(req);
		const authUser = await repositories.users.findById(userId);
		if (!authUser?.workspaceId) {
			res.status(200).json({ ok: false, error: "users_not_found" });
			return;
		}

		const user = await repositories.users.findByEmailCaseInsensitive(
			args.email,
			authUser.workspaceId,
		);
		if (!user || user.status !== "ACTIVE") {
			res.status(200).json({ ok: false, error: "users_not_found" });
			return;
		}

		res.status(200).json(
			transformUsersInfoResponse({
				userId: user.id,
				name: user.name,
				email: user.email,
				picture: user.picture,
				userType: user.userType,
				status: user.status,
				joined: user.createdAt,
				statusEmoji: user.statusEmoji,
				statusContent: user.statusContent,
				statusExpiryAt: user.statusExpiryAt,
			}),
		);
	});

	usersConversations = wrapSlackHandler(async (req: Request, res: Response) => {
		const parsed = UsersConversationsSchema.safeParse(getSlackParams(req));
		if (!parsed.success) {
			res.status(200).json({ ok: false, error: "invalid_arguments" });
			return;
		}

		const context = getSlackAuthContext(req);
		// Slack defaults to the authed user when `user` is omitted
		const targetUserId = parsed.data.user ?? context.userId;
		if (!targetUserId) {
			res.status(200).json({ ok: false, error: "user_not_found" });
			return;
		}

		if (parsed.data.user) {
			const targetUser = await repositories.users.findById(targetUserId);
			if (!targetUser) {
				res.status(200).json({ ok: false, error: "user_not_found" });
				return;
			}
		}

		const args = transformUsersConversations({
			...parsed.data,
			user: targetUserId,
		});
		if (args.unknownTypes.length > 0) {
			res.status(200).json({ ok: false, error: "invalid_types" });
			return;
		}

		const channels = await repositories.channels.findManyPaginated({
			where: args.where,
			limit: args.limit + 1,
			cursor: args.cursor,
		});

		const hasMore = channels.length > args.limit;
		const items = hasMore ? channels.slice(0, args.limit) : channels;
		const slackResponse = transformUsersConversationsResponse({
			items: items.map((channel) => ({
				id: channel.id,
				name: channel.name,
				description: channel.description || undefined,
				scopeType: channel.scopeType,
				visibility: channel.visibility,
				projectId: channel.projectId,
				createdBy: channel.createdBy,
				createdAt: channel.createdAt,
			})),
			hasMore,
			nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
		});
		res.status(200).json(slackResponse);
	});

	filesUpload = wrapSlackHandler(async (req: Request, res: Response) => {
		logger.info("[SLACK-FILES-UPLOAD] Received request", { body: req.body, query: req.query, headers: req.headers });
		const parsed = FilesUploadSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(200).json({ ok: false, error: "invalid_arguments" });
			return;
		}

		const args = transformFilesUpload(parsed.data);
		if (!args.channelId) {
			res.status(200).json({ ok: false, error: "channel_not_found" });
			return;
		}

		const channelId = await resolveSlackChannel(args.channelId);
		const context = getSlackAuthContext(req);
		const isParticipant = await repositories.channelParticipants.isParticipant(
			channelId,
			context.userId,
		);
		if (!isParticipant) {
			res.status(200).json({ ok: false, error: "not_in_channel" });
			return;
		}
		const channel = await repositories.channels.findById(channelId);
		const threadResolution = await resolveSlackThreadConversationId(
			args.conversationId,
			channelId,
		);
		if (threadResolution.error) {
			res.status(200).json({ ok: false, error: threadResolution.error });
			return;
		}

		const reqFiles = (Array.isArray(req.files) ? {} : req.files) || {};
		const uploadedFiles = [...(reqFiles.file || []), ...(reqFiles.files || [])];

		if (parsed.data.filename) {
			for (const f of uploadedFiles) {
				if (!path.extname(f.originalname)) {
					f.originalname = parsed.data.filename;
				}
			}
		}

		for (const f of uploadedFiles) {
			if (f.mimetype === "application/octet-stream") {
				const inferred = mime.getType(f.originalname);
				if (inferred) f.mimetype = inferred;
			}
		}

		if (uploadedFiles.length === 0 && parsed.data.content) {
			uploadedFiles.push({
				fieldname: "file",
				originalname:
					parsed.data.filename || `${parsed.data.title || "snippet"}.txt`,
				encoding: "7bit",
				mimetype: "text/plain",
				buffer: Buffer.from(parsed.data.content),
				size: Buffer.byteLength(parsed.data.content),
			} as Express.Multer.File);
		}

		if (uploadedFiles.length === 0) {
			res.status(200).json({ ok: false, error: "no_file_data" });
			return;
		}

		const result = await ingestAttachment({
			files: uploadedFiles,
			channelId,
			userId: context.userId,
			text: args.text,
			conversationId: threadResolution.conversationId,
			metadata: args.metadata,
			workspaceId: context.workspaceId,
		});

		res.status(200).json(
			transformFilesUploadResponse(result, {
				channelId,
				channelName: channel?.name,
				scopeType: channel?.scopeType,
				visibility: channel?.visibility,
			}),
		);
	});

	usergroupsList = wrapSlackHandler(async (req: Request, res: Response) => {
		const parsed = UsergroupsListSchema.safeParse(getSlackParams(req));
		if (!parsed.success) {
			res.status(200).json({ ok: false, error: "invalid_arguments" });
			return;
		}

		const groups = (await getAllUserGroups()).filter(
			(group) => parsed.data.include_disabled || group.isActive,
		);
		const groupsWithUsers = parsed.data.include_users
			? await Promise.all(
					groups.map(async (group) => {
						const withMappings =
							await repositories.userGroups.findWithMappings(group.id);
						return {
							...group,
							users:
								withMappings?.userGroupMappings
									?.map((mapping) => mapping.userId)
									.filter(Boolean) ?? [],
						};
					}),
				)
			: groups;

		res.status(200).json(
			transformUsergroupsListResponse(groupsWithUsers, {
				includeUsers: parsed.data.include_users,
				includeCount: parsed.data.include_count,
			}),
		);
	});

	// ========== File Upload V2 ==========

	filesGetUploadURLExternal = wrapSlackHandler(
		async (req: Request, res: Response) => {
			const parsed = GetUploadURLExternalSchema.safeParse(req.body);
			if (!parsed.success) {
				res.status(200).json({ ok: false, error: "invalid_arguments" });
				return;
			}

			const { filename } = parsed.data;
			const { userId, appId } = getSlackAuthContext(req);
			const fileId = uuidv4();

			const state: FileUploadV2State = {
				filename,
				userId,
				appId,
				status: "pending",
			};
			await redisService.set(
				`${UPLOAD_REDIS_PREFIX}${fileId}`,
				JSON.stringify(state),
				UPLOAD_TTL_SECONDS,
			);

			const protocol = req.get("x-forwarded-proto") || req.protocol;
			const host = req.get("host");
			const uploadUrl = `${protocol}://${host}${req.baseUrl}/_upload/${fileId}`;

			res
				.status(200)
				.json({ ok: true, upload_url: uploadUrl, file_id: fileId });
		},
	);

	filesUploadV2Binary = wrapSlackHandler(
		async (req: Request, res: Response) => {
			const { fileId } = req.params;
			if (!fileId) {
				res.status(200).json({ ok: false, error: "invalid_arguments" });
				return;
			}

			const redisKey = `${UPLOAD_REDIS_PREFIX}${fileId}`;
			const raw = await redisService.get(redisKey);
			if (!raw) {
				res.status(200).json({ ok: false, error: "invalid_arguments" });
				return;
			}

			const state: FileUploadV2State = JSON.parse(raw);
			if (state.status !== "pending") {
				res.status(200).json({ ok: false, error: "invalid_arguments" });
				return;
			}

			const { userId } = getSlackAuthContext(req);
			if (userId !== state.userId) {
				res.status(200).json({ ok: false, error: "not_authed" });
				return;
			}

			const fileBuffer = req.body as Buffer;
			if (
				!fileBuffer ||
				!Buffer.isBuffer(fileBuffer) ||
				fileBuffer.length === 0
			) {
				res.status(200).json({ ok: false, error: "no_file_data" });
				return;
			}

			const mimeType = req.get("content-type") || "application/octet-stream";

			const syntheticFile = {
				fieldname: "file",
				originalname: state.filename,
				encoding: "7bit",
				mimetype: mimeType,
				buffer: fileBuffer,
				size: fileBuffer.length,
				stream: undefined as unknown as Readable,
				destination: "",
				filename: state.filename,
				path: "",
			} as Express.Multer.File;

			const uploadResult = (await uploadFiles([syntheticFile]))[0];
			if (!uploadResult) {
				throw new Error("File upload returned no result");
			}

			state.status = "uploaded";
			state.uploadResult = uploadResult;
			await redisService.set(
				redisKey,
				JSON.stringify(state),
				UPLOAD_TTL_SECONDS,
			);

			res.status(200).send("OK");
		},
	);

	filesCompleteUploadExternal = wrapSlackHandler(
		async (req: Request, res: Response) => {
			const parsed = CompleteUploadExternalSchema.safeParse(req.body);
			if (!parsed.success) {
				res.status(200).json({ ok: false, error: "invalid_arguments" });
				return;
			}

			const { files, channel_id, channels, initial_comment, thread_ts } =
				parsed.data;
			const { userId } = getSlackAuthContext(req);

			const uploadedResults: UploadedFileResult[] = [];
			const redisKeys: string[] = [];

			for (const file of files) {
				const redisKey = `${UPLOAD_REDIS_PREFIX}${file.id}`;
				const raw = await redisService.get(redisKey);
				if (!raw) {
					res.status(200).json({ ok: false, error: "invalid_arguments" });
					return;
				}

				const state: FileUploadV2State = JSON.parse(raw);
				if (state.status !== "uploaded" || !state.uploadResult) {
					res.status(200).json({ ok: false, error: "invalid_arguments" });
					return;
				}
				if (state.userId !== userId) {
					res.status(200).json({ ok: false, error: "not_authed" });
					return;
				}

				uploadedResults.push(state.uploadResult);
				redisKeys.push(redisKey);
			}

			const responseFiles: SlackFileObject[] = files.map((f, i) => {
				const uploaded = uploadedResults[i];
				const name = uploaded.originalName;
				return {
					id: f.id,
					name,
					title: f.title ?? name,
					filetype: deriveFiletype(name, uploaded.mimeType),
					size: uploaded.fileSize,
					mimetype: uploaded.mimeType,
					url_private: uploaded.fileUrl,
					permalink: uploaded.fileUrl,
				};
			});

			const [shareChannel] = (channel_id ?? channels ?? "")
				.split(",")
				.map((channel) => channel.trim())
				.filter(Boolean);

			if (!shareChannel) {
				for (const key of redisKeys) {
					await redisService.del(key);
				}
				res.status(200).json({ ok: true, files: responseFiles });
				return;
			}

			const channelId = await resolveSlackChannel(shareChannel);
			const isParticipant =
				await repositories.channelParticipants.isParticipant(channelId, userId);
			if (!isParticipant) {
				res.status(200).json({ ok: false, error: "not_in_channel" });
				return;
			}

			const threadResolution = await resolveSlackThreadConversationId(
				thread_ts,
				channelId,
			);
			if (threadResolution.error) {
				res.status(200).json({ ok: false, error: threadResolution.error });
				return;
			}

			const conversationResult = await findOrCreateConversation(
				channelId,
				userId,
				initial_comment ?? "",
				false,
				threadResolution.conversationId,
				uploadedResults,
				MessageType.BOT,
			);

			const dbAttachments =
				await repositories.messageAttachments.findByMessageId(
					conversationResult.messageId,
				);

			// Match by file URL to avoid index-based race conditions
			const dbAttachmentByUrl = new Map(
				dbAttachments.map((a) => [a.url, a.id]),
			);

			const responseFilesWithDbIds = responseFiles.map((f) => ({
				...f,
				id: dbAttachmentByUrl.get(f.url_private) ?? undefined,
			}));

			for (const key of redisKeys) {
				await redisService.del(key);
			}

			res.status(200).json({ ok: true, files: responseFilesWithDbIds });
		},
	);
}
