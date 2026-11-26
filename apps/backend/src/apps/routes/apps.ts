import { API } from '@xyne/shared';
import { api } from '@/framework/api';
import { resourceAccess } from '@/framework/dashboardAccess';
import {
  activateInstalledPermissions,
  appSigningSecret,
  botChannels,
  configureAppWebhook,
  createApp,
  createAppCommand,
  createIncomingWebhook,
  deleteAppCommand,
  deleteFetchConfig,
  getAppPermissions,
  getFetchConfig,
  getInstalledPermissions,
  installAppHandler,
  listAppCommands,
  listAttachedResources,
  listAvailablePermissions,
  listChannelCommands,
  listIncomingWebhooks,
  listInstalledCommands,
  orgNames,
  projectBoards,
  promoteApp,
  regenerateAppJwt,
  revokeIncomingWebhook,
  setAppPermissions,
  setAttachedResources,
  setInstalledPermissions,
  updateAppCommand,
  updateIncomingWebhook,
  updateInstalledApp,
} from '../handlers/appsDashboard';
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
import userRoutes from './user';
import channelRoutes from './channel';
import guestRoutes from './guests';
import userGroupRoutes from './usergroups';
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

// ─── Typed routes (contracts in @xyne/shared, API.apps.dashboard) ───────────────
// The dashboard side: dashboard login, then XYNE-APPS access (resourceAccess). Served by the API
// router behind the contract gate; handlers in apps/handlers/appsDashboard.ts. Registered here,
// after the call / channel / user routes imported above, so those literal paths match first.
/** The dashboard login plus access to the XYNE-APPS resource at `level`. */
const xyneApps = (level: AccessType) => ({ access: { xyneApps: resourceAccess('XYNE-APPS', level) } });

api.routes(API.apps.dashboard, (serve) => ({
  create: serve('create', { ...xyneApps(AccessType.WRITE), successStatus: 201, handle: ({ body, user }) => createApp({ body, user }) }),
  install: serve('install', { ...xyneApps(AccessType.ADMIN), successStatus: 201, handle: ({ params, user }) => installAppHandler({ params, user }) }),
  promote: serve('promote', { ...xyneApps(AccessType.ADMIN), handle: ({ params, user }) => promoteApp({ params, user }) }),
  configureWebhook: serve('configureWebhook', {
    ...xyneApps(AccessType.WRITE),
    handle: ({ params, body, user }) => configureAppWebhook({ params, body, user }),
  }),
  regenerateJwt: serve('regenerateJwt', { ...xyneApps(AccessType.WRITE), handle: ({ params, user }) => regenerateAppJwt({ params, user }) }),
  signingSecret: serve('signingSecret', { ...xyneApps(AccessType.WRITE), handle: ({ params, user }) => appSigningSecret({ params, user }) }),
  botChannels: serve('botChannels', { ...xyneApps(AccessType.READ), handle: ({ params, user }) => botChannels({ params, user }) }),
  projectBoards: serve('projectBoards', { ...xyneApps(AccessType.READ), handle: ({ params, user }) => projectBoards({ params, user }) }),
  orgNames: serve('orgNames', { ...xyneApps(AccessType.READ), handle: ({ body }) => orgNames({ body }) }),

  // Per-install edits (Installed screen, workspace admin), scoped to the caller's workspace.
  installedUpdate: serve('installedUpdate', {
    ...xyneApps(AccessType.WRITE),
    handle: ({ params, body, user }) => updateInstalledApp({ params, body, user }),
  }),
  installedPermissions: serve('installedPermissions', {
    ...xyneApps(AccessType.READ),
    handle: ({ params, user }) => getInstalledPermissions({ params, user }),
  }),
  installedPermissionsSet: serve('installedPermissionsSet', {
    ...xyneApps(AccessType.WRITE),
    handle: ({ params, body, user }) => setInstalledPermissions({ params, body, user }),
  }),
  installedPermissionsActivate: serve('installedPermissionsActivate', {
    ...xyneApps(AccessType.WRITE),
    handle: ({ params, user }) => activateInstalledPermissions({ params, user }),
  }),
  installedCommands: serve('installedCommands', {
    ...xyneApps(AccessType.READ),
    handle: ({ params, query, user }) => listInstalledCommands({ params, query, user }),
  }),
  installedResources: serve('installedResources', {
    ...xyneApps(AccessType.READ),
    handle: ({ params, user }) => listAttachedResources({ params, user }),
  }),
  installedResourcesSet: serve('installedResourcesSet', {
    ...xyneApps(AccessType.ADMIN),
    handle: ({ params, body, user }) => setAttachedResources({ params, body, user }),
  }),
  installedFetchConfig: serve('installedFetchConfig', {
    ...xyneApps(AccessType.READ),
    handle: ({ params, user }) => getFetchConfig({ params, user }),
  }),
  installedFetchConfigDelete: serve('installedFetchConfigDelete', {
    ...xyneApps(AccessType.WRITE),
    handle: ({ params, user }) => deleteFetchConfig({ params, user }),
  }),

  incomingWebhooksCreate: serve('incomingWebhooksCreate', {
    ...xyneApps(AccessType.WRITE),
    successStatus: 201,
    handle: ({ body, user }) => createIncomingWebhook({ body, user }),
  }),
  incomingWebhooksList: serve('incomingWebhooksList', {
    ...xyneApps(AccessType.READ),
    handle: ({ params, query, user }) => listIncomingWebhooks({ params, query, user }),
  }),
  incomingWebhooksUpdate: serve('incomingWebhooksUpdate', {
    ...xyneApps(AccessType.WRITE),
    handle: ({ params, body, user }) => updateIncomingWebhook({ params, body, user }),
  }),
  incomingWebhooksRevoke: serve('incomingWebhooksRevoke', {
    ...xyneApps(AccessType.WRITE),
    handle: ({ params, user }) => revokeIncomingWebhook({ params, user }),
  }),

  // Commands (user auth) — the commands available in a channel; login only.
  channelCommands: serve('channelCommands', { handle: ({ params, query }) => listChannelCommands({ params, query }) }),

  // Permission management (user auth). The registry list is login only.
  permissions: serve('permissions', { handle: () => listAvailablePermissions() }),
  permissionsGet: serve('permissionsGet', { ...xyneApps(AccessType.READ), handle: ({ params }) => getAppPermissions({ params }) }),
  permissionsSet: serve('permissionsSet', {
    ...xyneApps(AccessType.WRITE),
    handle: ({ params, body, user }) => setAppPermissions({ params, body, user }),
  }),

  // Commands (user auth), per app: last, so `/:appId/commands` never captures a literal path above.
  commands: serve('commands', { ...xyneApps(AccessType.READ), handle: ({ params, query }) => listAppCommands({ params, query }) }),
  commandsCreate: serve('commandsCreate', {
    ...xyneApps(AccessType.WRITE),
    successStatus: 201,
    handle: ({ params, body, user }) => createAppCommand({ params, body, user }),
  }),
  commandsUpdate: serve('commandsUpdate', {
    ...xyneApps(AccessType.WRITE),
    handle: ({ params, body, user }) => updateAppCommand({ params, body, user }),
  }),
  commandsDelete: serve('commandsDelete', {
    ...xyneApps(AccessType.WRITE),
    handle: ({ params, query, user }) => deleteAppCommand({ params, query, user }),
  }),
}));

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

// User routes
router.use("/user", authenticateApp, userRoutes);
// Guest routes (the app's own guest users and their SDK tokens)
router.use("/guests", authenticateApp, guestRoutes);

// User Group routes
router.use("/usergroups", authenticateApp, userGroupRoutes);

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
