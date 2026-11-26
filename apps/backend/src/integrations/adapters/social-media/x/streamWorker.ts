/**
 * X activity stream worker.
 *
 * One long-lived `GET /2/activity/stream` per tenant X app (the stream is app-scoped: it carries
 * events for every subscribed account of that app, routed by `filter.user_id`). Exactly one
 * reader per app cluster-wide, enforced by a Redis lease taken with `acquireLeadership` (fails
 * closed) — two readers would double-process and X treats duplicate connections as a disconnect
 * cause. Live-verified: a second connection receives every event too, so a reader that loses its
 * lease must stop immediately.
 *
 * Self-serve streams have no native recovery (`backfill_minutes` / `start_time` → 400), so every
 * (re)connect reports the gap to `onGap`, which polling repairs.
 */
import crypto from 'node:crypto';
import type { ExternalSource } from '@prisma/client';
import { db } from '@/database/client';
import { ingestExternalSource } from '@/bypassAcl/webhookIngestServices';
import { acquireLeadership, releaseLock, renewLock, type LockHandle } from '@/utils/distributedLock';
import { logger } from '@/utils/logger';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { XApiError, isXCreditsDepleted, isXRateLimited, xApiClient, xAppKey } from './client';
import { X_API_BASE } from './constants';
import { fromActivityEvent, unwrapActivityEvent } from './normalizer';
import { X_CREDITS_RETRY_MS, XStreamLineParser, xReconnectDelayMs, type XStreamFailure } from './streamParser';
import { parseXCredentials } from './tokenService';
import type { XAppCredentials, XInboundItem } from './types';
import { xAdapter } from './index';
import { xchatService } from './xchat';
import { X_SYNC_OVERLAP_MS, xCursorAdvance, xPollWindow } from './flow';
import { xPoller } from './poller';

const TAG = '[XStream]';
const LEASE_TTL_S = 60;
const LEASE_RENEW_MS = 20_000;
const RECONCILE_MS = 30_000;
/** No byte (not even a keep-alive) for this long ⇒ the connection is dead; X keep-alives are ≤ ~20 s. */
const STALL_MS = 90_000;
const MAX_PENDING_LINE = 5 * 1024 * 1024;

export interface XAppGroup {
  appKey: string;
  /** Changes when the tenant re-enters keys; a running stream restarts with the new ones. */
  fingerprint: string;
  app: XAppCredentials;
  /** X user id → ExternalSource id. */
  accounts: Map<string, string>;
}

/** Queues an item behind everything already queued for the stream; resolves to whether it ingested. */
export type XEnqueue = (sourceId: string, item: XInboundItem) => Promise<boolean>;

export interface XStreamDeps {
  loadGroups(): Promise<XAppGroup[]>;
  acquireLease(appKey: string): Promise<LockHandle | null>;
  renewLease(lease: LockHandle): Promise<boolean>;
  releaseLease(lease: LockHandle): Promise<void>;
  getBearer(app: XAppCredentials): Promise<string>;
  openStream(bearer: string, signal: AbortSignal): Promise<Response>;
  ingest(sourceId: string, item: XInboundItem): Promise<void>;
  /** A window in which events may have been missed. `since` undefined ⇒ first connect this process. */
  /**
   * Repairs what the stream may have missed. Polled items go back through `enqueue`, the stream's
   * own queue, so each account has one writer (see repairSourceGap).
   */
  onGap(group: XAppGroup, since: Date | undefined, enqueue: XEnqueue): Promise<void>;
  now(): number;
}

export const xAppFingerprint = (app: XAppCredentials) =>
  crypto.createHash('sha256').update(`${app.consumerKey}:${app.consumerSecret}`).digest('hex').slice(0, 16);

/** Active X sources grouped by the tenant app they belong to. */
export async function loadXAppGroups(): Promise<XAppGroup[]> {
  const sources = await db.externalSource.findMany({
    where: { sourceType: ExternalSourcePlatform.X, isActive: true },
    select: { id: true, credentials: true },
    orderBy: { createdAt: 'asc' },
  });
  const groups = new Map<string, XAppGroup>();
  for (const source of sources) {
    let creds;
    try {
      creds = parseXCredentials(source.credentials);
    } catch {
      continue; // disconnected / malformed — nothing to stream for
    }
    const appKey = xAppKey(creds.app);
    const group = groups.get(appKey) ?? { appKey, fingerprint: xAppFingerprint(creds.app), app: creds.app, accounts: new Map() };
    group.accounts.set(creds.xUserId, source.id);
    groups.set(appKey, group);
  }
  return [...groups.values()];
}

