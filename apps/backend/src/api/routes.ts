import { api } from '@xyne/shared';
import { group, handle, implement } from '@/framework/api';
import { activateInstalledPermissions, activeChannels, activeUsers, addMember, addReaction, allHeaderOverrides, appGuestToken, appSigningSecret, botChannels, cacConfig, canLinkBoards, channelInfo, channelMembers, chatController, checkDuplicate, configureAppWebhook, connectedEmail, createAlias, createApp, createAppCommand, createAppGuest, createIncomingWebhook, currentActiveUsers, deleteAlias, deleteAppCommand, deleteEmoji, deleteFetchConfig, deskChannelConfig, deskTagsAccess, dismiss, emailAlias, fileInfo, filesShared, getAppPermissions, getCall, getChannelTagsConfig, getConfig, getEmoji, getFetchConfig, getInstalledPermissions, getMessageReactions, getMessagesReactions, getOrganization, getPreferences, getSettings, getSummaryTemplate, installAppHandler, labelDelete, labelDeleteImpact, labelUnreadCount, labelUnreadCounts, linkSubTicket, listAliases, listAppCommands, listAppGuests, listAttachedResources, listAvailablePermissions, listBoardStages, listBoards, listBySender, listChannelCommands, listChannels, listEmojis, listIncomingWebhooks, listInstalledCommands, listOrganizations, listSummaryTemplates, listUserGroups, markAllRead, markRead, memberCounts, messagesExchanged, messagesToday, myHeaderOverrides, numberOfCalls, numberOfCanvases, numberOfTickets, openDm, orgNames, postClientEvent, projectBoards, promoteApp, publishTargets, queueStats, regenerateAppJwt, registerMobilePushToken, removeHeaderOverrides, removeMember, removeReaction, revokeIncomingWebhook, saveConfig, saveSettings, searchForMentions, sendTest, setAppPermissions, setAttachedResources, setInstalledPermissions, shareAgentStatus, slackAuthTest, slackChatPostEphemeral, slackChatPostMessage, slackChatUpdate, slackConversationsInfo, slackConversationsList, slackConversationsOpen, slackUsergroupsList, slackUsersConversations, slackUsersInfo, slackUsersLookupByEmail, subscribe, toggleReaction, topUsersByMessages, totalCallsDuration, unlinkSubTicketHandler, unreadCount, unregisterMobilePushToken, unsubscribe, updateAlias, updateAppCommand, updateAppGuest, updateChannel, updateChannelTagsConfig, updateIncomingWebhook, updateInstalledApp, updateMemberRole, updatePreferences, userInfo, usersOnboarded, vespaParticipants, workspaceCounts } from './controllers';
import { xyneApps } from '@/api/apps/xyne-apps.access';
import { appPermission, botChannel } from '@/apps/access';
import { checkBotMessageDelete } from '@/apps/core/botMessageDelete';
import { deleteConversationMessage } from '@/apps/core/conversationUtils';
import { slackChannel, slackError, slackHandle } from '@/apps/platform-adapters/slack/access';
import { transformDeleteResponse } from '@/apps/platform-adapters/slack/response-transformers/chat';
import { analyticsWorkspace, resourceAccess, routeAcl } from '@/framework/dashboardAccess';
import { AccessType } from '@xyne/shared';

const userActivityAdmin = { access: { userActivity: resourceAccess('USER_ACTIVITY', AccessType.ADMIN) } };

/** The bot's workspace: whose key the encrypted fields are stored under. */
const encryptUnderBotWorkspace = {
  resolveWorkspaceId: async (req: { user?: { workspaceId: string } }) => req.user!.workspaceId,
};

const clientEventsAdmin = { access: { ticketMigration: resourceAccess('TICKET-MIGRATION', AccessType.ADMIN) } };

