import type { ChannelTicketRow } from '../types';

/**
 * In-memory last-good rows per (session, channel), unfiltered first page only.
 * Same policy as the desks list paint cache: seed on mount, overwrite on a non-empty
 * live result, clear on a confirmed-empty live result. Never written from filtered views.
 */
const rowsByKey = new Map<string, ChannelTicketRow[]>();

function cacheKey(sessionKey: string, channelId: string): string {
  return `${sessionKey}:${channelId}`;
}

export function getChannelTicketsPaintCache(
  sessionKey: string,
  channelId: string,
): ChannelTicketRow[] {
  if (!sessionKey || !channelId) return [];
  return rowsByKey.get(cacheKey(sessionKey, channelId)) ?? [];
}

export function setChannelTicketsPaintCache(
  sessionKey: string,
  channelId: string,
  rows: ChannelTicketRow[],
): void {
  if (!sessionKey || !channelId || rows.length === 0) return;
  rowsByKey.set(cacheKey(sessionKey, channelId), rows);
}

export function clearChannelTicketsPaintCache(sessionKey?: string, channelId?: string): void {
  if (!sessionKey) {
    rowsByKey.clear();
    return;
  }
  if (channelId) {
    rowsByKey.delete(cacheKey(sessionKey, channelId));
    return;
  }
  for (const key of rowsByKey.keys()) {
    if (key.startsWith(`${sessionKey}:`)) rowsByKey.delete(key);
  }
}
