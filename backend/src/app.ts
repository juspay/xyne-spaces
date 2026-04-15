import express, { Application } from 'express';
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
import { aclMiddleware } from '@/middleware/acl';
import { authMiddleware } from '@/middleware/auth';
import { verifyTranscriptionAgent } from '@/middleware/transcriptionAgentAuth';
import { DatabaseClient } from '@/database/client';
import webhookRoutes from '@/routes/webhooks';
import healthRoutes from '@/routes/health';
import authRoutes from '@/routes/auth';
import authV2Routes from '@/routes/authV2';
import ticketRoutes from '@/routes/tickets';
import externalStepResponseRoutes from '@/routes/externalStepResponses';
import agentRoutes from '@/routes/agents';
import modelRoutes from '@/routes/models';
import toolRoutes from '@/routes/tools';
import agentToolsMappingRoutes from '@/routes/agent-tools-mappings';
import analyticsRoutes from '@/routes/analytics';
import apiKeyRoutes from '@/routes/api-keys';
import userManagementRoutes from '@/routes/userManagement';
import channelRoutes from '@/routes/channels';
import conversationRoutes from '@/routes/conversations';
import organizationRoutes from '@/routes/organizations';
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
import migrationRoutes from '@/migration';
import { registerAllExternalSources } from '@/integrations/core/externalSourceRegistry';
import publicUserRoutes from '@/routes/publicUserRoutes';
import userRoutes from '@/routes/users';
import notificationRoutes from '@/routes/notifications';
import draftRoutes from '@/routes/draftAttachments';
import callRoutes from '@/routes/calls';
import transcriptionAgentRoutes from '@/routes/transcriptionAgent';
import livekitWebhookRoutes from '@/routes/livekitWebhook';
import zeroRoutes from '@/routes/zero';
import userGroupRoutes from '@/routes/userGroups';
import attachmentRoutes from '@/routes/attachments';
import draftAttachmentRoutes from '@/routes/draftAttachments';
import { notificationService } from '@/notification-service';
import { scheduledCallNotificationService } from '@/services/scheduledCallNotificationService';
import linkPreviewRoutes from '@/routes/linkPreview';
import bundleRoutes from '@/routes/bundles';
import projectRoutes from '@/routes/projects';
import boardRoutes from '@/routes/boards';
import searchRoutes from '@/routes/search';
import searchMetricsRoutes from '@/routes/searchMetrics';
import knowledgeRoutes from '@/routes/knowledge';
import vespaSearchRoutes from '@/routes/vespaSearch';
import summarizeRoutes from '@/routes/summarize';
import xyneAIRoutes from '@/routes/xyneAI';
import cacConfigRoutes from '@/routes/cacConfig';
import vespaBackfillRoutes from '@/routes/vespaBackfill';
import ticketMigrationRoutes from '@/routes/ticketMigration';
import activitiesBackfillRoutes from '@/routes/activitiesBackfill';
import messageMetadataBackfillRoutes from '@/routes/messageMetadataBackfill';
import setUpdatedAtTimeRoutes from '@/routes/setUpdatedAtTime';
import ticketMetadataBackfillRoutes from '@/routes/ticketMetadataBackfill';
import ticketDuplicateBackfillRoutes from '@/routes/ticketDuplicateBackfill';
import productInsightsReclusterRoutes from '@/routes/productInsightsRecluster';
import aiRoutes from '@/routes/aiRoutes';
import productInsightsRoutes from '@/routes/productInsights';
// import adminBackfillRoutes from '@/routes/adminBackfill';
import ysweetRoutes from '@/routes/ysweet';
import canvasRoutes from '@/routes/canvas';
import pythonQueryRoutes from '@/routes/pythonQuery';
import formsRoutes from '@/routes/forms';
import unifiedBotRoutes from '@/routes/unifiedBotRoutes';
import emailRoutes from '@/routes/email';
import emailDemergeRoutes from '@/routes/emailDemerge';
import docsRoutes from '@/routes/docs';
import testAuthRoutes from '@/routes/testAuth';
import customInstructionRoutes from '@/routes/customInstruction';
import userSkillsRoutes from '@/routes/userSkills';
import scheduledMessageRoutes from '@/routes/scheduledMessages';
import jenkinsRoutes from '@/routes/jenkins';
import activityLogRoutes from '@/routes/activityLog';
import userActivityRoutes from '@/routes/userActivity';
import inspectorToolsRoutes from '@/routes/inspectorTools';
import activityAliasesRoutes from '@/routes/activityAliases';
import commitAnalysisRoutes from '@/routes/commitAnalysis';
import meetCallbackRoutes from '@/routes/meetCallback';
import samRoutes from '@/routes/sam';
import memoryRoutes from '@/routes/memory';
import { initializeBotRegistry } from '@/bots/registry';
import { unifiedBotUserService, botCatalog } from '@/bots/unified/index.js';
import { metricsSyncQueue } from '@/queues/metricsSyncQueue';
import { modelSyncQueue } from '@/queues/modelSyncQueue';
import { presenceCleanupQueue } from '@/queues/presenceCleanupQueue';
import { etaDeadlineQueue } from '@/queues/etaDeadlineQueue';
import { stageEtaDeadlineQueue } from '@/queues/stageEtaDeadlineQueue';
import { assignmentReactivationQueue } from '@/queues/assignmentReactivationQueue';
import { onCallRotationQueue } from '@/queues/onCallRotationQueue';
import { scheduledMessageQueue } from '@/queues/scheduledMessageQueue';
import { initializeXyneAI } from '@/agents/xyne-ai';
import { conversationIngestQueue } from '@/queues/conversationIngestQueue';
import { documentIngestQueue } from '@/queues/documentIngestQueue';

