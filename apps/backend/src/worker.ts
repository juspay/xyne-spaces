import { config } from 'dotenv'
import { config as appConfig } from '@/config/env'
import { startDoclingSchedulerRole } from '@/services/ingestion/docling/workers/scheduler'
import { startRuntimeConfigPolling } from '@/services/ingestion/docling/runtime/config'
import { DatabaseClient } from '@/database/client'
import { CommonDatabaseClient } from '@/database/commonClient'
import { describeRejection, logger } from '@/utils/logger'
import { pollingService } from './workflows/services/polling-service'
import { eventPollingService } from './workflows/services/event-polling-service'
import { registerAllWorkflows } from '@/workflows'
import { vespaWorker } from './workers/vespaWorker'
import { vespaFileWorker } from './workers/vespaFileWorker'
import {
  startDriveImportWorker,
  closeDriveImportQueue,
} from '@/services/driveImport/driveImportWorker'
import { messageClassificationQueue } from '@/queues/messageClassificationQueue'
import { proactiveNudgeWorker } from './workers/proactiveNudgeWorker'
import { activityClassificationWorkerService } from '@/services/activity/activityClassificationWorkerService'
import { ticketCleanupWorkerService } from '@/services/tickets/descriptionCleaner/ticketCleanupWorkerService'
import { gcsPollingService } from './services/gcsPollingService'
import { notificationWorker } from '@/notification-service/consumers/notificationWorker'
import { notificationService, notificationService as realTimeNotificationService } from '@/notification-service'
import { redisService } from '@/services/redisService'
//import { vespaWorker } from '@/workers/vespaWorker'
import { workerScheduler } from './workers';
import { initializeOpenTelemetry, shutdownOpenTelemetry } from '@/services/otel';
import { callTimeoutWorker } from '@/workers/callTimeoutWorker';
import { callValidationWorker } from '@/workers/callValidationWorker';
import { initializeBotRegistry } from '@/bots/registry';
import { workflowStepGcsSyncQueue } from '@/queues/workflowStepGcsSyncQueue';
import { vespaQueue } from '@/queues/vespaQueue';
import { conversationIngestionWorker } from '@/workers/conversationIngestionWorker';
import { documentIngestionWorker } from '@/workers/documentIngestionWorker';
import { dataSourceIngestionWorker } from '@/workers/dataSourceIngestionWorker';
import { delayedMessageWorker } from '@/workers/delayedMessageWorker';
import { scheduledMessageWorker } from '@/workers/scheduledMessageWorker';
import { stageEtaDeadlineWorker } from '@/workers/stageEtaDeadlineWorker';
import { etaDeadlineWorker } from '@/workers/etaDeadlineWorker';
import { emailFetchWorker } from '@/workers/emailFetchWorker';
import { teamIntelligenceWorker } from '@/workers/teamIntelligenceWorker';
import { emailClassificationWorker } from '@/workers/emailClassificationWorker';
import { emailClassificationQueue } from '@/queues/emailClassificationQueue';
import { radarExecutionWorker } from '@/workers/radarExecutionWorker';
import { autoDraftWorker } from '@/workers/autoDraftWorker';
import { entityExtractionWorker } from '@/workers/entityExtractionWorker';
import { sdlcWorker } from '@/workers/sdlcWorker';
import { sdlcClawExecutionService } from '@/sdlc/SdlcClawExecutionService';
import { sdlcWikiExecutionService } from '@/sdlc/wiki/SdlcWikiExecutionService';
import { tagGenerationPipeline, registerDeskEmailTags, DESK_EMAIL_SOURCE_TYPE, enqueueTagVespaRefeed } from '@/tags';
import { emitTagGenerated } from '@/automations/triggers/tag-generated.trigger';
import { recoveryService } from './workflows/services/recovery-service'
import { aiProvisioningWorker } from '@/workers/aiProvisioningWorker';
import { socialMediaSyncWorker } from '@/workers/socialMediaSyncWorker';
import { workflowsWorker } from '@/workers/workflowsWorker';
config()

