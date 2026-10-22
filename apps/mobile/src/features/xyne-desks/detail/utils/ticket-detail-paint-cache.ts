import type { TicketDetailSnapshot } from '../types';
import { normalizeEmailSnapshots } from './map-ticket-detail';

const detailByKey = new Map<string, TicketDetailSnapshot>();

function cacheKey(sessionKey: string, channelId: string, ticketKey: string): string {
  return `${sessionKey}:${channelId}:${ticketKey}`;
}

function emailsNeedAttachmentBackfill(
  emails: TicketDetailSnapshot['emails'] | undefined,
): emails is TicketDetailSnapshot['emails'] {
  return Boolean(emails?.some(email => !Array.isArray(email.attachments)));
}

function withAttachmentArrays(snapshot: TicketDetailSnapshot): TicketDetailSnapshot {
  // Keep the same object identity unless emails need a one-time attachments backfill.
  // Legacy paint entries may omit deskSource — treat it as optional, do not clone to fill it.
  if (!emailsNeedAttachmentBackfill(snapshot.emails)) return snapshot;
  return { ...snapshot, emails: normalizeEmailSnapshots(snapshot.emails) };
}

export function getTicketDetailPaintCache(
  sessionKey: string,
  channelId: string,
  ticketKey: string,
): TicketDetailSnapshot | null {
  if (!sessionKey || !channelId || !ticketKey) return null;
  const snapshot = detailByKey.get(cacheKey(sessionKey, channelId, ticketKey));
  if (!snapshot) return null;
  return withAttachmentArrays(snapshot);
}

export function setTicketDetailPaintCache(
  sessionKey: string,
  channelId: string,
  ticketKey: string,
  snapshot: TicketDetailSnapshot,
): void {
  if (!sessionKey || !channelId || !ticketKey) return;
  detailByKey.set(cacheKey(sessionKey, channelId, ticketKey), withAttachmentArrays(snapshot));
}

export function clearTicketDetailPaintCache(
  sessionKey?: string,
  channelId?: string,
  ticketKey?: string,
): void {
  if (!sessionKey) {
    detailByKey.clear();
    return;
  }
  if (channelId && ticketKey) {
    detailByKey.delete(cacheKey(sessionKey, channelId, ticketKey));
    return;
  }
  const prefix = channelId ? `${sessionKey}:${channelId}:` : `${sessionKey}:`;
  for (const key of detailByKey.keys()) {
    if (key.startsWith(prefix)) detailByKey.delete(key);
  }
}
