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
import { readSheetRows, updateSheetRowStatus, updateSheetLastSyncedDate } from '@/migration/slack/googleSheetsService';
import { runMigration, resolveOrCreateChannel } from '@/migration/slack/slackConversationService';
import { getBotConfigByWorkspaceId } from '@/migration/slack/slackMigrationBotConfig';
import { db } from '@/database/client';

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

/** Convert dd-mm-yyyy or yyyy-mm-dd → YYYY-MM-DD for runMigration */
function toISODate(dateInput: string): string {
  const parts = dateInput.split('-');
  if (parts.length !== 3) {
    throw new Error(`Invalid date format: ${dateInput}. Expected dd-mm-yyyy or yyyy-mm-dd.`);
  }
  // If first part is 4 digits → yyyy-mm-dd (already ISO)
  if (parts[0].length === 4) {
    return dateInput;
  }
  // Otherwise assume dd-mm-yyyy → flip to yyyy-mm-dd
  const [dd, mm, yyyy] = parts;
  return `${yyyy}-${mm}-${dd}`;
}

/** Yesterday in IST as YYYY-MM-DD */
function yesterdayISODate(): string {
  const ist = nowIST();
  ist.setUTCDate(ist.getUTCDate() - 1);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

/** Add one calendar day to a YYYY-MM-DD date string */
function addOneDayISO(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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
    let xyneChannelId = row.xyneChannelId;

    // Auto-resolve or create channel when xyneChannelId is empty but projectId is provided
    if (!xyneChannelId && row.projectId) {
      const project = await db.project.findUnique({ where: { id: row.projectId }, select: { workspaceId: true } });
      const workspaceId = project?.workspaceId;
      if (workspaceId) {
        const wsConfig = getBotConfigByWorkspaceId(workspaceId);
        const resolvedId = await resolveOrCreateChannel(
          row.slackChannelName,
          row.slackChannelId,
          row.projectId,
          workspaceId,
          wsConfig.slackBotToken,
        );
        if (resolvedId) {
          xyneChannelId = resolvedId;
        } else {
          logger.error(`[SLACK-MIGRATION-WORKER] Row ${row.rowIndex} failed to resolve/create channel — skipping`);
          skipped++;
          continue;
        }
      } else {
        logger.warn(`[SLACK-MIGRATION-WORKER] Row ${row.rowIndex} has invalid projectId (no workspace) — skipping`);
        skipped++;
        continue;
      }
    }

    if (!xyneChannelId) {
      logger.warn(`[SLACK-MIGRATION-WORKER] Row ${row.rowIndex} missing Xyne channel ID and projectId — skipping`);
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
      // Skip if this channel already completed today's daily sync
      if (row.lastSyncedDate === syncDate) {
        logger.info(`[SLACK-MIGRATION-WORKER] #${row.slackChannelName} already synced for ${syncDate} — skipping`);
        skipped++;
        continue;
      }
    } else {
      try {
        // Resume from the day after the last completed batch, or start fresh from fromDate
        if (row.lastSyncedDate) {
          syncDate = addOneDayISO(row.lastSyncedDate);
          // If we've already caught up to today or beyond, the migration is done
          const todayUTC = new Date().toISOString().slice(0, 10);
          if (syncDate >= todayUTC) {
            logger.info(`[SLACK-MIGRATION-WORKER] #${row.slackChannelName} already caught up (lastSyncedDate ${row.lastSyncedDate}) — skipping`);
            skipped++;
            continue;
          }
          logger.info(`[SLACK-MIGRATION-WORKER] #${row.slackChannelName} resuming from ${syncDate} (lastSyncedDate was ${row.lastSyncedDate})`);
        } else {
          syncDate = toISODate(row.fromDate);
        }
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
      xyneChannelId,
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
      onBatchComplete: async (batchEndDate: string) => {
        await updateSheetLastSyncedDate(rowIndex, batchEndDate).catch((e) =>
          logger.error(`[SLACK-MIGRATION-WORKER] Per-batch lastSyncedDate writeback failed for row ${rowIndex}:`, e),
        );
      },
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
    // Remove ALL existing repeatables before re-registering.
    // removeRepeatableByKey(jobId) does NOT work when the cron expression changes between
    // deployments — Bull embeds the cron in the internal Redis key, so a changed cron
    // creates a new key and the old one lingers, causing both schedules to fire.
    // Fetching + removing all repeatables is the only reliable way to ensure a clean slate.
    // IMPORTANT: do NOT set removeOnComplete inside add() for repeatable jobs — in Bull 4.x
    // that causes the repeatable pattern itself to be deleted after the first fire (job fires once, never again).
    try {
      const existingSnapRepeatables = await this.snapshotQueue.getRepeatableJobs();
      await Promise.all(existingSnapRepeatables.map((r) => this.snapshotQueue!.removeRepeatableByKey(r.key)));
      if (existingSnapRepeatables.length > 0) {
        logger.info(`[SLACK-MIGRATION-WORKER] Removed ${existingSnapRepeatables.length} stale snapshot repeatable(s) from Redis`);
      }
    } catch (err) {
      logger.warn('[SLACK-MIGRATION-WORKER] Could not clear stale snapshot repeatables:', err);
    }
    await this.snapshotQueue.add(
      {},
      {
        repeat: { cron: config.autoSyncSlackChannel.syncCron, tz: 'UTC' }, // controlled via SLACK_MIGRATION_SYNC_CRON (default: 12 AM IST)
        jobId: 'slack-migration-snapshot-repeatable',
      },
    );
    logger.info(`[SLACK-MIGRATION-WORKER] Registered snapshot cron: ${config.autoSyncSlackChannel.syncCron}`);

    // ── Cleanup cron: 7 AM IST = 01:30 UTC ───────────────────────────────────
    this.cleanupQueue = new Bull('slack-migration-cleanup-cron', { redis: redisConfig });
    this.cleanupQueue.process(async () => { await cleanupExpiredJobs(); });
    try {
      const existingCleanupRepeatables = await this.cleanupQueue.getRepeatableJobs();
      await Promise.all(existingCleanupRepeatables.map((r) => this.cleanupQueue!.removeRepeatableByKey(r.key)));
      if (existingCleanupRepeatables.length > 0) {
        logger.info(`[SLACK-MIGRATION-WORKER] Removed ${existingCleanupRepeatables.length} stale cleanup repeatable(s) from Redis`);
      }
    } catch (err) {
      logger.warn('[SLACK-MIGRATION-WORKER] Could not clear stale cleanup repeatables:', err);
    }
    await this.cleanupQueue.add(
      {},
      {
        repeat: { cron: config.autoSyncSlackChannel.cleanupCron, tz: 'UTC' }, // controlled via SLACK_MIGRATION_CLEANUP_CRON (default: 7 AM IST)
        jobId: 'slack-migration-cleanup-repeatable',
      },
    );
    logger.info(`[SLACK-MIGRATION-WORKER] Registered cleanup cron: ${config.autoSyncSlackChannel.cleanupCron}`);

    this.isInitialized = true;
    logger.info(
      `[SLACK-MIGRATION-WORKER] Started — snapshot cron: ${config.autoSyncSlackChannel.syncCron}, cleanup cron: ${config.autoSyncSlackChannel.cleanupCron}, concurrency: ${concurrency} (all previous repeatables cleared on startup)`,
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
