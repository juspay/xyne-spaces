import { getUserData } from '@/apps/core/userUtils';
import { getAllUserGroups } from '@/apps/core/userGroupUtils';
import { unifiedDMService } from '@/bots/unified/services/unified-dm-service';
import { repositories } from '@/database/repositories';
import type { AppCaller } from '@/framework/api';
import type { AuthenticatedUser } from '@/types/express';
import { slackError, type SlackChannel } from '../../../apps/platform-adapters/slack/access';
import { resolveSlackChannel } from '../../../apps/platform-adapters/slack/middleware';
import { transformList, transformUsersConversations } from '../../../apps/platform-adapters/slack/request-transformers/conversations';
import { transformUsersInfo, transformUsersLookupByEmail } from '../../../apps/platform-adapters/slack/request-transformers/users';
import { transformInfoResponse, transformListResponse, transformOpenResponse, transformUsersConversationsResponse } from '../../../apps/platform-adapters/slack/response-transformers/conversations';
import { transformUsergroupsListResponse } from '../../../apps/platform-adapters/slack/response-transformers/usergroups';
import { transformUsersInfoResponse } from '../../../apps/platform-adapters/slack/response-transformers/users';
import type { SlackAuthTestResponse } from '../../../apps/platform-adapters/slack/types';

/**
 * The Slack-compatible read methods, for the controllers in slack.controller.ts: no req/res,
 * same answers as the controller handlers they replace. Errors are Slack codes (slackError,
 * HTTP 200); each controller runs them in slackHandle, for unexpected errors.
 */

type Caller = { user: AuthenticatedUser | undefined; app: AppCaller | undefined };

/** auth.test */
export async function slackAuthTest({ user: caller, app }: Caller): Promise<SlackAuthTestResponse> {
	const user = caller ? await repositories.users.findById(caller.id) : null;
	if (!user) throw slackError("user_not_found");
	const workspaceId = user.workspaceId ?? caller?.workspaceId ?? "";
	const workspace = workspaceId ? await repositories.workspaces.findById(workspaceId) : null;
	return {
		ok: true,
		url: "",
		team: workspace?.name ?? "",
		user: user.name ?? user.email,
		team_id: workspaceId,
		user_id: user.id,
		bot_id: app?.appId ?? "",
		is_enterprise_install: false,
	};
}

/** conversations.info (the channel already resolved and checked by slackChannel). */
export async function slackConversationsInfo({ channel: resolved }: { channel: SlackChannel }) {
	const channel = await repositories.channels.findById(resolved.channelId);
	if (!channel) throw slackError("channel_not_found");
	return transformInfoResponse({
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
}

type ChannelRow = Awaited<ReturnType<typeof repositories.channels.findManyPaginated>>[number];
const listItem = (channel: ChannelRow) => ({
	id: channel.id,
	name: channel.name,
	description: channel.description || undefined,
	scopeType: channel.scopeType,
	visibility: channel.visibility,
	projectId: channel.projectId,
	createdBy: channel.createdBy,
	createdAt: channel.createdAt,
});

/** conversations.list */
export async function slackConversationsList(args: Parameters<typeof transformList>[0]) {
	const list = transformList(args);
	const channels = await repositories.channels.findManyPaginated({ where: list.where, limit: list.limit + 1, cursor: list.cursor });
	const hasMore = channels.length > list.limit;
	const items = hasMore ? channels.slice(0, list.limit) : channels;
	return transformListResponse({
		items: items.map(listItem),
		hasMore,
		nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
	});
}

/** conversations.open: an existing channel the bot is in, its DM with one user, or a group DM. */
export async function openSlackConversation(input: { body: { users?: string; channel?: string } } & Caller) {
	const userId = input.user?.id ?? "";
	const botUser = await repositories.users.findById(userId);
	if (!botUser?.workspaceId) throw new Error("Workspace not found");

	if (input.body.channel) {
		const channelId = await resolveSlackChannel(input.body.channel);
		if (!(await repositories.channelParticipants.isParticipant(channelId, userId))) throw slackError("not_in_channel");
		const channel = await repositories.channels.findById(channelId);
		return transformOpenResponse(channelId, channel?.scopeType === "DM");
	}

	const targetUserIds = (input.body.users ?? "")
		.split(",")
		.map((user) => user.trim())
		.filter(Boolean);
	if (targetUserIds.length === 0) throw slackError("user_not_found");
	if (targetUserIds.length === 1) {
		const channel = await unifiedDMService.getOrCreateBotDM(targetUserIds[0], userId, botUser.workspaceId);
		return transformOpenResponse(channel.id, true);
	}
	const channelId = await repositories.channels.findOrCreateDMChannel(
		userId,
		targetUserIds,
		repositories.channelParticipants,
		botUser.workspaceId,
	);
	return transformOpenResponse(channelId, false);
}

/** users.info */
export async function slackUsersInfo(args: Parameters<typeof transformUsersInfo>[0]) {
	const result = await getUserData(transformUsersInfo(args).userId);
	return transformUsersInfoResponse(result);
}

/** users.lookupByEmail: an active user of the bot's own workspace. */
export async function slackUsersLookupByEmail(input: { args: Parameters<typeof transformUsersLookupByEmail>[0] } & Caller) {
	const { email } = transformUsersLookupByEmail(input.args);
	const authUser = input.user ? await repositories.users.findById(input.user.id) : null;
	if (!authUser?.workspaceId) throw slackError("users_not_found");
	const user = await repositories.users.findByEmailCaseInsensitive(email, authUser.workspaceId);
	if (!user || user.status !== "ACTIVE") throw slackError("users_not_found");
	return transformUsersInfoResponse({
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
		activityStatus: user.activityStatus,
	});
}

/** users.conversations: Slack defaults `user` to the authed user. */
export async function slackUsersConversations(input: { args: Omit<Parameters<typeof transformUsersConversations>[0], "user"> & { user?: string } } & Caller) {
	const targetUserId = input.args.user ?? input.user?.id;
	if (!targetUserId) throw slackError("user_not_found");
	if (input.args.user && !(await repositories.users.findById(targetUserId))) throw slackError("user_not_found");

	const list = transformUsersConversations({ ...input.args, user: targetUserId });
	if (list.unknownTypes.length > 0) throw slackError("invalid_types");
	const channels = await repositories.channels.findManyPaginated({ where: list.where, limit: list.limit + 1, cursor: list.cursor });
	const hasMore = channels.length > list.limit;
	const items = hasMore ? channels.slice(0, list.limit) : channels;
	return transformUsersConversationsResponse({
		items: items.map(listItem),
		hasMore,
		nextCursor: hasMore ? items[items.length - 1]?.id : undefined,
	});
}

/** usergroups.list */
export async function slackUsergroupsList(args: { include_users?: boolean; include_disabled?: boolean; include_count?: boolean }) {
	const groups = (await getAllUserGroups()).filter((group) => args.include_disabled || group.isActive);
	const withUsers = args.include_users
		? await Promise.all(
				groups.map(async (group) => {
					const withMappings = await repositories.userGroups.findWithMappings(group.id);
					return { ...group, users: withMappings?.userGroupMappings?.map((mapping) => mapping.userId).filter(Boolean) ?? [] };
				}),
			)
		: groups;
	return transformUsergroupsListResponse(withUsers, { includeUsers: !!args.include_users, includeCount: args.include_count ?? true });
}