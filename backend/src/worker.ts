import { config } from 'dotenv'
import { DatabaseClient } from '@/database/client'
import { logger } from '@/utils/logger'
import { pollingService } from './workflows/services/polling-service'
import { eventPollingService } from './workflows/services/event-polling-service'
import { registerAllWorkflows } from '@/workflows'
import { vespaWorker } from './workers/vespaWorker'
import { activityClassificationWorkerService } from '@/services/activity/activityClassificationWorkerService'
import { shutdownActivityClassificationTracing } from '@/services/activity/activityClassificationLangfuseTracing'
import { gcsPollingService } from './services/gcsPollingService'
import { notificationWorker } from '@/notification-service/consumers/notificationWorker'
import { notificationService as realTimeNotificationService } from '@/notification-service'
import { redisService } from '@/services/redisService'
//import { vespaWorker } from '@/workers/vespaWorker'
import { workerScheduler } from './workers';
import { initializeOpenTelemetry, shutdownOpenTelemetry } from '@/services/otel';
import { callTimeoutWorker } from '@/workers/callTimeoutWorker';

config()

class WorkerService {
  async start(): Promise<void> {
    try {
      // Initialize metrics
      initializeOpenTelemetry();

      await DatabaseClient.connect()
      logger.info('Worker database initialized successfully')

      // Register workflow definitions
      logger.info('Registering workflow definitions in worker...')
      registerAllWorkflows()

      const vespaEnabled = process.env.ENABLE_VESPA_WORKER === 'true'
      const gcsPollingEnabled = process.env.ENABLE_GCS_POLLING_WORKER === 'true'
      const activityClassificationEnabled =
        process.env.ENABLE_ACTIVITY_CLASSIFICATION_WORKER === 'true'
      const notificationWorkerEnabled = process.env.ENABLE_NOTIFICATION_WORKER === 'true'

      if (vespaEnabled) {
        await vespaWorker.start()
        workerScheduler.start();
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

      process.on('SIGINT', () => this.shutdown())
      process.on('SIGTERM', () => this.shutdown())

    } catch (error) {
      logger.error('Failed to start worker service:', error)
      process.exit(1)
    }
  }

  async shutdown(): Promise<void> {
    try {
      logger.info('Shutting down worker service...')
      const vespaEnabled = process.env.ENABLE_VESPA_WORKER === 'true'
      const gcsPollingEnabled = process.env.ENABLE_GCS_POLLING_WORKER === 'true'
      const activityClassificationEnabled =
        process.env.ENABLE_ACTIVITY_CLASSIFICATION_WORKER === 'true'
      const notificationWorkerEnabled = process.env.ENABLE_NOTIFICATION_WORKER === 'true'

      if (vespaEnabled) {
        await vespaWorker.shutdown()
        await workerScheduler.stop();
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
        await shutdownActivityClassificationTracing()
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
