import { defineRouter } from '../../../enc-contracts/api-route.js';
import { appsSlackAuthTestGet, appsSlackAuthTestPost, appsSlackChatDelete, appsSlackChatPostEphemeral, appsSlackChatPostMessage, appsSlackChatUpdate, appsSlackConversationsInfoGet, appsSlackConversationsInfoPost, appsSlackConversationsListGet, appsSlackConversationsListPost, appsSlackConversationsOpen, appsSlackUsergroupsListGet, appsSlackUsergroupsListPost, appsSlackUsersConversationsGet, appsSlackUsersConversationsPost, appsSlackUsersInfoGet, appsSlackUsersInfoPost, appsSlackUsersLookupByEmailGet, appsSlackUsersLookupByEmailPost } from './slack.contracts.js';

/** `/apps/slack`: the Slack-compatible API for bots. Key order is the mount order. */
export const slackRouter = defineRouter('/slack', {
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
});
