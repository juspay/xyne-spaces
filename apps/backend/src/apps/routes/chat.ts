import { Router, type RequestHandler } from 'express';
import { config } from '@/config/env';
import { ChatController } from '../controllers/chatController';
import { validateChannelAccessForGet, validateChannelAccessForPost, validateChannelAccessForPostWithDm } from '../middelware/channelValidation';
import { requirePermission } from '@/middleware/requirePermission';
import { appsChatPostMessageClient, appsChatUpdateMessageClient } from '@xyne/shared';
import { encryptedRoute } from '@/middleware/encryptedRoute';

const router = Router();
const chatController = new ChatController();

// postMessage also accepts a user id as `channelId` — it then posts into the
// bot's DM with that user, matching the Slack adapter's chat.postMessage.
// encryptedRoute: fields the transit proxy encrypted become workspace-DEK ciphertext (and the
// reply goes back encrypted to the proxy); a no-op unless API client encryption is on.
// Only where the ingress transit proxy is deployed (TRANSIT_PROXY_INGRESS_ENABLED): there every
// /api/apps call comes through it (requireTransitProxyIngress, app.ts, refuses any other).
// Without the proxy these routes take plaintext as before; the Prisma extension still
// encrypts it at rest.
const whenTransitProxyIngress = (handlers: RequestHandler[]): RequestHandler[] =>
  config.internal.transitProxyIngressEnabled ? handlers : [];

const encryptedPostMessage = whenTransitProxyIngress(encryptedRoute(appsChatPostMessageClient, {
  resolveWorkspaceId: async (req) => req.user!.workspaceId,
}));
router.post('/postMessage', requirePermission('chat:write'), validateChannelAccessForPostWithDm, ...encryptedPostMessage, chatController.postMessage);
router.post('/postEphemeral', requirePermission('chat:write'), validateChannelAccessForPost, chatController.postEphemeral);
const encryptedUpdateMessage = whenTransitProxyIngress(encryptedRoute(appsChatUpdateMessageClient, {
  resolveWorkspaceId: async (req) => req.user!.workspaceId,
}));
router.post('/updateMessage', requirePermission('chat:write'), validateChannelAccessForPost, ...encryptedUpdateMessage, chatController.updateMessage);
router.post('/deleteMessage', requirePermission('chat:delete'), validateChannelAccessForPost, chatController.deleteMessage);
router.post('/agentProgress', requirePermission('chat:write'), validateChannelAccessForPost, chatController.agentProgress);
router.get('/channelHistory', requirePermission('channels:read'), validateChannelAccessForGet, chatController.channelHistory);
router.get('/conversationReplies', requirePermission('channels:read'), validateChannelAccessForGet, chatController.conversationReplies);
router.get('/conversationAttachments', requirePermission('channels:read'), validateChannelAccessForGet, chatController.getConversationAttachments);

export default router;
