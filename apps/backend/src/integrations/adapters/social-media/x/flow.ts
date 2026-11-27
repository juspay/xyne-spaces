import type { ExternalSource } from '@prisma/client';
import { BaseFlow } from '@/integrations/core/baseFlow';
import type { IngestionOptions } from '@/integrations/core/types';
import { xPoller, type XPoller, type XPollWindow } from './poller';
import { isXGapRepairRunning, X_REPAIR_RUNNING_MESSAGE } from './repairFlag';

/** Overlap re-read on cursor-based runs; ingest dedups what was already stored. */
export const X_SYNC_OVERLAP_MS = 2 * 60_000;
/** Manual sync (no cursor) and the oldest a cursor-based run reaches back. */
export const X_MANUAL_SYNC_LOOKBACK_MS = 24 * 60 * 60_000;
export const X_MAX_CURSOR_LOOKBACK_MS = 7 * 24 * 60 * 60_000;

/**
 * Window for a polling run:
 * - a backfill (manual date range, or the stream's gap repair) is used as given;
 * - manual sync reads the last 24 h;
 * - otherwise from the cursor (minus overlap), at most 7 days back.
 * Never before the source was connected, except for an explicit backfill.
 */
export function xPollWindow(source: ExternalSource, options: IngestionOptions | undefined, now = new Date()): XPollWindow {
  if (options?.backfill) return { start: options.backfill.startDate, end: options.backfill.endDate };
  const connectedAt = source.createdAt.getTime();
  if (options?.ignoreSyncCursor) {
    return { start: new Date(Math.max(connectedAt, now.getTime() - X_MANUAL_SYNC_LOOKBACK_MS)) };
  }
  const cursor = source.lastSyncCursor ? Date.parse(source.lastSyncCursor) : Number.NaN;
  const fromCursor = Number.isFinite(cursor) ? cursor - X_SYNC_OVERLAP_MS : connectedAt;
  return { start: new Date(Math.max(connectedAt, fromCursor, now.getTime() - X_MAX_CURSOR_LOOKBACK_MS)) };
}

/**
 * Whether a finished manual or cursor-based run may move the cursor ("everything up to here has
 * been read"). It must have read its whole window, reached the present, and started at or before
 * what is already covered: the cursor itself, or the 7-day floor (older is deliberately never
 * read, so a run starting there leaves no hole even when the cursor is older). E.g. after a 3-day
 * outage a 24 h manual fetch leaves the cursor alone, so the next catch-up still reads the hole.
 * (While the stream runs it saves the cursor itself; see streamWorker.)
 */
export function xCursorAdvance(
  source: Pick<ExternalSource, 'lastSyncCursor'>,
  window: XPollWindow,
  complete: boolean,
  syncStartedAt: Date,
): boolean {
  if (!complete) return false;
  if (window.end && window.end.getTime() < syncStartedAt.getTime() - X_SYNC_OVERLAP_MS) return false;
  const cursor = source.lastSyncCursor ? Date.parse(source.lastSyncCursor) : Number.NaN;
  // No cursor yet: the run started at or after connect time (xPollWindow never reads earlier), so
  // nothing before it is owed.
  if (!Number.isFinite(cursor)) return true;
  const covered = Math.max(cursor, syncStartedAt.getTime() - X_MAX_CURSOR_LOOKBACK_MS);
  return window.start.getTime() <= covered;
}

/**
 * Stream items pass straight through. With no payload (manual sync, gap repair) the flow polls X.
 * The cursor only moves when the run extends it without a gap (see xCursorAdvance).
 */
export class XFlow extends BaseFlow {
  private readonly coverage = new Map<string, boolean>();

  constructor(private readonly poller: XPoller = xPoller) {
    super();
  }

  async preprocess(rawPayload: unknown, source?: ExternalSource, options?: IngestionOptions): Promise<unknown> {
    if (rawPayload !== undefined) return rawPayload;
    if (!source) throw new Error('X source is required for polling');
    // A gap repair is reading this account right now: a parallel manual fetch would only read the
    // same data again. (The reverse is allowed: a repair never waits for a manual fetch.)
    if (await isXGapRepairRunning(source.id)) throw new Error(X_REPAIR_RUNNING_MESSAGE);
    const window = xPollWindow(source, options);
    const { items, complete } = await this.poller.poll(source, window);
    this.coverage.set(source.id, xCursorAdvance(source, window, complete, new Date()));
    return items;
  }

  resolveNextCursor(source: ExternalSource, syncStartedAt: Date): string | null {
    const complete = this.coverage.get(source.id) ?? false;
    this.coverage.delete(source.id);
    return complete ? syncStartedAt.toISOString() : null;
  }
}

export const xFlow = new XFlow();
