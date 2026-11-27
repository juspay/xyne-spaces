/**
 * Every controller the routes file uses, in one place, so any route can use any of them:
 * the controller modules' functions, and the controller instances the routes call.
 */
import { ChatController } from '@/apps/controllers/chatController';
export { createAlias, deleteAlias, listAliases, updateAlias } from '@/api/activity-aliases/activity-aliases.controller';
export { activeChannels, activeUsers, currentActiveUsers, filesShared, messagesExchanged, messagesToday, numberOfCalls, numberOfCanvases, numberOfTickets, topUsersByMessages, totalCallsDuration, usersOnboarded } from '@/api/analytics/analytics.controller';
export { appSigningSecret, botChannels, configureAppWebhook, createApp, installAppHandler, orgNames, projectBoards, promoteApp, regenerateAppJwt } from '@/api/apps/apps.controller';
export { getCall, getSummaryTemplate, listSummaryTemplates } from '@/api/apps/calls/calls.controller';
export { channelInfo, deskChannelConfig, listChannels, openDm, updateChannel } from '@/api/apps/channel/channel.controller';
export { listChannelCommands } from '@/api/apps/channel/commands.controller';
export { createAppCommand, deleteAppCommand, listAppCommands, updateAppCommand } from '@/api/apps/commands.controller';
export { fileInfo } from '@/api/apps/files/files.controller';
export { appGuestToken, createAppGuest, listAppGuests, updateAppGuest } from '@/api/apps/guests/guests.controller';
export { createIncomingWebhook, listIncomingWebhooks, revokeIncomingWebhook, updateIncomingWebhook } from '@/api/apps/incoming-webhooks/incoming-webhooks.controller';
export { activateInstalledPermissions, deleteFetchConfig, getFetchConfig, getInstalledPermissions, listAttachedResources, listInstalledCommands, setAttachedResources, setInstalledPermissions, updateInstalledApp } from '@/api/apps/installed/installed.controller';
export { getAppPermissions, listAvailablePermissions, setAppPermissions } from '@/api/apps/permissions/permissions.controller';
export { slackChatPostEphemeral, slackChatPostMessage, slackChatUpdate } from '@/api/apps/slack/chat.controller';
export { slackAuthTest, slackConversationsInfo, slackConversationsList, slackConversationsOpen, slackUsergroupsList, slackUsersConversations, slackUsersInfo, slackUsersLookupByEmail } from '@/api/apps/slack/reads.controller';
export { listBoardStages, listBoards, listBySender } from '@/api/apps/ticket/ticket.controller';
export { userInfo } from '@/api/apps/user/user.controller';
export { listUserGroups } from '@/api/apps/usergroups/usergroups.controller';
export { cacConfig } from '@/api/cac-config/cac-config.controller';
export { canLinkBoards, channelMembers, checkDuplicate, connectedEmail, emailAlias, memberCounts, publishTargets, searchForMentions, shareAgentStatus, vespaParticipants } from '@/api/channels/channels.controller';
export { deskTagsAccess, getChannelTagsConfig, updateChannelTagsConfig } from '@/api/channels/tags-config/tags-config.controller';
export { allHeaderOverrides, myHeaderOverrides, postClientEvent, removeHeaderOverrides } from '@/api/client-events/client-events.controller';
export { labelDelete, labelDeleteImpact, labelUnreadCount, labelUnreadCounts } from '@/api/conversation-labels/conversation-labels.controller';
export { getConfig, getSettings, saveConfig, saveSettings } from '@/api/daily-brief/daily-brief.controller';
export { deleteEmoji, getEmoji, listEmojis } from '@/api/emojis/emojis.controller';
export { addReaction, getMessageReactions, getMessagesReactions, removeReaction, toggleReaction } from '@/api/messages/reactions.controller';
export { dismiss, getPreferences, markAllRead, markRead, queueStats, registerMobilePushToken, sendTest, subscribe, unreadCount, unregisterMobilePushToken, unsubscribe, updatePreferences, workspaceCounts } from '@/api/notifications/notifications.controller';
export { addMember, getOrganization, listOrganizations, removeMember, updateMemberRole } from '@/api/organizations/organizations.controller';
export { linkSubTicket, unlinkSubTicketHandler } from '@/api/sub-tickets/sub-tickets.controller';
export { ChatController } from '@/apps/controllers/chatController';

export const chatController = new ChatController();
