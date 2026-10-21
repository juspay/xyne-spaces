/**
 * Worker entry for the self-serve Slack migration — booted as a forked CHILD by the migration composition root
 * (`self-serve/index.ts`) when MIGRATION_WORKER_PROCESSES > 1, one child per process. It runs the migration WORKERS
 * only (no HTTP, no other app services), so the main app process keeps serving everything else as a single copy.
 *
 * Every child drains the fanned-out conversation jobs for cross-process (and cross-pod) parallelism; the singleton
 * duties (collection / ingestion planner / reconcile) run on exactly ONE worker cluster-wide, elected via a Redis
 * leader lease (see workers.ts). This process never forks again — the supervisor lives in the composition root.
 */
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { initializeOpenTelemetry } from '@/services/otel';
import { getStorageService } from '@/services/storage';
import { vespaQueue, vespaBackfillQueue } from '@/queues/vespaQueue';
import { superpositionClient } from '@/services/superpositionClient';
import { MigrationStore } from './store';
import { MigrationQueues } from './queues';
import { SlackMigrationEngine } from './engine';
import { MigrationWorkers } from './workers';
import { registerMigrationMetrics } from './migrationMetrics';

// Log the ORIGINAL rejection's stack (not this handler's frame) so an unawaited failure is actually diagnosable.
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('[SlackMigration] UNHANDLED REJECTION', {
    error: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  });
});
process.on('uncaughtException', (error: Error) => {
  logger.error('[SlackMigration] UNCAUGHT EXCEPTION', { error });
});
// In-flight conversations cut off by a restart are recovered by the reconcile watchdog + per-conversation dedup, so an
// immediate exit is safe. First release the leader lease (if this worker held it) so another takes over instantly; the
// lease TTL is the backstop if this never completes. A hard cap guarantees we never hang on shutdown.
let workers: MigrationWorkers | undefined;
const gracefulExit = (signal: string): void => {
  logger.info(`[SlackMigration] worker received ${signal} — releasing leadership & exiting`);
  void (async () => {
    try { await workers?.shutdown(); } catch { /* TTL reclaims the lease */ }
    process.exit(0);
  })();
  setTimeout(() => process.exit(0), 5000).unref?.();
};
process.on('SIGTERM', () => gracefulExit('SIGTERM'));
process.on('SIGINT', () => gracefulExit('SIGINT'));

async function boot(): Promise<void> {
  // Forked children don't boot through app.ts, so start the OTel SDK here or the slack_migration_* gauges never export.
  initializeOpenTelemetry();
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

  // Boot setup is idempotent (bucket ensure; NX-guarded first-init pause; isPaused-guarded kill-switch; global Redis
  // pauses), so every worker can run it safely — no "primary instance" needed now that the leader is elected at runtime.
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
  // Kill-switch: with MIGRATION_INGEST_CONTROL off, pause the ingestion queues if they were left running.
  if (!config.slackMigration.ingestControlEnabled) {
    const paused = await queues.pauseIngestionIfRunning().catch(() => false);
    if (paused) logger.warn('[SlackMigration] ingestion paused on boot — MIGRATION_INGEST_CONTROL is off');
  }

  workers = new MigrationWorkers(queues, store, engine);
  workers.register();
  registerMigrationMetrics(queues, store, () => workers!.isLeader()); // dashboard gauges — leader reports, so counts aren't N×
  logger.info('[SlackMigration] worker process up', {
    instance: process.env.NODE_APP_INSTANCE ?? 'single',
    ingestConcurrency: config.slackMigration.ingestConcurrency,
  });
}

void boot().catch((e: unknown) =>
  logger.error('[SlackMigration] worker boot failed', { error: e instanceof Error ? (e.stack ?? e.message) : String(e) }),
);
