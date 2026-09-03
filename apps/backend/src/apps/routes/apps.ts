import express, { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { AppController } from '../controllers/appController';
import { incomingWebhookController } from '../controllers/incomingWebhookController';
import { ChatController } from '../controllers/chatController';
import { CommandController } from '../controllers/commandController';
import { authorize } from '@/middleware/authorize';
import chatRoutes from './chat';
import fileRoutes from './files';
import ticketRoutes from './ticket';
import userRoutes from './user';
import channelRoutes from './channel';
import userGroupRoutes from './usergroups';
import emailRoutes from './email';
import callRoutes from './calls';
import prCheckCallbackRouter from './prCheckCallback';
import { authenticateApp } from '../middelware/authenticator';
import { uploadMultiple, uploadConfig } from '@/middleware/upload';
import { authMiddleware } from '@/middleware/auth';
import { FlowController } from '../controllers/flowController';
import { PermissionController } from '../controllers/permissionController';
import { AppResourceController } from '../controllers/appResourceController';
import { webhookLimiter } from '@/middleware/rateLimiters';
import { PlatformAdapterRegistry } from '../platform-adapters/types';
import { SlackAdapter } from '../platform-adapters/slack';

const router = Router();
const appController = new AppController();
const chatController = new ChatController();
const flowController = new FlowController();
const permissionController = new PermissionController();
const appResourceController = new AppResourceController();
const platformRegistry = new PlatformAdapterRegistry();

platformRegistry.register(new SlackAdapter());

// Type-prefixed webhook routes must stay ABOVE the 3-segment catch-all below,
// otherwise the prefix is captured as :workspaceId.
router.post('/webhooks/sentinel/:workspaceId/:appId/:secret', webhookLimiter, incomingWebhookController.handleSentinelIncoming);
// Amazon SNS posts JSON with `Content-Type: text/plain`, which the global
// express.json() ignores — parse the body as text here and JSON.parse it in the
// controller.
router.post('/webhooks/sns/:workspaceId/:appId/:secret', express.text({ type: '*/*', limit: '1mb' }), webhookLimiter, incomingWebhookController.handleAmazonSnsIncoming);
router.post('/webhooks/pingdom/:workspaceId/:appId/:secret', express.text({ type: '*/*', limit: '1mb' }), webhookLimiter, incomingWebhookController.handlePingdomIncoming);
router.post('/webhooks/gcp/:workspaceId/:appId/:secret', express.text({ type: '*/*', limit: '1mb' }), webhookLimiter, incomingWebhookController.handleGcpIncoming);
router.post('/webhooks/:workspaceId/:appId/:secret', webhookLimiter, incomingWebhookController.handleIncoming);
const commandController = new CommandController();

router.post('/create', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), appController.createApp);
router.post('/install/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.ADMIN), appController.installApp);
router.post('/promote/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.ADMIN), appController.promoteApp);
router.post('/configureWebhook/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), appController.configureWebhook);
router.post('/regenerate-jwt/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), appController.regenerateJwt);
router.post('/signing-secret/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), appController.getSigningSecret);
router.post('/upload-picture/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), uploadConfig.single('picture'), appController.uploadBotPicture);
router.get('/bot-channels/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.READ), appController.getBotChannels);
router.get('/project-boards/:projectId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.READ), appController.getProjectBoards);
router.post('/org-names', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.READ), appController.getOrgNames);

// Per-install edits (Installed screen, workspace admin). Scoped to the caller's workspace.
router.patch('/installed/:installedAppId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), appController.updateInstalledApp);
router.get('/installed/:installedAppId/permissions', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.READ), permissionController.getInstalledGranted);
router.post('/installed/:installedAppId/permissions', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), permissionController.setInstalledPermissions);
router.post('/installed/:installedAppId/permissions/activate', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), permissionController.activateInstalledPermissions);
router.get('/installed/:installedAppId/commands', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.READ), commandController.getInstalledCommands);
router.get('/installed/:installedAppId/resources/:resourceType', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.READ), appResourceController.listAttached);
router.patch('/installed/:installedAppId/resources/:resourceType', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.ADMIN), appResourceController.setAttached);

router.post('/incoming-webhooks', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), incomingWebhookController.createWebhook);
router.get('/incoming-webhooks/:installedAppId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.READ), incomingWebhookController.listWebhooks);
router.patch('/incoming-webhooks/:webhookId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), incomingWebhookController.updateWebhook);
router.post('/incoming-webhooks/:webhookId/revoke', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), incomingWebhookController.revokeWebhook);

// User-initiated app action dispatch (user auth, not app token)
router.post("/chat/action", authMiddleware.authenticate, chatController.dispatchAction);

// Channel commands (user auth) — fetch available commands + dispatch when user presses Enter
// These must be declared BEFORE router.use('/channel', authenticateApp, ...) to avoid
// being intercepted by the app-token authenticateApp middleware.
router.get('/channel/:channelId/commands', authMiddleware.authenticate, commandController.getChannelCommands);
router.post('/channel/:channelId/command', authMiddleware.authenticate, commandController.dispatchCommand);

// Channel routes
router.use("/channel", authenticateApp, channelRoutes);

// Chat routes
router.use("/chat", authenticateApp, chatRoutes);

// File routes
router.use('/files', authenticateApp, uploadMultiple, fileRoutes);

// Ticket routes
router.use("/ticket", authenticateApp, ticketRoutes);

// User routes
router.use("/user", authenticateApp, userRoutes);

// User Group routes
router.use("/usergroups", authenticateApp, userGroupRoutes);

// Email routes
router.use("/email", authenticateApp, emailRoutes);

// Call routes
router.use("/calls", authenticateApp, callRoutes);

// PR check callback (called by dispatchAction when user clicks "Run PR Check" button)
// No auth needed here - dispatchAction is already authenticated and validates the request
router.use("/pr-check", prCheckCallbackRouter);

// Flow UI route
router.post("/flow/action", authMiddleware.authenticate, flowController.executeAction);

// Platform adapter routes
platformRegistry.mountAll(router);

// ─── Permission management (user auth) ─────────────────────────────────────
// matched as an appId param.
router.get('/permissions', authMiddleware.authenticate, permissionController.listAvailable);
router.get('/permissions/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.READ), permissionController.getGranted);
router.post('/permissions/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), permissionController.setPermissions);

// Commands (user auth) — manage commands per app
router.get('/:appId/commands', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.READ), commandController.getCommands);
router.post('/:appId/commands', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), commandController.createCommand);
router.put('/:appId/commands', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), commandController.updateCommand);
router.delete('/:appId/commands/:commandName', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), commandController.deleteCommand);


// Channel commands user-auth routes are declared above, before authenticateApp middleware.

export default router;
