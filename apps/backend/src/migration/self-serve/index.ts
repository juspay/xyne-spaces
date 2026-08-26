import { Router } from 'express';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getStorageService } from '@/services/storage';
import { MigrationStore } from './store';
import { MigrationQueues } from './queues';
import { SlackMigrationEngine } from './engine';
import { SlackMigrationService } from './service';
import { MigrationWorkers } from './workers';
import { buildRouter } from './routes';

/**
 * Composition root for self-serve Slack migration, mounted at
 * /migrate/api/migration/slack-migration/*. Queues run one-at-a-time (§5.4).
 * Workers are opt-in via RUN_SLACK_MIGRATION_WORKERS on the single migration pod;
 * other pods serve the API only.
 */
const store = new MigrationStore();
const queues = new MigrationQueues();
const engine = new SlackMigrationEngine();
const service = new SlackMigrationService(store, queues, engine);

if (config.runSlackMigrationWorkers) {
  // Ensure the migration bucket exists before workers run (idempotent; auto-creates in fake-gcs).
  if (config.gcs.migrationBucketName) {
    void getStorageService(config.gcs.migrationBucketName)
      .ensureBucketExists()
      .catch((e: unknown) =>
        logger.error('[SlackMigration] failed to ensure migration bucket exists', {
          bucket: config.gcs.migrationBucketName, error: e instanceof Error ? e.message : String(e),
        }),
      );
  } else {
    logger.warn('[SlackMigration] MIGRATION_GCS_BUCKET is not set — migration jobs will fail until it is configured');
  }
  // Ingestion starts paused: approvals only stage jobs until SLACK-MIGRATION-INGEST starts it.
  void queues.pauseIngestionOnFirstInit().catch((e: unknown) =>
    logger.error('[SlackMigration] failed to initialise ingestion queue paused', {
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  new MigrationWorkers(queues, store, engine).register();
}

const router: Router = buildRouter(service);
export default router;
