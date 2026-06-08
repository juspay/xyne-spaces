/**
 * Slack Migration Nightly Worker
 *
 * Two cron jobs:
 *   1. 12 AM IST (18:30 UTC) — Single snapshot: enqueue ALL pending rows (daily + one-time)
 *      Runs at midnight IST so "yesterday" = full previous calendar day (00:00–23:59 IST)
 *   2.  7 AM IST (01:30 UTC) — Cleanup: remove any unprocessed stale jobs
 */

import Bull from 'bull';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { redisService } from '@/services/redisService';
import {
  getSlackMigrationQueue,
  SlackMigrationJobData,
  closeSlackMigrationQueue,
} from '@/queues/slackMigrationQueue';
import { readSheetRows, updateSheetRowStatus } from '@/migration/slack/googleSheetsService';
import { runMigration } from '@/migration/slack/slackConversationService';

// ─── IST helpers ─────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function nowIST(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/** Format a Date (assumed already in IST) to dd-mm-yyyy */
function formatISTDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/** Convert dd-mm-yyyy → YYYY-MM-DD for runMigration */
function toISODate(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('-');
  return `${yyyy}-${mm}-${dd}`;
}

/** Yesterday in IST as YYYY-MM-DD */
function yesterdayISODate(): string {
  const ist = nowIST();
  ist.setUTCDate(ist.getUTCDate() - 1);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Parse a simple "MM HH * * *" cron string into { hour, minute } (UTC).
 * Returns null if the string doesn't match the expected format.
 */
function parseCronHourMinute(cron: string): { hour: number; minute: number } | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const minute = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);
  if (isNaN(hour) || isNaN(minute)) return null;
  return { hour, minute };
}

/**
 * Returns true if the current UTC time falls between the sync cron fire time
 * and the cleanup cron fire time — i.e. the migration window is open.
 *
 * Example: syncCron = "30 18 * * *" (18:30 UTC), cleanupCron = "30 1 * * *" (01:30 UTC)
 * → window is 18:30 UTC → 01:30 UTC (crosses midnight).
 */
function isInMigrationWindow(): boolean {
  const syncTime = parseCronHourMinute(config.autoSyncSlackChannel.syncCron);
  const cleanupTime = parseCronHourMinute(config.autoSyncSlackChannel.cleanupCron);
  if (!syncTime || !cleanupTime) return false;

  const now = new Date();
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const syncMinutes = syncTime.hour * 60 + syncTime.minute;
  const cleanupMinutes = cleanupTime.hour * 60 + cleanupTime.minute;

  if (syncMinutes > cleanupMinutes) {
    // Window crosses midnight (e.g. 18:30 → 01:30 next day)
    return nowMinutes >= syncMinutes || nowMinutes < cleanupMinutes;
  }
  // Window within the same calendar day
  return nowMinutes >= syncMinutes && nowMinutes < cleanupMinutes;
}

// ─── Snapshot + Enqueue (12 AM IST) ──────────────────────────────────────────

async function snapshotAndEnqueue(): Promise<void> {
  logger.info('[SLACK-MIGRATION-WORKER] 12AM cron fired — reading sheet');

  const runDate = formatISTDate(nowIST()); // e.g. "22-05-2026"
  let rows;

  try {
    rows = await readSheetRows();
  } catch (err) {
    logger.error('[SLACK-MIGRATION-WORKER] Failed to read Google Sheet:', err);
    return;
  }

  const queue = getSlackMigrationQueue();
  let enqueued = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.xyneChannelId) {
      logger.warn(`[SLACK-MIGRATION-WORKER] Row ${row.rowIndex} missing Xyne channel ID — skipping`);
      skipped++;
      continue;
    }

    // One-time: skip if already successfully migrated
    if (!row.isDaily && row.status.startsWith('Migrated')) {
      skipped++;
      continue;
    }

    // Compute sync window
    let syncDate: string;
    let syncEndDate: string | undefined;
    if (row.isDaily) {
      // Midnight IST — yesterday = full previous calendar day, no bleed into today
      syncDate = yesterdayISODate();
      syncEndDate = syncDate;
    } else {
      try {
        syncDate = toISODate(row.fromDate);
      } catch {
        logger.warn(`[SLACK-MIGRATION-WORKER] Row ${row.rowIndex} invalid date "${row.fromDate}" — skipping`);
        skipped++;
        continue;
      }
    }

    const jobData: SlackMigrationJobData = {
      rowIndex: row.rowIndex,
      slackChannelName: row.slackChannelName,
      slackChannelId: row.slackChannelId,
      xyneChannelId: row.xyneChannelId,
      syncDate,
      syncEndDate,
      postNotification: row.postNotification,
      isDaily: row.isDaily,
      runDate,
    };

    const jobId = `slack-migration:${runDate}:${row.slackChannelId}`;

    try {
      await queue.add(jobData, { jobId });
      enqueued++;
      logger.info(`[SLACK-MIGRATION-WORKER] Enqueued #${row.slackChannelName} (${row.slackChannelId}, row ${row.rowIndex})`);
    } catch (err: any) {
      if (err?.message?.includes('already exists')) {
        logger.info(`[SLACK-MIGRATION-WORKER] #${row.slackChannelName} already queued — skipping duplicate`);
      } else {
        logger.error(`[SLACK-MIGRATION-WORKER] Failed to enqueue #${row.slackChannelName}:`, err);
      }
    }
  }

  logger.info(
    `[SLACK-MIGRATION-WORKER] Nightly batch ready — enqueued: ${enqueued}, skipped: ${skipped}, total rows: ${rows.length}`,
  );
}

