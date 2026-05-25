import path from "node:path";
import mime from "mime";
import type { FileUploadResponse } from "@/apps/types";
import type { SlackFileObject, SlackFilesUploadResponse } from "../types";

export function deriveFiletype(filename: string | undefined, mimetype: string | undefined): string {
	if (filename) {
		const ext = path.extname(filename).replace(/^\./, "").toLowerCase();
		if (ext) return ext;
	}

	if (!mimetype) return "binary";

	const fromMime = mime.getExtension(mimetype);
	if (fromMime) return fromMime;

	const sub = mimetype.split("/")[1] ?? "";
	return sub.replace(/^x-/, "").split(";")[0] || "binary";
}

interface SlackFileShareContext {
	channelId: string;
	channelName?: string;
	scopeType?: string;
	visibility?: string;
}

function transformFile(
	file: FileUploadResponse["attachments"][number],
	result: FileUploadResponse,
	shareContext?: SlackFileShareContext,
): SlackFileObject {
	const isIm =
		shareContext?.scopeType === "DM" || shareContext?.scopeType === "GROUP_DM";
	const isPublic =
		!!shareContext &&
		!isIm &&
		shareContext.visibility === "PUBLIC";
	const isPrivateChannel = !!shareContext && !isIm && !isPublic;
	const share = shareContext
		? {
				reply_users: [],
				reply_users_count: 0,
				reply_count: 0,
				ts: result.messageId,
				...(isPublic && shareContext.channelName
					? { channel_name: shareContext.channelName }
					: {}),
			}
		: undefined;

	return {
		id: file.fileid,
		name: file.originalFilename,
		title: file.originalFilename,
		filetype: deriveFiletype(file.originalFilename, file.mimeType),
		size: file.size,
		mimetype: file.mimeType,
		url_private: file.url,
		permalink: file.url,
		channels: isPublic && shareContext ? [shareContext.channelId] : [],
		groups: isPrivateChannel && shareContext ? [shareContext.channelId] : [],
		ims: isIm && shareContext ? [shareContext.channelId] : [],
		...(shareContext && share
			? {
					shares: {
						[isPublic ? "public" : "private"]: {
							[shareContext.channelId]: [share],
						},
					},
				}
			: {}),
	};
}

export function transformFilesUploadResponse(
	result: FileUploadResponse,
	shareContext?: SlackFileShareContext,
): SlackFilesUploadResponse {
	const firstFile = result.attachments[0];
	if (!firstFile) {
		throw new Error("No file data in upload response");
	}

	return {
		ok: true,
		file: transformFile(firstFile, result, shareContext),
	};
}
