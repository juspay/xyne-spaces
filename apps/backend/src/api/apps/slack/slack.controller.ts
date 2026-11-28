import { api } from '@xyne/shared';
import { appPermission, encryptUnderBotWorkspace } from '@/apps/access';
import { checkBotMessageDelete } from '@/apps/core/botMessageDelete';
import { deleteConversationMessage } from '@/apps/core/conversationUtils';
import { slackChannel, slackError, slackHandle } from '@/apps/platform-adapters/slack/access';
import { transformDeleteResponse } from '@/apps/platform-adapters/slack/response-transformers/chat';
import { controller } from '@/framework/api';
import { postSlackEphemeral, postSlackMessage, updateSlackMessage } from './chat.controller';
import {
  openSlackConversation,
  slackAuthTest,
  slackConversationsInfo,
  slackConversationsList,
  slackUsergroupsList,
  slackUsersConversations,
  slackUsersInfo,
  slackUsersLookupByEmail,
} from './reads.controller';

// ─── The Slack-compatible API (/apps/slack/...), bot token ─────────────────────
// Each controller runs in slackHandle, so an unexpected error is Slack's `internal_error`.
// The routes file's Slack group answers a bad request the Slack way (`invalid_arguments`).
// Reads take GET (query) and POST (body), as Slack answers both: one controller per method.

// ─── Writes ─────────────────────────────────────────────────────────────────────

/** Same check as the native chat/deleteMessage (core/botMessageDelete), Slack's answers. */
export const slackChatDelete = controller(
  api.apps.slack.chatDelete,
  { checks: { permission: appPermission('chat:delete'), channel: slackChannel() } },
  ({ body, user, access }) =>
    slackHandle(async () => {
      const userId = user?.id ?? '';
      const channelId = access.channel.channelId;
      const check = await checkBotMessageDelete(body.ts, channelId, userId);
      if (!check.ok) {
        throw slackError(check.reason === 'not_own' ? 'cant_delete_message' : 'message_not_found');
      }
      if (check.alreadyDeleted) {
        return { ok: true as const, channel: channelId, ts: body.ts };
      }
      const result = await deleteConversationMessage(body.ts, userId);
      return transformDeleteResponse(result, channelId);
    }),
);

/**
 * `text` encrypted by the ingress proxy: the content is built by the encryption service
 * (chatWrite.ts). Plain `text` takes the old transformers, unchanged.
 */
export const slackChatPostMessage = controller(
  api.apps.slack.chatPostMessage,
  { checks: { permission: appPermission('chat:write'), channel: slackChannel() }, encryption: encryptUnderBotWorkspace },
  ({ body, user, app, access, derived }) =>
    slackHandle(() => postSlackMessage({ body, user, app, channel: access.channel, textFacts: derived?.fields.text })),
);

export const slackChatPostEphemeral = controller(
  api.apps.slack.chatPostEphemeral,
  { checks: { permission: appPermission('chat:write'), channel: slackChannel() }, encryption: encryptUnderBotWorkspace },
  ({ body, user, app, access, derived }) =>
    slackHandle(() => postSlackEphemeral({ body, user, app, channel: access.channel, textFacts: derived?.fields.text })),
);

export const slackChatUpdate = controller(
  api.apps.slack.chatUpdate,
  { checks: { permission: appPermission('chat:write'), channel: slackChannel() }, encryption: encryptUnderBotWorkspace },
  ({ body, user, app, access, derived }) =>
    slackHandle(() => updateSlackMessage({ body, user, app, channel: access.channel, textFacts: derived?.fields.text })),
);

// ─── Reads ──────────────────────────────────────────────────────────────────────

export const slackAuthTestGet = controller(api.apps.slack.authTestGet, ({ user, app }) => slackHandle(() => slackAuthTest({ user, app })));
export const slackAuthTestPost = controller(api.apps.slack.authTestPost, ({ user, app }) => slackHandle(() => slackAuthTest({ user, app })));

export const slackConversationsInfoGet = controller(
  api.apps.slack.conversationsInfoGet,
  { checks: { permission: appPermission('channels:read'), channel: slackChannel('query') } },
  ({ access }) => slackHandle(() => slackConversationsInfo({ channel: access.channel })),
);
export const slackConversationsInfoPost = controller(
  api.apps.slack.conversationsInfoPost,
  { checks: { permission: appPermission('channels:read'), channel: slackChannel('body') } },
  ({ access }) => slackHandle(() => slackConversationsInfo({ channel: access.channel })),
);

export const slackConversationsListGet = controller(
  api.apps.slack.conversationsListGet,
  { checks: { permission: appPermission('channels:read') } },
  ({ query }) => slackHandle(() => slackConversationsList(query)),
);
export const slackConversationsListPost = controller(
  api.apps.slack.conversationsListPost,
  { checks: { permission: appPermission('channels:read') } },
  ({ body }) => slackHandle(() => slackConversationsList(body)),
);

export const slackConversationsOpen = controller(
  api.apps.slack.conversationsOpen,
  { checks: { permission: appPermission('im:write') } },
  ({ body, user, app }) => slackHandle(() => openSlackConversation({ body, user, app })),
);

export const slackUsersInfoGet = controller(
  api.apps.slack.usersInfoGet,
  { checks: { permission: appPermission('users:read') } },
  ({ query }) => slackHandle(() => slackUsersInfo(query)),
);
export const slackUsersInfoPost = controller(
  api.apps.slack.usersInfoPost,
  { checks: { permission: appPermission('users:read') } },
  ({ body }) => slackHandle(() => slackUsersInfo(body)),
);

export const slackUsersLookupByEmailGet = controller(
  api.apps.slack.usersLookupByEmailGet,
  { checks: { permission: appPermission('users:read') } },
  ({ query, user, app }) => slackHandle(() => slackUsersLookupByEmail({ args: query, user, app })),
);
export const slackUsersLookupByEmailPost = controller(
  api.apps.slack.usersLookupByEmailPost,
  { checks: { permission: appPermission('users:read') } },
  ({ body, user, app }) => slackHandle(() => slackUsersLookupByEmail({ args: body, user, app })),
);

export const slackUsersConversationsGet = controller(
  api.apps.slack.usersConversationsGet,
  { checks: { permission: appPermission('channels:read') } },
  ({ query, user, app }) => slackHandle(() => slackUsersConversations({ args: query, user, app })),
);
export const slackUsersConversationsPost = controller(
  api.apps.slack.usersConversationsPost,
  { checks: { permission: appPermission('channels:read') } },
  ({ body, user, app }) => slackHandle(() => slackUsersConversations({ args: body, user, app })),
);

export const slackUsergroupsListGet = controller(
  api.apps.slack.usergroupsListGet,
  { checks: { permission: appPermission('usergroups:read') } },
  ({ query }) => slackHandle(() => slackUsergroupsList(query)),
);
export const slackUsergroupsListPost = controller(
  api.apps.slack.usergroupsListPost,
  { checks: { permission: appPermission('usergroups:read') } },
  ({ body }) => slackHandle(() => slackUsergroupsList(body)),
);