function classify(error: unknown): XStreamFailure {
  if (isXCreditsDepleted(error)) return 'credits';
  if (isXRateLimited(error)) return 'rate_limited';
  if (error instanceof XApiError) return 'http';
  return 'network';
}

async function responseError(res: Response): Promise<XApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty */
  }
  return new XApiError(res.status, body.title as string | undefined, body.type as string | undefined, body.detail as string | undefined);
}

/** One app's stream: connect, read, dispatch, reconnect with backoff — until stopped or fenced. */
export class XAppStream {
  private stopped = false;
  private connection: AbortController | null = null;
  private wake: (() => void) | null = null;
  private lastByteAt = 0;
  private lastHealthyAt: number | undefined;
  private attempts: Record<XStreamFailure, number> = { network: 0, http: 0, rate_limited: 0, credits: 0 };
  private ingestChain: Promise<void> = Promise.resolve();
  private timers: NodeJS.Timeout[] = [];
  readonly done: Promise<void>;

  constructor(
    public group: XAppGroup,
    private readonly lease: LockHandle,
    private readonly deps: XStreamDeps,
  ) {
    this.done = this.run();
  }

  stop(reason: string): void {
    if (this.stopped) return;
    this.stopped = true;
    logger.info(`${TAG} Stopping stream`, { appKey: this.group.appKey, reason });
    this.connection?.abort();
    this.wake?.();
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
  }

  private startTimers(): void {
    const renew = setInterval(() => {
      this.deps
        .renewLease(this.lease)
        .then((ok) => {
          if (!ok) this.stop('lease lost');
        })
        .catch((error: unknown) => {
          // Not proof the lease is gone; the next renewal decides.
          logger.warn(`${TAG} Lease renewal errored`, { appKey: this.group.appKey, error: String(error) });
        });
    }, LEASE_RENEW_MS);
    const watchdog = setInterval(() => {
      if (this.connection && this.lastByteAt && this.deps.now() - this.lastByteAt > STALL_MS) {
        logger.warn(`${TAG} Stream stalled — reconnecting`, { appKey: this.group.appKey, silentMs: this.deps.now() - this.lastByteAt });
        this.connection.abort();
      }
    }, 5_000);
    renew.unref?.();
    watchdog.unref?.();
    this.timers.push(renew, watchdog);
  }

  private async run(): Promise<void> {
    this.startTimers();
    try {
      while (!this.stopped) {
        let failure: XStreamFailure = 'network';
        try {
          await this.connectAndRead();
          // Server closed a healthy stream: reconnect promptly.
        } catch (error) {
          if (this.stopped) break;
          failure = classify(error);
          logger.warn(`${TAG} x_stream_disconnected`, { appKey: this.group.appKey, failure, error: String(error) });
          if (failure === 'credits') {
            logger.error(`${TAG} x_credits_depleted — tenant X account has no credits; retrying in ${X_CREDITS_RETRY_MS / 60_000} min`, {
              appKey: this.group.appKey,
              sourceIds: [...this.group.accounts.values()],
            });
          }
        }
        if (this.stopped) break;
        const attempt = ++this.attempts[failure];
        await this.sleep(xReconnectDelayMs(failure, attempt));
      }
    } finally {
      this.timers.forEach(clearInterval);
      await this.ingestChain.catch(() => undefined);
      await this.deps.releaseLease(this.lease);
    }
  }

