import type { FileUploadResponse } from "@/apps/types";
import type { SlackFileObject, SlackFilesUploadResponse } from "../types";

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
