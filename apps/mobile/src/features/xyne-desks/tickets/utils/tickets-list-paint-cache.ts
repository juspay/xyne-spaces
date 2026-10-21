import type { TicketListItemData } from '../types';

const ticketsByKey = new Map<string, TicketListItemData[]>();

function cacheKey(sessionKey: string, channelId: string): string {
  return `${sessionKey}:${channelId}`;
}

export function getTicketsPaintCache(sessionKey: string, channelId: string): TicketListItemData[] {
  if (!sessionKey || !channelId) return [];
  return ticketsByKey.get(cacheKey(sessionKey, channelId)) ?? [];
}

export function setTicketsPaintCache(
  sessionKey: string,
  channelId: string,
  items: TicketListItemData[],
): void {
  if (!sessionKey || !channelId || items.length === 0) return;
  ticketsByKey.set(cacheKey(sessionKey, channelId), items);
}

/** Drop archived/removed tickets so paint fallback cannot resurrect them. */
export function removeTicketsFromPaintCache(
  sessionKey: string,
  channelId: string,
  ticketIds: readonly string[],
): void {
  if (!sessionKey || !channelId || ticketIds.length === 0) return;
  const key = cacheKey(sessionKey, channelId);
  const existing = ticketsByKey.get(key);
  if (!existing || existing.length === 0) return;

  const remove = new Set(ticketIds);
  const next = existing.filter(item => !remove.has(item.id));
  if (next.length === 0) {
    ticketsByKey.delete(key);
    return;
  }
  ticketsByKey.set(key, next);
}

export function clearTicketsPaintCache(sessionKey?: string, channelId?: string): void {
  if (!sessionKey) {
    ticketsByKey.clear();
    return;
  }
  if (channelId) {
    ticketsByKey.delete(cacheKey(sessionKey, channelId));
    return;
  }
  for (const key of ticketsByKey.keys()) {
    if (key.startsWith(`${sessionKey}:`)) ticketsByKey.delete(key);
  }
}
