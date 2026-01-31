import { config } from 'dotenv';
import { DatabaseClient } from '../database/client';
import { activityClassificationWorkerService } from '../services/activity/activityClassificationWorkerService';
import { logger } from '../utils/logger';

config();

const shutdown = async (): Promise<void> => {
  try {
    logger.info('Shutting down activity classification worker...');
    await activityClassificationWorkerService.stop();
    await DatabaseClient.disconnect();
    logger.info('Activity classification worker shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during activity classification worker shutdown:', error);
    process.exit(1);
  }
};

const startActivityClassificationWorker = async (): Promise<void> => {
  try {
    await DatabaseClient.connect();
    logger.info('Activity classification worker database initialized successfully');

    await activityClassificationWorkerService.start();

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error('Failed to start activity classification worker:', error);
    process.exit(1);
  }
};

void startActivityClassificationWorker();
