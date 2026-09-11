import { Router } from 'express';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
 * Workers are opt-in via RUN_SLACK_MIGRATION_WORKERS; the API router is always mounted.
 *
 * MIGRATION_WORKER_PROCESSES scales the WORKERS without any deploy/CMD change: when > 1, this process (still serving
 * everything else) forks that many `workerMain` CHILD processes that run ONLY the migration workers — so nothing else
 * runs N×, and index.ts is untouched. When = 1, the workers run in-process here as before.
 */
const store = new MigrationStore();
const queues = new MigrationQueues();
const engine = new SlackMigrationEngine();
const service = new SlackMigrationService(store, queues, engine);

/** Fork N dedicated worker children (workers only, no HTTP). Each gets a NODE_APP_INSTANCE; instance 0 owns the
 *  singleton duties. MIGRATION_WORKER_PROCESSES=1 in the child env stops it from forking again. Respawns on crash. */
function forkMigrationWorkerChildren(count: number): void {
  const usingTs = import.meta.url.endsWith('.ts');
  const workerPath = fileURLToPath(new URL(usingTs ? './workerMain.ts' : './workerMain.js', import.meta.url));
  const instanceByPid = new Map<number, string>();
  let stopping = false;

  const spawn = (instance: string): void => {
    const child = fork(workerPath, [], {
      env: { ...process.env, MIGRATION_WORKER_PROCESSES: '1', MIGRATION_WORKER_CHILD: '1', NODE_APP_INSTANCE: instance },
    });
    if (child.pid) instanceByPid.set(child.pid, instance);
    child.on('exit', (code, signal) => {
      if (child.pid) instanceByPid.delete(child.pid);
      if (stopping) return;
      logger.warn('[SlackMigration] worker child exited — respawning', { instance, code, signal });
      spawn(instance);
    });
  };

  for (let i = 0; i < count; i++) spawn(String(i));
  logger.info('[SlackMigration] forked migration worker children', { count });

  const stop = (): void => {
    stopping = true;
    for (const pid of instanceByPid.keys()) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (config.runSlackMigrationWorkers) {
  const procs = Math.max(1, config.slackMigration.workerProcesses);
  if (procs > 1 && !process.env.MIGRATION_WORKER_CHILD) {
    // Multi-process: the workers run in forked children; this process keeps serving the API + everything else.
    forkMigrationWorkerChildren(procs);
  } else {
    // Single in-process worker (procs = 1) — unchanged behaviour.
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
}

const router: Router = buildRouter(service);
export default router;
