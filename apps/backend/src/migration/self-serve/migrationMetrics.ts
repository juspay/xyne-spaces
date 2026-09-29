import { metrics } from '@opentelemetry/api';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { MigrationQueues } from './queues';
import { MigrationStore } from './store';
import { MigrationStatus, MigrationType, QueueName } from './types';

/**
 * OpenTelemetry gauges for the self-serve Slack migration, mirroring the Vespa backfill queue metrics
 * (services/otel/vespaMetrics.ts). Each is an observable gauge sampled at scrape time:
 *
 *   slack_migration_queue_{waiting,active,completed,failed,delayed,total}{queue="<name>"}
 *   slack_migration_jobs{status="<MigrationStatus>"}
 *
 * Register on the primary instance only (the counts are Redis/DB-global, so one reporter avoids N× series).
 */
const QUEUE_STATES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'total'] as const;
const QUEUE_NAMES = [QueueName.COLLECTION, QueueName.INGESTION, QueueName.CONV_INGEST];

// Short cache so many scrapes (or multiple scrapers) don't each run a store.list(). The cached promise is shared
// by concurrent scrapes, and dropped on failure so the next scrape retries.
const JOB_AGG_TTL_MS = 15_000;
type Bucket = { status: string; type: string; jobs: number; messages: number; conversations: number };
type JobAggregate = Record<string, Bucket>;
let _aggCache: { at: number; value: Promise<JobAggregate> } | null = null;

function sampleJobAggregate(store: MigrationStore): Promise<JobAggregate> {
  const now = Date.now();
  if (_aggCache && now - _aggCache.at < JOB_AGG_TTL_MS) return _aggCache.value;
  const value = (async () => {
    const agg: JobAggregate = {};
    // Pre-seed every status×type so absent combinations report 0 (stable series, no gaps).
    for (const s of Object.values(MigrationStatus))
      for (const t of Object.values(MigrationType)) agg[`${s}::${t}`] = { status: s, type: t, jobs: 0, messages: 0, conversations: 0 };
    for (const j of await store.list(5000, 0)) {
      const a = (agg[`${j.status}::${j.type}`] ??= { status: j.status, type: j.type, jobs: 0, messages: 0, conversations: 0 });
      a.jobs += 1;
      a.messages += j.stats?.messages ?? 0;
      a.conversations += j.stats?.conversations ?? 0;
    }
    return agg;
  })();
  _aggCache = { at: now, value };
  value.catch(() => { if (_aggCache?.value === value) _aggCache = null; });
  return value;
}

let _registered = false;
export function registerMigrationMetrics(queues: MigrationQueues, store: MigrationStore): void {
  if (_registered) return;
  _registered = true;
  const meter = metrics.getMeter(config.otel.serviceName);

  for (const state of QUEUE_STATES) {
    meter
      .createObservableGauge(`slack_migration_queue_${state}`, {
        description: `Slack migration queue ${state} job count`,
      })
      .addCallback(async (result) => {
        for (const name of QUEUE_NAMES) {
          try {
            const stats = await queues.getStats(name);
            result.observe(stats[state], { queue: name });
          } catch (e) {
            logger.warn('[SlackMigration] queue metric sample failed', { queue: name, state, error: e instanceof Error ? e.message : String(e) });
          }
        }
      });
  }

  // Store-derived gauges (jobs / messages / conversations) grouped by migration status. These read the retained
  // job records, so they reflect ALL historical jobs still in the store — e.g. slack_migration_messages{status="COMPLETED"}
  // is the cumulative messages ingested across every completed job, populated the moment this deploys (not from zero).
  // One batch callback so the whole set is computed from a single store.list() per scrape.
  const jobsGauge = meter.createObservableGauge('slack_migration_jobs', { description: 'Slack migration jobs by status' });
  const messagesGauge = meter.createObservableGauge('slack_migration_messages', { description: 'Slack migration messages by job status' });
  const conversationsGauge = meter.createObservableGauge('slack_migration_conversations', { description: 'Slack migration conversations by job status' });

  meter.addBatchObservableCallback(
    async (result) => {
      try {
        const agg = await sampleJobAggregate(store);
        for (const a of Object.values(agg)) {
          const attrs = { status: a.status, type: a.type };
          result.observe(jobsGauge, a.jobs, attrs);
          result.observe(messagesGauge, a.messages, attrs);
          result.observe(conversationsGauge, a.conversations, attrs);
        }
      } catch (e) {
        logger.warn('[SlackMigration] jobs/messages metric sample failed', { error: e instanceof Error ? e.message : String(e) });
      }
    },
    [jobsGauge, messagesGauge, conversationsGauge],
  );

  logger.info('[SlackMigration] migration metrics registered');
}
