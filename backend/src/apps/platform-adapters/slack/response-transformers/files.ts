import type { FileUploadResponse } from "@/apps/types";
import type { SlackFileObject, SlackFilesUploadResponse } from "../types";

function transformFile(
	file: FileUploadResponse["attachments"][number],
): SlackFileObject {
	return {
		id: file.fileid,
		name: file.originalFilename,
		title: file.originalFilename,
		size: file.size,
		mimetype: file.mimeType,
		url_private: file.url,
		permalink: file.url,
	};
}

export function transformFilesUploadResponse(
	result: FileUploadResponse,
): SlackFilesUploadResponse {
	const firstFile = result.attachments[0];
	if (!firstFile) {
		throw new Error("No file data in upload response");
	}

	return {
		ok: true,
		file: transformFile(firstFile),
	};
}
