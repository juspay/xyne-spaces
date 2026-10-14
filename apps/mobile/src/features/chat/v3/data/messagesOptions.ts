import type { MobileMessagesOptions } from '../../messagesOptions.types';

import type { OpenIntent } from '../intent/openIntent.types';
import type { LandingTarget } from '../machine/openState';

/** Matches v2 mobile chat page size (Phase 5 pagination feel). */
export const CHANNEL_PAGE_SIZE = 25;

type SnapshotRow = {
  messageId?: string | null;
  initialMessageId?: string | null;
  createdAt?: number;
};

const snapshotRowFrom = (value: unknown): SnapshotRow | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const createdAt = typeof record['createdAt'] === 'number' ? record['createdAt'] : null;
  return {
    messageId: typeof record['messageId'] === 'string' ? record['messageId'] : null,
    initialMessageId:
      typeof record['initialMessageId'] === 'string' ? record['initialMessageId'] : null,
    ...(createdAt !== null ? { createdAt } : {}),
  };
};

export const createdAtFromSnapshotRows = (rows: readonly unknown[], messageId: string): number => {
  if (!messageId) {
    return 0;
  }
  for (const value of rows) {
    const row = snapshotRowFrom(value);
    if (!row) {
      continue;
    }
    const matches = row.messageId === messageId || row.initialMessageId === messageId;
    if (matches && typeof row.createdAt === 'number' && row.createdAt > 0) {
      return row.createdAt;
    }
  }
  return 0;
};

const linkedAnchor = (
  target: LandingTarget,
): { conversationId: string; createdAt: number } | null => {
  if (target.kind === 'anchor') {
    return { conversationId: target.conversationId, createdAt: target.createdAt };
  }
  return null;
};

/**
 * List query for this landing.
 * Named message: `linkedItemCreatedAt` is the around-cursor (must be known).
 * `notificationTargetMessageId` is cache logging only — it does not fetch.
 */
export const messagesOptionsFor = (
  intent: OpenIntent,
  target: LandingTarget,
  aroundCursor = 0,
): MobileMessagesOptions => {
  const linked = linkedAnchor(target);
  const createdAt =
    linked && linked.createdAt > 0 ? linked.createdAt : aroundCursor > 0 ? aroundCursor : 0;
  const jumpMessageId = target.kind === 'anchor' ? (intent.hint.messageId ?? null) : null;
  return {
    enabled: true,
    channelPageSize: CHANNEL_PAGE_SIZE,
    channelLatestLimit: CHANNEL_PAGE_SIZE,
    promoteLatestTailOnColdOpen: jumpMessageId === null && target.kind === 'tail',
    notificationTargetMessageId: jumpMessageId,
    linkedConversationId: linked?.conversationId ?? null,
    linkedItemCreatedAt: createdAt > 0 ? { createdAt } : null,
    // For an unread-list open, keep Zero's initial window centred on the
    // frozen tap-time boundary. Do not read live status here: the boundary is
    // intentionally immutable for this open.
    lastViewedAt: intent.hint.unreadBoundaryAt ?? null,
  };
};
