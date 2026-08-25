import type {
	AppEventAttachment,
	ChannelHistoryResponse,
	ChannelListResponse,
	ChannelsResponse,
	ConversationRepliesResponse,
} from "@/apps/types";
import type {
	SlackChannelObject,
	SlackConversationsHistoryResponse,
	SlackConversationsInfoResponse,
	SlackConversationsListResponse,
	SlackConversationsOpenResponse,
	SlackConversationsRepliesResponse,
	SlackFileObject,
	SlackMessageObject,
	SlackUsersConversationsResponse,
} from "../types";
import { deriveFiletype } from "./files";

function transformAttachmentToFile(att: AppEventAttachment): SlackFileObject {
	return {
		id: att.attachmentId,
		name: att.fileName,
		title: att.fileName,
		filetype: deriveFiletype(att.fileName, att.mimeType),
		size: att.fileSize,
		mimetype: att.mimeType,
		url_private: att.fileUrl,
		permalink: att.fileUrl,
	};
}

export function transformHistoryResponse(
	result: ChannelHistoryResponse,
): SlackConversationsHistoryResponse {
	const messages: SlackMessageObject[] = result.items.map((item) => {
		const msg: SlackMessageObject = {
			type: "message",
			ts: item.initialMessageId,
			user: item.userId,
			text: item.cleanContent,
			thread_ts: item.initialMessageId,
		};

		if (item.attachments && item.attachments.length > 0) {
			msg.files = item.attachments.map(transformAttachmentToFile);
		}

		return msg;
	});

	const response: SlackConversationsHistoryResponse = {
		ok: true,
		messages,
		has_more: result.hasMore,
	};

	if (result.hasMore && result.nextCursor) {
		response.response_metadata = { next_cursor: result.nextCursor };
	}

	return response;
}

export function transformRepliesResponse(
	result: ConversationRepliesResponse,
): SlackConversationsRepliesResponse {
	const messages: SlackMessageObject[] = result.items.map((item) => {
		const msg: SlackMessageObject = {
			type: "message",
			ts: item.messageId,
			user: item.userId,
			text: item.cleanContent,
			thread_ts: item.parentMessageId,
		};

		if (item.attachments && item.attachments.length > 0) {
			msg.files = item.attachments.map(transformAttachmentToFile);
		}

		return msg;
	});

	const response: SlackConversationsRepliesResponse = {
		ok: true,
		messages,
		has_more: result.hasMore,
	};

	if (result.hasMore && result.nextCursor) {
		response.response_metadata = { next_cursor: result.nextCursor };
	}

	return response;
}

function toUnixSeconds(value: Date | string | number | undefined): number {
	if (!value) return 0;
	const date = value instanceof Date ? value : new Date(value);
	const time = date.getTime();
	return Number.isNaN(time) ? 0 : Math.floor(time / 1000);
}

function transformChannel(
	channel: ChannelsResponse | ChannelListResponse["items"][number],
): SlackChannelObject {
	const scopeType = channel.scopeType;
	const visibility = "visibility" in channel ? channel.visibility : undefined;
	const created = toUnixSeconds(channel.createdAt);
	const description = channel.description ?? "";
	const memberCount =
		"participantCount" in channel ? channel.participantCount : 0;

	return {
		id: channel.id,
		name: channel.name,
		is_channel: scopeType === "DEFAULT",
		is_private:
			visibility === "PRIVATE" ||
			scopeType === "DM" ||
			scopeType === "GROUP_DM",
		is_im: scopeType === "DM",
		is_mpim: scopeType === "GROUP_DM",
		is_shared: false,
		creator: channel.createdBy,
		created,
		num_members: memberCount,
		purpose: {
			value: description,
			creator: channel.createdBy,
			last_set: created,
		},
		topic: {
			value: description,
			creator: channel.createdBy,
			last_set: created,
		},
	};
}

export function transformInfoResponse(
	channel: ChannelsResponse,
): SlackConversationsInfoResponse {
	return {
		ok: true,
		channel: transformChannel(channel),
	};
}

export function transformListResponse(
	result: ChannelListResponse,
): SlackConversationsListResponse {
	const response: SlackConversationsListResponse = {
		ok: true,
		channels: result.items.map(transformChannel),
	};

	if (result.hasMore && result.nextCursor) {
		response.response_metadata = { next_cursor: result.nextCursor };
	}

	return response;
}

export function transformUsersConversationsResponse(
	result: ChannelListResponse,
): SlackUsersConversationsResponse {
	const response: SlackUsersConversationsResponse = {
		ok: true,
		channels: result.items.map(transformChannel),
	};

	if (result.hasMore && result.nextCursor) {
		response.response_metadata = { next_cursor: result.nextCursor };
	}

	return response;
}

export function transformOpenResponse(
	channelId: string,
	isIm = true,
): SlackConversationsOpenResponse {
	return {
		ok: true,
		channel: {
			id: channelId,
			is_im: isIm,
		},
	};
}
