/**
 * X gap repair.
 *
 * The activity stream cannot replay missed events on self-serve plans, so each time it reconnects
 * it reports the stretch it was down (a "gap"). Every gap gets its own task, started at once and
 * running in parallel with other gaps' tasks: it polls X for exactly that stretch and hands what it
 * finds to the account's ingest queue, so writes stay one at a time (a message both streamed and
 * polled is skipped the second time). A task that fails (a poll part errored, or a message failed
 * to ingest) retries only those parts, with growing delays, until it succeeds or the gap is a day
 * old. The stream also opens a one-message gap when a streamed message fails to ingest.
 *
 * Bookkeeping, nothing more:
 * - the gaps still unrepaired per account, so the stream never saves the cursor past one
 *   (`unrepairedFrom`); gap repair itself never moves the cursor;
 * - a flag while a repair is polling, so a manual fetch of that account does not read the same
 *   data at the same time (see repairFlag.ts).
 */
import type { ExternalSource } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { isXCreditsDepleted } from './client';
import { xPollWindow } from './flow';
import { X_POLL_PARTS, xPollPartOf, xPoller, type XPollPart } from './poller';
import { redisRepairFlag, type XRepairFlag } from './repairFlag';
import type { XInboundItem } from './types';

const TAG = '[XGapRepair]';

/**
 * A stretch the stream may have missed: from its last healthy moment to when it reconnected.
 * `since` undefined is the catch-up after a worker start: read from the source's saved cursor.
 */
export interface XGap {
  since: Date | undefined;
  until: Date;
}

export type XEnqueueResult = 'ingested' | 'failed' | 'stopped';
/** Puts an item into the stream's ingest queue; resolves once it was processed. */
export type XEnqueue = (sourceId: string, item: XInboundItem) => Promise<XEnqueueResult>;

/** Read this much before the gap: X delivers events a few seconds after they happen. */
export const GAP_START_MARGIN_MS = 2 * 60_000;
/** Read this much after it: clock differences and connection setup, seconds at most. */
export const GAP_END_MARGIN_MS = 15_000;

const RETRY_DELAYS_MS = [2, 5, 15, 60].map((m) => m * 60_000);
/** Out of credits: nothing works until the customer tops up, so retry rarely. */
const CREDITS_RETRY_MS = 60 * 60_000;
/** A gap still failing a day later is given up (logged with its span for a manual fetch). */
const GIVE_UP_AFTER_MS = 24 * 60 * 60_000;

/** One attempt at a gap: done, nothing left to do, or retry these parts. */
export type XRepairOutcome = 'repaired' | 'abandoned' | { retry: XPollPart[]; error: unknown };
export type XRepairAttempt = (
  sourceId: string,
  gap: XGap,
  enqueue: XEnqueue,
  parts: readonly XPollPart[],
) => Promise<XRepairOutcome>;

export class XGapRepairer {
  /** Per account: gaps whose repair has not finished. */
  private readonly unrepaired = new Map<string, Set<XGap>>();
  /** Per account: attempts polling right now (the manual-fetch flag is set while > 0). */
  private readonly polling = new Map<string, number>();