// ─── Cleanup (7 AM IST) ───────────────────────────────────────────────────────

async function cleanupExpiredJobs(): Promise<void> {
  logger.info('[SLACK-MIGRATION-WORKER] 7AM cleanup cron fired');

  const queue = getSlackMigrationQueue();

  try {
    const [waiting, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getDelayed(),
    ]);

    const toRemove = [...waiting, ...delayed];

    if (toRemove.length === 0) {
      logger.info('[SLACK-MIGRATION-WORKER] No unprocessed jobs to clean up — queue was empty');
      return;
    }

    await Promise.all(toRemove.map((job) => job.remove()));

    logger.warn(
      `[SLACK-MIGRATION-WORKER] 7AM window closed. Removed ${toRemove.length} unprocessed channel job(s). They will be picked up tonight.`,
    );
  } catch (err) {
    logger.error('[SLACK-MIGRATION-WORKER] Cleanup cron error:', err);
  }
}

// ─── Job Processor ────────────────────────────────────────────────────────────

async function processJob(job: Bull.Job<SlackMigrationJobData>): Promise<void> {
  const { rowIndex, slackChannelName, slackChannelId, xyneChannelId, syncDate, syncEndDate, postNotification, isDaily, runDate } =
    job.data;

  logger.info(
    `[SLACK-MIGRATION-WORKER] Processing #${slackChannelName} (${slackChannelId}, row ${rowIndex}, syncDate ${syncDate})`,
  );

  try {
    const result = await runMigration({
      syncDate,
      syncEndDate,
      channelId: slackChannelId,
      xyneSpaceChannelId: xyneChannelId,
      userId: 'system-nightly',
      syncOptions: ['include_threads', 'include_attachments', 'include_deactivated_users', 'include_bot_messages'],
      postChannelAnnouncement: postNotification,
      isDaily,
    });

    if (!result.success) {
      throw new Error(result.error || 'runMigration returned success=false');
    }

    // Build the status label
    const successStatus = isDaily ? `Migrated (${runDate})` : 'Migrated';
    await updateSheetRowStatus(rowIndex, successStatus, '').catch((e) =>
      logger.error(`[SLACK-MIGRATION-WORKER] Sheet writeback failed for row ${rowIndex}:`, e),
    );

    logger.info(
      `[SLACK-MIGRATION-WORKER] ✅ #${slackChannelName} (${slackChannelId}) migrated successfully (row ${rowIndex})`,
    );
  } catch (err: any) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error(`[SLACK-MIGRATION-WORKER] ❌ #${slackChannelName} (${slackChannelId}) failed: ${reason}`);

    // Write failure back to sheet immediately
    await updateSheetRowStatus(rowIndex, 'Failed', reason).catch((e) =>
      logger.error(`[SLACK-MIGRATION-WORKER] Sheet failure writeback failed for row ${rowIndex}:`, e),
    );

    throw err; // let Bull handle retries
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

class SlackMigrationWorker {
  private snapshotQueue: Bull.Queue | null = null; // 12 AM IST
  private cleanupQueue: Bull.Queue | null = null;  // 7 AM IST
  private isInitialized = false;

  async start(): Promise<void> {
    if (this.isInitialized) return;

    const inWindow = isInMigrationWindow();

    // Always flush the queue on startup — removes stale or leftover jobs from any
    // previous run (today's or older). When inside the migration window we will
    // immediately re-enqueue via snapshotAndEnqueue() below, which is idempotent:
    // channels already marked "Migrated" are skipped, only pending ones get queued.
    try {
      const redis = redisService.getClient();
      const keys = await redis.keys('bull:slack-migration-nightly:*');
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.info(`[SLACK-MIGRATION-WORKER] Flushed ${keys.length} stale Redis key(s) on startup`);
      }
    } catch (err) {
      logger.warn('[SLACK-MIGRATION-WORKER] Could not flush stale Redis keys on startup:', err);
    }

    const redisConfig = { ...redisService.getRedisConfig(), lazyConnect: false };

    // Main processing queue — concurrency controlled by SLACK_MIGRATION_CONCURRENCY (default: 2)
    const concurrency = config.autoSyncSlackChannel.concurrency;
    const processQueue = getSlackMigrationQueue();
    processQueue.process(concurrency, processJob);

    // ── Snapshot cron: 12 AM IST = 18:30 UTC ───────────────────────────────────
    // Handles all rows: daily (yesterday window) + one-time (explicit date)
    this.snapshotQueue = new Bull('slack-migration-snapshot-cron', { redis: redisConfig });
    this.snapshotQueue.process(async () => { await snapshotAndEnqueue(); });
    // Remove existing repeatable before re-registering so cron updates take effect on restart.
    // IMPORTANT: do NOT set removeOnComplete inside add() for repeatable jobs — in Bull 4.x
    // that causes the repeatable pattern itself to be deleted after the first fire (job fires once, never again).
    try { await this.snapshotQueue.removeRepeatableByKey('slack-migration-snapshot-repeatable'); } catch (_) { /* no-op */ }
    await this.snapshotQueue.add(
      {},
      {
        repeat: { cron: config.autoSyncSlackChannel.syncCron, tz: 'UTC' }, // controlled via SLACK_MIGRATION_SYNC_CRON (default: 12 AM IST)
        jobId: 'slack-migration-snapshot-repeatable',
      },
    );

    // ── Cleanup cron: 7 AM IST = 01:30 UTC ───────────────────────────────────
    this.cleanupQueue = new Bull('slack-migration-cleanup-cron', { redis: redisConfig });
    this.cleanupQueue.process(async () => { await cleanupExpiredJobs(); });
    try { await this.cleanupQueue.removeRepeatableByKey('slack-migration-cleanup-repeatable'); } catch (_) { /* no-op */ }
    await this.cleanupQueue.add(
      {},
      {
        repeat: { cron: config.autoSyncSlackChannel.cleanupCron, tz: 'UTC' }, // controlled via SLACK_MIGRATION_CLEANUP_CRON (default: 7 AM IST)
        jobId: 'slack-migration-cleanup-repeatable',
      },
    );

    this.isInitialized = true;
    logger.info(
      `[SLACK-MIGRATION-WORKER] Started — snapshot cron: ${config.autoSyncSlackChannel.syncCron}, cleanup cron: ${config.autoSyncSlackChannel.cleanupCron}, concurrency: ${concurrency}`,
    );

    // ── Recovery: re-enqueue if we restarted inside the migration window ─────
    // The processor is already registered above, so any re-enqueued jobs will
    // be picked up immediately. snapshotAndEnqueue skips rows already marked
    // "Migrated …" so this is fully idempotent.
    if (inWindow) {
      logger.info('[SLACK-MIGRATION-WORKER] Re-enqueuing channels after restart within migration window');
      snapshotAndEnqueue().catch((err) => {
        logger.error('[SLACK-MIGRATION-WORKER] Recovery re-enqueue failed:', err);
      });
    }
  }

  async stop(): Promise<void> {
    await Promise.all([
      this.snapshotQueue?.close(),
      this.cleanupQueue?.close(),
      closeSlackMigrationQueue(),
    ]);
    this.snapshotQueue = null;
    this.cleanupQueue = null;
    this.isInitialized = false;
    logger.info('[SLACK-MIGRATION-WORKER] Stopped');
  }
}

export const slackMigrationWorker = new SlackMigrationWorker();
