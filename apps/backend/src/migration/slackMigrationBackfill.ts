/**
 * TEMPORARY — self-serve Slack migration backfill. Everything (queue + worker + route) lives in this one file so
 * it can be removed in one shot: delete this file and its single `router.use('/slack-migration-backfill', …)`
 * mount in migration/index.ts.
 *
 * POST /migrate/api/migration/slack-migration-backfill   (admin-gated)
 *   Scans every migration job's `issues` and QUEUES each failed conversation onto a dedicated Bull queue —
 *   EXCEPT `skipped` issues (Slackbot / deleted DMs: nothing to re-ingest). A single worker (concurrency 1)
 *   drains the queue one conversation at a time and re-ingests it from the PRESERVED GCS dump (idempotent
 *   per-message dedup — no re-collect, no duplicates). Conversations whose GCS dump was already deleted are skipped.
 *   On a fully successful re-ingest (0 failures) the resolved issue is removed from the job record in Redis.
 *
 *   Kill-switch: the worker only drains while MIGRATION_INGEST_CONTROL is enabled (the existing ingestion flag).
 *   When it's off the queue is paused on boot, so you can queue now and flip the flag (restart) to run the backfill.
 *
 * Body: { channel?: string (slack|xyne id to scope to one channel), issueKinds?: string[], dryRun?: boolean }
 */
import Bull from 'bull';
import { Router, Request, Response } from 'express';
import { AccessType } from '@xyne/shared';
import { config } from '@/config/env';
import { getBaseRedisOptions } from '@/services/redisFactory';
import { getStorageService } from '@/services/storage';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { MigrationStore } from '@/migration/self-serve/store';
import { SlackMigrationEngine } from '@/migration/self-serve/engine';
import { MigrationIssue, MigrationJob } from '@/migration/self-serve/types';

const QUEUE_NAME = 'slack-migration-backfill';
const store = new MigrationStore();
const engine = new SlackMigrationEngine();

interface BackfillJob {
  migrationId: string;
  conversationId: string;
}

const queue = new Bull<BackfillJob>(QUEUE_NAME, {
  redis: { ...getBaseRedisOptions('bullmq'), lazyConnect: false },
  defaultJobOptions: { attempts: 3, backoff: { type: 'fixed', delay: 5000 }, removeOnComplete: true, removeOnFail: 1000 },
});

/** GCS base dump for a conversation still present? Early jobs had theirs deleted before we started preserving them. */
async function gcsDumpExists(job: MigrationJob, conversationId: string): Promise<boolean> {
  try {
    return await getStorageService(config.gcs.migrationBucketName).fileExists(`${job.gcsPrefix}/conversations/${conversationId}.jsonl`);
  } catch {
    return false;
  }
}

/**
 * Record the outcome of ONE conversation's backfill onto the job's `issues` (fresh read-modify-write; the worker is
 * single-concurrency and these jobs are COMPLETED, so no other writer). Only touches non-`skipped` issues for this
 * conversation — `skipped` (Slackbot/deleted) issues are left as-is:
 *  - resolved (0 failures) → remove them.
 *  - still failing → replace the reason with the latest failure (not appended forever, so it can't grow on re-runs).
 */
async function recordOutcome(migrationId: string, conversationId: string, resolvedReason: string | null): Promise<void> {
  const fresh = await store.findById(migrationId);
  if (!fresh) return;
  const before = fresh.issues ?? [];
  const mine = (i: MigrationIssue) => i.conversationId === conversationId && i.kind !== 'skipped';
  const after: MigrationIssue[] = resolvedReason === null
    ? before.filter((i) => !mine(i))
    : before.map((i) => (mine(i) ? { ...i, reason: resolvedReason } : i));
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    await store.update(migrationId, { issues: after });
  }
}

