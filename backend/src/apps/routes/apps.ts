import { Router } from 'express';
import { AppController } from '../controllers/appController';
import { incomingWebhookController } from '../controllers/incomingWebhookController';
import { ChatController } from '../controllers/chatController';
import { authorize } from '@/middleware/authorize';
import { AccessType } from '@prisma/client';
import chatRoutes from './chat';
import fileRoutes from './files';
import ticketRoutes from './ticket';
import userRoutes from './user';
import channelRoutes from './channel';
import userGroupRoutes from './usergroups';
import emailRoutes from './email';
import prCheckCallbackRouter from './prCheckCallback';
import { authenticateApp } from '../middelware/authenticator';
import { uploadMultiple, uploadConfig } from '@/middleware/upload';
import { authMiddleware } from '@/middleware/auth';
import { FlowController } from '../controllers/flowController';
import { webhookLimiter } from '@/middleware/rateLimiters';
import { PlatformAdapterRegistry } from '../platform-adapters/types';
import { SlackAdapter } from '../platform-adapters/slack';

const router = Router();
const appController = new AppController();
const chatController = new ChatController();
const flowController = new FlowController();
const platformRegistry = new PlatformAdapterRegistry();

platformRegistry.register(new SlackAdapter());

router.post('/webhooks/:workspaceId/:appId/:secret', webhookLimiter, incomingWebhookController.handleIncoming);

router.post('/create', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), appController.createApp);
router.post('/install/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.ADMIN), appController.installApp);
router.post('/configureWebhook/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), appController.configureWebhook);
router.post('/regenerate-jwt/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), appController.regenerateJwt);
router.post('/signing-secret/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), appController.getSigningSecret);
router.post('/upload-picture/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), uploadConfig.single('picture'), appController.uploadBotPicture);
router.get('/bot-channels/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.READ), appController.getBotChannels);

router.post('/incoming-webhooks', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), incomingWebhookController.createWebhook);
router.get('/incoming-webhooks/:installedAppId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.READ), incomingWebhookController.listWebhooks);
router.patch('/incoming-webhooks/:webhookId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), incomingWebhookController.updateWebhook);
router.post('/incoming-webhooks/:webhookId/revoke', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), incomingWebhookController.revokeWebhook);

// User-initiated app action dispatch (user auth, not app token)
router.post("/chat/action", authMiddleware.authenticate, chatController.dispatchAction);

// Channel routes
router.use("/channel", authenticateApp, channelRoutes);

// Chat routes
router.use("/chat", authenticateApp, chatRoutes);

// File routes
router.use("/files", uploadMultiple, authenticateApp, fileRoutes);

// Ticket routes
router.use("/ticket", authenticateApp, ticketRoutes);

// User routes
router.use("/user", authenticateApp, userRoutes);

// User Group routes
router.use("/usergroups", authenticateApp, userGroupRoutes);

// Email routes
router.use("/email", authenticateApp, emailRoutes);

// PR check callback (called by dispatchAction when user clicks "Run PR Check" button)
// No auth needed here - dispatchAction is already authenticated and validates the request
router.use("/pr-check", prCheckCallbackRouter);

// Flow UI route
router.post("/flow/action", authMiddleware.authenticate, flowController.executeAction);

// Platform adapter routes
platformRegistry.mountAll(router);

export default router;
