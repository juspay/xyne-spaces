import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { acquireLeadership, releaseLock, renewLock, type LockHandle } from '@/utils/distributedLock';
import { MigrationStore } from './store';
import { MigrationQueues, queueFor } from './queues';
import { SlackMigrationEngine, type CollectedConversation, type DirUser } from './engine';
import { MigrationJob, MigrationStatus, MigrationType, QueueName } from './types';
import { getMigrationRuntimeConfig } from './migrationRuntimeConfig';

const HEARTBEAT_MS = 15_000;
const RECONCILE_EVERY_MS = 60_000;
const RECLAIM_STALE_MS = 90_000; // several missed heartbeats ⇒ the pod that owned the job is gone
// Leader lease: exactly one worker cluster-wide runs the singleton duties (collection, ingestion planner, reconcile).
// Renew 3× per TTL so a transient Redis blip doesn't drop it; a dead leader is reclaimed within one TTL.
const LEADER_KEY = 'slackmig:leader';
const LEADER_TTL_S = 30;
const LEADER_RENEW_MS = 10_000;
// Transient encryption-provider / DB-transaction blips during a heavy ingest — retry the conversation before failing it.
const INGEST_MAX_ATTEMPTS = 4;
const INGEST_RETRY_BASE_MS = 2_000;
const RETRYABLE_INGEST_ERROR = /batch-encrypt (?:failed with status 5\d\d|timed out)|Transaction already closed|expired transaction/i;
// stallLimitMs (live heartbeat but no forward progress ⇒ worker wedged) is now live-tunable via Superposition — read per reconcile tick.
// A job interrupted more often than this in a row without progress is failed, so it can't hold the front of its lane.
const MAX_IDLE_RECLAIMS = 3;
// Never picked up from a queue: resume/backfill/reclaim set QUEUED before they enqueue.
const SETTLED = [MigrationStatus.STOPPED, MigrationStatus.FAILED, MigrationStatus.COMPLETED];