  constructor(
    private readonly attempt: XRepairAttempt,
    private readonly flag: XRepairFlag = redisRepairFlag,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms).unref?.()),
  ) {}

  /**
   * Repairs one gap, retrying as needed; resolves when it is repaired, abandoned or given up.
   * `isStopped`: the stream that owns the queue stopped, so a retry must not pay for another poll.
   */
  async repair(sourceId: string, gap: XGap, enqueue: XEnqueue, isStopped: () => boolean = () => false): Promise<void> {
    const gaps = this.unrepaired.get(sourceId) ?? new Set<XGap>();
    gaps.add(gap);
    this.unrepaired.set(sourceId, gaps);
    let parts: readonly XPollPart[] = X_POLL_PARTS;
    try {
      for (let attempt = 1; ; attempt++) {
        if (isStopped()) return; // its successor catches up from the cursor
        const outcome = await this.whilePolling(sourceId, () => this.safeAttempt(sourceId, gap, enqueue, parts));
        if (outcome === 'repaired' || outcome === 'abandoned') return;

        const span = { since: gap.since?.toISOString() ?? 'cursor', until: gap.until.toISOString() };
        if (this.now() - gap.until.getTime() > GIVE_UP_AFTER_MS) {
          logger.error(`${TAG} Gave up on a gap after a day of failures; recover it with a manual fetch of this span`, {
            sourceId,
            ...span,
            parts: outcome.retry,
            error: String(outcome.error),
          });
          return;
        }
        const delay = isXCreditsDepleted(outcome.error)
          ? CREDITS_RETRY_MS
          : RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
        logger.warn(`${TAG} Gap repair failed; will retry`, {
          sourceId,
          ...span,
          parts: outcome.retry,
          attempt,
          retryInMs: delay,
          error: String(outcome.error),
        });
        parts = outcome.retry; // only what failed: the rest is already in
        await this.sleep(delay);
      }
    } finally {
      gaps.delete(gap);
      if (gaps.size === 0) this.unrepaired.delete(sourceId);
    }
  }

  /**
   * Earliest time not yet repaired for an account, which the cursor must not pass: 'catch-up' while
   * a worker-start catch-up is pending (leave the cursor as it is), undefined when nothing is.
   */
  unrepairedFrom(sourceId: string): Date | 'catch-up' | undefined {
    const gaps = [...(this.unrepaired.get(sourceId) ?? [])];
    if (gaps.some((g) => !g.since)) return 'catch-up';
    const starts = gaps.map((g) => g.since!.getTime() - GAP_START_MARGIN_MS);
    return starts.length ? new Date(Math.min(...starts)) : undefined;
  }

  /** An unexpected throw (e.g. the database) is retried like a failed poll of the same parts. */
  private async safeAttempt(sourceId: string, gap: XGap, enqueue: XEnqueue, parts: readonly XPollPart[]): Promise<XRepairOutcome> {
    try {
      return await this.attempt(sourceId, gap, enqueue, parts);
    } catch (error) {
      return { retry: [...parts], error };
    }
  }

  /** Sets the manual-fetch flag while any attempt of this account is polling. */
  private async whilePolling<T>(sourceId: string, fn: () => Promise<T>): Promise<T> {
    const count = (this.polling.get(sourceId) ?? 0) + 1;
    this.polling.set(sourceId, count);
    if (count === 1) {
      await this.flag
        .set(sourceId)
        .catch((error: unknown) => logger.warn(`${TAG} Could not set repair flag`, { sourceId, error: String(error) }));
    }
    try {
      return await fn();
    } finally {
      const left = (this.polling.get(sourceId) ?? 1) - 1;
      if (left > 0) {
        this.polling.set(sourceId, left);
      } else {
        this.polling.delete(sourceId);
        await this.flag
          .clear(sourceId)
          .catch((error: unknown) => logger.warn(`${TAG} Could not clear repair flag`, { sourceId, error: String(error) }));
      }
    }
  }
}

/**
 * One attempt at a gap: polls `parts` for the gap's own span plus the margins (after `until` the
 * live stream is reading, so even a late attempt reads only what was missed; a catch-up starts at
 * the source's cursor, at most 7 days back) and queues what it finds. Parts that failed come back
 * for a retry, and so does the part of a message that failed to ingest (e.g. a database blip); what
 * was already stored is skipped on the retry. A message that keeps failing is given up with the gap.
 */
export async function repairSourceGap(
  sourceId: string,
  gap: XGap,
  enqueue: XEnqueue,
  parts: readonly XPollPart[] = X_POLL_PARTS,
): Promise<XRepairOutcome> {
  const source = (await db.externalSource.findUnique({ where: { id: sourceId } })) as ExternalSource | null;
  if (!source?.isActive) return 'abandoned';

  const window = {
    start: gap.since ? new Date(gap.since.getTime() - GAP_START_MARGIN_MS) : xPollWindow(source, undefined).start,
    end: new Date(gap.until.getTime() + GAP_END_MARGIN_MS),
  };
  let polled;
  try {
    polled = await xPoller.poll(source, window, parts);
  } catch (error) {
    return { retry: [...parts], error }; // every requested part failed
  }
  const results = await Promise.all(polled.items.map((item) => enqueue(sourceId, item)));
  // The stream that owns the queue stopped (e.g. lost its lease): its successor catches up.
  if (results.includes('stopped')) return 'abandoned';

  logger.info(`${TAG} Gap polled`, {
    sourceId,
    since: gap.since?.toISOString() ?? 'cursor',
    until: gap.until.toISOString(),
    parts,
    polled: polled.items.length,
    failedToIngest: results.filter((r) => r === 'failed').length,
    failedParts: polled.failedParts,
  });
  const failedIngest = polled.items.filter((_, i) => results[i] === 'failed').map(xPollPartOf);
  const retry = [...new Set([...(polled.failedParts ?? []), ...failedIngest])];
  if (retry.length) {
    return {
      retry,
      error: polled.firstError ?? new Error(polled.failedParts?.length ? 'Part of the gap poll failed' : 'A message failed to ingest'),
    };
  }
  if (!polled.complete) {
    // A per-run cap was hit (very busy account, or a long catch-up): retrying would hit it again.
    logger.warn(`${TAG} Gap poll stopped at its cap; older messages in this span may need a manual fetch`, {
      sourceId,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
    });
  }
  return 'repaired';
}

export const xGapRepairer = new XGapRepairer(repairSourceGap);
