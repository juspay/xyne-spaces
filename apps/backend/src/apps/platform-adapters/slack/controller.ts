import path from "node:path";
import type { Readable } from "node:stream";
import mime from "mime";
import { MessageType } from "@xyne/shared";
import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import { logger } from "@/utils/logger";
import {
	findOrCreateConversation,
	getChannelHistory,
	getConversationReplies,
} from "@/apps/core/conversationUtils";
import { ingestAttachment } from "@/apps/core/fileUtils";
import { repositories } from "@/database/repositories";
import {
	type UploadedFileResult,
	uploadFiles,
} from "@/services/fileUploadService";
import { redisService } from "@/services/redisService";
import { classifyUpload, screenUploadBuffer, MAX_FILE_SIZE_BYTES } from "@/middleware/upload";
import { wrapSlackHandler } from "./error-transformer";
import { resolveSlackThreadConversationId } from "@/api/apps/slack/chat.controller";
import {
	getResolvedChannelId,
	getSlackAuthContext,
	resolveSlackChannel,
} from "./middleware";
import {
	transformHistory,
	transformReplies,
} from "./request-transformers/conversations";
import { transformFilesUpload } from "./request-transformers/files";
import {
	transformHistoryResponse,
	transformRepliesResponse,
} from "./response-transformers/conversations";
import { deriveFiletype, transformFilesUploadResponse } from "./response-transformers/files";
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

function getSlackParams(req: Request): unknown {
	return req.method === "GET" ? req.query : req.body;
}

const SlackOptionalStringSchema = z
	.string()
	.nullable()
	.optional()
	.transform((value) => value ?? undefined);

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

		// Server-side content validation: reject disallowed types and executable
		// content even when the extension/MIME look benign.
		for (const f of uploadedFiles) {
			const verdict = await screenUploadBuffer(f.buffer, f.originalname, f.mimetype);
			if (!verdict.ok) {
				logger.warn("[SLACK-FILES-UPLOAD] File rejected by content screening", {
					filename: f.originalname,
					reason: verdict.reason,
				});
				res.status(200).json({ ok: false, error: "file_type_not_allowed" });
				return;
			}
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

	// ========== File Upload V2 ==========

	filesGetUploadURLExternal = wrapSlackHandler(
		async (req: Request, res: Response) => {
			const parsed = GetUploadURLExternalSchema.safeParse(req.body);
			if (!parsed.success) {
				res.status(200).json({ ok: false, error: "invalid_arguments" });
				return;
			}

			const { filename, length } = parsed.data;
			// Fail fast: reject a disallowed file type by name before issuing an upload
			// URL. The binary step re-checks name and content once the bytes arrive.
			if (classifyUpload(undefined, filename) !== "allowed") {
				res.status(200).json({ ok: false, error: "file_type_not_allowed" });
				return;
			}
			// Bound the declared size server-side rather than trusting the client value;
			// the binary step enforces the actual byte length as the authoritative check.
			if (length > MAX_FILE_SIZE_BYTES) {
				res.status(200).json({ ok: false, error: "file_too_large" });
				return;
			}
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

			// Authoritative size check on the actual bytes received (not a client-declared
			// length).
			if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
				res.status(200).json({ ok: false, error: "file_too_large" });
				return;
			}

			const mimeType = req.get("content-type") || "application/octet-stream";

			// Server-side validation for the binary upload step, which does not pass
			// through multer: reject disallowed types and executable content.
			const verdict = await screenUploadBuffer(fileBuffer, state.filename, mimeType);
			if (!verdict.ok) {
				logger.warn("[SLACK-FILES-UPLOAD-V2] File rejected by content screening", {
					filename: state.filename,
					reason: verdict.reason,
				});
				res.status(200).json({ ok: false, error: "file_type_not_allowed" });
				return;
			}

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
