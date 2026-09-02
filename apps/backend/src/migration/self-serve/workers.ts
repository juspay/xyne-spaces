import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { MigrationStore } from './store';
import { MigrationQueues } from './queues';
import { SlackMigrationEngine, type CollectedConversation, type DirUser } from './engine';
import { MigrationJob, MigrationStatus, MigrationType, QueueName } from './types';

const HEARTBEAT_MS = 15_000;
const RECONCILE_EVERY_MS = 60_000;
const RECLAIM_STALE_MS = 90_000; // several missed heartbeats ⇒ the pod that owned the job is gone
const STALL_LIMIT_MS = config.slackMigration.stallLimitMs; // live heartbeat but no forward progress ⇒ worker wedged

/** Human-readable ingest duration for the completion log, e.g. "7m 12s". */
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}h ${m}m ${sec}s`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Bull processors for the two queues, each with lifecycle + heartbeat + cooperative stop. */
export class MigrationWorkers {
  constructor(
    private readonly queues: MigrationQueues,
    private readonly store: MigrationStore,
    private readonly engine: SlackMigrationEngine,
  ) {}

  register(): void {
    // Under pm2 cluster mode NODE_APP_INSTANCE is 0..N-1; single process → undefined. Singleton duties (collection,
    // the ingestion planner, and reconcile) run on instance 0 only, so they don't fire N times. Every process drains
    // the fanned-out conversation jobs for cross-process parallelism.
    const isPrimary = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
    if (isPrimary) {
      this.queues.process(QueueName.COLLECTION, (id) => this.guard(id, (j) => this.collect(j)));
      this.queues.process(QueueName.INGESTION, (id) => this.guard(id, (j) => this.ingest(j)));
      const timer = setInterval(() => void this.reconcile().catch(() => undefined), RECONCILE_EVERY_MS);
      timer.unref?.();
      void this.reconcile().catch(() => undefined);
    }
    this.queues.processConv(config.slackMigration.ingestConcurrency, (mid, cid) => this.ingestConversation(mid, cid));
    logger.info('[SlackMigration] workers registered', {
      primary: isPrimary, instance: process.env.NODE_APP_INSTANCE ?? 'single', ingestConcurrency: config.slackMigration.ingestConcurrency,
    });
  }

  /** Recover running jobs that a live worker can no longer make progress on: pod died (stale heartbeat) → re-enqueue;
   *  or wedged/looping (fresh heartbeat, no progress) → fail resumably. */
  private async reconcile(): Promise<void> {
    const now = Date.now();
    for (const job of await this.store.list(1000, 0)) {
      // Queued/submitted jobs live in Bull, not here — but recover one whose Bull entry was lost (e.g. a crash
      // between the store write and enqueue) so it can't sit stranded forever. Only re-enqueue if genuinely absent.
      if (job.status === MigrationStatus.QUEUED || job.status === MigrationStatus.SUBMITTED) {
        if (now - job.updatedAt >= RECLAIM_STALE_MS && !(await this.queues.hasJob(job.currentQueue, job.id))) {
          logger.warn('[SlackMigration] re-enqueuing stranded job (no queue entry)', { id: job.id, status: job.status });
          await this.queues.enqueue(job.currentQueue, job.id, 'end').catch(() => undefined);
        }
        continue;
      }
      const running = job.status === MigrationStatus.COLLECTING || job.status === MigrationStatus.INGESTING;
      if (!running) continue;
      // Status says running — but is a worker actually processing it? If Bull has it sitting in the wait/delayed
      // queue (bumped back by a restart/stall, or a resume jumped ahead), the "Collecting/Ingesting" status is
      // stale. Show it as QUEUED so two jobs never both look like they're running.
      const bstate = await this.queues.jobState(job.currentQueue, job.id);
      if (bstate && bstate !== 'active') {
        await this.store.update(job.id, { status: MigrationStatus.QUEUED }).catch(() => undefined);
        continue;
      }
      if (now - (job.heartbeatAt ?? 0) < RECLAIM_STALE_MS) {
        // A live worker still owns it — but is it actually progressing? A fresh heartbeat with no forward progress
        // means the worker is wedged on an unresponsive upstream (e.g. a socket killed by a laptop sleep) or stuck
        // retrying. We can't preempt the locked Bull job, so surface it as FAILED (resumable) rather than let it
        // masquerade as "running" forever. Threshold is generous so normal Slack rate-limit backoffs don't trip it.
        const lastProgress = job.progressAt ?? job.createdAt;
        if (now - lastProgress >= STALL_LIMIT_MS) {
          const minutes = Math.round((now - lastProgress) / 60_000);
          logger.error('[SlackMigration] migration stalled — live heartbeat but no progress; marking failed (resumable)', {
            id: job.id, status: job.status, stalledForMin: minutes,
          });
          await this.store.update(job.id, {
            status: MigrationStatus.FAILED,
            error: `Stalled: no progress for ~${minutes} min (worker likely wedged on an unresponsive Slack connection). Resume to retry from the last checkpoint.`,
          }).catch(() => undefined);
        }
        continue;
      }
      // Heartbeat is stale ⇒ the owning pod is gone.
      if (job.stopRequested) {
        // Owning pod died before honoring the stop — finalize to STOPPED (resumable) instead of leaving it hung.
        logger.warn('[SlackMigration] finalizing stop for orphaned migration after restart', { id: job.id, status: job.status });
        await this.store.update(job.id, { status: MigrationStatus.STOPPED });
        continue;
      }
      logger.warn('[SlackMigration] reclaiming orphaned migration after restart', {
        id: job.id, status: job.status, queue: job.currentQueue,
      });
      await this.store.update(job.id, { status: MigrationStatus.QUEUED }).catch(() => undefined); // waiting to resume, not running
      await this.queues.enqueue(job.currentQueue, job.id, 'end');
    }
  }

  private async collect(job: MigrationJob): Promise<void> {
    // Idempotency: a duplicate/stale delivery must not reprocess past collection (re-collecting after the token was dropped fails it).
    if ([MigrationStatus.AWAITING_APPROVAL, MigrationStatus.INGESTING, MigrationStatus.COMPLETED].includes(job.status)) return;
    const token = this.engine.decryptToken(job);
    await this.store.update(job.id, { status: MigrationStatus.COLLECTING });
    logger.info('[SlackMigration] collection started', { id: job.id, type: job.type });

    let conversations;
    let directory: Record<string, DirUser> = {};
    if (await this.engine.manifestExists(job.gcsPrefix)) {
      conversations = await this.engine.readManifest(job.gcsPrefix);
      directory = await this.engine.readDirectory(job.gcsPrefix); // for issue labels on resume (no Slack)
      await this.store.markProgress(job.id).catch(() => undefined);
      await this.store.update(job.id, { checkpoint: { ...job.checkpoint, totalConversations: conversations.length } });
      logger.info('[SlackMigration] reusing existing collection plan (resume)', { id: job.id, conversations: conversations.length });
    } else {
      directory = await this.engine.collectDirectory(token, job.gcsPrefix);
      await this.store.markProgress(job.id).catch(() => undefined);
      await this.engine.collectUsergroups(token, job.gcsPrefix);
      await this.engine.collectChannels(token, job.gcsPrefix, job.teamId);
      conversations = await this.engine.listConversations(token, job.type, job.channelInput);
      await this.engine.writeManifest(job.gcsPrefix, conversations);
      await this.store.markProgress(job.id).catch(() => undefined);
      await this.store.update(job.id, { checkpoint: { ...job.checkpoint, totalConversations: conversations.length } });
      logger.info('[SlackMigration] collection plan ready', { id: job.id, users: Object.keys(directory).length, conversations: conversations.length });
    }

    const done = new Set(job.checkpoint.collectedConversationIds);
    const PROGRESS_EVERY = 25;
    let collected = 0, messages = 0, skipped = 0, truncated = 0;
    // A channel is a single conversation (conversation bar meaningless) and Slack gives no message total, so report progress
    // through the date window [start, newest message], where start = chosen startDate or the channel's creation ts.
    const isChannel = job.type === MigrationType.CHANNEL;
    // Human-readable identifier for an issue: "#channel" for a channel, "DM with <names>" (resolved from the dump) for a DM.
    const labelFor = (conv: CollectedConversation): string => {
      if (isChannel) return `#${job.slackChannelName ?? conv.id}`;
      const names = conv.members
        .filter((m) => m !== job.ownerSlackId)
        .map((m) => directory[m]?.real_name || directory[m]?.display_name || m);
      return names.length ? `DM with ${names.join(', ')}` : `DM ${conv.id}`;
    };
    const windowStart = job.channelInput?.startDate
      ? Math.floor(Date.parse(job.channelInput.startDate) / 1000)
      : (job.slackChannelCreated ?? 0);
    for (const [index, conv] of conversations.entries()) {
      if (await this.store.isStopRequested(job.id)) {
        logger.info('[SlackMigration] stop requested — halting at next conversation', { id: job.id, queue: job.currentQueue });
        return void this.store.update(job.id, { status: MigrationStatus.STOPPED });
      }
      if (done.has(conv.id)) continue;
      const result = await this.engine.collectConversation(
        token, conv, job.gcsPrefix, job.channelInput?.startDate,
        isChannel
          ? (p) => this.store.setChannelProgress(job.id, { messages: p.messages, start: windowStart, end: p.newestTs, through: p.oldestTs })
          : () => this.store.markProgress(job.id), // DMs: per-page progress signal so the stall watchdog isn't tripped mid-conversation
      );
      if (result.outcome === 'skipped') {
        // Inaccessible on Slack — don't migrate it. A channel job is a single conversation, so fail
        // the whole job; a DM job records the skip and keeps going with the rest.
        if (isChannel) throw new Error(result.reason ?? 'Channel is inaccessible on Slack.');
        skipped += 1;
        await this.store.addIssue(job.id, { conversationId: conv.id, label: labelFor(conv), kind: 'skipped', reason: result.reason ?? 'Inaccessible on Slack.' });
        continue;
      }
      await this.store.addCollected(job.id, conv.id, isChannel ? 0 : result.messages); // channel count already live via setChannelProgress
      collected += 1;
      messages += result.messages;
      if (result.outcome === 'truncated') {
        truncated += 1;
        await this.store.addIssue(job.id, { conversationId: conv.id, label: labelFor(conv), kind: 'truncated', reason: result.reason ?? 'Partial — lost Slack access mid-collection.' });
      }
      if (conversations.length > PROGRESS_EVERY && (index + 1) % PROGRESS_EVERY === 0) {
        logger.info('[SlackMigration] collection progress', { id: job.id, done: index + 1, total: conversations.length, messages });
      }
    }

    // Collection done → approval gate; drop the token immediately (§5.7).
    await this.store.update(job.id, { status: MigrationStatus.AWAITING_APPROVAL, encryptedToken: undefined });
    logger.info('[SlackMigration] collection complete → awaiting approval', {
      id: job.id, conversations: conversations.length, collected, messages, skipped, truncated,
    });
  }

  /**
   * PLANNER (runs on the INGESTION queue, instance-0 only, one migration at a time): fan the conversations out
   * as CONV_INGEST jobs that every worker process drains in parallel. Idempotent — re-running on resume/restart
   * re-enqueues only conversations not yet in the done-set. Does NOT ingest anything itself.
   */
  private async ingest(job: MigrationJob): Promise<void> {
    // Idempotency: never re-plan a completed job (its GCS data is already deleted).
    if ([MigrationStatus.SUBMITTED, MigrationStatus.COLLECTING, MigrationStatus.COMPLETED].includes(job.status)) return;
    // Stamp the ingest start once (kept across resume) so the completion log/UI can report how long ingestion took.
    await this.store.update(job.id, { status: MigrationStatus.INGESTING, ...(job.ingestStartedAt ? {} : { ingestStartedAt: Date.now() }) });
    let conversations;
    try {
      conversations = await this.engine.readManifest(job.gcsPrefix);
    } catch {
      await this.store.update(job.id, { status: MigrationStatus.COMPLETED, completedAt: Date.now() });
      logger.warn('[SlackMigration] ingest manifest missing — finalizing as complete', { id: job.id });
      return;
    }
    // Dedupe by id: the done-set is a Redis SET and enqueueConv dedups by jobId, so the total must be the DISTINCT
    // count — otherwise a repeated id in the manifest makes SCARD unable to reach total and the job never finalizes.
    const uniqueConversations = [...new Map(conversations.map((c) => [c.id, c])).values()];
    // Seed the done-set from any prior checkpoint (resume, or upgrade from the old serial array) and set the total.
    await this.store.seedDoneSet(job.id, job.checkpoint.ingestedConversationIds);
    await this.store.update(job.id, { checkpoint: { ...job.checkpoint, totalConversations: uniqueConversations.length } });

    let enqueued = 0;
    for (const conv of uniqueConversations) {
      if (await this.store.isStopRequested(job.id)) {
        logger.info('[SlackMigration] stop requested — halting fan-out', { id: job.id, queue: job.currentQueue });
        return void this.store.update(job.id, { status: MigrationStatus.STOPPED });
      }
      if (await this.store.isConversationDone(job.id, conv.id)) continue;
      await this.queues.enqueueConv(job.id, conv.id);
      enqueued += 1;
    }
    logger.info('[SlackMigration] ingestion fanned out', { id: job.id, enqueued, total: conversations.length, concurrency: config.slackMigration.ingestConcurrency });
    // Nothing left to enqueue (all already done, or empty manifest) → no processor will fire, so finalize here.
    if (enqueued === 0) await this.maybeFinalize(job.id);
  }

  /**
   * PROCESSOR (runs on the CONV_INGEST queue in EVERY worker process, `ingestConcurrency`-at-a-time): ingest one
   * conversation. Marks it done atomically afterwards and, when it closes the last one, claims the once-only finalize.
   */
  private async ingestConversation(migrationId: string, conversationId: string): Promise<void> {
    const job = await this.store.findById(migrationId);
    if (!job || job.status !== MigrationStatus.INGESTING) return;          // stopped/failed/completed → drop, don't mark done
    if (await this.store.isStopRequested(migrationId)) {                   // admin stopped → flip status (old serial loop did this) and drop
      await this.store.update(migrationId, { status: MigrationStatus.STOPPED }).catch(() => undefined);
      return;
    }
    if (await this.store.isConversationDone(migrationId, conversationId)) return; // already done (stale re-delivery) → idempotent skip

    const heartbeat = setInterval(() => void this.store.heartbeat(migrationId).catch(() => undefined), HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      const conv = await this.engine.getManifestConversation(migrationId, job.gcsPrefix, conversationId);
      if (conv) {
        const ref = await this.engine.getOfflineReference(migrationId, job.gcsPrefix);
        const loaded = await this.engine.loadConversation(job, conv, ref, () => void this.store.markProgress(migrationId).catch(() => undefined));
        if (loaded.failed > 0) {
          await this.store.addIssue(migrationId, { conversationId, kind: 'ingest-error', reason: `${loaded.failed} message(s) couldn't be migrated (unresolved sender or attachment).` });
        }
      } else {
        logger.warn('[SlackMigration] conversation missing from manifest — skipping', { migrationId, conversationId });
      }
    } catch (err) {
      // Record and move on so the migration can still finalize (never stuck). A hard-failed conversation is surfaced as an issue, not auto-retried.
      logger.error('[SlackMigration] conversation ingest failed (recorded, not retried)', { migrationId, conversationId, error: err instanceof Error ? err.message : String(err) });
      await this.store.addIssue(migrationId, { conversationId, kind: 'ingest-error', reason: err instanceof Error ? err.message : String(err) }).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
    }

    const { total } = await this.store.markConversationDone(migrationId, conversationId);
    if (total >= job.checkpoint.totalConversations) await this.maybeFinalize(migrationId);
  }

  /** Finalize a migration exactly once — the worker that closes the last conversation wins the SETNX claim. */
  private async maybeFinalize(migrationId: string): Promise<void> {
    const job = await this.store.findById(migrationId);
    if (!job || job.status !== MigrationStatus.INGESTING) return;        // only an actively-ingesting job finalizes — never override STOPPED/FAILED/COMPLETED
    if (await this.store.isStopRequested(migrationId)) return;           // a stop landed on the final conversation → let the stop win, don't complete
    if (await this.store.doneCount(migrationId) < job.checkpoint.totalConversations) return; // SCARD is the source of truth, not the derived ingestedCount field
    if (!(await this.store.tryClaimFinalize(migrationId))) return; // another worker is finalizing
    const completedAt = Date.now();
    await this.store.update(migrationId, { status: MigrationStatus.COMPLETED, completedAt });
    await this.engine.announceMigration(job).catch((err) => logger.warn('[SlackMigration] announce failed (non-fatal)', { id: migrationId, error: err instanceof Error ? err.message : String(err) }));
    await this.engine.deletePrefix(job.gcsPrefix).catch(() => undefined);
    const durationMs = job.ingestStartedAt ? completedAt - job.ingestStartedAt : undefined;
    logger.info('[SlackMigration] ingestion complete', {
      id: migrationId,
      conversations: job.checkpoint.totalConversations,
      messages: job.stats.messages,
      ingestDurationMs: durationMs,
      ingestDuration: durationMs !== undefined ? formatDuration(durationMs) : undefined,
      messagesPerSec: durationMs && durationMs > 0 ? Math.round((job.stats.messages / durationMs) * 1000) : undefined,
    });
  }

  /** Loads the record, runs a heartbeat ticker, and centralizes failure marking. */
  private async guard(id: string, work: (job: MigrationJob) => Promise<void>): Promise<void> {
    const job = await this.store.findById(id);
    if (!job) return;
    logger.info('[SlackMigration] worker picked up job', { id, queue: job.currentQueue, status: job.status });
    await this.store.markProgress(id).catch(() => undefined); // fresh stall window on pickup — don't inherit a prior attempt's stale progressAt
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
