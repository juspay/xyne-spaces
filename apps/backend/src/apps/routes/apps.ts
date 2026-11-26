import express, { Router } from 'express';
import { AccessType } from '@xyne/shared';
import { AppController } from '../controllers/appController';
import { incomingWebhookController } from '../controllers/incomingWebhookController';
import { fetchConfigController } from '../controllers/fetchConfigController';
import { ChatController } from '../controllers/chatController';
import { CommandController } from '../controllers/commandController';
import { authorize } from '@/middleware/authorize';
import chatRoutes from './chat';
import fileRoutes from './files';
import ticketRoutes from './ticket';
import channelRoutes from './channel';
import emailRoutes from './email';
import callRoutes from './calls';
import workflowRoutes from './workflows';
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

// Typed routes: src/api (the router tree), contracts in @xyne/shared (packages/shared/src/api).


// Type-prefixed webhook routes must stay ABOVE the 3-segment catch-all below,
// otherwise the prefix is captured as :workspaceId.
router.post('/webhooks/sentinel/:workspaceId/:appId/:secret', webhookLimiter, incomingWebhookController.handleSentinelIncoming);
// Amazon SNS posts JSON with `Content-Type: text/plain`, which the global
// express.json() ignores — parse the body as text here and JSON.parse it in the
// controller.
router.post('/webhooks/sns/:workspaceId/:appId/:secret', express.text({ type: '*/*', limit: '1mb' }), webhookLimiter, incomingWebhookController.handleAmazonSnsIncoming);
router.post('/webhooks/pingdom/:workspaceId/:appId/:secret', express.text({ type: '*/*', limit: '1mb' }), webhookLimiter, incomingWebhookController.handlePingdomIncoming);
router.post('/webhooks/gcp/:workspaceId/:appId/:secret', express.text({ type: '*/*', limit: '1mb' }), webhookLimiter, incomingWebhookController.handleGcpIncoming);
router.post('/webhooks/hubspot/:workspaceId/:appId/:secret', express.text({ type: '*/*', limit: '1mb' }), webhookLimiter, incomingWebhookController.handleHubspotIncoming);
router.post('/webhooks/:workspaceId/:appId/:secret', webhookLimiter, incomingWebhookController.handleIncoming);
const commandController = new CommandController();

router.post('/upload-picture/:appId', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), uploadConfig.single('picture'), appController.uploadBotPicture);

// Per-install edits (Installed screen, workspace admin). Scoped to the caller's workspace.

// App Desk history fetch config. The test route makes a real outbound call on the
// caller's behalf, so it is WRITE rather than READ.
router.put('/installed/:installedAppId/fetch-config', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), fetchConfigController.putFetchConfig);
router.post('/installed/:installedAppId/fetch-config/test', authMiddleware.authenticate, authorize('XYNE-APPS', AccessType.WRITE), webhookLimiter, fetchConfigController.testFetchConfig);


// User-initiated app action dispatch (user auth, not app token)
router.post("/chat/action", authMiddleware.authenticate, chatController.dispatchAction);

// Channel commands (user auth) — fetch available commands + dispatch when user presses Enter
// These must be declared BEFORE router.use('/channel', authenticateApp, ...) to avoid
// being intercepted by the app-token authenticateApp middleware.
router.post('/channel/:channelId/command', authMiddleware.authenticate, commandController.dispatchCommand);

// Channel routes
router.use("/channel", authenticateApp, channelRoutes);

// Chat routes
router.use("/chat", authenticateApp, chatRoutes);

// File routes
router.use('/files', authenticateApp, uploadMultiple, fileRoutes);

// Ticket routes
router.use("/ticket", authenticateApp, ticketRoutes);



// Email routes
router.use("/email", authenticateApp, emailRoutes);

// Call routes
router.use("/calls", authenticateApp, callRoutes);

// Workflow routes
router.use("/workflows", authenticateApp, workflowRoutes);

// PR check callback (called by dispatchAction when user clicks "Run PR Check" button)
// No auth needed here - dispatchAction is already authenticated and validates the request
router.use("/pr-check", prCheckCallbackRouter);

// Flow UI route
router.post("/flow/action", authMiddleware.authenticate, flowController.executeAction);

// Platform adapter routes
platformRegistry.mountAll(router);

// ─── Permission management (user auth) ─────────────────────────────────────
// matched as an appId param.

// Commands (user auth) — manage commands per app


// Channel commands user-auth routes are declared above, before authenticateApp middleware.

export default router;
