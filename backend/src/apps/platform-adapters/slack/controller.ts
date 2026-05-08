import type { Readable } from "node:stream";
import { MessageType } from "@xyne/shared";
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
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
} from "./request-transformers/conversations";
import { transformFilesUpload } from "./request-transformers/files";
import { transformUsersInfo } from "./request-transformers/users";
import {
	transformPostMessageResponse,
	transformUpdateResponse,
} from "./response-transformers/chat";
import {
	transformHistoryResponse,
	transformInfoResponse,
	transformListResponse,
	transformOpenResponse,
	transformRepliesResponse,
} from "./response-transformers/conversations";
import { transformFilesUploadResponse } from "./response-transformers/files";
import { transformUsergroupsListResponse } from "./response-transformers/usergroups";
import { transformUsersInfoResponse } from "./response-transformers/users";
import type { SlackFileObject } from "./types";

// ========== Zod Schemas ==========

function parseJsonString(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
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

const PostMessageSchema = z
	.object({
		channel: z.string().min(1, "channel is required"),
		text: z.string().optional(),
		blocks: SlackArraySchema,
		attachments: SlackArraySchema,
		thread_ts: z.string().optional(),
		mrkdwn: SlackBooleanSchema,
		metadata: SlackRecordSchema,
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

const ConversationsOpenSchema = z.object({
	users: z.string().min(1, "users is required"),
	return_im: SlackBooleanSchema,
});

const UsersInfoSchema = z.object({
	user: z.string().min(1, "user is required"),
});

const FilesUploadSchema = z.object({
	channels: z.string().min(1, "channels is required"),
	initial_comment: z.string().optional(),
	thread_ts: z.string().optional(),
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
	channel_id: z.string().min(1, "channel_id is required"),
	initial_comment: z.string().optional(),
	thread_ts: z.string().optional(),
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
	chatPostMessage = wrapSlackHandler(async (req: Request, res: Response) => {
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

		let conversationId = args.conversationId;
		if (conversationId) {
			const parentMsg = await repositories.messages.findById(conversationId);
			if (!parentMsg) {
				res.status(200).json({ ok: false, error: "thread_not_found" });
				return;
			}
			conversationId = parentMsg.conversationId;
		}

		const result = await findOrCreateConversation(
			args.channelId,
			args.userId,
			args.content,
			args.isMarkdown,
			conversationId,
			undefined,
			MessageType.BOT,
			args.metadata,
		);

		const slackResponse = transformPostMessageResponse(
			result,
			channelId,
			parsed.data.text ?? "",
			context.appId,
		);
		res.status(200).json(slackResponse);
	});

	chatUpdate = wrapSlackHandler(async (req: Request, res: Response) => {
		const parsed = UpdateSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(200).json({ ok: false, error: "invalid_arguments" });
			return;
		}

		const context = getSlackAuthContext(req);
		const args = await transformUpdate(parsed.data);
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
			const parsed = HistorySchema.safeParse(req.body);
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
			const parsed = RepliesSchema.safeParse(req.body);
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
		const parsed = ConversationsInfoSchema.safeParse(req.body);
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
		const parsed = ConversationsListSchema.safeParse(req.body);
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

		const [targetUserId] = parsed.data.users
			.split(",")
			.map((user) => user.trim())
			.filter(Boolean);
		if (!targetUserId) {
			res.status(200).json({ ok: false, error: "user_not_found" });
			return;
		}

		const { userId } = getSlackAuthContext(req);
		const botUser = await repositories.users.findById(userId);
		if (!botUser?.workspaceId) {
			throw new Error("Workspace not found");
		}

		const channel = await unifiedDMService.getOrCreateBotDM(
			targetUserId,
			userId,
			botUser.workspaceId,
		);
		res.status(200).json(transformOpenResponse(channel.id));
	});

	usersInfo = wrapSlackHandler(async (req: Request, res: Response) => {
		const parsed = UsersInfoSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(200).json({ ok: false, error: "invalid_arguments" });
			return;
		}

		const args = transformUsersInfo(parsed.data);
		const result = await getUserData(args.userId);
		const slackResponse = transformUsersInfoResponse(result);
		res.status(200).json(slackResponse);
	});

	filesUpload = wrapSlackHandler(async (req: Request, res: Response) => {
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
		const { userId } = getSlackAuthContext(req);
		const isParticipant = await repositories.channelParticipants.isParticipant(
			channelId,
			userId,
		);
		if (!isParticipant) {
			res.status(200).json({ ok: false, error: "not_in_channel" });
			return;
		}

		const reqFiles = (Array.isArray(req.files) ? {} : req.files) || {};
		const uploadedFiles = [...(reqFiles.file || []), ...(reqFiles.files || [])];

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
			userId,
			text: args.text,
			conversationId: args.conversationId,
			metadata: args.metadata,
		});

		res.status(200).json(transformFilesUploadResponse(result));
	});

	usergroupsList = wrapSlackHandler(async (_req: Request, res: Response) => {
		const groups = await getAllUserGroups();
		res.status(200).json(transformUsergroupsListResponse(groups));
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

			const { files, channel_id, initial_comment, thread_ts } = parsed.data;
			const { userId } = getSlackAuthContext(req);

			const channelId = await resolveSlackChannel(channel_id);
			const isParticipant =
				await repositories.channelParticipants.isParticipant(channelId, userId);
			if (!isParticipant) {
				res.status(200).json({ ok: false, error: "not_in_channel" });
				return;
			}

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

			let conversationId: string | undefined;
			if (thread_ts) {
				const parentMsg = await repositories.messages.findById(thread_ts);
				if (!parentMsg) {
					res.status(200).json({ ok: false, error: "thread_not_found" });
					return;
				}

				const parentConversation = await repositories.conversations.findById(
					parentMsg.conversationId,
				);
				if (!parentConversation || parentConversation.channelId !== channelId) {
					res.status(200).json({ ok: false, error: "thread_not_found" });
					return;
				}

				conversationId = parentMsg.conversationId;
			}

			await findOrCreateConversation(
				channelId,
				userId,
				initial_comment ?? "",
				false,
				conversationId,
				uploadedResults,
				MessageType.BOT,
			);

			for (const key of redisKeys) {
				await redisService.del(key);
			}

			const responseFiles: SlackFileObject[] = files.map((f, i) => {
				const uploaded = uploadedResults[i];
				return {
					id: f.id,
					name: uploaded.originalName,
					title: f.title ?? uploaded.originalName,
					size: uploaded.fileSize,
					mimetype: uploaded.mimeType,
					url_private: uploaded.fileUrl,
					permalink: uploaded.fileUrl,
				};
			});

			res.status(200).json({ ok: true, files: responseFiles });
		},
	);
}
