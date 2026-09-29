/** Per-viewer preferences kept in browser storage. Storage may be missing or blocked in the sandbox. */

export type Range = 'all' | number;

/** The Created menu's choices; anything else in storage is ignored. */
export const RANGE_VALUES: Range[] = ['all', 7, 30, 90, 180, 365];

const RANGE_KEY = 'mpv.createdRange';

export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadRange(store: Storage | null): Range {
  try {
    const raw = store?.getItem(RANGE_KEY);
    if (!raw) return 'all';
    const v: unknown = JSON.parse(raw);
    return RANGE_VALUES.find(r => r === v) ?? 'all';
  } catch {
    return 'all';
  }
}

export function saveRange(store: Storage | null, v: Range): void {
  try {
    store?.setItem(RANGE_KEY, JSON.stringify(v));
  } catch {
    // Blocked storage: the choice just lasts for this session.
  }
}

/** The filter pills and tab, remembered between visits (search and one-off KPI filters aren't). */
export interface SavedFilters {
  tab: 'merchants' | 'tickets';
  desks: string[];
  boards: string[];
  owners: string[];
  health: ('red' | 'amber' | 'watch' | 'ok')[];
}

const FILTERS_KEY = 'mpv.filters';
const HEALTH = ['red', 'amber', 'watch', 'ok'] as const;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function loadFilters(store: Storage | null): SavedFilters {
  let v: Record<string, unknown> = {};
  try {
    const raw = store?.getItem(FILTERS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) v = parsed as Record<string, unknown>;
  } catch {
    // Unreadable or blocked: start with no filters.
  }
  return {
    tab: v.tab === 'tickets' ? 'tickets' : 'merchants',
    desks: strings(v.desks),
    boards: strings(v.boards),
    owners: strings(v.owners),
    health: strings(v.health).filter((h): h is SavedFilters['health'][number] => (HEALTH as readonly string[]).includes(h)),
  };
}

export function saveFilters(store: Storage | null, f: SavedFilters): void {
  try {
    store?.setItem(FILTERS_KEY, JSON.stringify({ tab: f.tab, desks: f.desks, boards: f.boards, owners: f.owners, health: f.health }));
  } catch {
    // Blocked storage: filters just last for this session.
  }
}

const PICKS_KEY = 'mpv.midPicks';
const PICKS_MAX = 50;
type Picks = Record<string, { n: number; at: number }>;

function readPicks(store: Storage | null): Picks {
  try {
    const raw = store?.getItem(PICKS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Picks) : {};
  } catch {
    return {};
  }
}

const ranked = (p: Picks): string[] =>
  Object.entries(p)
    .filter(([, v]) => v && typeof v.n === 'number')
    .sort((a, b) => b[1].n - a[1].n || b[1].at - a[1].at)
    .map(([mid]) => mid);

/** Merchant IDs this viewer picks most, most-picked first (ties: most recent). */
export function loadMidPicks(store: Storage | null): string[] {
  return ranked(readPicks(store));
}

/** Count a pick from the search box; keeps the 50 most-picked. */
export function recordMidPick(store: Storage | null, mid: string, now: number = Date.now()): void {
  const p = readPicks(store);
  p[mid] = { n: (p[mid]?.n ?? 0) + 1, at: now };
  const keep = ranked(p).slice(0, PICKS_MAX);
  const trimmed = Object.fromEntries(keep.map(m => [m, p[m]]));
  try {
    store?.setItem(PICKS_KEY, JSON.stringify(trimmed));
  } catch {
    // Blocked storage: history just isn't kept.
  }
}
