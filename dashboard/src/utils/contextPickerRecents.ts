import {
  TabType,
  type ContextPickerItem,
} from '../components/Chat/ChatDirectory/ChannelCommandMenu.types';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RECENT = 6;

export const RECENT_KEYS: Partial<Record<TabType, string>> = {
  [TabType.CHANNELS]: 'xyne_ai_recent_channels',
  [TabType.TICKETS]: 'xyne_ai_recent_tickets',
  [TabType.CANVAS]: 'xyne_ai_recent_canvases',
  [TabType.CALL]: 'xyne_ai_recent_transcripts',
  [TabType.RECORDING]: 'xyne_ai_recent_recordings',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function loadRecents(tab: TabType): ContextPickerItem[] {
  try {
    const key = RECENT_KEYS[tab];
    if (!key) return [];
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as ContextPickerItem[]) : [];
  } catch {
    return [];
  }
}

export function saveRecents(tab: TabType, items: ContextPickerItem[]): void {
  try {
    const key = RECENT_KEYS[tab];
    if (!key) return;
    const existing = loadRecents(tab);
    const newIds = new Set(items.map(i => i.id));
    const merged = [...items, ...existing.filter(i => !newIds.has(i.id))].slice(0, MAX_RECENT);
    localStorage.setItem(key, JSON.stringify(merged));
  } catch {
    // ignore
  }
}