/**
 * Every typed route, in the API's shape (packages/shared/src/api): its controller, and its access
 * checks, encryption and the like when it has any. No paths (the API has them) and no logins (the
 * API's auth map has them). A missing route, an extra one, or a controller that does not fit its
 * contract is a type error. Mounted once at startup (app.ts: mountApi(routes)).
 */
export const routes = implement(api, {
  apps: {
    create: handle({ ...xyneApps(AccessType.WRITE), successStatus: 201, controller: ({ body, user }) => createApp({ body, user }) }),
    install: handle({ ...xyneApps(AccessType.ADMIN), successStatus: 201, controller: ({ params, user }) => installAppHandler({ params, user }) }),
    promote: handle({ ...xyneApps(AccessType.ADMIN), controller: ({ params, user }) => promoteApp({ params, user }) }),
    configureWebhook: handle({
      ...xyneApps(AccessType.WRITE),
      controller: ({ params, body, user }) => configureAppWebhook({ params, body, user }),
    }),
    regenerateJwt: handle({ ...xyneApps(AccessType.WRITE), controller: ({ params, user }) => regenerateAppJwt({ params, user }) }),
    signingSecret: handle({ ...xyneApps(AccessType.WRITE), controller: ({ params, user }) => appSigningSecret({ params, user }) }),
    botChannels: handle({ ...xyneApps(AccessType.READ), controller: ({ params, user }) => botChannels({ params, user }) }),
    projectBoards: handle({ ...xyneApps(AccessType.READ), controller: ({ params, user }) => projectBoards({ params, user }) }),
    orgNames: handle({ ...xyneApps(AccessType.READ), controller: ({ body }) => orgNames({ body }) }),

    // Commands (user auth), per app: last, so `/:appId/commands` never captures a literal path above.
    commands: handle({ ...xyneApps(AccessType.READ), controller: ({ params, query }) => listAppCommands({ params, query }) }),
    commandsCreate: handle({
      ...xyneApps(AccessType.WRITE),
      successStatus: 201,
      controller: ({ params, body, user }) => createAppCommand({ params, body, user }),
    }),
    commandsUpdate: handle({
      ...xyneApps(AccessType.WRITE),
      controller: ({ params, body, user }) => updateAppCommand({ params, body, user }),
    }),
    commandsDelete: handle({
      ...xyneApps(AccessType.WRITE),
      controller: ({ params, query, user }) => deleteAppCommand({ params, query, user }),
    }),
    chat: {
      // Also accepts a user id as `channelId`: it then posts into the bot's DM with that user,
      // matching the Slack adapter's chat.postMessage.
      postMessage: handle({
        access: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: true }) },
        encryption: encryptUnderBotWorkspace,
        successStatus: 201,
        controller: ({ body, derived, user, app, access }) =>
          chatController.sendMessage({
            body,
            senderUserId: user?.id,
            workspaceId: user?.workspaceId,
            // Only a DM target is handed over; any other channel is resolved by sendMessage as before.
            resolvedChannelId: access.channel.dm ? access.channel.channelId : undefined,
            appId: app?.appId,
            markdownFacts: derived?.fields.markdownText,
            textFacts: derived?.fields.text,
            isPostAsUser: false,
          }),
      }),
      // Shown to one user only, never stored. markdownText reaches the handler as workspace-DEK
      // ciphertext, like postMessage; it is re-encrypted per recipient socket on delivery.
      postEphemeral: handle({
        access: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: false }) },
        encryption: encryptUnderBotWorkspace,
        successStatus: 201,
        controller: ({ body, derived, user, app }) =>
          chatController.sendEphemeral({
            body,
            sender: user ? { id: user.id, name: user.name } : undefined,
            workspaceId: user?.workspaceId,
            appId: app?.appId,
            textFacts: derived?.fields.text,
          }),
      }),
      updateMessage: handle({
        access: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: false }) },
        encryption: encryptUnderBotWorkspace,
        controller: ({ body, derived, user, app }) =>
          chatController.editMessage({ body, workspaceId: user?.workspaceId, appId: app?.appId, textFacts: derived?.fields.text }),
      }),
      // Ids only: no encryption contract. Only the app's own BOT messages (removeMessage).
      deleteMessage: handle({
        access: { permission: appPermission('chat:delete'), channel: botChannel({ allowDm: false }) },
        controller: ({ body, user }) => chatController.removeMessage({ body, userId: user?.id }),
      }),
      // "Agent is working" signal, Redis pub/sub only. Not encrypted (decided 2026-11-25).
      agentProgress: handle({
        access: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: false }) },
        controller: ({ body, user }) => chatController.publishAgentProgress({ body, userId: user!.id }),
      }),
    },
    files: {
      info: handle({ access: { permission: appPermission('files:read') }, controller: ({ params, user }) => fileInfo({ params, user }) }),
    },
    channel: {
      // The workspace comes from the verified token, never the body: an app installed in workspace
      // A cannot open a DM in workspace B.
      openDm: handle({
        access: { permission: appPermission('im:write') },
        controller: ({ body, user }) => openDm({ body, user }),
      }),
      info: handle({
        access: { permission: appPermission('channels:read'), channel: botChannel({ allowDm: false }) },
        controller: ({ body }) => channelInfo({ body }),
      }),
      deskChannelConfig: handle({
        access: { permission: appPermission('desk:read'), channel: botChannel({ allowDm: false }) },
        controller: ({ body }) => deskChannelConfig({ body }),
      }),
      list: handle({
        access: { permission: appPermission('channels:read') },
        controller: ({ query, user }) => listChannels({ query, user }),
      }),
      update: handle({
        access: { permission: appPermission('channels:write') },
        controller: ({ body, user, app }) => updateChannel({ body, user, app }),
      }),
      // The dashboard's command picker: a dashboard login, not the bot token.

      // Commands (user auth) — the commands available in a channel; login only.
      commands: handle({ controller: ({ params, query }) => listChannelCommands({ params, query }) }),
    },
    user: {
      info: handle({
        access: { permission: appPermission('users:read') },
        controller: ({ query }) => userInfo({ query }),
      }),
    },
    usergroups: {
      list: handle({
        access: { permission: appPermission('usergroups:read') },
        controller: () => listUserGroups(),
      }),
    },
    guests: {
      create: handle({
        access: { permission: appPermission('guests:write') },
        successStatus: 201,
        controller: ({ body, user, app }) => createAppGuest({ body, user, app }),
      }),
      get: handle({
        access: { permission: appPermission('guests:read') },
        controller: ({ body, user, app }) => listAppGuests({ body, user, app }),
      }),
      update: handle({
        access: { permission: appPermission('guests:write') },
        controller: ({ body, user, app }) => updateAppGuest({ body, user, app }),
      }),
      token: handle({
        access: { permission: appPermission('guests:write') },
        controller: ({ body, user, app }) => appGuestToken({ body, user, app }),
      }),
    },
    installed: {

      // Per-install edits (Installed screen, workspace admin), scoped to the caller's workspace.
      update: handle({
        ...xyneApps(AccessType.WRITE),
        controller: ({ params, body, user }) => updateInstalledApp({ params, body, user }),
      }),
      permissions: handle({
        ...xyneApps(AccessType.READ),
        controller: ({ params, user }) => getInstalledPermissions({ params, user }),
      }),
      permissionsSet: handle({
        ...xyneApps(AccessType.WRITE),
        controller: ({ params, body, user }) => setInstalledPermissions({ params, body, user }),
      }),
      permissionsActivate: handle({
        ...xyneApps(AccessType.WRITE),
        controller: ({ params, user }) => activateInstalledPermissions({ params, user }),
      }),
      commands: handle({
        ...xyneApps(AccessType.READ),
        controller: ({ params, query, user }) => listInstalledCommands({ params, query, user }),
      }),
      resources: handle({
        ...xyneApps(AccessType.READ),
        controller: ({ params, user }) => listAttachedResources({ params, user }),
      }),
      resourcesSet: handle({
        ...xyneApps(AccessType.ADMIN),
        controller: ({ params, body, user }) => setAttachedResources({ params, body, user }),
      }),
      fetchConfig: handle({
        ...xyneApps(AccessType.READ),
        controller: ({ params, user }) => getFetchConfig({ params, user }),
      }),
      fetchConfigDelete: handle({
        ...xyneApps(AccessType.WRITE),
        controller: ({ params, user }) => deleteFetchConfig({ params, user }),
      }),
    },
    incomingWebhooks: {

      create: handle({
        ...xyneApps(AccessType.WRITE),
        successStatus: 201,
        controller: ({ body, user }) => createIncomingWebhook({ body, user }),
      }),
      list: handle({
        ...xyneApps(AccessType.READ),
        controller: ({ params, query, user }) => listIncomingWebhooks({ params, query, user }),
      }),
      update: handle({
        ...xyneApps(AccessType.WRITE),
        controller: ({ params, body, user }) => updateIncomingWebhook({ params, body, user }),
      }),
      revoke: handle({
        ...xyneApps(AccessType.WRITE),
        controller: ({ params, user }) => revokeIncomingWebhook({ params, user }),
      }),
    },
    permissions: {

      // Permission management (user auth). The registry list is login only.
      list: handle({ controller: () => listAvailablePermissions() }),
      get: handle({ ...xyneApps(AccessType.READ), controller: ({ params }) => getAppPermissions({ params }) }),
      set: handle({
        ...xyneApps(AccessType.WRITE),
        controller: ({ params, body, user }) => setAppPermissions({ params, body, user }),
      }),
    },
    calls: {
      summaryTemplates: handle({
        access: { permission: appPermission('summaries:read') },
        controller: ({ user }) => listSummaryTemplates({ user }),
      }),
      summaryTemplate: handle({
        access: { permission: appPermission('summaries:read') },
        controller: ({ params, user }) => getSummaryTemplate({ params, user }),
      }),
      get: handle({
        access: { permission: appPermission('calls:read') },
        controller: ({ params, user }) => getCall({ params, user }),
      }),
    },
    ticket: {
      boards: handle({
        access: { permission: appPermission('tickets:read') },
        controller: ({ query, user }) => listBoards({ query, user }),
      }),
      boardStages: handle({
        access: { permission: appPermission('tickets:read') },
        controller: ({ params, user }) => listBoardStages({ params, user }),
      }),
      listBySender: handle({
        access: { permission: appPermission('tickets:read') },
        controller: ({ query, user }) => listBySender({ query, user }),
      }),
    },
    slack: group({ invalidRequest: () => slackError('invalid_arguments') }, {
    	// Same check as the native chat/deleteMessage (core/botMessageDelete), Slack's answers.
    	chatDelete: handle({
    		access: { permission: appPermission("chat:delete"), channel: slackChannel() },
    		controller: ({ body, user, access }) =>
    			slackHandle(async () => {
    				const userId = user?.id ?? "";
    				const channelId = access.channel.channelId;
    				const check = await checkBotMessageDelete(body.ts, channelId, userId);
    				if (!check.ok) {
    					throw slackError(check.reason === "not_own" ? "cant_delete_message" : "message_not_found");
    				}
    				if (check.alreadyDeleted) {
    					return { ok: true as const, channel: channelId, ts: body.ts };
    				}
    				const result = await deleteConversationMessage(body.ts, userId);
    				return transformDeleteResponse(result, channelId);
    			}),
    	}),
    	// `text` encrypted by the ingress proxy: the content is built by the encryption service
    	// (chatWrite.ts). Plain `text` takes the old transformers, unchanged.
    	chatPostMessage: handle({
    		access: { permission: appPermission("chat:write"), channel: slackChannel() },
    		encryption: encryptUnderBotWorkspace,
    		controller: ({ body, user, app, access, derived }) =>
    			slackHandle(() => slackChatPostMessage({ body, user, app, channel: access.channel, textFacts: derived?.fields.text })),
    	}),
    	chatPostEphemeral: handle({
    		access: { permission: appPermission("chat:write"), channel: slackChannel() },
    		encryption: encryptUnderBotWorkspace,
    		controller: ({ body, user, app, access, derived }) =>
    			slackHandle(() => slackChatPostEphemeral({ body, user, app, channel: access.channel, textFacts: derived?.fields.text })),
    	}),
    	chatUpdate: handle({
    		access: { permission: appPermission("chat:write"), channel: slackChannel() },
    		encryption: encryptUnderBotWorkspace,
    		controller: ({ body, user, app, access, derived }) =>
    			slackHandle(() => slackChatUpdate({ body, user, app, channel: access.channel, textFacts: derived?.fields.text })),
    	}),
    	// ─── Reads: GET (query) and POST (body), as Slack answers both ───────────────
    	authTestGet: handle({ controller: ({ user, app }) => slackHandle(() => slackAuthTest({ user, app })) }),
    	authTestPost: handle({ controller: ({ user, app }) => slackHandle(() => slackAuthTest({ user, app })) }),
    	conversationsInfoGet: handle({
    		access: { permission: appPermission("channels:read"), channel: slackChannel("query") },
    		controller: ({ access }) => slackHandle(() => slackConversationsInfo({ channel: access.channel })),
    	}),
    	conversationsInfoPost: handle({
    		access: { permission: appPermission("channels:read"), channel: slackChannel("body") },
    		controller: ({ access }) => slackHandle(() => slackConversationsInfo({ channel: access.channel })),
    	}),
    	conversationsListGet: handle({
    		access: { permission: appPermission("channels:read") },
    		controller: ({ query }) => slackHandle(() => slackConversationsList(query)),
    	}),
    	conversationsListPost: handle({
    		access: { permission: appPermission("channels:read") },
    		controller: ({ body }) => slackHandle(() => slackConversationsList(body)),
    	}),
    	conversationsOpen: handle({
    		access: { permission: appPermission("im:write") },
    		controller: ({ body, user, app }) => slackHandle(() => slackConversationsOpen({ body, user, app })),
    	}),
    	usersInfoGet: handle({
    		access: { permission: appPermission("users:read") },
    		controller: ({ query }) => slackHandle(() => slackUsersInfo(query)),
    	}),
    	usersInfoPost: handle({
    		access: { permission: appPermission("users:read") },
    		controller: ({ body }) => slackHandle(() => slackUsersInfo(body)),
    	}),
    	usersLookupByEmailGet: handle({
    		access: { permission: appPermission("users:read") },
    		controller: ({ query, user, app }) => slackHandle(() => slackUsersLookupByEmail({ args: query, user, app })),
    	}),
    	usersLookupByEmailPost: handle({
    		access: { permission: appPermission("users:read") },
    		controller: ({ body, user, app }) => slackHandle(() => slackUsersLookupByEmail({ args: body, user, app })),
    	}),
    	usersConversationsGet: handle({
    		access: { permission: appPermission("channels:read") },
    		controller: ({ query, user, app }) => slackHandle(() => slackUsersConversations({ args: query, user, app })),
    	}),
    	usersConversationsPost: handle({
    		access: { permission: appPermission("channels:read") },
    		controller: ({ body, user, app }) => slackHandle(() => slackUsersConversations({ args: body, user, app })),
    	}),
    	usergroupsListGet: handle({
    		access: { permission: appPermission("usergroups:read") },
    		controller: ({ query }) => slackHandle(() => slackUsergroupsList(query)),
    	}),
    	usergroupsListPost: handle({
    		access: { permission: appPermission("usergroups:read") },
    		controller: ({ body }) => slackHandle(() => slackUsergroupsList(body)),
    	}),
    }),
  },
  activityAliases: {
    list: handle({ controller: () => listAliases() }),
    create: handle({ ...userActivityAdmin, controller: ({ body }) => createAlias({ body }) }),
    update: handle({ ...userActivityAdmin, controller: ({ params, body }) => updateAlias({ params, body }) }),
    delete: handle({ ...userActivityAdmin, successStatus: 204, controller: ({ params }) => deleteAlias({ params }) }),
  },
  clientEvents: {
    mine: handle({ controller: ({ user }) => myHeaderOverrides({ user }) }),
    list: handle({ ...clientEventsAdmin, controller: ({ user }) => allHeaderOverrides({ user }) }),
    post: handle({ ...clientEventsAdmin, controller: ({ body, user }) => postClientEvent({ body, user }) }),
    remove: handle({ ...clientEventsAdmin, controller: ({ body, user }) => removeHeaderOverrides({ body, user }) }),
  },
  emojis: {
    list: handle({ controller: () => listEmojis() }),
    get: handle({ controller: ({ params }) => getEmoji({ params }) }),
    delete: handle({ controller: ({ params, user }) => deleteEmoji({ params, user }) }),
  },
  analytics: group({ access: { workspace: analyticsWorkspace(), acl: routeAcl(), analytics: resourceAccess('ANALYTICS', AccessType.ADMIN) } }, {
    messagesExchanged: handle({ controller: ({ query, user }) => messagesExchanged({ query, user }) }),
    activeUsers: handle({ controller: ({ query, user }) => activeUsers({ query, user }) }),
    currentActiveUsers: handle({ controller: ({ query, user }) => currentActiveUsers({ query, user }) }),
    activeChannels: handle({ controller: ({ query, user }) => activeChannels({ query, user }) }),
    filesShared: handle({ controller: ({ query, user }) => filesShared({ query, user }) }),
    messagesToday: handle({ controller: ({ query, user }) => messagesToday({ query, user }) }),
    numberOfTickets: handle({ controller: ({ query, user }) => numberOfTickets({ query, user }) }),
    numberOfCanvases: handle({ controller: ({ query, user }) => numberOfCanvases({ query, user }) }),
    numberOfCalls: handle({ controller: ({ query, user }) => numberOfCalls({ query, user }) }),
    totalCallsDuration: handle({ controller: ({ query, user }) => totalCallsDuration({ query, user }) }),
    usersOnboarded: handle({ controller: ({ query, user }) => usersOnboarded({ query, user }) }),
    topUsersByMessages: handle({ controller: ({ query, user }) => topUsersByMessages({ query, user }) }),
  }),
  notifications: {
    subscribe: handle({ controller: ({ body, user, userAgent }) => subscribe({ body, user, userAgent }) }),
    unsubscribe: handle({ controller: ({ body, user }) => unsubscribe({ body, user }) }),
    mobileRegister: handle({ controller: ({ body, user, headers }) => registerMobilePushToken({ body, user, headers }) }),
    mobileUnregister: handle({ controller: ({ user, headers }) => unregisterMobilePushToken({ user, headers }) }),
    queueStats: handle({ controller: () => queueStats() }),
    unreadCount: handle({ controller: ({ user }) => unreadCount({ user }) }),
    workspaceCounts: handle({ controller: ({ user }) => workspaceCounts({ user }) }),
    test: handle({ controller: ({ user }) => sendTest({ user }) }),
    markAllRead: handle({ controller: ({ user }) => markAllRead({ user }) }),
    preferences: handle({ controller: ({ user }) => getPreferences({ user }) }),
    preferencesSet: handle({ controller: ({ body, user }) => updatePreferences({ body, user }) }),
    read: handle({ controller: ({ params, body, user }) => markRead({ params, body, user }) }),
    dismiss: handle({ controller: ({ params, user }) => dismiss({ params, user }) }),
  },
  messages: {
    reactions: {
      bulk: handle({ controller: ({ body, user }) => getMessagesReactions({ body, user }) }),
      add: handle({ controller: ({ params, body, user }) => addReaction({ params, body, user }) }),
      remove: handle({ controller: ({ params, user }) => removeReaction({ params, user }) }),
      toggle: handle({ controller: ({ params, user }) => toggleReaction({ params, user }) }),
      get: handle({ controller: ({ params, user }) => getMessageReactions({ params, user }) }),
    },
  },
  organizations: {
    list: handle({ controller: ({ user }) => listOrganizations({ user }) }),
    get: handle({ controller: ({ params, user }) => getOrganization({ params, user }) }),
    addMember: handle({ controller: ({ params, body, user }) => addMember({ params, body, user }) }),
    updateMemberRole: handle({ controller: ({ params, body, user }) => updateMemberRole({ params, body, user }) }),
    removeMember: handle({ controller: ({ params, user }) => removeMember({ params, user }) }),
  },
  cacConfig: {
    get: handle({ controller: ({ params, user, headers }) => cacConfig({ params, user, headers }) }),
  },
  subTickets: {
    link: handle({ successStatus: 201, controller: ({ body, user }) => linkSubTicket({ body, user }) }),
    unlink: handle({ successStatus: 204, controller: ({ body, user }) => unlinkSubTicketHandler({ body, user }) }),
  },
  conversationLabels: {
    unreadCounts: handle({ controller: ({ query, user }) => labelUnreadCounts({ query, user }) }),
    unreadCount: handle({ controller: ({ body, user }) => labelUnreadCount({ body, user }) }),
    deleteImpact: handle({ controller: ({ params, user }) => labelDeleteImpact({ params, user }) }),
    delete: handle({ controller: ({ params, user }) => labelDelete({ params, user }) }),
  },
  channels: {
    checkDuplicate: handle({ controller: ({ body, user }) => checkDuplicate({ body, user }) }),
    search: handle({ controller: ({ query, user }) => searchForMentions({ query, user }) }),
    memberCounts: handle({ controller: ({ body, user }) => memberCounts({ body, user }) }),
    publishTargets: handle({ controller: ({ user }) => publishTargets({ user }) }),
    connectedEmail: handle({
      responseHeaders: { 'Cache-Control': 'private, no-cache' },
      controller: ({ params, user }) => connectedEmail({ params, user }),
    }),
    emailAlias: handle({ controller: ({ params, user }) => emailAlias({ params, user }) }),
    vespaParticipants: handle({ controller: ({ params, user }) => vespaParticipants({ params, user }) }),
    members: handle({ controller: ({ params, user }) => channelMembers({ params, user }) }),
    canLinkBoards: handle({ controller: ({ params, user }) => canLinkBoards({ params, user }) }),
    shareAgentStatus: handle({ controller: ({ params, query, user }) => shareAgentStatus({ params, query, user }) }),
    tagsConfig: {
      get: handle({ access: { tags: deskTagsAccess({ manage: false }) }, controller: ({ params }) => getChannelTagsConfig({ params }) }),
      update: handle({
        access: { tags: deskTagsAccess({ manage: true }) },
        controller: ({ params, body, access }) => updateChannelTagsConfig({ params, body, caller: access.tags }),
      }),
    },
  },
  dailyBrief: {
    config: handle({ controller: ({ user, headers }) => getConfig({ user, headers }) }),
    configSet: handle({ controller: ({ body, user, headers }) => saveConfig({ body, user, headers }) }),
    settings: handle({ controller: ({ user, headers }) => getSettings({ user, headers }) }),
    settingsSet: handle({ controller: ({ body, user, headers }) => saveSettings({ body, user, headers }) }),
  },
});
