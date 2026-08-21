import { logger } from '@/utils/logger';
import { MigrationStore } from './store';
import { MigrationQueues } from './queues';
import { SlackMigrationEngine } from './engine';
import { MigrationJob, MigrationStatus, MigrationType, QueueName } from './types';

const HEARTBEAT_MS = 15_000;
const RECONCILE_EVERY_MS = 60_000;
const RECLAIM_STALE_MS = 90_000; // several missed heartbeats ⇒ the pod that owned the job is gone

/** Bull processors for the two queues, each with lifecycle + heartbeat + cooperative stop. */
export class MigrationWorkers {
  constructor(
    private readonly queues: MigrationQueues,
    private readonly store: MigrationStore,
    private readonly engine: SlackMigrationEngine,
  ) {}

  register(): void {
    this.queues.process(QueueName.COLLECTION, (id) => this.guard(id, (j) => this.collect(j)));
    this.queues.process(QueueName.INGESTION, (id) => this.guard(id, (j) => this.ingest(j)));
    logger.info('[SlackMigration] workers registered (collection + ingestion processors active)');
    // Recover jobs orphaned by a pod kill (stuck COLLECTING/INGESTING, stale heartbeat). Store is the source of truth, not Bull.
    const timer = setInterval(() => void this.reconcile().catch(() => undefined), RECONCILE_EVERY_MS);
    timer.unref?.();
    void this.reconcile().catch(() => undefined);
  }

  /** Re-enqueue running jobs whose owning pod died (heartbeat went stale). */
  private async reconcile(): Promise<void> {
    const now = Date.now();
    for (const job of await this.store.list(1000, 0)) {
      const running = job.status === MigrationStatus.COLLECTING || job.status === MigrationStatus.INGESTING;
      if (!running) continue;
      if (now - (job.heartbeatAt ?? 0) < RECLAIM_STALE_MS) continue; // a live worker still owns it
      if (job.stopRequested) {
        // Owning pod died before honoring the stop — finalize to STOPPED (resumable) instead of leaving it hung.
        logger.warn('[SlackMigration] finalizing stop for orphaned migration after restart', { id: job.id, status: job.status });
        await this.store.update(job.id, { status: MigrationStatus.STOPPED });
        continue;
      }
      logger.warn('[SlackMigration] reclaiming orphaned migration after restart', {
        id: job.id, status: job.status, queue: job.currentQueue,
      });
      await this.queues.enqueue(job.currentQueue, job.id, 'end');
      await this.store.heartbeat(job.id).catch(() => undefined); // don't re-reclaim before the worker starts
    }
  }

  private async collect(job: MigrationJob): Promise<void> {
    // Idempotency: a duplicate/stale delivery must not reprocess past collection (re-collecting after the token was dropped fails it).
    if ([MigrationStatus.AWAITING_APPROVAL, MigrationStatus.INGESTING, MigrationStatus.COMPLETED].includes(job.status)) return;
    const token = this.engine.decryptToken(job);
    await this.store.update(job.id, { status: MigrationStatus.COLLECTING });
    logger.info('[SlackMigration] collection started', { id: job.id, type: job.type });

    await this.engine.collectDirectory(token, job.gcsPrefix);
    await this.engine.collectUsergroups(token, job.gcsPrefix);
    await this.engine.collectChannels(token, job.gcsPrefix);
    const conversations = await this.engine.listConversations(token, job.type, job.channelInput);
    await this.engine.writeManifest(job.gcsPrefix, conversations);
    await this.store.update(job.id, { checkpoint: { ...job.checkpoint, totalConversations: conversations.length } });
    logger.info('[SlackMigration] collecting conversations', { id: job.id, total: conversations.length });

    const done = new Set(job.checkpoint.collectedConversationIds);
    // A channel is a single conversation (conversation bar meaningless) and Slack gives no message total, so report progress
    // through the date window [start, newest message], where start = chosen startDate or the channel's creation ts.
    const isChannel = job.type === MigrationType.CHANNEL;
    const windowStart = job.channelInput?.startDate
      ? Math.floor(Date.parse(job.channelInput.startDate) / 1000)
      : (job.slackChannelCreated ?? 0);
    for (const conv of conversations) {
      if (await this.store.isStopRequested(job.id)) {
        logger.info('[SlackMigration] stop requested — halting at next conversation', { id: job.id, queue: job.currentQueue });
        return void this.store.update(job.id, { status: MigrationStatus.STOPPED });
      }
      if (done.has(conv.id)) continue;
      const messages = await this.engine.collectConversation(
        token, conv, job.gcsPrefix, job.channelInput?.startDate,
        isChannel
          ? (p) => this.store.setChannelProgress(job.id, { messages: p.messages, start: windowStart, end: p.newestTs, through: p.oldestTs })
          : undefined,
      );
      await this.store.addCollected(job.id, conv.id, isChannel ? 0 : messages); // channel count already live via setChannelProgress
    }

    // Collection done → approval gate; drop the token immediately (§5.7).
    await this.store.update(job.id, { status: MigrationStatus.AWAITING_APPROVAL, encryptedToken: undefined });
    logger.info('[SlackMigration] collection complete → awaiting approval', { id: job.id, total: conversations.length });
  }

  private async ingest(job: MigrationJob): Promise<void> {
    // Idempotency: never re-ingest a completed job (its GCS data is already deleted).
    if ([MigrationStatus.SUBMITTED, MigrationStatus.COLLECTING, MigrationStatus.COMPLETED].includes(job.status)) return;
    await this.store.update(job.id, { status: MigrationStatus.INGESTING });
    const conversations = await this.engine.readManifest(job.gcsPrefix);
    logger.info('[SlackMigration] ingestion started', { id: job.id, total: conversations.length });
    // Build the offline reference once per job so ingestion resolves users/usergroups/channels from the dumps, never Slack.
    const ref = await this.engine.buildOfflineReference(job.gcsPrefix);
    const done = new Set(job.checkpoint.ingestedConversationIds);

    for (const conv of conversations) {
      if (await this.store.isStopRequested(job.id)) {
        logger.info('[SlackMigration] stop requested — halting at next conversation', { id: job.id, queue: job.currentQueue });
        return void this.store.update(job.id, { status: MigrationStatus.STOPPED });
      }
      if (done.has(conv.id)) continue;
      await this.engine.loadConversation(job, conv, ref);
      await this.store.addIngested(job.id, conv.id);
    }

    await this.engine.announceMigration(job); // opt-in Slack notice; no-op unless enabled
    await this.engine.deletePrefix(job.gcsPrefix);
    await this.store.update(job.id, { status: MigrationStatus.COMPLETED, completedAt: Date.now() });
    logger.info('[SlackMigration] ingestion complete', { id: job.id, total: conversations.length });
  }

  /** Loads the record, runs a heartbeat ticker, and centralizes failure marking. */
  private async guard(id: string, work: (job: MigrationJob) => Promise<void>): Promise<void> {
    const job = await this.store.findById(id);
    if (!job) return;
    logger.info('[SlackMigration] worker picked up job', { id, queue: job.currentQueue, status: job.status });
    const heartbeat = setInterval(() => void this.store.heartbeat(id).catch(() => undefined), HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      await work(job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.store.update(id, { status: MigrationStatus.FAILED, error: message }).catch(() => undefined);
      logger.error('[SlackMigration] job failed', { id, message });
    } finally {
      clearInterval(heartbeat);
    }
  }
}