  private async connectAndRead(): Promise<void> {
    const bearer = await this.deps.getBearer(this.group.app);
    const connection = new AbortController();
    this.connection = connection;
    try {
      const res = await this.deps.openStream(bearer, connection.signal);
      if (!res.ok || !res.body) throw await responseError(res);

      logger.info(`${TAG} x_stream_connected`, { appKey: this.group.appKey, accounts: this.group.accounts.size });
      this.attempts = { network: 0, http: 0, rate_limited: 0, credits: 0 };
      this.lastByteAt = this.deps.now();
      // Anything between the last healthy byte and now may be missing.
      const since = this.lastHealthyAt !== undefined ? new Date(this.lastHealthyAt) : undefined;
      void this.deps.onGap(this.group, since, (sourceId, item) => this.enqueue(sourceId, item, 'gap-repair')).catch((error) =>
        logger.error(`${TAG} Gap repair failed`, { appKey: this.group.appKey, error: String(error) }),
      );

      const parser = new XStreamLineParser();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        this.lastByteAt = this.deps.now();
        this.lastHealthyAt = this.lastByteAt;
        for (const line of parser.push(chunk)) this.handleLine(line);
        if (parser.pendingLength > MAX_PENDING_LINE) throw new Error('Unterminated stream line exceeded 5 MB');
      }
    } finally {
      this.connection = null;
    }
  }

  /** Exposed for tests. */
  handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      logger.warn(`${TAG} Unparsable stream line`, { appKey: this.group.appKey, length: line.length });
      return;
    }
    const event = unwrapActivityEvent(message);
    if (!event) {
      // In-stream errors / operational-disconnect notices.
      logger.warn(`${TAG} Non-event stream message`, { appKey: this.group.appKey, message: line.slice(0, 500) });
      return;
    }
    const xUserId = event.filter?.user_id;
    const sourceId = xUserId ? this.group.accounts.get(xUserId) : undefined;
    if (!xUserId || !sourceId) return; // account not (or no longer) connected
    for (const item of fromActivityEvent(event, xUserId)) void this.enqueue(sourceId, item, event.event_type);
  }

  /**
   * The account's single ingest queue: streamed events and gap-repair items run strictly one after
   * another, so core ingest's check-then-create never sees two copies of a message, or two new
   * messages of one new thread, at the same moment.
   */
  enqueue(sourceId: string, item: XInboundItem, origin: string): Promise<boolean> {
    const done = this.ingestChain
      .then(() => this.deps.ingest(sourceId, item))
      .then(
        () => true,
        (error: unknown) => {
          logger.error(`${TAG} Ingest failed`, { sourceId, origin, error: String(error) });
          return false;
        },
      );
    this.ingestChain = done.then(() => undefined);
    return done;
  }
}

/** Keeps one XAppStream per tenant app that this process holds the lease for. */
export class XStreamSupervisor {
  private readonly streams = new Map<string, XAppStream>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: XStreamDeps) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), RECONCILE_MS);
    this.timer.unref?.();
    logger.info(`${TAG} Supervisor started`);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const streams = [...this.streams.values()];
    streams.forEach((s) => s.stop('shutdown'));
    await Promise.all(streams.map((s) => s.done));
    this.streams.clear();
  }

  async reconcile(): Promise<void> {
    if (!this.running) return;
    let groups: XAppGroup[];
    try {
      groups = await this.deps.loadGroups();
    } catch (error) {
      logger.error(`${TAG} Failed to load X accounts`, { error: String(error) });
      return;
    }
    const wanted = new Map(groups.map((g) => [g.appKey, g]));

    for (const [appKey, stream] of this.streams) {
      const group = wanted.get(appKey);
      if (stream.isStopped) {
        this.streams.delete(appKey); // fenced or failed — retake below if still wanted
      } else if (!group) {
        stream.stop('no active accounts');
        this.streams.delete(appKey);
      } else if (group.fingerprint !== stream.group.fingerprint) {
        stream.stop('app keys changed');
        await stream.done; // releases the lease
        this.streams.delete(appKey);
      } else {
        stream.group = group; // pick up added/removed accounts without reconnecting
      }
    }

    for (const [appKey, group] of wanted) {
      if (this.streams.has(appKey)) continue;
      const lease = await this.deps.acquireLease(appKey);
      if (!lease) continue; // another worker owns this app
      this.streams.set(appKey, new XAppStream(group, lease, this.deps));
    }
  }

  /** For health/metrics. */
  ownedAppKeys(): string[] {
    return [...this.streams.keys()];
  }
}

async function ingestXItem(sourceId: string, item: XInboundItem): Promise<void> {
  const source = (await db.externalSource.findUnique({ where: { id: sourceId } })) as ExternalSource | null;
  if (!source?.isActive) return;
  await ingestExternalSource(source.workspaceId, xAdapter, source.name, item, source);
}

/**
 * Gap repair per source, one run at a time and at least `minSpacingMs` apart, so a flapping stream
 * cannot exhaust X's polling budgets (DM events: 15 calls / 15 min per user; a run makes ≤ 2).
 * Requests that arrive while a run is pending merge into the widest window.
 */