// ── worker: one conversation at a time, re-ingest from the preserved GCS dump ──────────────────────────────────
queue.process(1, async (bjob) => {
  const { migrationId, conversationId } = bjob.data;
  const job = await store.findById(migrationId);
  if (!job) return void logger.warn('[Backfill] migration not found — dropping', { migrationId, conversationId });
  if (!(await gcsDumpExists(job, conversationId))) return void logger.warn('[Backfill] GCS dump missing — skipping', { migrationId, conversationId });
  const conv = await engine.getManifestConversation(migrationId, job.gcsPrefix, conversationId);
  if (!conv) return void logger.warn('[Backfill] not in manifest — skipping', { migrationId, conversationId });
  const ref = await engine.getOfflineReference(migrationId, job.gcsPrefix);

  try {
    const r = await engine.loadConversation(job, conv, ref);
    if (r.failed === 0) {
      await recordOutcome(migrationId, conversationId, null); // fully re-ingested → remove the resolved issue
      logger.info('[Backfill] conversation re-ingested — issue cleared', { migrationId, conversationId, ingested: r.ingested });
    } else {
      await recordOutcome(migrationId, conversationId, `${r.failed} message(s) still couldn't be migrated after backfill re-ingest (unresolved sender or attachment).`);
      logger.warn('[Backfill] conversation partially re-ingested — issue reason updated', { migrationId, conversationId, ingested: r.ingested, failed: r.failed });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordOutcome(migrationId, conversationId, `Backfill re-ingest failed: ${msg}`); // keep the issue, refresh its reason
    throw e; // rethrow so Bull retries (attempts:3, 5s backoff); a later attempt can still resolve + clear it
  }
});

// ── kill-switch: only drain while MIGRATION_INGEST_CONTROL is on (pause/resume set from the flag at boot) ───────
if (config.slackMigration.ingestControlEnabled) {
  void queue.resume().then(() => logger.info('[Backfill] worker active (MIGRATION_INGEST_CONTROL on)')).catch(() => undefined);
} else {
  void queue.pause().then(() => logger.warn('[Backfill] worker paused — set MIGRATION_INGEST_CONTROL=true to drain the queue')).catch(() => undefined);
}

// ── auth ──────────────────────────────────────────────────────────────────────────────────────────────────────
interface AuthedUser {
  id: string;
  workspaceId: string;
  role?: string;
  orgRole?: string;
}
const userOf = (req: Request): AuthedUser | undefined => (req as Request & { user?: AuthedUser }).user;

async function isMigrationAdmin(u: AuthedUser): Promise<boolean> {
  if (u.role === 'ADMIN' || u.role === 'OWNER' || u.orgRole === 'ADMIN' || u.orgRole === 'OWNER') return true;
  for (const name of ['SLACK-MIGRATION-INGEST', 'TICKET-MIGRATION']) {
    const r = await repositories.resources.findByName(name);
    if (r && (await repositories.resourceAccess.hasAccess(u.id, r.id, AccessType.ADMIN))) return true;
  }
  return false;
}

// ── route: queue every failed conversation (except Slackbot/deleted skips) ────────────────────────────────────
const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const u = userOf(req);
  if (!u) return void res.status(401).json({ error: 'Authentication required' });
  if (!(await isMigrationAdmin(u))) return void res.status(403).json({ error: 'Admin access required' });

  const channel = String(req.body?.channel ?? '').trim();
  const dryRun = req.body?.dryRun === true || req.body?.dryRun === 'true';
  const kinds: string[] | undefined =
    Array.isArray(req.body?.issueKinds) && req.body.issueKinds.length ? req.body.issueKinds.map(String) : undefined;

  const jobs = (await store.list(5000, 0)).filter(
    (j) =>
      j.workspaceId === u.workspaceId &&
      (!channel || j.channelInput?.slackChannelId === channel || j.channelInput?.xyneChannelId === channel),
  );

  let queued = 0;
  const items: Array<Record<string, unknown>> = [];
  for (const job of jobs) {
    for (const issue of job.issues ?? []) {
      if (issue.kind === 'skipped') continue; // Slackbot / deleted DMs — nothing to re-ingest
      if (kinds && !kinds.includes(issue.kind)) continue; // optional kind filter
      items.push({ migrationId: job.id, conversationId: issue.conversationId, kind: issue.kind });
      if (!dryRun) {
        await queue.add(
          { migrationId: job.id, conversationId: issue.conversationId },
          { jobId: `${job.id}:${issue.conversationId}` }, // dedup: same conversation is never queued twice
        );
      }
      queued += 1;
    }
  }

  const workerActive = config.slackMigration.ingestControlEnabled;
  logger.info('[Backfill] queued failed conversations', { queued, dryRun, workerActive, jobs: jobs.length });
  res.json({
    queued,
    dryRun,
    workerActive,
    note: workerActive ? 'worker is draining the queue' : 'worker paused — set MIGRATION_INGEST_CONTROL=true (and restart) to drain',
    jobs: jobs.length,
    items,
  });
});

export default router;
