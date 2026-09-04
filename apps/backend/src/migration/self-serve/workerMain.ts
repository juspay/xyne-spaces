/**
 * Worker entry for the self-serve Slack migration — booted as a forked CHILD by the migration composition root
 * (`self-serve/index.ts`) when MIGRATION_WORKER_PROCESSES > 1, one child per process. It runs the migration WORKERS
 * only (no HTTP, no other app services), so the main app process keeps serving everything else as a single copy.
 *
 * Each child is given a NODE_APP_INSTANCE (0..N-1): singleton duties (collection / ingestion planner / reconcile) run
 * on instance 0 only; every child drains the fanned-out conversation jobs for cross-process parallelism. This process
 * never forks again — the supervisor lives in the composition root.
 */
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getStorageService } from '@/services/storage';
import { vespaQueue, vespaBackfillQueue } from '@/queues/vespaQueue';
import { superpositionClient } from '@/services/superpositionClient';
import { MigrationStore } from './store';
import { MigrationQueues } from './queues';
import { SlackMigrationEngine } from './engine';
import { MigrationWorkers } from './workers';

// Log the ORIGINAL rejection's stack (not this handler's frame) so an unawaited failure is actually diagnosable.
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('[SlackMigration] UNHANDLED REJECTION', {
    error: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  });
});
process.on('uncaughtException', (error: Error) => {
  logger.error('[SlackMigration] UNCAUGHT EXCEPTION', { error });
});
// In-flight conversations cut off by a restart are recovered by the reconcile watchdog + per-conversation dedup, so an immediate exit is safe.
process.on('SIGTERM', () => { logger.info('[SlackMigration] worker received SIGTERM — exiting'); process.exit(0); });
process.on('SIGINT', () => process.exit(0));

const isPrimaryInstance = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';

async function boot(): Promise<void> {
  // These forked worker children never boot through app.ts, so the Vespa PRODUCER queues would be uninitialised here —
  // every enqueueMessageVespa would then throw "Vespa queue not initialized Properly" and NO migrated message would be
  // indexed. Initialise them (idempotent) BEFORE registering workers. Draining stays with the backfill worker pods.
  await vespaQueue.initialize();
  await vespaBackfillQueue.initialize();
  await superpositionClient.initialize().catch((e: unknown) =>
    logger.warn('[SlackMigration] Superposition init failed — migration config will use defaults', { error: e instanceof Error ? e.message : String(e) }),
  );

  const store = new MigrationStore();
  const queues = new MigrationQueues();
  const engine = new SlackMigrationEngine();

  // One-time setup runs on instance 0 only (idempotent, but no need to do it N times).
  if (isPrimaryInstance) {
    if (config.gcs.migrationBucketName) {
      await getStorageService(config.gcs.migrationBucketName).ensureBucketExists().catch((e: unknown) =>
        logger.error('[SlackMigration] failed to ensure migration bucket exists', {
          bucket: config.gcs.migrationBucketName, error: e instanceof Error ? e.message : String(e),
        }),
      );
    } else {
      logger.warn('[SlackMigration] MIGRATION_GCS_BUCKET is not set — migration jobs will fail until it is configured');
    }
    await queues.pauseIngestionOnFirstInit().catch((e: unknown) =>
      logger.error('[SlackMigration] failed to initialise ingestion queue paused', { error: e instanceof Error ? e.message : String(e) }),
    );
  }

  new MigrationWorkers(queues, store, engine).register();
  logger.info('[SlackMigration] worker process up', {
    instance: process.env.NODE_APP_INSTANCE ?? 'single',
    ingestConcurrency: config.slackMigration.ingestConcurrency,
  });
}

void boot().catch((e: unknown) =>
  logger.error('[SlackMigration] worker boot failed', { error: e instanceof Error ? (e.stack ?? e.message) : String(e) }),
);