export class XGapRepairer {
  /** undefined since = cursor-based window (widest). `enqueue` is the newest stream's queue. */
  private readonly pending = new Map<string, { since: Date | undefined; enqueue: XEnqueue }>();
  private readonly active = new Set<string>();
  private readonly lastRunAt = new Map<string, number>();

  constructor(
    private readonly run: (sourceId: string, since: Date | undefined, enqueue: XEnqueue) => Promise<void>,
    private readonly minSpacingMs = 2 * 60_000,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms).unref?.()),
  ) {}

  async request(sourceId: string, since: Date | undefined, enqueue: XEnqueue): Promise<void> {
    const prev = this.pending.get(sourceId);
    const merged = !prev ? since : prev.since === undefined || since === undefined ? undefined : prev.since < since ? prev.since : since;
    this.pending.set(sourceId, { since: merged, enqueue });
    if (this.active.has(sourceId)) return Promise.resolve();
    this.active.add(sourceId);
    return this.drain(sourceId).finally(() => this.active.delete(sourceId));
  }

  private async drain(sourceId: string): Promise<void> {
    for (let next = this.pending.get(sourceId); next; next = this.pending.get(sourceId)) {
      const wait = (this.lastRunAt.get(sourceId) ?? -Infinity) + this.minSpacingMs - this.now();
      if (wait > 0) await this.sleep(wait);
      const job = this.pending.get(sourceId)!; // may have widened while waiting
      this.pending.delete(sourceId);
      this.lastRunAt.set(sourceId, this.now());
      try {
        await this.run(sourceId, job.since, job.enqueue);
      } catch (error) {
        logger.error(`${TAG} Gap repair failed`, { sourceId, error: String(error) });
      }
    }
  }
}

/**
 * Polls the window the stream may have missed and hands the items to the stream's own queue, so
 * the account keeps a single writer: a message that is both streamed and polled, or two new
 * messages of one new thread, are ingested one after the other and dedup / threading just work.
 * Without `since` (first connect after a worker start) the source's cursor decides the window.
 * The cursor moves only after every polled item ingested, by the same rule as manual sync.
 */
export async function repairSourceGap(sourceId: string, since: Date | undefined, enqueue: XEnqueue): Promise<void> {
  const source = (await db.externalSource.findUnique({ where: { id: sourceId } })) as ExternalSource | null;
  if (!source?.isActive) return;
  const startedAt = new Date();
  const window = since
    ? { start: new Date(since.getTime() - X_SYNC_OVERLAP_MS), end: startedAt }
    : xPollWindow(source, undefined, startedAt);
  const { items, complete } = await xPoller.poll(source, window);
  const ingested = await Promise.all(items.map((item) => enqueue(sourceId, item)));
  const failed = ingested.filter((ok) => !ok).length;
  const advance = xCursorAdvance(source, window, complete && failed === 0, startedAt);
  if (advance) {
    await db.externalSource.update({ where: { id: sourceId }, data: { lastSyncCursor: startedAt.toISOString() } });
  }
  logger.info(`${TAG} Gap repaired`, {
    sourceId,
    since: since?.toISOString() ?? 'cursor',
    polled: items.length,
    failed,
    complete,
    cursorAdvanced: advance,
  });
}

const gapRepairer = new XGapRepairer(repairSourceGap);

export const xStreamDeps: XStreamDeps = {
  loadGroups: async () => {
    const groups = await loadXAppGroups();
    // Keep XChat keys in memory only for sources that are still connected.
    xchatService.retainOnly(new Set(groups.flatMap((g) => [...g.accounts.values()])));
    return groups;
  },
  acquireLease: (appKey) => acquireLeadership(`lock:x-stream:${appKey}`, LEASE_TTL_S),
  renewLease: (lease) => renewLock(lease, LEASE_TTL_S),
  releaseLease: (lease) => releaseLock(lease),
  getBearer: (app) => xApiClient.getAppBearer(app),
  openStream: (bearer, signal) =>
    fetch(`${X_API_BASE}/2/activity/stream`, { headers: { authorization: `Bearer ${bearer}` }, signal }),
  ingest: ingestXItem,
  // The stream cannot replay on self-serve, so every (re)connect polls what may have been missed.
  onGap: async (group, since, enqueue) => {
    await Promise.all([...group.accounts.values()].map((sourceId) => gapRepairer.request(sourceId, since, enqueue)));
  },
  now: () => Date.now(),
};

export const xStreamSupervisor = new XStreamSupervisor(xStreamDeps);
