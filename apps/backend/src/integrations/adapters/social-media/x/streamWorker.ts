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
 * (re)connect reports the stretch it missed to `onGap`, which polling repairs (gapRepair.ts).
 *
 * The sync cursor ("everything before this has been read", used only by the catch-up after a worker
 * start) is saved here while the stream is healthy, never past a gap still being repaired.
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
import { xItemTime } from './poller';
import { xchatService } from './xchat';
import { xGapRepairer, type XEnqueue, type XEnqueueResult, type XGap } from './gapRepair';

const TAG = '[XStream]';
const LEASE_TTL_S = 60;
const LEASE_RENEW_MS = 20_000;
const RECONCILE_MS = 30_000;
/** No byte (not even a keep-alive) for this long ⇒ the connection is dead; X keep-alives are ≤ ~20 s. */
const STALL_MS = 90_000;
/** A connection attempt X has not answered by now is abandoned (separate from the stall watchdog). */
const CONNECT_TIMEOUT_MS = 30_000;
/** While healthy, save each account's cursor this often (one small write per account). */
const CURSOR_SAVE_MS = 5 * 60_000;

const MAX_PENDING_LINE = 5 * 1024 * 1024;

export interface XAppGroup {
  appKey: string;
  /** Changes when the tenant re-enters keys; a running stream restarts with the new ones. */
  fingerprint: string;
  app: XAppCredentials;
  /** X user id → ExternalSource id. */
  accounts: Map<string, string>;
}