process.on('unhandledRejection', reason => {
  logger.error('WORKER UNHANDLED REJECTION', { error: describeRejection(reason) });
});

process.on('uncaughtException', error => {
  logger.error('WORKER UNCAUGHT EXCEPTION', { error });
});

class WorkerService {
  private isShuttingDown = false
  private automationTemplateCleanupTimer: NodeJS.Timeout | null = null
  private sdlcReconciliationTimer: NodeJS.Timeout | null = null

  async start(): Promise<void> {
    try {
      // Initialize metrics
      initializeOpenTelemetry();

      await DatabaseClient.connect()
      const isCommonDatabaseConnected = await CommonDatabaseClient.connect()
      logger.info('Worker database initialization completed', {
        mainDatabase: 'connected',
        commonDatabase: isCommonDatabaseConnected ? 'connected' : 'unavailable',
      })

      // Register workflow definitions
      logger.info('Registering workflow definitions in worker...')
      registerAllWorkflows()
      initializeBotRegistry()

      logger.info('Initializing Vespa queue (producer)...')
      await vespaQueue.initialize()

      const vespaEnabled = process.env.ENABLE_VESPA_WORKER === 'true'
      const vespaFileWorkerEnabled = process.env.ENABLE_VESPA_FILE_WORKER === 'true'
      const gcsPollingEnabled = process.env.ENABLE_GCS_POLLING_WORKER === 'true'
      const activityClassificationEnabled =
        process.env.ENABLE_ACTIVITY_CLASSIFICATION_WORKER === 'true'
      const ticketCleanupEnabled = appConfig.ticketCleanupWorkerEnabled
      const notificationWorkerEnabled = process.env.ENABLE_NOTIFICATION_WORKER === 'true'
      const workerSchedulerEnabled = appConfig.workerSchedulerEnabled
      const proactiveNudgeWorkerEnabled = process.env.ENABLE_PROACTIVE_NUDGE_WORKER === 'true'
      const callValidationEnabled = process.env.ENABLE_CALL_VALIDATION_WORKER === 'true'
      const socialMediaSyncEnabled = process.env.ENABLE_SOCIAL_MEDIA_SYNC_WORKER === 'true'
      const workflowsEnabled = appConfig.workflows.workerEnabled
      const messageClassificationEnabled = appConfig.messageClassificationEnabled
          // Only schedule recovery if not disabled (recovery should run in separate pod)
    const enableRecovery = appConfig.workflowRecoveryEnabled
    const workflowType = process.env.WORKFLOW_TYPE
    if (enableRecovery) {
      await recoveryService.start()
    } else {
      logger.info('Recovery worker is disabled ')
    }
      const enableNotificationProducer = process.env.ENABLE_NOTIFICATION_PRODUCER === 'true';

      if (vespaEnabled) {
        await vespaWorker.start()
        if (workerSchedulerEnabled) {
          await workerScheduler.start()
        } else {
          logger.info('Worker scheduler is disabled (ENABLE_WORKER_SCHEDULER=false)')
        }
      } else if (notificationWorkerEnabled) {
        logger.info('Starting notification worker service...')
        // Redis connection is required for notification worker checks
        await redisService.connect()
        
        // Initialize real-time notification service (Producer) for CallTimeoutWorker
        await realTimeNotificationService.initialize()

        await notificationWorker.startWorker()
        
        logger.info('Starting call timeout worker service...')
        await callTimeoutWorker.startWorker()
      } 

      if (vespaFileWorkerEnabled) {
        await vespaFileWorker.start()
      }

      // Google Drive import worker. When disabled, the API process runs imports
      // in-process as a fallback (see collectionController.uploadFromDriveLink).
      if (appConfig.enableDriveImportWorker) {
        logger.info('Starting Drive import worker...')
        startDriveImportWorker()
      }

      // Async OCR (Docling/LightOn) scheduler roles — fire-and-forget loops.
      if (appConfig.doclingScheduler.enabled && appConfig.doclingScheduler.role) {
        logger.info(
          `Starting Docling async OCR scheduler role: ${appConfig.doclingScheduler.role}`,
        )
        startRuntimeConfigPolling()
        void startDoclingSchedulerRole(appConfig.doclingScheduler.role)
      }

      if(workflowType){
        logger.info(`WORKFLOW_TYPE is set to ${workflowType}. Only starting workers compatible with this workflow type.`)
        await Promise.all([
          pollingService.start(),
          eventPollingService.start(),
        ])
      }
      else{
        logger.info('WORKFLOW_TYPE is not set. workflow polling and event polling workers will not be started.')
      }

      if (gcsPollingEnabled) {
        await gcsPollingService.start()
      }

      if (activityClassificationEnabled) {
        logger.info('Starting activity classification worker service...')
        await activityClassificationWorkerService.start()
      }

      if (ticketCleanupEnabled) {
        logger.info('Starting ticket cleanup worker service...')
        await ticketCleanupWorkerService.start()
      }


      if (proactiveNudgeWorkerEnabled) {
        logger.info('Starting proactive nudge worker service...')
        await proactiveNudgeWorker.start()
      }

      if (callValidationEnabled) {
        logger.info('Starting call validation worker service...');
        await callValidationWorker.start();
      }

      if (socialMediaSyncEnabled) {
        logger.info('Initializing email classification queue (producer)...');
        await emailClassificationQueue.initialize();
        logger.info('Starting social media review sync worker...');
        socialMediaSyncWorker.start();
      }

      if (workflowsEnabled) {
        logger.info('Starting workflows worker...');
        await workflowsWorker.start();
      }
      // LLM auto-tagging of messages (message act + thread type). The API process enqueues,
      // this worker consumes. Both sides call initialize(), which no-ops when the flag is
      // off — so with it off nothing is produced either, and no backlog builds up.
      if (messageClassificationEnabled) {
        logger.info('Starting message classification worker service...')
        await messageClassificationQueue.initialize()
        messageClassificationQueue.startProcessing()
      }

      if (appConfig.enableWorkflowStepGcsSync) {
        logger.info('Initializing workflow step GCS sync queue...');
        await workflowStepGcsSyncQueue.initialize();
      }

      if (appConfig.enableConversationIngestionQueue) {
        logger.info('Initializing conversation ingest queue...');
        const { conversationIngestQueue } = await import('@/queues/conversationIngestQueue');
        await conversationIngestQueue.initialize();
      }

      if (appConfig.enableConversationIngestionWorker) {
        logger.info('Starting conversation ingestion worker...');
        await conversationIngestionWorker.start();
      }

      logger.info('Initializing scheduled message queue...');
      const { scheduledMessageQueue } = await import('@/queues/scheduledMessageQueue');
      await scheduledMessageQueue.initialize();

      // Initialize recording cleanup queue (daily cron to delete expired recordings)
      logger.info('Initializing recording cleanup queue...');
      const { recordingCleanupQueue } = await import('@/queues/recordingCleanupQueue');
      await recordingCleanupQueue.initialize();

      // HLS → MP4 stitch worker. Queue-based and CPU/disk-heavy (ffmpeg), so it
      // is isolated behind its own flag: deploy a dedicated stitch node by enabling
      // ONLY ENABLE_STITCH_WORKER. The API never consumes (enqueue is producer-only).
      if (appConfig.enableStitchWorker) {
        logger.info('Starting recording stitch worker...');
        const { stitchWorker } = await import('@/workers/stitchWorker');
        stitchWorker.start();
      }

      if (appConfig.enableScheduledMessageWorker) {
        logger.info('Initializing notification service for scheduled message worker...');
        await notificationService.initialize();
        logger.info('Starting scheduled message worker...');
        await scheduledMessageWorker.start();
      }

      if (appConfig.enableStageEtaDeadlineWorker) {
        logger.info('Starting stage ETA deadline worker...');
        await stageEtaDeadlineWorker.start();
      }

      if (appConfig.enableEtaDeadlineWorker) {
        logger.info('Starting ETA deadline worker...');
        await etaDeadlineWorker.start();
      }

      if (appConfig.enableAutomationWorker) {
        logger.info('Initializing notification service for automation worker...');
        await notificationService.initialize();
        logger.info('Initializing automations module...');
        const { initializeAutomations } = await import('@/automations');
        await initializeAutomations();
        const { automationWorker } = await import('@/automations/queue/automation.worker');
        logger.info('Starting automation run worker...');
        await automationWorker.start();
        const { automationScheduleWorker } = await import(
          '@/automations/queue/automation-schedule.worker'
        );
        logger.info('Starting automation schedule worker...');
        await automationScheduleWorker.start();

        const { cleanupUnreferencedAutomationTemplates } = await import(
          '@/automations/services/automation-template.service'
        );
        const cleanupTemplates = (): void => {
          void cleanupUnreferencedAutomationTemplates()
            .then((removed) => {
              if (removed > 0) {
                logger.info(`[automations] Cleaned up ${removed} unreferenced templates`);
              }
            })
            .catch((error) => logger.error('[automations] Template cleanup failed', error));
        };
        cleanupTemplates();
        this.automationTemplateCleanupTimer = setInterval(cleanupTemplates, 60 * 60 * 1000);
        this.automationTemplateCleanupTimer.unref();
      }

      if (appConfig.enableEmailFetchWorker) {
        logger.info('Initializing notification service for email refetch worker...');
        await notificationService.initialize();
        logger.info('Starting email refetch worker...');
        await emailFetchWorker.start();
      }

      if (appConfig.enableTeamIntelligenceWorker) {
        logger.info('Starting team intelligence worker...');
        await teamIntelligenceWorker.start();
      }

      if (appConfig.enableEmailClassificationWorker) {
        logger.info('Starting email classification worker...');
        await emailClassificationWorker.start();
      }

      if (appConfig.radar.enabled) {
        logger.info('Starting radar execution worker...');
        // Guarded, unlike its neighbours: an unguarded throw reaches the outer
        // catch, which exits the process — taking unrelated workers down with
        // a dark-launched feature none of them depend on.
        try {
          await radarExecutionWorker.start();
        } catch (error) {
          logger.error(
            '[RADAR-EXECUTION-WORKER] Failed to start; continuing without it',
            error,
          );
        }
      }

      if (appConfig.enableAiProvisioningWorker) {
        logger.info('Starting AI provisioning worker...');
        await aiProvisioningWorker.start();
      }

      logger.info('Starting auto draft worker...');
      await autoDraftWorker.start();

      if (appConfig.entityExtraction.enabled) {
        logger.info('Starting entity extraction worker...');
        await entityExtractionWorker.start();
      } else {
        logger.info('Entity extraction is disabled; skipping worker startup');
      }

      if (appConfig.enableSdlcWorker) {
        logger.info('Starting SDLC worker...');
        await sdlcWorker.start();
        const reconcileSdlc = (): void => {
          void sdlcClawExecutionService.reconcileExecutions().catch(error => {
            logger.error('[SDLC-CLAW] reconciliation failed', error);
          });
          void sdlcWikiExecutionService.reconcileExecutions().catch(error => {
            logger.error('[SDLC-WIKI] reconciliation failed', error);
          });
        };
        reconcileSdlc();
        this.sdlcReconciliationTimer = setInterval(reconcileSdlc, 60_000);
        this.sdlcReconciliationTimer.unref();
      } else {
        logger.info('SDLC worker is disabled (ENABLE_SDLC_WORKER=false)');
      }

      if (appConfig.enableTagGenerationPipeline) {
        logger.info('Initializing tag generation pipeline...');
        registerDeskEmailTags(tagGenerationPipeline);
        await tagGenerationPipeline.initialize();

        tagGenerationPipeline.onCompleted(DESK_EMAIL_SOURCE_TYPE, (result) => {
          void enqueueTagVespaRefeed(DESK_EMAIL_SOURCE_TYPE, result.sourceId);
          logger.info(`Tag generation completed for sourceId=${result.sourceId}, emitting tagGenerated event...`);
          void emitTagGenerated({
            sourceId: result.sourceId,
            sourceType: result.sourceType,
            tags: result.tags.map(t => ({ category: t.tagCategory, tag: t.tag, reason: t.reason ?? null })),
          });
        });
      }

      const documentIngestionWorkerEnabled = process.env.ENABLE_DOCUMENT_INGESTION_WORKER === 'true';
      if (documentIngestionWorkerEnabled) {
        logger.info('Starting document ingestion worker...');
        await documentIngestionWorker.start();
      }

      const dataSourceIngestionWorkerEnabled = process.env.ENABLE_DATA_SOURCE_INGESTION_WORKER === 'true';
      if (dataSourceIngestionWorkerEnabled) {
        logger.info('Starting data source ingestion worker...');
        await dataSourceIngestionWorker.start();
      }

      const delayedMessageWorkerEnabled = appConfig.enableDelayedMessageWorker;
      if (delayedMessageWorkerEnabled) {
        logger.info('Starting delayed message worker...');
        await delayedMessageWorker.start();
        await delayedMessageWorker.reenqueuePendingMessages();
      }

      if (enableNotificationProducer) {
        logger.info('Starting notification producer for real-time notifications...');
        await notificationService.initialize();
      }

      process.on('SIGINT', () => this.shutdown())
      process.on('SIGTERM', () => this.shutdown())

    } catch (error) {
      logger.error('Failed to start worker service:', error)
      process.exit(1)
    }
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      logger.info('Shutdown already in progress, ignoring duplicate signal')
      return
    }
    this.isShuttingDown = true

