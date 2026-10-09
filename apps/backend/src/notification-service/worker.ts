import { notificationService } from './index';
import { logger } from '@/utils/logger';
import { startLogRedactAllowListSync } from '@/services/logRedactAllowList';

async function startNotificationWorker() {
  try {
    logger.info('Starting notification worker...');
    startLogRedactAllowListSync();

    await notificationService.initialize();

    logger.info('Notification worker started successfully');

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down notification worker...');
      await notificationService.shutdown();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down notification worker...');
      await notificationService.shutdown();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start notification worker:', error);
    process.exit(1);
  }
}

startNotificationWorker();