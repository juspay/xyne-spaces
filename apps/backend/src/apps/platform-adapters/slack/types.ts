import type {
	SlackAttachment,
	SlackBlock,
} from "@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitTypes";

// ========== Express Request Augmentation ==========

declare module "express-serve-static-core" {
	interface Request {
		_slackAuth?: { userId: string; appId: string };
		_resolvedChannelId?: string;
	}
}

// ========== Slack Request Types ==========

export interface SlackChatPostMessageRequest {
	channel: string;
	text?: string;
	blocks?: SlackBlock[];
	attachments?: SlackAttachment[];
	thread_ts?: string;
	mrkdwn?: boolean;
	metadata?: Record<string, unknown>;
	// Fields accepted but ignored by Xyne
	reply_broadcast?: boolean;
	unfurl_links?: boolean;
	unfurl_media?: boolean;
	icon_emoji?: string;
	icon_url?: string;
	username?: string;
}

export interface SlackChatUpdateRequest {
	channel: string;
	ts: string;
	text?: string;
	blocks?: SlackBlock[];
	attachments?: SlackAttachment[];
}

export interface SlackChatDeleteRequest {
	channel: string;
	ts: string;
}

export interface SlackConversationsHistoryRequest {
	channel: string;
	limit?: number;
	cursor?: string;
	// Accepted but ignored — Xyne is cursor-only
	oldest?: string;
	latest?: string;
	inclusive?: boolean;
	include_all_metadata?: boolean;
}

export interface SlackUsersInfoRequest {
	user: string;
	include_locale?: boolean;
}

export interface SlackUsersLookupByEmailRequest {
	email: string;
}

// ========== Slack Response Types ==========

export interface SlackErrorResponse {
	ok: false;
	error: string;
}

export interface SlackAuthTestResponse {
	ok: true;
	url: string;
	team: string;
	user: string;
	team_id: string;
	user_id: string;
	bot_id: string;
	is_enterprise_install: false;
}

export interface SlackMessageObject {
	type: "message";
	subtype?: string;
	ts: string;
	user?: string;
	bot_id?: string;
	username?: string;
	text: string;
	thread_ts?: string;
	files?: SlackFileObject[];
}

export interface SlackFileObject {
	id: string;
	name: string;
	title: string;
	filetype: string;
	size: number;
	mimetype: string;
	url_private: string;
	permalink: string;
	shares?: {
		public?: Record<string, SlackFileShareObject[]>;
		private?: Record<string, SlackFileShareObject[]>;
	};
	channels?: string[];
	groups?: string[];
	ims?: string[];
}

export interface SlackFileShareObject {
	reply_users: string[];
	reply_users_count: number;
	reply_count: number;
	ts: string;
	channel_name?: string;
	team_id?: string;
}

export interface SlackChatPostMessageResponse {
	ok: true;
	channel: string;
	ts: string;
	message: SlackMessageObject;
}

export interface SlackChatUpdateResponse {
	ok: true;
	channel: string;
	ts: string;
	text: string;
	message: {
		text: string;
		user: string;
	};
}

export interface SlackChatDeleteResponse {
	ok: true;
	channel: string;
	ts: string;
}

export interface SlackConversationsHistoryResponse {
	ok: true;
	messages: SlackMessageObject[];
	has_more: boolean;
	response_metadata?: {
		next_cursor: string;
	};
}

export interface SlackUserProfile {
	real_name: string;
	display_name: string;
	email: string;
	image_24: string;
	image_32: string;
	image_48: string;
	image_72: string;
	image_192: string;
	image_512: string;
}

export interface SlackUserObject {
	id: string;
	name: string;
	real_name: string;
	deleted: boolean;
	is_bot: boolean;
	is_admin: boolean;
	is_app_user: boolean;
	team_id: string;
	updated: number;
	profile: SlackUserProfile;
}

export interface SlackUsersInfoResponse {
	ok: true;
	user: SlackUserObject;
}

// ========== conversations.replies ==========

export interface SlackConversationsRepliesRequest {
	channel: string;
	ts: string;
	limit?: number;
	cursor?: string;
	oldest?: string;
	latest?: string;
}

export interface SlackConversationsRepliesResponse {
	ok: true;
	messages: SlackMessageObject[];
	has_more: boolean;
	response_metadata?: {
		next_cursor: string;
	};
}

// ========== conversations.info / conversations.list ==========

export interface SlackChannelObject {
	id: string;
	name: string;
	is_channel: boolean;
	is_private: boolean;
	is_im: boolean;
	is_mpim: boolean;
	is_shared: boolean;
	creator: string;
	created: number;
	num_members: number;
	purpose: { value: string; creator: string; last_set: number };
	topic: { value: string; creator: string; last_set: number };
}

export interface SlackConversationsInfoResponse {
	ok: true;
	channel: SlackChannelObject;
}

export interface SlackConversationsListRequest {
	types?: string;
	limit?: number;
	cursor?: string;
	exclude_archived?: boolean;
	team_id?: string;
}

export interface SlackConversationsListResponse {
	ok: true;
	channels: SlackChannelObject[];
	response_metadata?: {
		next_cursor: string;
	};
}

// ========== users.conversations ==========

export interface SlackUsersConversationsRequest {
	user?: string;
	types?: string;
	limit?: number;
	cursor?: string;
	exclude_archived?: boolean;
	team_id?: string;
}

export interface SlackUsersConversationsResponse {
	ok: true;
	channels: SlackChannelObject[];
	response_metadata?: {
		next_cursor: string;
	};
}

// ========== conversations.open ==========

export interface SlackConversationsOpenResponse {
	ok: true;
	channel: {
		id: string;
		is_im: boolean;
	};
}

// ========== files.upload ==========

export interface SlackFilesUploadRequest {
	channels: string;
	initial_comment?: string;
	thread_ts?: string;
	title?: string;
	filename?: string;
	filetype?: string;
	content?: string;
}

export interface SlackFilesUploadResponse {
	ok: true;
	file: SlackFileObject;
}

// ========== usergroups.list ==========

export interface SlackUsergroupObject {
	id: string;
	name: string;
	handle: string;
	description: string;
	date_delete: number;
	user_count?: number;
	date_create: number;
	date_update: number;
	users?: string[];
}

export interface SlackUsergroupsListResponse {
	ok: true;
	usergroups: SlackUsergroupObject[];
}

// ========== files.getUploadURLExternal (v2 step 1) ==========
// ========== files.completeUploadExternal (v2 step 3) ==========
