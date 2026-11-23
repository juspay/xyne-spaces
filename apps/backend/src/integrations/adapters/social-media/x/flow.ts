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
 * Stream items pass straight through. With no payload (manual sync, gap repair) the flow polls X.
 * The cursor only advances when the run covered its whole window.
 */
export class XFlow extends BaseFlow {
  private readonly coverage = new Map<string, boolean>();

  constructor(private readonly poller: XPoller = xPoller) {
    super();
  }

  async preprocess(rawPayload: unknown, source?: ExternalSource, options?: IngestionOptions): Promise<unknown> {
    if (rawPayload !== undefined) return rawPayload;
    if (!source) throw new Error('X source is required for polling');
    const { items, complete } = await this.poller.poll(source, xPollWindow(source, options));
    this.coverage.set(source.id, complete);
    return items;
  }

  resolveNextCursor(source: ExternalSource, syncStartedAt: Date): string | null {
    const complete = this.coverage.get(source.id) ?? false;
    this.coverage.delete(source.id);
    return complete ? syncStartedAt.toISOString() : null;
  }
}

export const xFlow = new XFlow();
