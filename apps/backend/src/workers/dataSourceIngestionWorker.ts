import type Bull from 'bull';
import { logger } from '@/utils/logger';
import {
  dataSourceIngestQueue,
  type DataSourceIngestJobData,
} from '@/queues/dataSourceIngestQueue';
import { runDataSourceIngestion } from '@/services/dynamicDashboard/dataSource/ingestion/ingestionService';

class DataSourceIngestionWorker {
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    await dataSourceIngestQueue.initialize();
    const queue = dataSourceIngestQueue.getQueue();
    if (!queue) {
      throw new Error('[DS-INGEST-WORKER] Queue not available after initialization');
    }

    queue.process('*', 3, async (job: Bull.Job<DataSourceIngestJobData>) => {
      return this.processJob(job);
    });

    this.isInitialized = true;
    logger.info('[DS-INGEST-WORKER] Started, ready to process jobs');
  }

  private async processJob(job: Bull.Job<DataSourceIngestJobData>): Promise<void> {
    const { dataSourceId, includedTables } = job.data;
    logger.info(`[DS-INGEST-WORKER] Processing job ${job.id} dataSourceId=${dataSourceId}`);
    await runDataSourceIngestion(dataSourceId, includedTables);
    logger.info(`[DS-INGEST-WORKER] Completed job ${job.id} dataSourceId=${dataSourceId}`);
  }

  async shutdown(): Promise<void> {
    await dataSourceIngestQueue.close();
    this.isInitialized = false;
    logger.info('[DS-INGEST-WORKER] Shut down');
  }
}

export const dataSourceIngestionWorker = new DataSourceIngestionWorker();
