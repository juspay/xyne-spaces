import { config } from 'dotenv'
import { config as appConfig } from '@/config/env'
import { DatabaseClient } from '@/database/client'
import { logger } from '@/utils/logger'
import { pollingService } from './workflows/services/polling-service'
import { eventPollingService } from './workflows/services/event-polling-service'
import { registerAllWorkflows } from '@/workflows'
import { vespaWorker } from './workers/vespaWorker'
import { proactiveNudgeWorker } from './workers/proactiveNudgeWorker'
import { activityClassificationWorkerService } from '@/services/activity/activityClassificationWorkerService'
import { ticketCleanupWorkerService } from '@/services/tickets/descriptionCleaner/ticketCleanupWorkerService'
import { gcsPollingService } from './services/gcsPollingService'
import { notificationWorker } from '@/notification-service/consumers/notificationWorker'
import { notificationService as realTimeNotificationService } from '@/notification-service'
import { redisService } from '@/services/redisService'
//import { vespaWorker } from '@/workers/vespaWorker'
import { workerScheduler } from './workers';
import { initializeOpenCode, shutdownOpenCode } from '@/workflows/framework/opencode';
import { initializeOpenTelemetry, shutdownOpenTelemetry } from '@/services/otel';
import { callTimeoutWorker } from '@/workers/callTimeoutWorker';
import { callValidationWorker } from '@/workers/callValidationWorker';

config()

class WorkerService {
  private isShuttingDown = false

  async start(): Promise<void> {
    try {
      // Initialize metrics
      initializeOpenTelemetry();

      await DatabaseClient.connect()
      logger.info('Worker database initialized successfully')

      // Register workflow definitions
      logger.info('Registering workflow definitions in worker...')
      registerAllWorkflows()

      // Initialize OpenCode only if enabled
      if (appConfig.openCode.enabled) {
        logger.info('Initializing OpenCode server...')
        await initializeOpenCode()
      } else {
        logger.info('OpenCode is disabled, skipping initialization')
      }

      const vespaEnabled = process.env.ENABLE_VESPA_WORKER === 'true'
      const gcsPollingEnabled = process.env.ENABLE_GCS_POLLING_WORKER === 'true'
      const activityClassificationEnabled =
        process.env.ENABLE_ACTIVITY_CLASSIFICATION_WORKER === 'true'
      const ticketCleanupEnabled = appConfig.ticketCleanupWorkerEnabled
      const notificationWorkerEnabled = process.env.ENABLE_NOTIFICATION_WORKER === 'true'
      const workerSchedulerEnabled = appConfig.workerSchedulerEnabled
      const proactiveNudgeWorkerEnabled = process.env.ENABLE_PROACTIVE_NUDGE_WORKER === 'true'
      const callValidationEnabled = process.env.ENABLE_CALL_VALIDATION_WORKER === 'true'

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
      } else {
        await Promise.all([
          pollingService.start(),
          eventPollingService.start(),
        ])
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
      await shutdownOpenCode()
      const vespaEnabled = process.env.ENABLE_VESPA_WORKER === 'true'
      const gcsPollingEnabled = process.env.ENABLE_GCS_POLLING_WORKER === 'true'
      const activityClassificationEnabled =
        process.env.ENABLE_ACTIVITY_CLASSIFICATION_WORKER === 'true'
      const ticketCleanupEnabled = appConfig.ticketCleanupWorkerEnabled
      const notificationWorkerEnabled = process.env.ENABLE_NOTIFICATION_WORKER === 'true'
      const workerSchedulerEnabled = appConfig.workerSchedulerEnabled
      const proactiveNudgeWorkerEnabled = process.env.ENABLE_PROACTIVE_NUDGE_WORKER === 'true'
      const callValidationEnabled = process.env.ENABLE_CALL_VALIDATION_WORKER === 'true'

      if (vespaEnabled) {
        await vespaWorker.shutdown()
        if (workerSchedulerEnabled) {
          await workerScheduler.stop()
        }
      } else if (notificationWorkerEnabled) {
        await notificationWorker.shutdown()
        await callTimeoutWorker.shutdown()
        await redisService.disconnect()
      } else {
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

      await DatabaseClient.disconnect()

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
