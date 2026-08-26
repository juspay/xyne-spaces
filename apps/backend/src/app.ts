import express, { Application, Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { webhookLimiter } from '@/middleware/rateLimiters';
import morgan from 'morgan';

import { config } from '@/config/env';
import { logger, stream } from '@/utils/logger';
import { errorHandler, notFoundHandler } from '@/middleware/errorHandler';
import { requestLogger } from '@/middleware/requestLogger';
import { tenantScopeMiddleware, workspaceScopedRoute } from '@/database/tenant/context';
import { redactSensitiveUrl } from '@/utils/redact';
import { aclMiddleware } from '@/middleware/acl';
import { authMiddleware } from '@/middleware/auth';
import { backfillMountGuard } from '@/middleware/backfillAdminAuth';
import { authenticateUserOrApp } from '@/middleware/authenticateUserOrApp';
import { verifyTranscriptionAgent } from '@/middleware/transcriptionAgentAuth';
import { requireYSweetServerToken } from '@/middleware/ysweetServerAuth';
import { DatabaseClient } from '@/database/client';
import { CommonDatabaseClient } from '@/database/commonClient';
import webhookRoutes from '@/routes/webhooks';
import jiraCompatRoutes, { JIRA_COMPAT_MOUNT } from '@/routes/jiraCompat';
import healthRoutes from '@/routes/health';
import authRoutes from '@/routes/auth';
import authV2Routes from '@/routes/authV2';
import ticketRoutes from '@/routes/tickets';
import toolRoutes from '@/routes/tools';
import agentToolsMappingRoutes from '@/routes/agent-tools-mappings';
import analyticsRoutes from '@/routes/analytics';
import apiKeyRoutes from '@/routes/api-keys';
import userManagementRoutes from '@/routes/userManagement';
import userActivationRoutes from '@/routes/userActivation';
import channelRoutes from '@/routes/channels';
import microsoftDeskAuthRoutes from '@/integrations/routes/microsoft-desk-auth';
import conversationRoutes from '@/routes/conversations';
import threadTypeVocabularyRoutes from '@/routes/threadTypeVocabulary';
import conversationLabelRoutes from '@/routes/conversationLabels';
import radarExecutionRoutes from '@/routes/radarExecution';
import organizationRoutes from '@/routes/organizations';
import invitationRoutes from '@/routes/invitations';
import communityRoutes from '@/routes/community';
import reactionRoutes from '@/routes/reactionRoutes';
import userAssignmentStateRoutes from '@/routes/userAssignmentState';
import { UserManagementController } from '@/controllers/userManagementController';
import { registerAllWorkflows } from '@/workflows';
import workflowRoutes from '@/routes/workflows';
import { configSyncService } from '@/services/configSyncService';
import { websocketService } from '@/services/websocketService';
import { redisService } from '@/services/redisService';
import { superpositionClient } from '@/services/superpositionClient';
import { metricsMiddleware } from '@/middleware/metricsMiddleware';
import { initializeOpenTelemetry, shutdownOpenTelemetry } from '@/services/otel';
import { externalSourceSyncRoutes } from '@/integrations';
import googleAuthRoutes from '@/integrations/routes/google-auth';
import deskIntegrationRoutes from '@/integrations/routes/desk-integration';
import workspaceDeskRoutes from '@/integrations/routes/workspace-desk';
import slackDeskRoutes from '@/integrations/routes/slack-desk';
import appDeskRoutes from '@/integrations/routes/app-desk';
import socialMediaRoutes from './integrations/routes/social-media.js';
import ozonetelIntegrationRoutes from '@/integrations/routes/ozonetel';
import slackUserAuthRoutes from '@/integrations/routes/slack-user-auth';
import migrationRoutes from '@/migration';
import { slackMigrationWorker } from '@/workers/slackMigrationWorker';
import { registerAllExternalSources } from '@/integrations/core/externalSourceRegistry';
import publicWorkspaceRoutes from '@/routes/publicWorkspaceRoutes';
import userRoutes from '@/routes/users';
import notificationRoutes from '@/routes/notifications';
import draftRoutes from '@/routes/draftAttachments';
import callRoutes from '@/routes/calls';
import calendarSyncRoutes from '@/routes/calendarSync';
import calendarOAuthRoutes from '@/routes/calendarOAuth';
import driveOAuthRoutes from '@/routes/driveOAuth';
import calendarWatchRoutes from '@/routes/calendarWatch';
import calendarWebhookRoutes from '@/routes/calendarWebhooks';
import callLobbyRoutes from '@/routes/callLobby';
import csatRoutes from '@/routes/csat';
import voiceInputRoutes from '@/routes/voiceInput';
import { attachVoiceInputStreamHandler } from '@/routes/voiceInputStream';
import transcriptionAgentRoutes from '@/routes/transcriptionAgent';
import livekitWebhookRoutes from '@/routes/livekitWebhook';
import zeroRoutes from '@/routes/zero';
import userHeaderOverridesRoutes from '@/routes/userHeaderOverrides';
import encryptionRoutes from '@/routes/encryption';
import userGroupRoutes from '@/routes/userGroups';
import attachmentRoutes from '@/routes/attachments';
import draftAttachmentRoutes from '@/routes/draftAttachments';
import { notificationService } from '@/notification-service';
import { scheduledCallNotificationService } from '@/services/scheduledCallNotificationService';
import { bookmarkReminderService } from '@/services/bookmarkReminderService';
import linkPreviewRoutes from '@/routes/linkPreview';
import bundleRoutes from '@/routes/bundles';
import projectRoutes from '@/routes/projects';
import ticketReportRoutes from '@/routes/ticketReports';
import boardRoutes from '@/routes/boards';
import subTicketRoutes from '@/routes/subTickets';
import boardConfigCopyRoutes from '@/routes/boardConfigCopy';
import recordingPointerBackfillRoutes from '@/routes/recordingPointerBackfill';
import searchMetricsRoutes from '@/routes/searchMetrics';
import knowledgeRoutes from '@/routes/knowledge';
import vespaSearchRoutes from '@/routes/vespaSearch';
import { dashboardClawRouter } from '@/routes/dashboardClaw';
import summarizeRoutes from '@/routes/summarize';
import xyneAIRoutes from '@/routes/xyneAI';
import cacConfigRoutes from '@/routes/cacConfig';
import lotusCacConfigRoutes from '@/routes/lotusCacConfig';
import ticketMigrationRoutes from '@/routes/ticketMigration';
import gmailWatchRenewalRoutes from '@/routes/gmailWatchRenewal';
import { registerPrivateBackfillRoutes } from '@/routes/privateBackfillRoutes';
import aiRoutes from '@/routes/aiRoutes';
import productInsightsRoutes from '@/routes/productInsights';
// import adminBackfillRoutes from '@/routes/adminBackfill';
import ysweetRoutes, { ysweetValidateRouter } from '@/routes/ysweet';
import canvasRoutes from '@/routes/canvas';
import internalCanvasRoutes from '@/routes/internalCanvas';
import { dashboardRouter, dashboardCrudRouter } from '@/routes/dashboard';
import pythonQueryRoutes from '@/routes/pythonQuery';
import formsRoutes from '@/routes/forms';
import unifiedBotRoutes from '@/routes/unifiedBotRoutes';
import emailRoutes from '@/routes/email';
import emailDemergeRoutes from '@/routes/emailDemerge';
import emailClassificationRoutes from '@/routes/emailClassification';
import deskTagsConfigRoutes from '@/routes/deskTagsConfig';
import priorityClassificationRoutes from '@/routes/priorityClassificationRoutes';
import deskMetricsRoutes from '@/routes/deskMetricsRoutes';
import deskMetricsAggregateRoutes from '@/routes/deskMetricsAggregateRoutes';
import deskMetricsClawRoutes from '@/routes/deskMetricsClawRoutes';
import deskReportPanelRoutes from '@/routes/deskReportPanelRoutes';
import aiRetriggerRoutes from '@/routes/aiRetriggerRoutes';
import testAuthRoutes from '@/routes/testAuth';
import customInstructionRoutes from '@/routes/customInstruction';
import dailyBriefRoutes from '@/routes/dailyBrief';
import userSkillsRoutes from '@/routes/userSkills';
import scheduledMessageRoutes from '@/routes/scheduledMessages';
import { tagRoutes, registerDeskEmailTags } from '@/tags';
import { tagGenerationPipeline } from '@/tags/pipeline';
import { automationRoutes, initializeAutomations } from '@/automations';
import { handleClawCallback } from '@/automations/routes/claw-callback.handler';
import sdlcWikiInternalRoutes from '@/routes/sdlcWikiInternal';
import sdlcArtifactVersionsInternalRoutes from '@/routes/sdlcArtifactVersionsInternal';
import { handleAutoDraftCallback } from '@/controllers/autodraftCallback.handler';
import { handleDeskReportCallback } from '@/controllers/deskReportCallback.handler';
import automationWebhookRoutes from '@/automations/routes/webhook-trigger.handler';
import activityLogRoutes from '@/routes/activityLog';
import userActivityRoutes from '@/routes/userActivity';
import activityAliasesRoutes from '@/routes/activityAliases';
import commitAnalysisRoutes from '@/routes/commitAnalysis';
import meetCallbackRoutes from '@/routes/meetCallback';
import samRoutes from '@/routes/sam';
import mettleUserSyncRoutes from '@/routes/mettleUserSync';
import mettleTeamMembersRoutes from '@/routes/mettleTeamMembersRoutes';
import teamIntelligenceRoutes from '@/team-intelligence/routes';
import teamIntelligenceDashboardRoutes from '@/routes/teamIntelligenceDashboard';
import teamIntelligenceTeamDashboardRoutes from '@/routes/teamIntelligenceTeamDashboard';
import teamIntelligenceUserDashboardRoutes from '@/routes/teamIntelligenceUserDashboard';
import mettleEmployeeDetailsRoutes from '@/routes/mettleEmployeeDetailsRoutes';
import memoryRoutes from '@/routes/memory';
import queueManagementRoutes from '@/routes/clearqueueManagement';
import { initializeBotRegistry } from '@/bots/registry';
import { unifiedBotUserService, botCatalog } from '@/bots/unified/index.js';
import { modelSyncQueue } from '@/queues/modelSyncQueue';
import { presenceCleanupQueue } from '@/queues/presenceCleanupQueue';
import { microsoftCalendarSyncQueue } from '@/queues/microsoftCalendarSyncQueue';
import { googleCalendarSyncQueue } from '@/queues/googleCalendarSyncQueue';
import { warmUserRegistryQueue } from '@/queues/warmUserRegistryQueue';
import { watchRenewalQueue } from '@/pubsub';
import { etaDeadlineQueue } from '@/queues/etaDeadlineQueue';
import { stageEtaDeadlineQueue } from '@/queues/stageEtaDeadlineQueue';
import { boardConfigCopyQueue } from '@/queues/boardConfigCopyQueue';
import { boardConfigCopyWorker } from '@/workers/boardConfigCopyWorker';
import { assignmentReactivationQueue } from '@/queues/assignmentReactivationQueue';
import { ticketReassignmentQueue } from '@/queues/ticketReassignmentQueue';
import { onCallRotationQueue } from '@/queues/onCallRotationQueue';
import { scheduledMessageQueue } from '@/queues/scheduledMessageQueue';
import { conversationIngestQueue } from '@/queues/conversationIngestQueue';
import { documentIngestQueue } from '@/queues/documentIngestQueue';
import { teamIntelligenceQueue } from '@/team-intelligence/queue';
import { emailClassificationQueue } from '@/queues/emailClassificationQueue';
import { autoDraftQueue } from '@/queues/autoDraftQueue';
import { entityExtractionQueue } from '@/queues/entityExtractionQueue';
import { sdlcQueue } from '@/queues/sdlcQueue';
import { initStorage } from '@/services/storage';

import queryRoutes from '@/routes/query';
import { GenericFieldRegistry } from '@/services/queryService/genericFieldRegistry';
import emojiRoutes from '@/routes/emojis';
import { appRoutes } from '@/apps';
import { ChatController } from '@/apps/controllers/chatController';
import { ReactionController } from '@/controllers/reactionController';
import { unifiedDMService } from '@/bots/unified/services/unified-dm-service';
import { coerceTwinReplyDraft, destinationNameLookup, createTwinReplyDraft } from '@/services/twinReplyDraftService';
import userMigrationRoutes from '@/routes/userMigration';
import { decryptRequestBodyMiddleware, encryptResponseBodyMiddleware } from './middleware/decryptionMiddleware';
import internalRoutes from '@/routes/internal';
import collectionsRoutes from '@/routes/collections';
import officeConversionRoutes from '@/routes/officeConversion';
import sdlcRoutes from '@/routes/sdlc';
import sdlcClawRoutes from '@/routes/sdlcClaw';
import sdlcVcsInternalRoutes from '@/routes/sdlcVcsInternal';
import { handleSdlcClawCallback } from '@/sdlc/SdlcClawCallback';
import { createSdkPublicRouter, createSdkRouter } from '@/api/sdk';
import { errorHandler as sdkErrorHandler } from '@/api/sdk/handler';
import { sdkConfig } from '@/api/sdk/config';
import { apiKeyAuth } from '@/middleware/sdkApiKeyAuth';
import sdkKeyRoutes from '@/routes/sdk-keys';
import sdkSsoRoutes from '@/routes/sdk-sso';


export class App {
  public app: Application;
  public httpServer: HttpServer;

  constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddlewares(): void {

    const apiPathPrefix = config.apiPathPrefix;
    if (apiPathPrefix) {
      this.app.use((req: Request, _res: Response, next: express.NextFunction): void => {
        const url = req.url;
        const isPrefixed =
          url === apiPathPrefix ||
          url.startsWith(`${apiPathPrefix}/`) ||
          url.startsWith(`${apiPathPrefix}?`);
        if (isPrefixed) {
          req.url = `/api${url.slice(apiPathPrefix.length)}`;
          req.originalUrl = req.url;
        }
        next();
      });
    }

    // Security middleware
    this.app.use(helmet());

    // Cookie parser (must be before routes that use cookies)
    this.app.use(cookieParser());

    // CORS
    this.app.use(
      cors({
        origin: config.cors.origin,
        credentials: true,
      })
    );

    // Rate limiting
    // const limiter = rateLimit({
    //   windowMs: config.rateLimit.windowMs,
    //   max: config.rateLimit.max,
    //   message: {
    //     success: false,
    //     error: 'Too many requests from this IP, please try again later.',
    //     timestamp: new Date().toISOString(),
    //   },
    // });
    // this.app.use(limiter);

    // Compression - skip SSE endpoints to allow streaming
    this.app.use(
      compression({
        filter: (req, res) => {
          // Don't compress SSE responses - they need to stream immediately
          if (req.headers.accept === 'text/event-stream') {
            return false;
          }
          // Use default compression filter for other requests
          return compression.filter(req, res);
        },
      })
    );

    this.app.use(metricsMiddleware);

    // Logging
    if (config.env !== 'test') {
      morgan.token('url', req =>
        redactSensitiveUrl((req as { originalUrl?: string; url?: string }).originalUrl ?? (req as { url?: string }).url),
      );
      this.app.use(morgan('combined', { stream }));
    }
    this.app.use(requestLogger);

    // Open a request-backed tenant scope for every route, once, here. Auth-agnostic:
    // resolves req.user lazily at DB-call time so the workspaceId stamper can read it.
    this.app.use(tenantScopeMiddleware);
  }

  private initializeRoutes(): void {
    // Public routes (no ACL protection)

    // External source sync routes (body parsing handled in route file)
    //Don't add any middleware here, add in api/external-source-sync.ts file otherwise API will not work.
    this.app.use('/api/external-source-sync', externalSourceSyncRoutes);

    // Google OAuth routes (public - no auth required)
    this.app.use('/api/integrations/google', googleAuthRoutes);

    // Desk integration management (disconnect / reconnect-init) — auth-gated
    // per-route via the desk-owner check inside each handler.
    this.app.use('/api/integrations/desk', deskIntegrationRoutes);
    this.app.use('/api/integrations/workspace-desk', workspaceDeskRoutes);
    this.app.use('/api/integrations/slack-desk', slackDeskRoutes);
    this.app.use('/api/integrations/app-desk', appDeskRoutes);
    this.app.use('/api/integrations/social-media', socialMediaRoutes);
    this.app.use('/api/integrations/ozonetel', authMiddleware.authenticate, ozonetelIntegrationRoutes);
    this.app.use('/api/integrations/slack-user', slackUserAuthRoutes);

    // Migration routes (body parsing handled in route file)
    this.app.use('/api/migration', migrationRoutes);

    this.app.use('/migrate/api/migration', migrationRoutes);

    // JIRA-compatibility facade (public, read-only): lets Bitbucket linkify
    // Spaces ticket keys (e.g. TTS-0001) and route /browse/<KEY> to the Spaces
    // ticket instead of Atlassian JIRA. Mounted UNDER the existing per-workspace
    // Bitbucket webhook path (the only path the ingress forwards), so the
    // Application Link base URL is <host>/api/webhooks/bitbucket/<workspaceId>
    // and Bitbucket appends /rest/* and /browse/*.
    //
    // Ordering matters: this must stay BEFORE the /api/webhooks raw-body mount.
    // The shim defines only GET routes, so the webhook POST /bitbucket/:workspaceId
    // matches no route here (Express matches method AND path) and falls through to
    // the HMAC-verified handler below. Deliberately NO express.raw — buffering the
    // body here would leave the webhook's raw parser with an empty stream and break
    // its HMAC check. Endpoints are unauthenticated (Bitbucket is external, no
    // client cert) and workspace-scoped; restrict to Bitbucket egress IPs at the
    // ingress if the project-code / ticket-title exposure is a concern.
    this.app.use(JIRA_COMPAT_MOUNT,
      webhookLimiter,

      jiraCompatRoutes);

    // Webhook routes with webhook rate limiter (applied before general rate limiter)
    this.app.use('/api/webhooks',
      express.raw({ type: 'application/json' }),
      webhookLimiter,

      webhookRoutes);

    // Calendar webhook routes (needs JSON body parsing for Microsoft notifications)
    this.app.use('/api/calendar/webhooks', express.json(), webhookLimiter, calendarWebhookRoutes);

    // LiveKit webhook routes (MUST be before body parser for raw body signature verification)
    this.app.use('/api/livekit', livekitWebhookRoutes);

    // Body parsing for all other routes (10mb limit)
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use(decryptRequestBodyMiddleware);
    this.app.use(encryptResponseBodyMiddleware);

    // Public SDK API. It authenticates its own API keys, so it must be mounted
    // before the legacy catch-all `/api` session middleware. When disabled,
    // nothing is mounted here and a request falls through to the app's own
    // `notFoundHandler` further down.
    //
    // Two routers at the same prefix: the public one (version/health) is
    // tried first and falls through on no match, then `apiKeyAuth` runs for
    // everything else — mirroring how `/api/sdk-keys` below passes its own
    // auth explicitly, rather than hiding it inside the router. The trailing
    // `sdkErrorHandler` is what still gives an `apiKeyAuth` failure the SDK's
    // own error envelope: that failure happens before the protected router is
    // ever entered, so an error handler defined inside it would never see it.
    if (sdkConfig.enabled) {
      // SDK SSO device flow routes MUST be mounted first (before apiKeyAuth).
      // These have mixed auth: init/poll are public, status/approve need session.
      this.app.use('/api/sdk/auth/sso', sdkSsoRoutes);
      logger.info('SDK SSO routes mounted at /api/sdk/auth/sso');

      this.app.use('/api/sdk', createSdkPublicRouter());
      this.app.use('/api/sdk', apiKeyAuth, createSdkRouter(), sdkErrorHandler);
      logger.info('Public SDK API mounted at /api/sdk');

      // Where those keys are minted. Session-authenticated, not key-authenticated:
      // you cannot use an API key to mint another one.
      this.app.use('/api/sdk-keys', authMiddleware.authenticate, sdkKeyRoutes);
    }

    this.app.use('/api/automation-webhooks', webhookLimiter, automationWebhookRoutes);

    // Claw MCP route (user + app auth) — must be before /api/query
    this.app.use('/api/query/claw', authenticateUserOrApp, pythonQueryRoutes);
    this.app.use('/api/query', authMiddleware.authenticate, pythonQueryRoutes);

    // Commit analysis routes (auth and ACL required)
    this.app.use('/api/commits/analyze', authMiddleware.authenticate, commitAnalysisRoutes);

    this.app.use('/api/health', healthRoutes);
    this.app.use('/api/email', emailRoutes);
    this.app.use('/api/email', emailDemergeRoutes);
    this.app.use('/api/channels/:channelId/classification', authMiddleware.authenticate, emailClassificationRoutes);
    this.app.use('/api/channels/:channelId/tags-config', authMiddleware.authenticate, deskTagsConfigRoutes);
    this.app.use('/api/channels/:channelId/priority-classification', authMiddleware.authenticate, priorityClassificationRoutes);
    this.app.use('/api/channels/:channelId/metrics', authMiddleware.authenticate, deskMetricsRoutes);
    this.app.use('/api/desk-metrics/claw', authenticateUserOrApp, deskMetricsClawRoutes);
    this.app.use('/api/desk-metrics', authMiddleware.authenticate, deskMetricsAggregateRoutes);
    this.app.use('/api/desk-report', authMiddleware.authenticate, deskReportPanelRoutes);
    this.app.use('/api/channels/:channelId/ai-retrigger', authMiddleware.authenticate, aiRetriggerRoutes);

    // Meet callback route (API key auth - called by SAM service)
    this.app.use('/api/meet', meetCallbackRoutes);

    // SAM transcript ingestion route (API key auth - called by SAM/Pragati service)
    this.app.use('/api/sam/', samRoutes);

    // Mettle user sync route (API key auth - called by Mettle)
    this.app.use('/api/mettle', mettleUserSyncRoutes);

    // Mettle team members lookup route (authenticated wrapper around external Mettle API)
    this.app.use('/api/mettle/team-members', authMiddleware.authenticate, mettleTeamMembersRoutes);

    // Team intelligence sync route (S2S auth - called by Mettle)
    this.app.use('/api/team-intelligence', teamIntelligenceRoutes);

    // Team intelligence dashboard routes (JWT auth - called by dashboard)
    this.app.use('/api/team-intelligence-dashboard/org', authMiddleware.authenticate, aclMiddleware.checkAccess, teamIntelligenceDashboardRoutes);
    this.app.use('/api/team-intelligence-dashboard/team', authMiddleware.authenticate, aclMiddleware.checkAccess, teamIntelligenceTeamDashboardRoutes);
    this.app.use('/api/team-intelligence-dashboard/user', authMiddleware.authenticate, aclMiddleware.checkAccess, teamIntelligenceUserDashboardRoutes);

    // Mettle employee details route (JWT auth - fetch employee information)
    this.app.use('/api/mettle/employee', authMiddleware.authenticate, mettleEmployeeDetailsRoutes);

    // Bundle serving routes (public, no auth required - frontend static assets)
    this.app.use('/api/bundles', bundleRoutes);

    // External call lobby — PUBLIC, no auth middleware
    this.app.use('/api/call-lobby', callLobbyRoutes);

    // CSAT satisfaction survey — PUBLIC, no auth middleware, but requires a signed per-ticket token
    this.app.use('/api/csat', csatRoutes);

    this.app.use('/api/transcriptionAgent', verifyTranscriptionAgent, transcriptionAgentRoutes);

    this.app.use('/api/admin', backfillMountGuard);
    this.app.use('/migrate/api/admin', backfillMountGuard);

    // Internal-only migration/backfill admin routes (Postman/curl-invoked one-off
    // data-fix endpoints, not part of the public product). Real implementation
    // lives in the private overlay repo; the checked-in stub here no-ops when
    // it isn't present (i.e. in a standalone public build).
    registerPrivateBackfillRoutes(this.app);

    // Ticket migration route (admin-only)
    this.app.use('/api/admin/migrate-tickets-xyneid', workspaceScopedRoute, ticketMigrationRoutes);
    this.app.use('/api/admin/gmail-watch-renewal', workspaceScopedRoute, gmailWatchRenewalRoutes);
    this.app.use('/api/admin/board-config-copy', workspaceScopedRoute, boardConfigCopyRoutes);
    // No workspaceScopedRoute: the controller opens its own runAsSystem scope, since
    // this one-off repair links summary canvases across every workspace. The
    // '-backfill' path suffix also puts it behind backfillMountGuard above.
    this.app.use('/api/admin/recording-pointer-backfill', recordingPointerBackfillRoutes);
    // Same shape: the one-off SDLC multi-repo data migration spans every workspace,
    // so it opens its own runAsSystem scope rather than taking workspaceScopedRoute.

    this.app.use('/migrate/api/users-data-migration', authMiddleware.authenticate, userMigrationRoutes);

    // Apply general rate limiter to all API routes from this point onward

    // Test-only routes - only register when NODE_ENV=test
    // Test auth routes - used for CI automation testing and sandbox environments
    const enableDevAuth = process.env.ENABLE_DEV_AUTH === 'true' && process.env.NODE_ENV === 'development';
    if (config.isTestEnv || enableDevAuth) {
      logger.info('Registering test routes (/api/test/*)');
      this.app.use('/api/test', testAuthRoutes);
    }

    // Apply general rate limiter to all API routes from this point onward
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/v2/auth', authV2Routes);
    this.app.use('/api/community', communityRoutes);
    this.app.use('/api/bots', unifiedBotRoutes); // Unified bot framework routes
    this.app.use('/api/public', publicWorkspaceRoutes);

    // Protected routes (auth first, then ACL middleware)
    // Claw MCP route (user + app auth) — must be before /api/tickets
    this.app.use('/api/tickets/claw', authenticateUserOrApp, ticketRoutes);
    this.app.use(
      '/api/tickets',
      authMiddleware.authenticate,
      aclMiddleware.checkAccess,
      ticketRoutes
    );
    this.app.use(
      '/api/ticket-reports',
      authMiddleware.authenticate,
      aclMiddleware.checkAccess,
      ticketReportRoutes
    );
    this.app.use(
      '/api/workflows',
      authMiddleware.authenticate,
      aclMiddleware.checkAccess,
      workflowRoutes
    );
    this.app.use('/api/tools', authMiddleware.authenticate, aclMiddleware.checkAccess, toolRoutes);
    this.app.use(
      '/api/agent-tools-mappings',
      authMiddleware.authenticate,
      aclMiddleware.checkAccess,
      agentToolsMappingRoutes
    );
    this.app.use('/api/analytics', authMiddleware.authenticate, analyticsRoutes);
    this.app.use('/api/queues', authMiddleware.authenticate, queueManagementRoutes);

    // Chat routes (auth only, no ACL for now)

    // New chat schema routes
    this.app.use('/api/integrations/microsoft', microsoftDeskAuthRoutes); // Microsoft email channel OAuth (auth handled per-route)
    this.app.use('/api/channels', authMiddleware.authenticate, channelRoutes);
    // Claw MCP route (user + app auth) — must be before /api/conversations
    this.app.use('/api/conversations/claw', authenticateUserOrApp, conversationRoutes);
    this.app.use('/api/conversations', authMiddleware.authenticate, conversationRoutes);
    this.app.use('/api/conversation-labels', authMiddleware.authenticate, conversationLabelRoutes);
    this.app.use('/api/radar', authMiddleware.authenticate, radarExecutionRoutes);
    this.app.use('/api/organizations', authMiddleware.authenticate, organizationRoutes);
    this.app.use('/api/invitations', invitationRoutes);
    this.app.use('/api/users', authMiddleware.authenticate, userRoutes);
    this.app.use('/api/user-groups', authMiddleware.authenticate, userGroupRoutes); // User groups (teams)
    this.app.use('/api/forms', authMiddleware.authenticate, formsRoutes); // Forms routes
    this.app.use('/api/zero', zeroRoutes); // Zero sync routes (uses authenticateZero middleware in route file)
    this.app.use('/api/client-events', userHeaderOverridesRoutes); // Common client-command events + header overrides (auth in route file)
    this.app.use('/api/encryption', authMiddleware.authenticate, encryptionRoutes);

    this.app.use('/api/messages', authMiddleware.authenticate, reactionRoutes);

    // Claw MCP route (user + app auth) — must be before /api/calls
    this.app.use('/api/calls/claw', authenticateUserOrApp, callRoutes);
    this.app.use('/api/calls', authMiddleware.authenticate, callRoutes); // Calling feature routes
    this.app.use('/api/calendar/oauth', calendarOAuthRoutes); // Calendar-only OAuth (init is authenticated; callbacks use bound state)
    this.app.use('/api/drive/oauth', driveOAuthRoutes); // KB Drive import OAuth (init is authenticated; callback uses bound state)
    this.app.use('/api/calendar/sync', authMiddleware.authenticate, calendarSyncRoutes); // Calendar manual sync
    this.app.use('/api/calendar/watch', authMiddleware.authenticate, calendarWatchRoutes); // Calendar watch setup
    this.app.use('/api/voice-input', authMiddleware.authenticate, voiceInputRoutes); // Low-latency chat voice input

    // App routes
    this.app.use('/api/apps', appRoutes);

    // Internal S2S endpoints (trusted service-to-service calls)
    const validateS2SKey = (req: Request, res: Response, next: express.NextFunction): void => {
      const supplied = req.headers['x-s2s-key'];
      const accepted = [process.env['INTERNAL_S2S_KEY'], config.xyneClaw.s2sKey].filter(Boolean);
      if (accepted.length === 0 || !accepted.includes(String(supplied || ''))) {
        res.status(401).json({ error: 'Invalid or missing S2S key' });
        return;
      }
      next();
    };

    this.app.post('/api/internal/postAsUser', validateS2SKey, (req: Request, res: Response) => {
      // Mark this request so ChatController.postMessage persists the message as a
      // USER message (posted on behalf of a real human) rather than a BOT message.
      // Only the trusted S2S postAsUser route sets this; app-token callers never do.
      (req as Request & { isPostAsUser?: boolean }).isPostAsUser = true;
      void new ChatController().postMessage(req, res);
    });
    this.app.post('/api/internal/reactAsUser', validateS2SKey, (req: Request, res: Response) => {
      void new ReactionController().reactAsUser(req, res);
    });
    this.app.post('/api/internal/getOrCreateDm', validateS2SKey, async (req: Request, res: Response) => {
      try {
        const { userId, targetUserId, workspaceId } = (req.body ?? {}) as {
          userId?: string; targetUserId?: string; workspaceId?: string;
        };
        if (!userId || !targetUserId || !workspaceId) {
          res.status(400).json({ error: 'userId, targetUserId and workspaceId are required' });
          return;
        }
        const channelId = await unifiedDMService.getOrCreateDirectMessage(userId, targetUserId, workspaceId);
        res.json({ channelId });
      } catch (err) {
        logger.error('[getOrCreateDm] failed', err);
        res.status(500).json({ error: 'Internal error' });
      }
    });
    this.app.post('/api/internal/twin-reply-draft', validateS2SKey, async (req: Request, res: Response) => {
      try {
        const parsed = coerceTwinReplyDraft(req.body);
        if ('error' in parsed) {
          res.status(400).json({ error: parsed.error });
          return;
        }
        const lookup = destinationNameLookup(parsed.draft);
        if (lookup) {
          try {
            const prisma = DatabaseClient.getInstance();
            if (lookup.field === 'destinationChannelName') {
              const chan = await prisma.channel.findUnique({ where: { id: lookup.id }, select: { name: true } });
              if (chan?.name) parsed.draft.destinationChannelName = chan.name;
            } else {
              const target = await prisma.user.findUnique({ where: { id: lookup.id }, select: { name: true, displayName: true } });
              const name = target?.displayName || target?.name;
              if (name) parsed.draft.destinationUserName = name;
            }
          } catch (err) {
            logger.warn('[twin-reply-draft] destination name resolution failed', err);
          }
        }
        await createTwinReplyDraft(parsed.draft);
        res.json({ ok: true });
      } catch (err) {
        logger.error('[twin-reply-draft] create failed', err);
        res.status(500).json({ error: 'Internal error' });
      }
    });
    this.app.post(
      '/api/internal/automations/claw-callback/:executionId/:stepName',
      validateS2SKey,
      handleClawCallback,
    );
    this.app.post(
      '/api/internal/email/autodraft-callback/:conversationId/:channelId',
      validateS2SKey,
      handleAutoDraftCallback,
    );
    this.app.post(
      '/api/internal/sdlc/claw-callback/:executionId/:step',
      validateS2SKey,
      handleSdlcClawCallback,
    );
    this.app.use('/api/internal/sdlc/vcs', validateS2SKey, sdlcVcsInternalRoutes);
    this.app.use('/api/internal/sdlc/wiki', validateS2SKey, sdlcWikiInternalRoutes);
    this.app.use(
      '/api/internal/sdlc/artifact-versions',
      validateS2SKey,
      sdlcArtifactVersionsInternalRoutes
    );
    this.app.post(
      '/api/internal/desk-report/callback/:channelId/:attachmentId',
      validateS2SKey,
      handleDeskReportCallback,
    );

    // Internal canvas read/update (S2S-only, used by MCP tools)
    this.app.use('/api/internal/canvas', internalCanvasRoutes);
    this.app.use('/api/canvas/claw', authenticateUserOrApp, canvasRoutes);
    this.app.use('/api/vespaSearch/claw', authenticateUserOrApp, vespaSearchRoutes);
    this.app.use('/api/dashboard/claw', authenticateUserOrApp, dashboardClawRouter);


    // No user session here — the caller is the y-sweet server itself, gated
    // by the shared Y_SWEET_SERVER_TOKEN instead of authMiddleware.
    this.app.use('/api/ysweet/validate', requireYSweetServerToken, ysweetValidateRouter);
    this.app.use('/api', authMiddleware.authenticate, attachmentRoutes); // Attachment routes (file streaming)
    this.app.use('/api', authMiddleware.authenticate, draftAttachmentRoutes); // Draft attachment upload routes
    this.app.use('/api/link-preview', authMiddleware.authenticate, linkPreviewRoutes); // Link preview routes
    this.app.use('/api/search-metrics', authMiddleware.authenticate, searchMetricsRoutes); // Search metrics routes (POST /api/search-metrics/...)

    // API Key management routes (admin only, no ACL needed as it has requireAdmin middleware)
    this.app.use('/api/admin/api-keys', apiKeyRoutes);

    // User management routes - admin operations with ACL protection
    this.app.use(
      '/api/user-management',
      authMiddleware.authenticate,
      aclMiddleware.checkAccess,
      userManagementRoutes
    );

    // user deactivation from dashboard 
    this.app.use('/api/user-activation', userActivationRoutes);

    // Project routes (auth and ACL required)
    this.app.use('/api/projects', authMiddleware.authenticate, projectRoutes);
    this.app.use('/api/sdlc/claw', authenticateUserOrApp, sdlcClawRoutes);
    this.app.use('/api/sdlc', authMiddleware.authenticate, sdlcRoutes);

    // Board routes (auth and ACL required)
    this.app.use('/api/boards', authMiddleware.authenticate, boardRoutes);
    this.app.use('/api/sub-tickets', authMiddleware.authenticate, subTicketRoutes);

    // Knowledge routes (auth required)
    this.app.use('/api/knowledge', authMiddleware.authenticate, knowledgeRoutes);

    // Memory routes (auth handled internally by dualAuthenticate middleware)
    this.app.use('/api/memory', memoryRoutes);

    this.app.use('/api/ysweet', ysweetRoutes);
    // AI routes (auth required)
    this.app.use('/api/ai', authMiddleware.authenticate, aiRoutes);

    // Generic query route (auth required)
    this.app.use('/api/analytics-query', authMiddleware.authenticate, queryRoutes);

    // Canvas file upload routes (auth required)
    this.app.use('/api/canvas', authMiddleware.authenticate, canvasRoutes);

    this.app.use('/api/dashboard', authMiddleware.authenticate, dashboardRouter);

    this.app.use('/api/dashboards', authMiddleware.authenticate, dashboardCrudRouter);

    // Custom emoji routes (auth required)
    this.app.use('/api/emojis', authMiddleware.authenticate, emojiRoutes);

    // Summarization routes (auth required, uses JAF agent)
    this.app.use('/api/summarize', authMiddleware.authenticate, summarizeRoutes);

    // Xyne AI routes (unified AI assistant with context awareness)
    this.app.use('/api/xyne-ai', authMiddleware.authenticate, xyneAIRoutes);

    // Generic CAC config routes
    this.app.use('/api/cac-config', authMiddleware.authenticate, cacConfigRoutes);

    this.app.use('/api/lotus-config', authMiddleware.authenticate, lotusCacConfigRoutes);

    // Custom instruction routes (auth required)
    this.app.use('/api/custom-instruction', customInstructionRoutes);

    // Daily Brief routes (auth required) — proxies to xyne-claw-auth
    this.app.use('/api/daily-brief', authMiddleware.authenticate, dailyBriefRoutes);

    // User skills routes (auth required)
    this.app.use('/api/user-skills', authMiddleware.authenticate, userSkillsRoutes);

    // Scheduled messages routes (auth required)
    this.app.use('/api/scheduled-messages', authMiddleware.authenticate, scheduledMessageRoutes);

    // Generic tag routes (auth applied per-route within tagRoutes)
    this.app.use('/api/tags', tagRoutes);

    // Automations routes (auth required, no ACL — matches /api/calls)
    this.app.use('/api/automations', authMiddleware.authenticate, automationRoutes);

    // Collections routes
    this.app.use('/api/collections', authMiddleware.authenticate, collectionsRoutes);

    // Office document (pptx, docx, ...) -> PDF conversion, via LibreOffice.
    // Stateless: takes uploaded bytes, returns converted bytes, touches no stored data.
    this.app.use('/api/office-conversion', authMiddleware.authenticate, officeConversionRoutes);

    // Activity logging routes (auth required)
    this.app.use('/api/activity', authMiddleware.authenticate, activityLogRoutes);

    // User activity routes (auth required)
    this.app.use('/api/user-activity', authMiddleware.authenticate, userActivityRoutes);

    this.app.use('/api/activity-aliases', authMiddleware.authenticate, activityAliasesRoutes);

    // Chat routes (auth only, no ACL for now)

    // New chat schema routes
    this.app.use('/api/channels', authMiddleware.authenticate, channelRoutes);
    this.app.use('/api/conversations', authMiddleware.authenticate, conversationRoutes);
    this.app.use('/api/thread-type-vocabulary', authMiddleware.authenticate, threadTypeVocabularyRoutes);
    this.app.use('/api/organizations', authMiddleware.authenticate, organizationRoutes);
    this.app.use('/api/users', authMiddleware.authenticate, userRoutes);
    this.app.use('/api/user-groups', authMiddleware.authenticate, userGroupRoutes); // User groups (teams)
    this.app.use('/api/user-assignment-state', userAssignmentStateRoutes); // User assignment state routes (auth handled in route file)
    // this.app.use('/api/messages', authMiddleware.authenticate, reactionRoutes); // Reactions routes
    this.app.use('/api/notifications', notificationRoutes); // Notification routes

    //Draft routes
    this.app.use('/api/drafts', authMiddleware.authenticate, draftRoutes);

    // Vespa search routes (auth required)
    this.app.use('/api/vespaSearch', authMiddleware.authenticate, vespaSearchRoutes);

    // Product Insights routes (auth and ACL required)
    this.app.use('/api/productInsights', authMiddleware.authenticate, productInsightsRoutes);

    // API Key management routes (admin only, no ACL needed as it has requireAdmin middleware)
    this.app.use('/api/admin/api-keys', apiKeyRoutes);

    // API Key test route
    this.app.use('/api/test/api-key', apiKeyRoutes);
    // User management routes - /users endpoint without ACL, others with ACL
    const userManagementController = UserManagementController.getInstance();
    this.app.get(
      '/api/user-management/users',
      authMiddleware.authenticate,
      userManagementController.getAllUsers
    );
    this.app.use(
      '/api/user-management',
      authMiddleware.authenticate,
      aclMiddleware.checkAccess,
      userManagementRoutes
    );

    this.app.use('/internal', internalRoutes);

  }

  private initializeErrorHandling(): void {
    // 404 handler
    this.app.use(notFoundHandler);

    // Global error handler
    this.app.use(errorHandler);
  }

  public async initializeDatabase(): Promise<void> {
    try {
      await DatabaseClient.connect();
      const isCommonDatabaseConnected = await CommonDatabaseClient.connect();
      logger.info('Database initialization completed', {
        mainDatabase: 'connected',
        commonDatabase: isCommonDatabaseConnected ? 'connected' : 'unavailable',
      });
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  public async listen(): Promise<void> {
    // Initialize metrics
    initializeOpenTelemetry();

    // Phase 2 Optimization: Parallelize initialization in TEST environment only
    const isTestEnv = config.isTestEnv || process.env.NODE_ENV === 'test';

    if (isTestEnv) {
      logger.info('[TEST MODE] Starting parallel initialization of core services...');

      // Group 1: Parallelize independent operations (DB, Redis, Storage)
      await Promise.all([
        (async () => {
          await this.initializeDatabase();
        })(),
        (async () => {
          logger.info('Initializing Redis connection...');
          await redisService.connect();
        })(),
        (async () => {
          logger.info('Initializing storage bucket...');
          await initStorage();
        })(),
      ]);

      logger.info('[TEST MODE] Core services initialized (DB, Redis, Storage)');

      // Group 2: DB-dependent operations (run after DB is ready)
      logger.info('Initializing query service schema cache...');
      await GenericFieldRegistry.initialize();

      // Group 3: Parallelize all Redis-dependent queue initializations
      logger.info('[TEST MODE] Initializing queues in parallel...');
      await Promise.all([
        (async () => {
          logger.info('Initializing presence cleanup queue...');
          await presenceCleanupQueue.initialize();
        })(),
        (async () => {
          logger.info('Initializing ETA deadline queue...');
          await etaDeadlineQueue.initialize();
        })(),
        (async () => {
          logger.info('Initializing stage ETA deadline queue...');
          await stageEtaDeadlineQueue.initialize();
        })(),
        (async () => {
          logger.info('Initializing board config copy queue...');
          await boardConfigCopyQueue.initialize();
          boardConfigCopyWorker.start();
        })(),
        (async () => {
          logger.info('Initializing assignment reactivation queue...');
          await assignmentReactivationQueue.initialize();
        })(),
        (async () => {
          logger.info('Initializing ticket reassignment queue...');
          await ticketReassignmentQueue.initialize();
        })(),
        (async () => {
          logger.info('Initializing on-call rotation queue...');
          await onCallRotationQueue.initialize();
        })(),
        (async () => {
          logger.info('Initializing scheduled message queue...');
          await scheduledMessageQueue.initialize();
        })(),
        (async () => {
          logger.info('Initializing team intelligence queue...');
          await teamIntelligenceQueue.initialize();
        })(),
        (async () => {
          logger.info('Initializing email classification queue...');
          await emailClassificationQueue.initialize();
        })(),
      ]);

      logger.info('[TEST MODE] All queues initialized');
    } else {
      // Production/Dev: Keep sequential initialization (proven stable)
      await this.initializeDatabase();

      logger.info('Initializing query service schema cache...');
      await GenericFieldRegistry.initialize();

      logger.info('Initializing Redis connection...');
      await redisService.connect();

      await initStorage();

      logger.info('Initializing presence cleanup queue...');
      await presenceCleanupQueue.initialize();

      logger.info('Initializing ETA deadline queue...');
      await etaDeadlineQueue.initialize();

      logger.info('Initializing stage ETA deadline queue...');
      await stageEtaDeadlineQueue.initialize();

      logger.info('Initializing board config copy queue...');
      await boardConfigCopyQueue.initialize();
      boardConfigCopyWorker.start();

      logger.info('Initializing assignment reactivation queue...');
      await assignmentReactivationQueue.initialize();

      logger.info('Initializing ticket reassignment queue...');
      await ticketReassignmentQueue.initialize();

      logger.info('Initializing on-call rotation queue...');
      await onCallRotationQueue.initialize();

      logger.info('Initializing scheduled message queue...');
      await scheduledMessageQueue.initialize();

      logger.info('Initializing team intelligence queue...');
      await teamIntelligenceQueue.initialize();

      logger.info('Initializing email classification queue...');
      await emailClassificationQueue.initialize();

      // Producer only — messages are enqueued here at ingest; the worker (a
      // separate process) drains each thread once its debounce window elapses.
      logger.info('Initializing entity extraction queue...');
      await entityExtractionQueue.initialize();

      logger.info('Initializing auto draft queue...');
      await autoDraftQueue.initialize();
    }

    logger.info('Initializing SDLC queue (producer)...');
    await sdlcQueue.initialize();

    logger.info('Initializing automations module (registries + queue producers)...');
    await initializeAutomations();

    // Initialize WebSocket server
    logger.info('Initializing WebSocket server...');
    websocketService.initialize(this.httpServer);
    attachVoiceInputStreamHandler(this.httpServer);

    // Initialize notification service
    logger.info('Initializing notification service...');
    await notificationService.initialize();

    // Initialize scheduled call notification service
    logger.info('Initializing scheduled call notification service...');
    await scheduledCallNotificationService.initialize();

    // Initialize bookmark reminder service
    logger.info('Initializing bookmark reminder service...');
    await bookmarkReminderService.initialize();

    // Ensure default model and tools exist before synchronizing config
    await configSyncService.ensureDefaultModelAndTools();

    // Synchronize config.json with database before starting other services
    logger.info('Synchronizing configuration with database...');
    await configSyncService.syncConfigWithDatabase();

    // Initialize and start model sync queue (Bull-based scheduling)
    // Only run when LiteLLM is configured; otherwise there is nothing to sync
    // and we must not fire requests to LiteLLM (e.g. local `pnpm run dev`).
    if (config.litellm.apiKey && config.litellm.baseUrl) {
      logger.info('Initializing model sync queue...');
      await modelSyncQueue.initialize();
      await modelSyncQueue.runInitialSync();
    } else {
      logger.info(
        'Skipping model sync queue: LITELLM_API_KEY / LITELLM_BASE_URL not configured',
      );
    }

    // Initialize calendar sync queues as PRODUCERS only. The calendar webhook
    // routes live here and must stay here (they are the publicly reachable
    // endpoints Google/Microsoft push to), but the sync work they enqueue is
    // drained by the worker process — see ENABLE_CALENDAR_SYNC_WORKER.
    logger.info('Initializing Microsoft Calendar sync queue (producer)...');
    await microsoftCalendarSyncQueue.initialize();

    logger.info('Initializing Google Calendar sync queue (producer)...');
    await googleCalendarSyncQueue.initialize();

    // Initialize unified watch renewal queue (replaces Gmail + Calendar renewal queues)
    logger.info('Initializing unified watch renewal queue...');
    await watchRenewalQueue.initialize();

    logger.info('Initializing warm user registry queue...');
    await warmUserRegistryQueue.initialize();

    // Initialize Superposition client early to fail fast if misconfigured
    logger.info('Initializing Superposition client...');
    try {
      await superpositionClient.initialize();
      logger.info('Superposition client initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Superposition client:', error);
      logger.warn('Continuing startup without Superposition client...');
    }

    // Y_SWEET_SERVER_TOKEN gates /api/ysweet/validate (requireYSweetServerToken
    // fails closed with 401 if it's empty). A missing token here is silent at
    // request time — every canvas connect and every 10s revalidation poll
    // just 401s — so surface it loudly at boot instead. Warn, don't crash:
    // an empty value is expected in local dev where nothing calls this route.
    if (!config.ysweet.serverToken) {
      logger.warn(
        'Y_SWEET_SERVER_TOKEN is not set.' +
          'if y-sweet auth validation is enabled in this environment, canvas collaboration will be down.'
      );
    }

    try {
      await registerAllExternalSources();
    } catch (error) {
      logger.error('Failed to register external sources:', error);
      logger.warn('Continuing startup without external sources...');
    }

    // Register workflow definitions
    logger.info('Registering workflow definitions...');
    registerAllWorkflows();

    // Initialize bot framework
    logger.info('Initializing bot framework...');
    await import('@/bots');

    // Initialize bot processor
    logger.info('Initializing bot processor...');
    const { botProcessor } = await import('@/services/bots');
    await botProcessor.initialize();

    // Initialize unified bot framework
    logger.info('Initializing unified bot framework...');
    initializeBotRegistry(); // Register all bots (internal + external) with unified catalog

    // Vespa queue MUST be initialized before syncing bot users below: each bot User
    // upsert transparently fires the setupUserVespaSync Prisma middleware, which enqueues
    // a user-index job on vespaQueue. If the queue isn't ready the enqueue is swallowed and
    // logged ("Vespa queue not initialized Properly") — sync still succeeds, but the first
    // bots' index jobs are silently dropped. The dependency is invisible at the sync call
    // site (it lives in a Prisma $use hook), so keep these ordered explicitly.
    logger.info('Initializing Vespa queue...');
    const { vespaQueue, vespaBackfillQueue } = await import('@/queues/vespaQueue');
    await vespaQueue.initialize();
    // Backfill producer (backfill + migration) → isolated queues, drained by dedicated backfill worker pods
    await vespaBackfillQueue.initialize();

    // Sync bots for all existing workspaces
    const dbClient = DatabaseClient.getInstance();
    const workspaces = await dbClient.workspace.findMany({ select: { id: true } });
    for (const ws of workspaces) {
      await unifiedBotUserService.syncAllBotUsers(ws.id);
    }
    botCatalog.markInitialized();
    logger.info(`Unified bot framework initialized with ${botCatalog.count} bot(s)`);

    logger.info('Initializing conversation ingest queue (producer)...');
    await conversationIngestQueue.initialize();

    logger.info('Initializing team intelligence queue (producer)...');
    await teamIntelligenceQueue.initialize();

    logger.info('Initializing document ingest queue (producer)...');
    await documentIngestQueue.initialize();

    logger.info('Initializing data source ingest queue (producer)...');
    const { dataSourceIngestQueue } = await import('@/queues/dataSourceIngestQueue');
    await dataSourceIngestQueue.initialize();

    logger.info('Initializing delayed message queue (producer)...');
    const { delayedMessageQueue } = await import('@/queues/delayedMessageQueue');
    await delayedMessageQueue.initialize();

    const { radarExecutionQueue, isRadarExecutionEnabled } = await import('@/queues/radarExecutionQueue');
    if (isRadarExecutionEnabled()) {
      logger.info('Initializing radar execution queue (producer)...');
      await radarExecutionQueue.initialize();
    }

    logger.info('Initializing message classification queue (producer)...');
    const { messageClassificationQueue } = await import('@/queues/messageClassificationQueue');
    await messageClassificationQueue.initialize();

    if (config.enableTagGenerationPipeline) {
      logger.info('Initializing tag generation pipeline queue (producer)...');
      registerDeskEmailTags(tagGenerationPipeline);
      await tagGenerationPipeline.connectQueue();
    }

    // Nightly automated Slack migration cron (runs only on migration pod)
    if (config.autoSyncSlackChannel.enabled) {
      logger.info('[APP] Starting Slack migration nightly worker...');
      await slackMigrationWorker.start();
    }

    this.httpServer.listen(config.port, config.host, () => {
      logger.info(`Server is running on ${config.host}:${config.port} in ${config.env} mode`);
      logger.info('WebSocket server ready for connections');
    });
  }

  public async shutdown(): Promise<void> {
    try {
      // Shutdown OpenTelemetry
      await shutdownOpenTelemetry();

      // Close superposition client
      await superpositionClient.close();

      // Close calendar sync queues
      await microsoftCalendarSyncQueue.close();
      await googleCalendarSyncQueue.close();
      await watchRenewalQueue.close();

      // Close warm user registry queue
      await warmUserRegistryQueue.close();

      // Close presence cleanup queue
      await presenceCleanupQueue.close();

      // Close ETA deadline queue
      await etaDeadlineQueue.close();

      // Close stage ETA deadline queue
      await stageEtaDeadlineQueue.close();

      // Close board config copy queue
      await boardConfigCopyQueue.close();

      // Close assignment reactivation queue
      await assignmentReactivationQueue.close();

      // Close ticket reassignment queue
      await ticketReassignmentQueue.close();

      // Close on-call rotation queue
      await onCallRotationQueue.close();

      // Close scheduled message queue
      await scheduledMessageQueue.close();

      // Close email classification queue
      await emailClassificationQueue.close();

      // Close auto draft queue
      await autoDraftQueue.close();

      // Close SDLC producer queue
      await sdlcQueue.close();

      // Close radar execution producer queue (initialized above when enabled)
      const { radarExecutionQueue: radarQueue } = await import('@/queues/radarExecutionQueue');
      await radarQueue.close();

      // Close tag generation pipeline queue
      await tagGenerationPipeline.close();

      // Shutdown notification service
      await notificationService.shutdown();

      // Shutdown scheduled call notification service
      await scheduledCallNotificationService.shutdown();

      // Shutdown bookmark reminder service
      await bookmarkReminderService.shutdown();

      await DatabaseClient.disconnect();
      await CommonDatabaseClient.disconnect();
      await redisService.disconnect();

      // Stop Slack migration nightly worker if running
      await slackMigrationWorker.stop();

      // Close HTTP server
      this.httpServer.close(() => {
        logger.info('HTTP server closed');
      });

      logger.info('Application shutdown complete');
    } catch (error) {
      logger.error('Error during shutdown:', error);
    }
  }
}
