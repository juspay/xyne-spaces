import { Router } from 'express';
import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { ChatController } from '../controllers/chatController';
import { appPermission, botChannel } from '../access';
import { validateChannelAccessForGet } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';

const router = Router();
const chatController = new ChatController();

// ─── Typed routes (contracts in @xyne/shared, API.apps.chat) ───────────────────
// Served by the API router (/api, app.ts) behind the contract gate, not by this router.
// Encryption: fields the transit proxy encrypted become workspace-DEK ciphertext (and the
// reply goes back encrypted to the proxy). Whether it runs for `app` routes is the framework's
// call (runsEncryption in framework/api.ts), not these routes'.
const encryptUnderBotWorkspace = {
  resolveWorkspaceId: async (req: { user?: { workspaceId: string } }) => req.user!.workspaceId,
};

api.routes(API.apps.chat, (serve) => ({
  // Also accepts a user id as `channelId`: it then posts into the bot's DM with that user,
  // matching the Slack adapter's chat.postMessage.
  postMessage: serve('postMessage', {
    auth: 'app',
    access: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: true }) },
    encryption: encryptUnderBotWorkspace,
    successStatus: 201,
    handle: ({ body, derived, user, app, access }) =>
      chatController.sendMessage({
        body,
        senderUserId: user?.id,
        workspaceId: user?.workspaceId,
        // Only a DM target is handed over; any other channel is resolved by sendMessage as before.
        resolvedChannelId: access.channel.dm ? access.channel.channelId : undefined,
        appId: app?.appId,
        markdownFacts: derived?.fields.markdownText,
        isPostAsUser: false,
      }),
  }),
  // Shown to one user only, never stored. markdownText reaches the handler as workspace-DEK
  // ciphertext, like postMessage; it is re-encrypted per recipient socket on delivery.
  postEphemeral: serve('postEphemeral', {
    auth: 'app',
    access: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: false }) },
    encryption: encryptUnderBotWorkspace,
    successStatus: 201,
    handle: ({ body, user, app }) =>
      chatController.sendEphemeral({
        body,
        sender: user ? { id: user.id, name: user.name } : undefined,
        workspaceId: user?.workspaceId,
        appId: app?.appId,
      }),
  }),
  updateMessage: serve('updateMessage', {
    auth: 'app',
    access: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: false }) },
    encryption: encryptUnderBotWorkspace,
    handle: ({ body, user, app }) =>
      chatController.editMessage({ body, workspaceId: user?.workspaceId, appId: app?.appId }),
  }),
  // Ids only: no encryption contract. Only the app's own BOT messages (removeMessage).
  deleteMessage: serve('deleteMessage', {
    auth: 'app',
    access: { permission: appPermission('chat:delete'), channel: botChannel({ allowDm: false }) },
    handle: ({ body, user }) => chatController.removeMessage({ body, userId: user?.id }),
  }),
  // "Agent is working" signal, Redis pub/sub only. Not encrypted (decided 2026-11-25).
  agentProgress: serve('agentProgress', {
    auth: 'app',
    access: { permission: appPermission('chat:write'), channel: botChannel({ allowDm: false }) },
    handle: ({ body, user }) => chatController.publishAgentProgress({ body, userId: user!.id }),
  }),
}));

// ─── Untyped routes (still mounted by apps.ts under /api/apps/chat) ────────────
router.get('/channelHistory', requirePermission('channels:read'), validateChannelAccessForGet, chatController.channelHistory);
router.get('/conversationReplies', requirePermission('channels:read'), validateChannelAccessForGet, chatController.conversationReplies);
router.get('/conversationAttachments', requirePermission('channels:read'), validateChannelAccessForGet, chatController.getConversationAttachments);

export default router;