    try {
      logger.info('Shutting down worker service...')
      if (this.automationTemplateCleanupTimer) {
        clearInterval(this.automationTemplateCleanupTimer)
        this.automationTemplateCleanupTimer = null
      }
      if (this.sdlcReconciliationTimer) {
        clearInterval(this.sdlcReconciliationTimer)
        this.sdlcReconciliationTimer = null
      }
      const vespaEnabled = process.env.ENABLE_VESPA_WORKER === 'true'
      const vespaFileWorkerEnabled = process.env.ENABLE_VESPA_FILE_WORKER === 'true'
      const gcsPollingEnabled = process.env.ENABLE_GCS_POLLING_WORKER === 'true'
      const activityClassificationEnabled =
        process.env.ENABLE_ACTIVITY_CLASSIFICATION_WORKER === 'true'
      const ticketCleanupEnabled = appConfig.ticketCleanupWorkerEnabled
      const notificationWorkerEnabled = process.env.ENABLE_NOTIFICATION_WORKER === 'true'
      const workerSchedulerEnabled = appConfig.workerSchedulerEnabled
      const proactiveNudgeWorkerEnabled = process.env.ENABLE_PROACTIVE_NUDGE_WORKER === 'true'
      const callValidationEnabled = process.env.ENABLE_CALL_VALIDATION_WORKER === 'true'
      const socialMediaSyncEnabled = process.env.ENABLE_SOCIAL_MEDIA_SYNC_WORKER === 'true'
      const workflowsEnabled = appConfig.workflows.workerEnabled
      const messageClassificationEnabled = appConfig.messageClassificationEnabled
      const enableRecovery = process.env.ENABLE_WORKFLOW_RECOVERY !== 'false'
      const workflowType = process.env.WORKFLOW_TYPE
      if (enableRecovery) {
        await recoveryService.stop()
      }

      if (vespaEnabled) {
        await vespaWorker.shutdown()
        if (workerSchedulerEnabled) {
          await workerScheduler.stop()
        }
      } else if (notificationWorkerEnabled) {
        await notificationWorker.shutdown()
        await callTimeoutWorker.shutdown()
        await redisService.disconnect()
      }

      if (vespaFileWorkerEnabled) {
        await vespaFileWorker.shutdown()
      }
      if (appConfig.enableDriveImportWorker) {
        await closeDriveImportQueue()
      }
      if(workflowType){
        logger.info(`WORKFLOW_TYPE is set to ${workflowType}. Only stopping workers compatible with this workflow type.`)
        await Promise.all([
          pollingService.stop(),
          eventPollingService.stop(),
        ])
      }

      if (gcsPollingEnabled) {
        await gcsPollingService.stop()
      }

      if (activityClassificationEnabled) {
        await activityClassificationWorkerService.stop()
      }
      if (ticketCleanupEnabled) {
        await ticketCleanupWorkerService.stop()
      }

      if (proactiveNudgeWorkerEnabled) {
        await proactiveNudgeWorker.shutdown()
      }

      if (callValidationEnabled) {
        await callValidationWorker.stop();
      }

      if (socialMediaSyncEnabled) {
        socialMediaSyncWorker.stop();
        if (!appConfig.enableEmailClassificationWorker) {
          await emailClassificationQueue.close();
        }
      }
      if (messageClassificationEnabled) {
        await messageClassificationQueue.shutdown()
      }

      if (workflowsEnabled) {
        await workflowsWorker.stop()
      }

      if (appConfig.enableWorkflowStepGcsSync) {
        logger.info('Closing workflow step GCS sync queue...');
        await workflowStepGcsSyncQueue.close();
      }

      if (appConfig.enableConversationIngestionWorker) {
        await conversationIngestionWorker.shutdown();
      }

      if (appConfig.enableScheduledMessageWorker) {
        await scheduledMessageWorker.shutdown();
      }

      if (appConfig.enableStageEtaDeadlineWorker) {
        await stageEtaDeadlineWorker.shutdown();
      }

      if (appConfig.enableEtaDeadlineWorker) {
        await etaDeadlineWorker.shutdown();
      }

      if (appConfig.enableEmailFetchWorker) {
        await emailFetchWorker.shutdown();
      }

      if (appConfig.enableTeamIntelligenceWorker) {
        await teamIntelligenceWorker.shutdown();
      }

      if (appConfig.enableEmailClassificationWorker) {
        await emailClassificationWorker.shutdown();
      }

      if (appConfig.radar.enabled) {
        await radarExecutionWorker.shutdown();
      }

      if (appConfig.enableAiProvisioningWorker) {
        await aiProvisioningWorker.shutdown();
      }

      await autoDraftWorker.shutdown();
      if (appConfig.enableSdlcWorker) await sdlcWorker.stop();

      if (appConfig.enableTagGenerationPipeline) {
        await tagGenerationPipeline.close();
      }

      const documentIngestionWorkerEnabled = process.env.ENABLE_DOCUMENT_INGESTION_WORKER === 'true';
      if (documentIngestionWorkerEnabled) {
        await documentIngestionWorker.shutdown();
      }

      const dataSourceIngestionWorkerEnabled = process.env.ENABLE_DATA_SOURCE_INGESTION_WORKER === 'true';
      if (dataSourceIngestionWorkerEnabled) {
        await dataSourceIngestionWorker.shutdown();
      }

      const delayedMessageWorkerEnabled = appConfig.enableDelayedMessageWorker;
      if (delayedMessageWorkerEnabled) {
        await delayedMessageWorker.shutdown();
      }

      await DatabaseClient.disconnect()
      await CommonDatabaseClient.disconnect()

      await shutdownOpenTelemetry();

      logger.info('Worker service shutdown complete')
      process.exit(0)
    } catch (error) {
      logger.error('Error during worker shutdown:', error)
      process.exit(1)
    }
  }
}

const worker = new WorkerService()
worker.start()
