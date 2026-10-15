import { db } from '@/database/client';
import type { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';

/** Meta only lets a business reply to a DM within 24h of the customer's last message. */
export const META_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Which ticket thread an inbound Instagram/Messenger DM belongs to. A message within 24h of the
 * customer's last one joins that thread; otherwise it starts a new one (a new ticket).
 */
export async function resolveMetaDmThread(
  externalMessageRepo: ExternalMessageRepository,
  sourceId: string,
  senderId: string,
  timestampMs: number,
): Promise<{ externalThreadId: string; windowExpired: boolean }> {
  const latest = await externalMessageRepo.findLatestForIgsid(sourceId, senderId);
  const latestTime = latest?.createdAt;
  // Math.abs handles out-of-order delivery: a late-arriving webhook can carry a timestamp
  // older than the latest stored message, which would make the raw delta negative.
  const windowExpired =
    !latestTime || Math.abs(timestampMs - latestTime.getTime()) > META_REPLY_WINDOW_MS;

  // New threads are keyed by the start of the message's own 24h window, so concurrent webhooks
  // for the same customer produce the same thread id regardless of server time.
  const windowStart = Math.floor(timestampMs / META_REPLY_WINDOW_MS) * META_REPLY_WINDOW_MS;
  return {
    externalThreadId: latest && !windowExpired ? latest.externalThreadId : `${senderId}:${windowStart}`,
    windowExpired,
  };
}

/**
 * When the customer last wrote on a DM thread. Reads externalMessage (not email) because its
 * createdAt is the real Meta event time, set in core.ts.
 */
export async function getLastInboundAt(
  sourceId: string,
  externalThreadId: string,
): Promise<Date | null> {
  const lastInbound = await db.externalMessage.findFirst({
    where: { externalSourceId: sourceId, externalThreadId, direction: 'INCOMING' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return lastInbound?.createdAt ?? null;
}

/** Whether a DM thread is still inside the standard 24h reply window. */
export async function getMetaReplyWindowState(
  sourceId: string,
  externalThreadId: string,
): Promise<'open' | 'expired' | 'no-inbound'> {
  const lastInboundAt = await getLastInboundAt(sourceId, externalThreadId);
  if (!lastInboundAt) return 'no-inbound';
  return Date.now() - lastInboundAt.getTime() > META_REPLY_WINDOW_MS ? 'expired' : 'open';
}