import queryRoutes from '@/routes/query';
import { GenericFieldRegistry } from '@/services/queryService/genericFieldRegistry';
import emojiRoutes from '@/routes/emojis';
import applicationBackfillRoutes from '@/routes/applicationBackfill';
import { appRoutes } from '@/apps';
import { ChatController } from '@/apps/controllers/chatController';
import userMigrationRoutes from '@/routes/userMigration';

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
      this.app.use(morgan('combined', { stream }));
    }
    this.app.use(requestLogger);
  }

  private initializeRoutes(): void {
    // Public routes (no ACL protection)

    // External source sync routes (body parsing handled in route file)
    //Don't add any middleware here, add in api/external-source-sync.ts file otherwise API will not work.
    this.app.use('/api/external-source-sync', externalSourceSyncRoutes);

    // Migration routes (body parsing handled in route file)
    this.app.use('/api/migration', migrationRoutes);

    this.app.use('/migrate/api/migration', migrationRoutes);

    // Webhook routes with webhook rate limiter (applied before general rate limiter)
    this.app.use('/api/webhooks',
      express.raw({ type: 'application/json' }),
      webhookLimiter,
      
      webhookRoutes);

    // LiveKit webhook routes (MUST be before body parser for raw body signature verification)
    this.app.use('/api/livekit', livekitWebhookRoutes);

    // Body parsing for all other routes (10mb limit)
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use('/api/query', authMiddleware.authenticate, pythonQueryRoutes);

    // Commit analysis routes (auth and ACL required)
    this.app.use('/api/commits/analyze', authMiddleware.authenticate, commitAnalysisRoutes);

    this.app.use('/api/health', healthRoutes);
    this.app.use('/api/email', emailRoutes);
    this.app.use('/api/email', emailDemergeRoutes);

    // Meet callback route (API key auth - called by SAM service)
    this.app.use('/api/meet', meetCallbackRoutes);

    // SAM transcript ingestion route (API key auth - called by SAM/Pragati service)
    this.app.use('/api/sam/', samRoutes);

    // Bundle serving routes (public, no auth required - frontend static assets)
    this.app.use('/api/bundles', bundleRoutes);

    this.app.use('/api/transcriptionAgent', verifyTranscriptionAgent, transcriptionAgentRoutes);

    // Admin backfill routes (must be before generic /api routes to avoid auth conflicts)
    // Only enable when ENABLE_VESPA_BACKFILL_ROUTES environment variable is true
    if (process.env.ENABLE_VESPA_BACKFILL_ROUTES === 'true') {
      this.app.use('/api/admin/vespa-backfill', vespaBackfillRoutes);
      this.app.use('/migrate/api/admin/vespa-backfill', vespaBackfillRoutes);
    }

    // Ticket migration route (admin-only)
    this.app.use('/api/admin/migrate-tickets-xyneid', ticketMigrationRoutes);
    // Activities backfill route (for backfilling group mention actorAction)
    if (process.env.ENABLE_ACTIVITIES_BACKFILL_ROUTES === 'true') {
      this.app.use('/api/admin/activities-backfill', activitiesBackfillRoutes);
    }
    this.app.use('/migrate/api/admin/message-metadata-backfill', messageMetadataBackfillRoutes);
    this.app.use('/api/admin/message-metadata-backfill', messageMetadataBackfillRoutes);
    this.app.use('/api/admin/set-updated-at-time', setUpdatedAtTimeRoutes);
    this.app.use('/api/admin/ticket-metadata-backfill', ticketMetadataBackfillRoutes);
    // Ticket duplicate backfill route (always available, no vespa flag)
    this.app.use('/api/admin/ticket-duplicate-backfill', ticketDuplicateBackfillRoutes);
    // Product insights recluster route (admin-only)
    this.app.use('/api/admin/product-insights-recluster', productInsightsReclusterRoutes);

    // Application backfill admin routes (auth required)
    this.app.use('/api/admin/applications', authMiddleware.authenticate, applicationBackfillRoutes);

    this.app.use('/migrate/api/users-data-migration', authMiddleware.authenticate, userMigrationRoutes);

    // Apply general rate limiter to all API routes from this point onward

    // Test-only routes - only register when NODE_ENV=test
    // This will be only used on CI automation testing
    if (config.isTestEnv) {
      logger.info('Registering test routes (/api/test/*)');
      this.app.use('/api/test', testAuthRoutes);
    }

    // Apply general rate limiter to all API routes from this point onward
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/v2/auth', authV2Routes);
    this.app.use('/api/bots', unifiedBotRoutes); // Unified bot framework routes
    this.app.use('/api/public/users', publicUserRoutes);

    // Protected routes (auth first, then ACL middleware)
    this.app.use(
      '/api/tickets',
      authMiddleware.authenticate,
      aclMiddleware.checkAccess,
      ticketRoutes
    );
    this.app.use(
      '/api/workflows',
      authMiddleware.authenticate,
      aclMiddleware.checkAccess,
      workflowRoutes
    );
    this.app.use(
      '/api/agents',
      authMiddleware.authenticate,
      aclMiddleware.checkAccess,
      agentRoutes
    );
    this.app.use(
      '/api/models',
      authMiddleware.authenticate,
      aclMiddleware.checkAccess,
      modelRoutes
    );
    this.app.use('/api/tools', authMiddleware.authenticate, aclMiddleware.checkAccess, toolRoutes);
    this.app.use(
      '/api/agent-tools-mappings',
      authMiddleware.authenticate,
      aclMiddleware.checkAccess,
      agentToolsMappingRoutes
    );
    this.app.use('/api/external-step-response', externalStepResponseRoutes);
    this.app.use('/api/analytics', authMiddleware.authenticate, analyticsRoutes);

    // Chat routes (auth only, no ACL for now)

    // New chat schema routes
    this.app.use('/api/channels', authMiddleware.authenticate, channelRoutes);
    this.app.use('/api/conversations', authMiddleware.authenticate, conversationRoutes);
    this.app.use('/api/organizations', authMiddleware.authenticate, organizationRoutes);
    this.app.use('/api/users', authMiddleware.authenticate, userRoutes);
    this.app.use('/api/user-groups', authMiddleware.authenticate, userGroupRoutes); // User groups (teams)
    this.app.use('/api/forms', authMiddleware.authenticate, formsRoutes); // Forms routes
    this.app.use('/api/zero', zeroRoutes); // Zero sync routes (uses authenticateZero middleware in route file)

    this.app.use('/api/messages', authMiddleware.authenticate, reactionRoutes);

    this.app.use('/api/calls', authMiddleware.authenticate, callRoutes); // Calling feature routes
    
    // App routes
    this.app.use('/api/apps', appRoutes);

    // Internal S2S endpoints (trusted service-to-service calls)
    this.app.post('/api/internal/postAsUser', (req, res, next) => {
      const s2sKey = process.env['INTERNAL_S2S_KEY'];
      if (!s2sKey || req.headers['x-s2s-key'] !== s2sKey) {
        res.status(401).json({ error: 'Invalid or missing S2S key' });
        return;
      }
      next();
    }, new ChatController().postMessage);
    
    this.app.use('/api', authMiddleware.authenticate, attachmentRoutes); // Attachment routes (file streaming)
    this.app.use('/api', authMiddleware.authenticate, draftAttachmentRoutes); // Draft attachment upload routes
    this.app.use('/api/link-preview', authMiddleware.authenticate, linkPreviewRoutes); // Link preview routes
    this.app.use('/api/search', authMiddleware.authenticate, searchRoutes); // Global search routes (GET /api/search)
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

    // Project routes (auth and ACL required)
    this.app.use('/api/projects', authMiddleware.authenticate, projectRoutes);

    // Board routes (auth and ACL required)
    this.app.use('/api/boards', authMiddleware.authenticate, boardRoutes);

    // Knowledge routes (auth required)
    this.app.use('/api/knowledge', authMiddleware.authenticate, knowledgeRoutes);

    // Memory routes (auth handled internally by dualAuthenticate middleware)
    this.app.use('/api/memory', memoryRoutes);

    // Y-Sweet collaboration routes (auth required)
    this.app.use('/api/ysweet', authMiddleware.authenticate, ysweetRoutes);
    // AI routes (auth required)
    this.app.use('/api/ai', authMiddleware.authenticate, aiRoutes);

    // Generic query route (auth required)
    this.app.use('/api/analytics-query', authMiddleware.authenticate, queryRoutes);

    // Canvas file upload routes (auth required)
    this.app.use('/api/canvas', authMiddleware.authenticate, canvasRoutes);

    // Custom emoji routes (auth required)
    this.app.use('/api/emojis', authMiddleware.authenticate, emojiRoutes);

    // Summarization routes (auth required, uses JAF agent)
    this.app.use('/api/summarize', authMiddleware.authenticate, summarizeRoutes);

    // Docs publishing routes (auth required)
    this.app.use('/api/docs', authMiddleware.authenticate, docsRoutes);

    // Xyne AI routes (unified AI assistant with context awareness)
    this.app.use('/api/xyne-ai', authMiddleware.authenticate, xyneAIRoutes);

    // Generic CAC config routes
    this.app.use('/api/cac-config', authMiddleware.authenticate, cacConfigRoutes);

    // Custom instruction routes (auth required)
    this.app.use('/api/custom-instruction', customInstructionRoutes);

    // User skills routes (auth required)
    this.app.use('/api/user-skills', authMiddleware.authenticate, userSkillsRoutes);

    // Scheduled messages routes (auth required)
    this.app.use('/api/scheduled-messages', authMiddleware.authenticate, scheduledMessageRoutes);

    // Activity logging routes (auth required)
    this.app.use('/api/activity', authMiddleware.authenticate, activityLogRoutes);

    // User activity routes (auth required)
    this.app.use('/api/user-activity', authMiddleware.authenticate, userActivityRoutes);

    // Inspector Tools routes (auth required)
    this.app.use('/api/inspectorTools', authMiddleware.authenticate, inspectorToolsRoutes);

    this.app.use('/api/activity-aliases', authMiddleware.authenticate, activityAliasesRoutes);

    // Chat routes (auth only, no ACL for now)

    // New chat schema routes
    this.app.use('/api/channels', authMiddleware.authenticate, channelRoutes);
    this.app.use('/api/conversations', authMiddleware.authenticate, conversationRoutes);
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

    // Jenkins routes (auth required)
    this.app.use('/api/jenkins', authMiddleware.authenticate, jenkinsRoutes);

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

    // API versioning placeholder
    this.app.use('/api/v1', (_req, res) => {
      res.json({
        success: true,
        message: 'API v1 endpoint - ready for implementation',
        timestamp: new Date().toISOString(),
      });
    });
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
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  public async listen(): Promise<void> {
    // Initialize metrics
    initializeOpenTelemetry();

    // Initialize database connection before starting server
    await this.initializeDatabase();

    // Initialize query service schema cache
    logger.info('Initializing query service schema cache...');
    await GenericFieldRegistry.initialize();

    // Initialize Redis connection
    logger.info('Initializing Redis connection...');
    await redisService.connect();

    // Initialize and start metrics sync queue (Bull-based scheduling)
    logger.info('Initializing metrics sync queue...');
    await metricsSyncQueue.initialize();
    await metricsSyncQueue.runInitialSync();

    // Initialize presence cleanup queue (Bull-based scheduling)
    logger.info('Initializing presence cleanup queue...');
    await presenceCleanupQueue.initialize();

    logger.info('Initializing ETA deadline queue...');
    await etaDeadlineQueue.initialize();

    logger.info('Initializing stage ETA deadline queue...');
    await stageEtaDeadlineQueue.initialize();

    // Initialize assignment reactivation queue (Bull-based scheduling)
    logger.info('Initializing assignment reactivation queue...');
    await assignmentReactivationQueue.initialize();

    // Initialize on-call rotation queue (Bull-based scheduling)
    logger.info('Initializing on-call rotation queue...');
    await onCallRotationQueue.initialize();

    // Initialize scheduled message queue (Bull-based scheduling)
    logger.info('Initializing scheduled message queue...');
    await scheduledMessageQueue.initialize();

    // Initialize WebSocket server
    logger.info('Initializing WebSocket server...');
    websocketService.initialize(this.httpServer);

    // Initialize notification service
    logger.info('Initializing notification service...');
    await notificationService.initialize();

    // Initialize scheduled call notification service
    logger.info('Initializing scheduled call notification service...');
    await scheduledCallNotificationService.initialize();

    // Ensure default model and tools exist before synchronizing config
    await configSyncService.ensureDefaultModelAndTools();

    // Synchronize config.json with database before starting other services
    logger.info('Synchronizing configuration with database...');
    await configSyncService.syncConfigWithDatabase();

    // Initialize and start model sync queue (Bull-based scheduling)
    logger.info('Initializing model sync queue...');
    await modelSyncQueue.initialize();
    await modelSyncQueue.runInitialSync();

    // Initialize Superposition client early to fail fast if misconfigured
    logger.info('Initializing Superposition client...');
    try {
      await superpositionClient.initialize();
      logger.info('Superposition client initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Superposition client:', error);
      logger.warn('Continuing startup without Superposition client...');
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
    await unifiedBotUserService.syncAllBotUsers(); // Sync all bots to database
    botCatalog.markInitialized();
    logger.info(`Unified bot framework initialized with ${botCatalog.count} bot(s)`);

    // Initialize Xyne AI agent (fetches prompts from Langfuse)
    await initializeXyneAI();

    logger.info('Initializing Vespa queue...');
    const { vespaQueue } = await import('@/queues/vespaQueue');
    await vespaQueue.initialize();

    logger.info('Initializing conversation ingest queue (producer)...');
    await conversationIngestQueue.initialize();

    logger.info('Initializing document ingest queue (producer)...');
    await documentIngestQueue.initialize();

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

      // Close metrics sync queue
      await metricsSyncQueue.close();

      // Close presence cleanup queue
      await presenceCleanupQueue.close();

      // Close ETA deadline queue
      await etaDeadlineQueue.close();

      // Close stage ETA deadline queue
      await stageEtaDeadlineQueue.close();

      // Close assignment reactivation queue
      await assignmentReactivationQueue.close();

      // Close on-call rotation queue
      await onCallRotationQueue.close();

      // Close scheduled message queue
      await scheduledMessageQueue.close();

      // Shutdown notification service
      await notificationService.shutdown();

      // Shutdown scheduled call notification service
      await scheduledCallNotificationService.shutdown();

      await DatabaseClient.disconnect();
      await redisService.disconnect();

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