/** Changes whenever a job advances in its current phase — equal marks across two reclaims mean no headway. */
const progressMark = (j: MigrationJob): string =>
  [j.status, j.stats.messages, j.checkpoint.collectedConversationIds.length, j.ingestedCount ?? 0, j.refreshDone ?? 0].join(':');

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

  private leaderHandle: LockHandle | null = null;
  private ingestionRegistered = false;
  private readonly collectionLanes = new Set<string>(); // workspaceIds this process has a collection processor for
  private reconcileTimer: NodeJS.Timeout | null = null;
  private leaderTimer: NodeJS.Timeout | null = null;

  register(): void {
    // Fan-out ingest runs on EVERY worker (every process on every pod). Bull delivers each conversation to exactly
    // one worker cluster-wide, and re-ingest is idempotent (done-set skip + per-message dedup), so this is safe to fan out.
    this.queues.processConv(config.slackMigration.ingestConcurrency, (mid, cid) => this.ingestConversation(mid, cid));

    // Collection, the ingestion planner and reconcile are SINGLETON duties — exactly one worker cluster-wide may run
    // them (two collectors per workspace would blow Slack's rate limits). A Redis lease elects that one; the winner
    // lazily subscribes to those queues on promote (so a follower never consumes them), and on its death the lease
    // TTL-expires and another worker takes over.
    void this.runLeaderLoop();

    logger.info('[SlackMigration] workers registered', {
      instance: process.env.NODE_APP_INSTANCE ?? 'single', ingestConcurrency: config.slackMigration.ingestConcurrency,
    });
  }

  /** True while this worker holds the migration leader lease — gates leader-only metrics so counts aren't reported N×. */
  isLeader(): boolean { return this.leaderHandle !== null; }

  /** Poll the lease: renew while leader (step down if lost), else try to acquire and promote. */
  private async runLeaderLoop(): Promise<void> {
    const tick = async (): Promise<void> => {
      try {
        if (this.leaderHandle) {
          if (!(await renewLock(this.leaderHandle, LEADER_TTL_S))) await this.demote();
        } else {
          const handle = await acquireLeadership(LEADER_KEY, LEADER_TTL_S);
          if (handle) await this.promote(handle);
        }
      } catch (e) {
        logger.warn('[SlackMigration] leader loop tick failed', { error: e instanceof Error ? e.message : String(e) });
      }
    };
    this.leaderTimer = setInterval(() => void tick(), LEADER_RENEW_MS);
    this.leaderTimer.unref?.();
    await tick();
  }

  private async promote(handle: LockHandle): Promise<void> {
    this.leaderHandle = handle;
    logger.info('[SlackMigration] acquired leadership — running collection, ingestion planner & reconcile');
    // Re-elected after a demotion: resume local consumption of the already-registered processors.
    for (const name of this.leaderQueues()) await this.queues.resumeLocal(name).catch(() => undefined);
    if (!this.ingestionRegistered) {
      // Bull's .process() is once-per-process, so followers that never win the lease never consume these queues.
      this.queues.process(QueueName.INGESTION, (id) => this.guard(QueueName.INGESTION, id, (j) => this.ingest(j)));
      this.ingestionRegistered = true;
    }
    this.startReconcile(); // its first tick opens a collection lane per workspace
  }

  private async demote(): Promise<void> {
    logger.warn('[SlackMigration] lost leadership — stepping down from singleton duties');
    this.leaderHandle = null;
    this.stopReconcile();
    for (const name of this.leaderQueues()) await this.queues.pauseLocal(name).catch(() => undefined);
  }

  /** Singleton queues this process has a processor on. */
  private leaderQueues(): string[] {
    const lanes = [...this.collectionLanes].map((ws) => queueFor(QueueName.COLLECTION, ws));
    return this.ingestionRegistered ? [...lanes, QueueName.INGESTION] : lanes;
  }

  /** One collection lane per workspace, drained one job at a time: tenants collect in parallel, never two per tenant. */
  private openCollectionLane(workspaceId: string): void {
    if (!this.leaderHandle || !workspaceId || this.collectionLanes.has(workspaceId)) return;
    this.collectionLanes.add(workspaceId);
    this.queues.process(queueFor(QueueName.COLLECTION, workspaceId), (id) =>
      this.guard(QueueName.COLLECTION, id, (j) => j.backfill ? this.collectMissingFiles(j) : j.refreshRequested ? this.refresh(j) : this.collect(j)));
    logger.info('[SlackMigration] collection lane opened', { workspaceId });
  }

  private startReconcile(): void {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setInterval(() => void this.reconcile().catch(() => undefined), RECONCILE_EVERY_MS);
    this.reconcileTimer.unref?.();
    void this.reconcile().catch(() => undefined);
  }

  private stopReconcile(): void {
    if (this.reconcileTimer) { clearInterval(this.reconcileTimer); this.reconcileTimer = null; }
  }

  /** Graceful shutdown: release the lease (if held) so another worker takes over immediately instead of waiting the TTL. */
  async shutdown(): Promise<void> {
    if (this.leaderTimer) { clearInterval(this.leaderTimer); this.leaderTimer = null; }
    const handle = this.leaderHandle;
    this.leaderHandle = null;
    if (handle) await releaseLock(handle);
  }

  /** Recover running jobs that a live worker can no longer make progress on: pod died (stale heartbeat) → re-enqueue;
   *  or wedged/looping (fresh heartbeat, no progress) → fail resumably. */
  private async reconcile(): Promise<void> {
    const now = Date.now();
    const { stallLimitMs } = await getMigrationRuntimeConfig();
    const jobs = await this.store.list(1000, 0);
    for (const ws of new Set(jobs.map((j) => j.workspaceId))) this.openCollectionLane(ws);
    for (const job of jobs) {
      const queue = queueFor(job.currentQueue, job.workspaceId);
      // Queued/submitted jobs live in Bull, not here — but recover one whose Bull entry was lost (e.g. a crash
      // between the store write and enqueue) so it can't sit stranded forever. Only re-enqueue if genuinely absent.
      if (job.status === MigrationStatus.QUEUED || job.status === MigrationStatus.SUBMITTED) {
        if (now - job.updatedAt >= RECLAIM_STALE_MS && !(await this.queues.hasJob(queue, job.id))) {
          logger.warn('[SlackMigration] re-enqueuing stranded job (no queue entry)', { id: job.id, status: job.status });
          await this.queues.enqueue(queue, job.id, job.backfill ? 'front' : 'end').catch(() => undefined); // a backfill keeps its priority
        }
        continue;
      }
      const running = job.status === MigrationStatus.COLLECTING || job.status === MigrationStatus.REFRESHING || job.status === MigrationStatus.INGESTING;
      if (!running) continue;
      // Status says running — but is a worker actually processing it? If Bull has it sitting in the wait/delayed
      // queue (bumped back by a restart/stall, or a resume jumped ahead), the "Collecting/Ingesting" status is
      // stale. Show it as QUEUED so two jobs never both look like they're running.
      const bstate = await this.queues.jobState(queue, job.id);
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
        if (now - lastProgress >= stallLimitMs) {
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
      await this.reclaim(job, queue);
    }
  }

  /** A pod died mid-run: the job was interrupted, not failed, so it resumes at the FRONT of its queue. */
  private async reclaim(job: MigrationJob, queue: string): Promise<void> {
    const progress = progressMark(job);
    const count = job.reclaims?.progress === progress ? job.reclaims.count + 1 : 1;
    if (count > MAX_IDLE_RECLAIMS) {
      logger.error('[SlackMigration] migration keeps dying without progress — marking failed (resumable)', { id: job.id, status: job.status, reclaims: count });
      await this.store.update(job.id, {
        status: MigrationStatus.FAILED,
        reclaims: undefined,
        error: `Interrupted ${count} times in a row without progress. Resume to retry from the last checkpoint.`,
      }).catch(() => undefined);
      return;
    }
    logger.warn('[SlackMigration] reclaiming orphaned migration after restart', { id: job.id, status: job.status, queue, reclaims: count });
    await this.store.update(job.id, { status: MigrationStatus.QUEUED, reclaims: { count, progress } }).catch(() => undefined); // waiting to resume, not running
    await this.queues.enqueue(queue, job.id, 'front');
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
    const cursors = await this.engine.readCursors(job.gcsPrefix); // per-conversation last-collected ts → the delta cursor for refresh
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
      if (conv.isEmpty) { await this.store.addCollected(job.id, conv.id, 0); collected += 1; continue; } // Slack says no messages ever → skip the history call
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
      await this.engine.collectConversationResources(token, conv.id, job.gcsPrefix).catch(() => undefined); // bookmarks/links/canvases
      if (result.newestTs > 0) cursors[conv.id] = result.newestTs; // remember the newest ts so refresh only fetches the delta
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

    await this.engine.writeCursors(job.gcsPrefix, cursors).catch(() => undefined);
    // Collection done → approval gate. Keep the token (encrypted) through the approval window so "Get latest messages"
    // can re-collect; it's dropped when ingestion starts (see ingest()).
    await this.store.update(job.id, { status: MigrationStatus.AWAITING_APPROVAL, collectedAt: Date.now() });
    logger.info('[SlackMigration] collection complete → awaiting approval', {
      id: job.id, conversations: conversations.length, collected, messages, skipped, truncated,
    });
  }

  /**
   * Attachment backfill, phase 1: fetch the files the collected dump references but never stored, then hand the job to
   * ingestion at the FRONT of the queue (phase 2 re-ingests with upsert: missing messages are inserted, existing ones get
   * their files attached). Messages come from the dump — only file downloads hit Slack. Idempotent on restart.
   */
  private async collectMissingFiles(job: MigrationJob): Promise<void> {
    if (![MigrationStatus.QUEUED, MigrationStatus.COLLECTING].includes(job.status)) return; // stale delivery
    await this.store.update(job.id, { status: MigrationStatus.COLLECTING });
    logger.info('[SlackMigration] backfill: collecting missing files', { id: job.id });
    const r = await this.engine.collectMissingFiles(job, () => this.store.markProgress(job.id), () => this.store.isStopRequested(job.id));
    if (r.stopped) return void this.store.update(job.id, { status: MigrationStatus.STOPPED });
    const filesCollected = { messages: r.messages, withFiles: r.withFiles, files: r.files, stored: r.stored, failed: r.files - r.stored, at: Date.now() };
    logger.info('[SlackMigration] backfill: files collected → re-ingesting', { id: job.id, ...filesCollected });
    await this.store.update(job.id, { status: MigrationStatus.QUEUED, currentQueue: QueueName.INGESTION, filesCollected });
    await this.queues.enqueue(QueueName.INGESTION, job.id, 'front');
  }

  /**
   * "Get latest messages": incremental DELTA re-collection while AWAITING_APPROVAL. Re-lists conversations (catches new
   * DMs → full collect into base), and for each existing conversation writes only messages/replies newer than its cursor
   * to a SNAPSHOT file (base untouched, so a partial refresh can't lose data). Old-thread replies within the 30-day
   * lookback are caught. Ingest reads base + snapshots as a union and dedups. Returns to AWAITING_APPROVAL.
   */
  private async refresh(job: MigrationJob): Promise<void> {
    // Include QUEUED: reconcile re-enqueues an interrupted refresh as QUEUED; without it the job returns every pickup and thrashes forever.
    if (![MigrationStatus.AWAITING_APPROVAL, MigrationStatus.REFRESHING, MigrationStatus.QUEUED].includes(job.status)) return;
    let token: string;
    try { token = this.engine.decryptToken(job); }
    catch { await this.store.update(job.id, { status: MigrationStatus.AWAITING_APPROVAL, refreshRequested: false, error: 'Refresh needs the Slack token, which is no longer available. Re-submit to migrate newer messages.' }); return; }
    // Keep refreshRequested set through the run so an orphaned refresh (pod died) is re-dispatched as a refresh, not a collect.
    await this.store.update(job.id, { status: MigrationStatus.REFRESHING });
    logger.info('[SlackMigration] refresh started', { id: job.id, type: job.type });

    const existing = await this.engine.readManifest(job.gcsPrefix).catch(() => [] as CollectedConversation[]);
    const current = await this.engine.listConversations(token, job.type, job.channelInput);
    const knownIds = new Set(existing.map((c) => c.id));
    const merged = [...existing, ...current.filter((c) => !knownIds.has(c.id))];
    if (merged.length !== existing.length) await this.engine.writeManifest(job.gcsPrefix, merged);

    const freshEmpty = new Map(current.map((c) => [c.id, c.isEmpty])); // FRESH is_empty from this listing — never trust the stale manifest for skipping
    const cursors = await this.engine.readCursors(job.gcsPrefix);
    const directory = await this.engine.readDirectory(job.gcsPrefix).catch(() => ({} as Record<string, DirUser>));
    const isChannel = job.type === MigrationType.CHANNEL;
    const labelFor = (conv: CollectedConversation): string => {
      if (isChannel) return `#${job.slackChannelName ?? conv.id}`;
      const names = conv.members.filter((m) => m !== job.ownerSlackId).map((m) => directory[m]?.real_name || directory[m]?.display_name || m);
      return names.length ? `DM with ${names.join(', ')}` : `DM ${conv.id}`;
    };
    const runTs = Date.now();
    const windowStart = job.channelInput?.startDate ? Math.floor(Date.parse(job.channelInput.startDate) / 1000) : (job.slackChannelCreated ?? 0);
    let refreshedConvs = 0, newMessages = 0, newConvs = 0;
    await this.store.update(job.id, { refreshTotal: merged.length, refreshDone: 0 });
    for (const [i, conv] of merged.entries()) {
      if (await this.store.isStopRequested(job.id)) return void this.store.update(job.id, { status: MigrationStatus.STOPPED });
      if ((i + 1) % 10 === 0 || i + 1 === merged.length) await this.store.update(job.id, { refreshDone: i + 1 });
      if (freshEmpty.get(conv.id) === true) continue; // Slack says still no messages ever → nothing to refresh, skip the history call
      const isNew = !knownIds.has(conv.id);
      // Existing conv → delta snapshot from its cursor; new conv → full collect into base (sinceTs 0).
      const destPath = isNew ? undefined : this.engine.conversationRefreshPath(job.gcsPrefix, conv.id, runTs);
      const sinceTs = isNew ? 0 : (cursors[conv.id] ?? 0);
      const result = await this.engine.collectConversation(
        token, conv, job.gcsPrefix, job.channelInput?.startDate,
        isChannel
          ? (p) => this.store.setChannelProgress(job.id, { messages: p.messages, start: windowStart, end: p.newestTs, through: p.oldestTs })
          : () => this.store.markProgress(job.id),
        destPath, sinceTs,
      );
      if (result.outcome === 'skipped') {
        if (!isNew) continue; // existing conv now inaccessible: keep what we have, don't record a new issue
        await this.store.addIssue(job.id, { conversationId: conv.id, label: labelFor(conv), kind: 'skipped', reason: result.reason ?? 'Inaccessible on Slack.' });
        continue;
      }
      if (result.newestTs > 0) cursors[conv.id] = Math.max(cursors[conv.id] ?? 0, result.newestTs);
      await this.engine.collectConversationResources(token, conv.id, job.gcsPrefix).catch(() => undefined); // re-collect bookmarks/links/canvases
      newMessages += result.messages;
      if (result.messages > 0) refreshedConvs += 1;
      if (isNew) { newConvs += 1; await this.store.addCollected(job.id, conv.id, isChannel ? 0 : result.messages); }
    }

    await this.engine.writeCursors(job.gcsPrefix, cursors).catch(() => undefined);
    await this.store.update(job.id, {
      status: MigrationStatus.AWAITING_APPROVAL, refreshRequested: false, lastRefreshedAt: Date.now(), refreshCount: (job.refreshCount ?? 0) + 1,
      checkpoint: { ...job.checkpoint, totalConversations: merged.length },
    });
    logger.info('[SlackMigration] refresh complete → awaiting approval', { id: job.id, refreshedConvs, newConvs, newMessages });
  }

  /**
   * PLANNER (INGESTION queue, instance-0, one migration at a time): fan conversations out as CONV_INGEST jobs
   * (drained in parallel), then hold the slot until they finish so migrations ingest one-at-a-time end-to-end.
   * Idempotent on resume. Does NOT ingest anything itself.
   */
  private async ingest(job: MigrationJob): Promise<void> {
    // Idempotency: never re-plan a completed job (its GCS data is already deleted).
    if ([MigrationStatus.SUBMITTED, MigrationStatus.COLLECTING, MigrationStatus.COMPLETED].includes(job.status)) return;
    // ingestStartedAt is stamped at the first conversation, not here.
    await this.store.update(job.id, { status: MigrationStatus.INGESTING, encryptedToken: undefined });
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
    if (enqueued === 0) {
      await this.maybeFinalize(job.id);
      return;
    }
    // One migration at a time: hold the slot until this job's conversations finish.
    await this.awaitIngestionComplete(job.id, uniqueConversations.length);
  }

  /** Hold the INGESTION slot until this migration's conversations finish, or it's stopped/finalized. */
  private async awaitIngestionComplete(migrationId: string, total: number): Promise<void> {
    const POLL_MS = 2000;
    for (;;) {
      const job = await this.store.findById(migrationId);
      if (!job || job.status !== MigrationStatus.INGESTING) return;
      if (await this.store.isStopRequested(migrationId)) return;
      if (await this.store.doneCount(migrationId) >= total) {
        await this.maybeFinalize(migrationId);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }

  /** Retry a conversation load on a transient encryption/DB error (re-ingest is idempotent); rethrow otherwise. */
  private async loadWithRetry(migrationId: string, conversationId: string, run: () => Promise<{ ingested: number; failed: number }>): Promise<{ ingested: number; failed: number }> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt >= INGEST_MAX_ATTEMPTS || !RETRYABLE_INGEST_ERROR.test(msg)) throw err;
        const delay = INGEST_RETRY_BASE_MS * 2 ** (attempt - 1);
        logger.warn('[SlackMigration] transient ingest error — retrying conversation', { migrationId, conversationId, attempt, delayMs: delay, error: msg });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
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

    // Stamp ingest start on the first conversation to run.
    if (!job.ingestStartedAt) {
      await this.store.update(migrationId, { ingestStartedAt: Date.now() }).catch(() => undefined);
    }

    const heartbeat = setInterval(() => void this.store.heartbeat(migrationId).catch(() => undefined), HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      const conv = await this.engine.getManifestConversation(migrationId, job.gcsPrefix, conversationId);
      if (conv) {
        const ref = await this.engine.getOfflineReference(migrationId, job.gcsPrefix);
        const onProgress = () => void this.store.markProgress(migrationId).catch(() => undefined);
        const loaded = await this.loadWithRetry(migrationId, conversationId, () => this.engine.loadConversation(job, conv, ref, onProgress));
        if (loaded.failed > 0) {
          await this.store.addIssue(migrationId, { conversationId, kind: 'ingest-error', reason: `${loaded.failed} message(s) couldn't be migrated (unresolved sender or attachment).` });
        }
      } else {
        logger.warn('[SlackMigration] conversation missing from manifest — skipping', { migrationId, conversationId });
      }
    } catch (err) {
      // Record and move on so the migration can still finalize (never stuck). Transient errors were already retried above.
      logger.error('[SlackMigration] conversation ingest failed (recorded)', { migrationId, conversationId, error: err instanceof Error ? err.message : String(err) });
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
    await this.store.update(migrationId, { status: MigrationStatus.COMPLETED, completedAt, backfill: undefined });
    // A backfill of a channel that was already announced stays silent in Slack.
    if (job.backfill !== 'silent') await this.engine.announceMigration(job).catch((err) => logger.warn('[SlackMigration] announce failed (non-fatal)', { id: migrationId, error: err instanceof Error ? err.message : String(err) }));
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
  private async guard(phase: QueueName, id: string, work: (job: MigrationJob) => Promise<void>): Promise<void> {
    const job = await this.store.findById(id);
    if (!job) return;
    // A leftover copy (cutover / rollout overlap) must not re-run a phase the job has left, or a job that's settled.
    if (job.currentQueue !== phase || SETTLED.includes(job.status)) {
      logger.warn('[SlackMigration] skipping stale delivery', { id, phase, currentQueue: job.currentQueue, status: job.status });
      return;
    }
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
