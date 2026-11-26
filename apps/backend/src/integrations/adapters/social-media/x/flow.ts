import type { ExternalSource } from '@prisma/client';
import { BaseFlow } from '@/integrations/core/baseFlow';
import type { IngestionOptions } from '@/integrations/core/types';
import { xPoller, type XPoller, type XPollWindow } from './poller';

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
 * Whether a finished run may move the cursor, and to where. The cursor means "everything up to here
 * has been read", so a run may only extend it contiguously: it must have read its whole window, that
 * window must start at or before the current cursor (no hole in between), and it must reach the
 * present. A cursor-based run always qualifies. A manual 24 h fetch or a gap repair qualifies only
 * when it overlaps the cursor; e.g. after a 3-day outage a 24 h fetch leaves the cursor alone, so
 * the next cursor run still reads the hole.
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
  return !Number.isFinite(cursor) || window.start.getTime() <= cursor;
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
