import { api } from '@xyne/shared';
import { appPermission, botChannel, encryptUnderBotWorkspace } from '@/apps/access';
import { ChatController } from '@/apps/controllers/chatController';
import { controller } from '@/framework/api';

// ─── Bot chat (/apps/chat/...), bot token ──────────────────────────────────────
// The checks resolve the channel the bot may post in; ChatController does the work.

const chat = new ChatController();

/**
 * Also accepts a user id as `channelId`: it then posts into the bot's DM with that user,
 * matching the Slack adapter's chat.postMessage.
 */
export const postMessage = controller(
  api.apps.chat.postMessage,
  {
    checks: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: true }) },
    encryption: encryptUnderBotWorkspace,
  },
  async ({ body, derived, user, app, access }, reply) => {
    reply.status(201);
    return chat.sendMessage({
      body,
      senderUserId: user?.id,
      workspaceId: user?.workspaceId,
      // Only a DM target is handed over; any other channel is resolved by sendMessage as before.
      resolvedChannelId: access.channel.dm ? access.channel.channelId : undefined,
      appId: app?.appId,
      markdownFacts: derived?.fields.markdownText,
      textFacts: derived?.fields.text,
      isPostAsUser: false,
    });
  },
);

/**
 * Shown to one user only, never stored. markdownText reaches the controller as workspace-DEK
 * ciphertext, like postMessage; it is re-encrypted per recipient socket on delivery.
 */
export const postEphemeral = controller(
  api.apps.chat.postEphemeral,
  {
    checks: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: false }) },
    encryption: encryptUnderBotWorkspace,
  },
  async ({ body, derived, user, app }, reply) => {
    reply.status(201);
    return chat.sendEphemeral({
      body,
      sender: user ? { id: user.id, name: user.name } : undefined,
      workspaceId: user?.workspaceId,
      appId: app?.appId,
      textFacts: derived?.fields.text,
    });
  },
);

export const updateMessage = controller(
  api.apps.chat.updateMessage,
  {
    checks: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: false }) },
    encryption: encryptUnderBotWorkspace,
  },
  async ({ body, derived, user, app }) =>
    chat.editMessage({ body, workspaceId: user?.workspaceId, appId: app?.appId, textFacts: derived?.fields.text }),
);

/** Ids only: no encryption contract. Only the app's own BOT messages (removeMessage). */
export const deleteMessage = controller(
  api.apps.chat.deleteMessage,
  { checks: { permission: appPermission('chat:delete'), channel: botChannel({ allowDm: false }) } },
  async ({ body, user }) => chat.removeMessage({ body, userId: user?.id }),
);

/** "Agent is working" signal, Redis pub/sub only. Not encrypted (decided 2026-11-25). */
export const agentProgress = controller(
  api.apps.chat.agentProgress,
  { checks: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: false }) } },
  async ({ body, user }) => chat.publishAgentProgress({ body, userId: user!.id }),
);
