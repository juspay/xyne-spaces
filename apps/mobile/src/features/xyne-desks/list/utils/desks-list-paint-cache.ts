import type { DeskListItemData } from '../types';

const desksBySession = new Map<string, DeskListItemData[]>();

export function getDesksPaintCache(sessionKey: string): DeskListItemData[] {
  if (!sessionKey) return [];

  return desksBySession.get(sessionKey) ?? [];
}

export function setDesksPaintCache(sessionKey: string, items: DeskListItemData[]) {
  if (!sessionKey || items.length === 0) return;

  desksBySession.set(sessionKey, items);
}

export function clearDesksPaintCache(sessionKey?: string): void {
  if (!sessionKey) {
    desksBySession.clear();
    return;
  }

  desksBySession.delete(sessionKey);
}