export interface XStreamDeps {
  loadGroups(): Promise<XAppGroup[]>;
  acquireLease(appKey: string): Promise<LockHandle | null>;
  renewLease(lease: LockHandle): Promise<boolean>;
  releaseLease(lease: LockHandle): Promise<void>;
  getBearer(app: XAppCredentials): Promise<string>;
  openStream(bearer: string, signal: AbortSignal): Promise<Response>;
  ingest(sourceId: string, item: XInboundItem): Promise<void>;
  /** Repairs `gap` for these accounts; `isStopped` ends a waiting retry once the stream stopped. */
  onGap(sourceIds: string[], gap: XGap, enqueue: XEnqueue, isStopped: () => boolean): Promise<void>;
  /** The stream was healthy up to `healthyAt`: save the account's cursor (never past a pending gap). */
  saveCursor(sourceId: string, healthyAt: Date): Promise<void>;
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
  /** True only while X has answered and the body is being read; the stall watchdog ignores attempts. */
  private streamOpen = false;
  private lastHealthyAt: number | undefined;
  private attempts: Record<XStreamFailure, number> = { network: 0, http: 0, rate_limited: 0, credits: 0 };
  /** Per account: its single ingest queue (one writer per account; accounts do not wait on each other). */
  private readonly chains = new Map<string, Promise<unknown>>();
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
      // Only a stream X has answered can stall; an attempt still waiting is bounded by its own timeout.
      if (this.connection && this.streamOpen && this.deps.now() - this.lastByteAt > STALL_MS) {
        logger.warn(`${TAG} Stream stalled — reconnecting`, { appKey: this.group.appKey, silentMs: this.deps.now() - this.lastByteAt });
        this.connection.abort();
      }
    }, 5_000);
    const cursor = setInterval(() => {
      if (!this.streamOpen || this.lastHealthyAt === undefined) return;
      const healthyAt = new Date(this.lastHealthyAt);
      // Through the account's queue: saved only once everything received before it was ingested,
      // so a crash with messages still queued leaves the cursor before them. A message that
      // failed opened a gap by then (ingestOne), which holds the cursor until it is repaired.
      for (const sourceId of this.group.accounts.values()) {
        this.afterQueued(sourceId, async () => {
          if (this.stopped) return; // another worker owns the account now
          await this.deps
            .saveCursor(sourceId, healthyAt)
            .catch((error: unknown) => logger.warn(`${TAG} Could not save sync cursor`, { sourceId, error: String(error) }));
        });
      }
    }, CURSOR_SAVE_MS);
    renew.unref?.();
    watchdog.unref?.();
    cursor.unref?.();
    this.timers.push(renew, watchdog, cursor);
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
      await Promise.all([...this.chains.values()].map((chain) => chain.catch(() => undefined)));
      await this.deps.releaseLease(this.lease);
    }
  }

  private async connectAndRead(): Promise<void> {
    const bearer = await this.deps.getBearer(this.group.app);
    if (this.stopped) return;
    const connection = new AbortController();
    this.connection = connection;
    const connectTimer = setTimeout(() => connection.abort(), CONNECT_TIMEOUT_MS);
    connectTimer.unref?.();
    try {
      const res = await this.deps.openStream(bearer, connection.signal);
      clearTimeout(connectTimer);
      if (!res.ok || !res.body) throw await responseError(res);

      logger.info(`${TAG} x_stream_connected`, { appKey: this.group.appKey, accounts: this.group.accounts.size });
      this.attempts = { network: 0, http: 0, rate_limited: 0, credits: 0 };
      this.lastByteAt = this.deps.now();
      this.streamOpen = true;
      // Anything between the last healthy byte and now may be missing.
      const gap: XGap = {
        since: this.lastHealthyAt !== undefined ? new Date(this.lastHealthyAt) : undefined,
        until: new Date(this.lastByteAt),
      };
      this.repairGap([...this.group.accounts.values()], gap);

      const parser = new XStreamLineParser();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        this.lastByteAt = this.deps.now();
        this.lastHealthyAt = this.lastByteAt;
        for (const line of parser.push(chunk)) this.handleLine(line);
        if (parser.pendingLength > MAX_PENDING_LINE) throw new Error('Unterminated stream line exceeded 5 MB');
      }
    } finally {
      clearTimeout(connectTimer);
      this.streamOpen = false;
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
   * messages of one new thread, at the same moment. A missed message that lands after a newer
   * live one backdates its ticket (XPostprocessor).
   */
  enqueue(sourceId: string, item: XInboundItem, origin: string): Promise<XEnqueueResult> {
    // A stopped stream (e.g. it lost its lease) must not keep writing: another worker owns the
    // account now and catches up itself.
    if (this.stopped) return Promise.resolve('stopped');
    const done = (this.chains.get(sourceId) ?? Promise.resolve()).then(() => this.ingestOne(sourceId, item, origin));
    this.chains.set(sourceId, done);
    return done;
  }

  /** Runs `task` on the account's queue, after everything queued before it. */
  private afterQueued(sourceId: string, task: () => Promise<void>): void {
    this.chains.set(sourceId, (this.chains.get(sourceId) ?? Promise.resolve()).then(task));
  }

  private repairGap(sourceIds: string[], gap: XGap): void {
    void this.deps
      .onGap(sourceIds, gap, (sourceId, item) => this.enqueue(sourceId, item, 'gap-repair'), () => this.stopped)
      .catch((error) => logger.error(`${TAG} Gap repair failed`, { appKey: this.group.appKey, error: String(error) }));
  }

  private ingestOne(sourceId: string, item: XInboundItem, origin: string): Promise<XEnqueueResult> {
    return this.deps.ingest(sourceId, item).then(
      (): XEnqueueResult => 'ingested',
      (error: unknown): XEnqueueResult => {
        logger.error(`${TAG} Ingest failed`, { sourceId, origin, error: String(error) });
        // A streamed message would otherwise be lost once the cursor moves on: repair a gap around
        // it, which retries it (polling) and holds the cursor until then. A gap-repair item that
        // fails is retried by its own repair.
        if (origin !== 'gap-repair') {
          const at = new Date(xItemTime(item) || this.deps.now());
          this.repairGap([sourceId], { since: at, until: at });
        }
        return 'failed';
      },
    );
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
 * Cursor = the stream's last healthy moment, held back to the start of any gap still being repaired
 * and left alone while a worker-start catch-up is pending.
 */
async function saveCursor(sourceId: string, healthyAt: Date): Promise<void> {
  const hold = xGapRepairer.unrepairedFrom(sourceId);
  if (hold === 'catch-up') return;
  const at = hold && hold < healthyAt ? hold : healthyAt;
  await db.externalSource.update({ where: { id: sourceId }, data: { lastSyncCursor: at.toISOString() } });
}

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
  onGap: async (sourceIds, gap, enqueue, isStopped) => {
    await Promise.all(sourceIds.map((sourceId) => xGapRepairer.repair(sourceId, gap, enqueue, isStopped)));
  },
  saveCursor,
  now: () => Date.now(),
};

export const xStreamSupervisor = new XStreamSupervisor(xStreamDeps);
