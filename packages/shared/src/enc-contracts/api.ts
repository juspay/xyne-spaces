import {
  appsChatAgentProgress,
  appsChatDeleteMessage,
  appsChatPostEphemeral,
  appsChatPostMessage,
  appsChatUpdateMessage,
} from './contracts/apps.js';
import { appsChannelDeskConfig, appsChannelInfo, appsChannelList, appsChannelOpenDm, appsChannelUpdate } from './contracts/appsChannels.js';
import { appsGuestsCreate, appsGuestsGet, appsGuestsToken, appsGuestsUpdate, appsUserGroupsList, appsUserInfo } from './contracts/appsUsers.js';
import { appsCallsGet, appsCallsSummaryTemplate, appsCallsSummaryTemplates, appsTicketBoardStages, appsTicketBoards, appsTicketListBySender } from './contracts/appsCallsTickets.js';
import {
  appsSlackChatDelete,
  appsSlackChatPostEphemeral,
  appsSlackChatPostMessage,
  appsSlackChatUpdate,
  appsSlackAuthTestGet,
  appsSlackAuthTestPost,
  appsSlackConversationsInfoGet,
  appsSlackConversationsInfoPost,
  appsSlackConversationsListGet,
  appsSlackConversationsListPost,
  appsSlackConversationsOpen,
  appsSlackUsersInfoGet,
  appsSlackUsersInfoPost,
  appsSlackUsersLookupByEmailGet,
  appsSlackUsersLookupByEmailPost,
  appsSlackUsersConversationsGet,
  appsSlackUsersConversationsPost,
  appsSlackUsergroupsListGet,
  appsSlackUsergroupsListPost,
} from './contracts/appsSlack.js';

/**
 * Every REST API that has a route contract, grouped the way the backend serves them. The
 * backend serves a group with `api.routes(API.<group>, { ... })`, which needs a handler for
 * every entry: adding a contract here without serving it is a type error in the backend.
 *
 * Routes move here one group at a time; anything not here is still mounted the old way.
 */
export const API = {
  apps: {
    chat: {
      postMessage: appsChatPostMessage,
      postEphemeral: appsChatPostEphemeral,
      updateMessage: appsChatUpdateMessage,
      deleteMessage: appsChatDeleteMessage,
      agentProgress: appsChatAgentProgress,
    },
    channel: {
      openDm: appsChannelOpenDm,
      info: appsChannelInfo,
      deskChannelConfig: appsChannelDeskConfig,
      list: appsChannelList,
      update: appsChannelUpdate,
    },
    user: { info: appsUserInfo },
    usergroups: { list: appsUserGroupsList },
    guests: {
      create: appsGuestsCreate,
      get: appsGuestsGet,
      update: appsGuestsUpdate,
      token: appsGuestsToken,
    },
    // Literal paths before /:callId: routes match in this order.
    calls: {
      summaryTemplates: appsCallsSummaryTemplates,
      summaryTemplate: appsCallsSummaryTemplate,
      get: appsCallsGet,
    },
    ticket: {
      boards: appsTicketBoards,
      boardStages: appsTicketBoardStages,
      listBySender: appsTicketListBySender,
    },
    /** The Slack-compatible API, /apps/slack/<method>. */
    slack: {
      chatDelete: appsSlackChatDelete,
      chatPostMessage: appsSlackChatPostMessage,
      chatPostEphemeral: appsSlackChatPostEphemeral,
      chatUpdate: appsSlackChatUpdate,
      authTestGet: appsSlackAuthTestGet,
      authTestPost: appsSlackAuthTestPost,
      conversationsInfoGet: appsSlackConversationsInfoGet,
      conversationsInfoPost: appsSlackConversationsInfoPost,
      conversationsListGet: appsSlackConversationsListGet,
      conversationsListPost: appsSlackConversationsListPost,
      conversationsOpen: appsSlackConversationsOpen,
      usersInfoGet: appsSlackUsersInfoGet,
      usersInfoPost: appsSlackUsersInfoPost,
      usersLookupByEmailGet: appsSlackUsersLookupByEmailGet,
      usersLookupByEmailPost: appsSlackUsersLookupByEmailPost,
      usersConversationsGet: appsSlackUsersConversationsGet,
      usersConversationsPost: appsSlackUsersConversationsPost,
      usergroupsListGet: appsSlackUsergroupsListGet,
      usergroupsListPost: appsSlackUsergroupsListPost,
    },
  },
} as const;
