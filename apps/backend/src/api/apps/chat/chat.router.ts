import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { appPermission, botChannel } from '@/apps/access';
import { ChatController } from '@/apps/controllers/chatController';

const chatController = new ChatController();

/** The bot's workspace: whose key the encrypted fields are stored under. */
const encryptUnderBotWorkspace = {
  resolveWorkspaceId: async (req: { user?: { workspaceId: string } }) => req.user!.workspaceId,
};

/** `/apps/chat`: the native chat API for bots (bot token). Controllers: the chat controller (apps/controllers/chatController.ts). */
export const chatRouter = api.router(API.apps.chat, { auth: 'app' }, (serve) => ({
  // Also accepts a user id as `channelId`: it then posts into the bot's DM with that user,
  // matching the Slack adapter's chat.postMessage.
  postMessage: serve('postMessage', {
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
  postEphemeral: serve('postEphemeral', {
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
  updateMessage: serve('updateMessage', {
    access: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: false }) },
    encryption: encryptUnderBotWorkspace,
    controller: ({ body, derived, user, app }) =>
      chatController.editMessage({ body, workspaceId: user?.workspaceId, appId: app?.appId, textFacts: derived?.fields.text }),
  }),
  // Ids only: no encryption contract. Only the app's own BOT messages (removeMessage).
  deleteMessage: serve('deleteMessage', {
    access: { permission: appPermission('chat:delete'), channel: botChannel({ allowDm: false }) },
    controller: ({ body, user }) => chatController.removeMessage({ body, userId: user?.id }),
  }),
  // "Agent is working" signal, Redis pub/sub only. Not encrypted (decided 2026-11-25).
  agentProgress: serve('agentProgress', {
    access: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: false }) },
    controller: ({ body, user }) => chatController.publishAgentProgress({ body, userId: user!.id }),
  }),
}));
