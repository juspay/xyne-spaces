import { FLAG_CFG } from './config';
import { isAbandoned } from './cleanup';
import { FLAG_LABEL, RANK, fmtDays, flagsFor, sevOf, type Flag, type FlagType, type Sev } from './flags';
import type { Court, MTicket, Model } from './model';

/** Everything the portfolio page shows, derived from the model and the page's filter state. */

export type Tab = 'merchants' | 'tickets';
export type TypeFilter = FlagType | 'anyEta' | null;

export interface PState {
  tab: Tab;
  /** Created within the last N days, or all time. */
  range: 'all' | number;
  /** Merchant IDs picked from the search suggestions; empty = all merchants. Scopes the whole page. */
  mids: string[];
  /** Text matched against merchant IDs only. Scopes the whole page. */
  search: string;
  /** Desk sources ("Desk · <channel>") and board sources ("<project> / <board>"); none picked = all. */
  desks: string[];
  boards: string[];
  owners: string[];
  /** Merchant health on the Merchants tab, a ticket's worst flag on Tickets; empty = all. */
  health: Sev[];
  typeFilter: TypeFilter;
  bucket: number | null;
}

export const DEFAULT_PSTATE: PState = {
  tab: 'merchants',
  range: 'all',
  mids: [],
  search: '',
  desks: [],
  boards: [],
  owners: [],
  health: [],
  typeFilter: null,
  bucket: null,
};

export const BUCKETS = ['0–3d', '4–7d', '8–14d', '15–30d', '30d+'];
/** Ages are shown in whole days, so bucket by whole days too. */
export function bucketOf(age: number): number {
  const d = Math.floor(age);
  return d <= 3 ? 0 : d <= 7 ? 1 : d <= 14 ? 2 : d <= 30 ? 3 : 4;
}

export interface FTicket extends MTicket {
  flags: Flag[];
  sev: Sev;
}

export interface Chip {
  type: FlagType;
  label: string;
  sev: Sev;
}

export interface MerchantRow {
  mid: string;
  sev: Sev;
  tickets: FTicket[];
  open: FTicket[];
  openCount: number;
  desk: number;
  board: number;
  /** Open tickets per age bucket. */
  counts: number[];
  /** Median open age in days; null when nothing is open. */
  median: number | null;
  oldest: FTicket | null;
  chips: Chip[];
  court: Record<Court, number>;
  /** Days since the merchant's most recent ticket update. */
  lastU: number;
  red: number;
  amber: number;
}

export type KpiTarget =
  | { kind: 'merchants'; health: Sev[] }
  | { kind: 'tickets'; typeFilter: TypeFilter }
  | { drawer: string };

export interface Kpi {
  id: 'attention' | 'open' | 'median' | 'oldest' | 'eta' | 'stale';
  label: string;
  value: string;
  sub: string;
  tone: 'default' | 'red' | 'amber' | 'age';
  target: KpiTarget | null;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

const isEta = (f: Flag): boolean => f.type === 'eta' || f.type === 'stageEta';

/** Flags for every ticket in the model. */
export function withFlags(m: Model): Map<string, FTicket> {
  const out = new Map<string, FTicket>();
  for (const t of m.tickets.values()) {
    const flags = flagsFor(t, m);
    out.set(t.id, { ...t, flags, sev: sevOf(flags) });
  }
  return out;
}

export function merchantRow(mid: string, tickets: FTicket[]): MerchantRow {
  const open = tickets.filter(t => t.open);
  // Tickets that only borrow this merchant's ID from their sub-tickets don't set its health.
  const flags = tickets.filter(t => !t.borrowed).flatMap(t => t.flags);
  const counts = [0, 0, 0, 0, 0];
  for (const t of open) counts[bucketOf(t.d)] += 1;
  const byType = new Map<FlagType, { n: number; sev: Sev }>();
  for (const f of flags) byType.set(f.type, { n: (byType.get(f.type)?.n ?? 0) + 1, sev: f.sev });
  const chips = [...byType]
    .sort((a, b) => RANK[b[1].sev] - RANK[a[1].sev])
    .map(([type, c]) => ({ type, sev: c.sev, label: c.n > 1 ? `${FLAG_LABEL[type]} ×${c.n}` : FLAG_LABEL[type] }));
  const court: Record<Court, number> = { us: 0, merchant: 0, external: 0 };
  for (const t of open) court[t.court] += 1;
  return {
    mid,
    sev: sevOf(flags),
    tickets,
    open,
    openCount: open.length,
    desk: open.filter(t => t.kind === 'desk').length,
    board: open.filter(t => t.kind !== 'desk').length,
    counts,
    median: open.length > 0 ? median(open.map(t => t.d)) : null,
    oldest: open.reduce<FTicket | null>((a, t) => (!a || t.d > a.d ? t : a), null),
    chips,
    court,
    lastU: Math.min(...tickets.map(t => t.u)),
    red: flags.filter(f => f.sev === 'red').length,
    amber: flags.filter(f => f.sev === 'amber').length,
  };
}

export const sortMerchants = (a: MerchantRow, b: MerchantRow): number =>
  RANK[b.sev] - RANK[a.sev] || b.red - a.red || b.amber - a.amber || (b.oldest?.d ?? 0) - (a.oldest?.d ?? 0);

export interface Portfolio {
  kpis: Kpi[];
  buckets: number[];
  merchants: MerchantRow[];
  merchantRows: MerchantRow[];
  ticketRows: FTicket[];
  people: string[];
  /** Desk and board sources that have tickets in range, for the Desks / Boards filters. */
  deskOptions: string[];
  boardOptions: string[];
  byId: Map<string, FTicket>;
  /** Tickets that look abandoned (see lib/cleanup), oldest first; not limited by the Created range. */
  abandoned: FTicket[];
}

export interface MidSuggestion {
  mid: string;
  open: number;
  total: number;
}

/** Merchant IDs matching the search text (prefix matches first), for the search box's suggestions. */
/** Open and total counts over the tickets the page would show for this Created range. */
function midCounts(mid: string, ts: MTicket[], range: PState['range']): MidSuggestion {
  const inRange = range === 'all' ? ts : ts.filter(t => t.d <= range);
  return { mid, open: inRange.filter(t => t.open).length, total: inRange.length };
}

export function midSuggestions(m: Model, query: string, selected: string[], range: PState['range'] = 'all', limit = 8): MidSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const skip = new Set(selected);
  const hits: (MidSuggestion & { at: number })[] = [];
  for (const [mid, ts] of m.byMid) {
    if (skip.has(mid)) continue;
    const at = mid.toLowerCase().indexOf(q);
    if (at >= 0) hits.push({ ...midCounts(mid, ts, range), at });
  }
  // Prefix matches first, then busier merchants.
  hits.sort((a, b) => Number(a.at > 0) - Number(b.at > 0) || b.total - a.total || a.mid.localeCompare(b.mid));
  return hits.slice(0, limit).map(({ mid, open, total }) => ({ mid, open, total }));
}

// Flags and merchant rows depend only on the model (and the range), not on the other filters,
// so they're computed once per model instead of on every keystroke.
const flagCache = new WeakMap<Model, Map<string, FTicket>>();
const rangeCache = new WeakMap<Model, Map<PState['range'], { tv: FTicket[]; merchants: MerchantRow[] }>>();

function inRangeRows(m: Model, byId: Map<string, FTicket>, range: PState['range']): { tv: FTicket[]; merchants: MerchantRow[] } {
  let perRange = rangeCache.get(m);
  if (!perRange) rangeCache.set(m, (perRange = new Map()));
  const hit = perRange.get(range);
  if (hit) return hit;
  const tv = [...byId.values()].filter(t => range === 'all' || t.d <= range);
  const tvIds = new Set(tv.map(t => t.id));
  const merchants = [...m.byMid.keys()]
    .map(mid => merchantRow(mid, m.byMid.get(mid)!.filter(t => tvIds.has(t.id)).map(t => byId.get(t.id)!)))
    .filter(r => r.tickets.length > 0)
    .sort(sortMerchants);
  const out = { tv, merchants };
  perRange.set(range, out);
  return out;
}

/**
 * What the search box offers before anything is typed: the viewer's most-searched merchants, or the
 * busiest ones (most open tickets) when there's no history yet.
 */
export function defaultMidSuggestions(m: Model, picks: string[], selected: string[], range: PState['range'] = 'all', limit = 6): { title: string; items: MidSuggestion[] } {
  const skip = new Set(selected);
  const row = (mid: string): MidSuggestion => midCounts(mid, m.byMid.get(mid)!, range);
  const recent = picks.filter(mid => m.byMid.has(mid) && !skip.has(mid)).slice(0, limit);
  if (recent.length) return { title: 'Frequently searched', items: recent.map(row) };
  const busiest = [...m.byMid.keys()]
    .filter(mid => !skip.has(mid))
    .map(row)
    .sort((a, b) => b.open - a.open || b.total - a.total || a.mid.localeCompare(b.mid))
    .slice(0, limit);
  return { title: 'Busiest merchants', items: busiest };
}

export function portfolio(m: Model, s: PState, cfg = FLAG_CFG): Portfolio {
  let byId = flagCache.get(m);
  if (!byId) flagCache.set(m, (byId = withFlags(m)));
  const { tv: tvAll, merchants: merchantsAll } = inRangeRows(m, byId, s.range);

  // Merchant ID search and picks scope everything below, KPIs included.
  const q = s.search.trim().toLowerCase();
  const pick = new Set(s.mids);
  const midMatch = (mid: string): boolean => (pick.size === 0 || pick.has(mid)) && (!q || mid.toLowerCase().includes(q));
  const scoped = pick.size === 0 && !q;
  const tv = scoped ? tvAll : tvAll.filter(t => t.midR.some(midMatch));
  const merchants = scoped ? merchantsAll : merchantsAll.filter(r => midMatch(r.mid));

  const desks = new Set(s.desks);
  const boards = new Set(s.boards);
  const srcOk = (t: MTicket): boolean => (desks.size === 0 && boards.size === 0) || (t.kind === 'desk' ? desks.has(t.src) : boards.has(t.src));
  const ownOk = (t: MTicket): boolean => s.owners.length === 0 || (t.who !== null && s.owners.includes(t.who));
  const typeOk = (t: FTicket): boolean =>
    !s.typeFilter || t.flags.some(f => f.type === s.typeFilter || (s.typeFilter === 'anyEta' && isEta(f)));
  const healthOk = (sev: Sev): boolean => s.health.length === 0 || s.health.includes(sev);

  const merchantRows = merchants.filter(
    r =>
      healthOk(r.sev) &&
      (s.owners.length === 0 || r.open.some(ownOk)) &&
      (desks.size === 0 && boards.size === 0 || r.open.some(srcOk)),
  );

  const ticketRows = tv
    .filter(
      t =>
        (t.open || t.flags.length > 0) &&
        srcOk(t) &&
        ownOk(t) &&
        typeOk(t) &&
        healthOk(t.sev) &&
        (s.bucket === null || (t.open && bucketOf(t.d) === s.bucket)),
    )
    .sort((a, b) => RANK[b.sev] - RANK[a.sev] || b.d - a.d);

  const allOpen = tv.filter(t => t.open);
  const buckets = [0, 0, 0, 0, 0];
  for (const t of allOpen) buckets[bucketOf(t.d)] += 1;
  const need = merchants.filter(r => r.sev === 'red' || r.sev === 'amber');
  const etaFlags = tv.flatMap(t => t.flags.filter(isEta).map(f => ({ f, t })));
  const etaTickets = new Set(etaFlags.map(x => x.t.id)).size;
  // Count by flag so each KPI matches the list its click opens.
  const hasFlag = (t: FTicket, type: FlagType): boolean => t.flags.some(f => f.type === type);
  const stale = tv.filter(t => hasFlag(t, 'stale'));
  const ageing = tv.filter(t => hasFlag(t, 'ageing'));
  const oldest = allOpen.reduce<FTicket | null>((a, t) => (!a || t.d > a.d ? t : a), null);

  const kpis: Kpi[] = [
    {
      id: 'attention',
      label: 'Needs attention',
      value: String(need.length),
      sub: `${merchants.filter(r => r.sev === 'red').length} critical · ${merchants.filter(r => r.sev === 'amber').length} at risk · of ${merchants.length}`,
      tone: 'default',
      target: { kind: 'merchants', health: ['red', 'amber'] },
    },
    {
      id: 'open',
      label: 'Open tickets',
      value: String(allOpen.length),
      sub: `${allOpen.filter(t => t.kind === 'desk').length} Desk · ${allOpen.filter(t => t.kind !== 'desk').length} board`,
      tone: 'default',
      target: { kind: 'tickets', typeFilter: null },
    },
    {
      id: 'median',
      label: 'Median open age',
      value: allOpen.length ? fmtDays(median(allOpen.map(t => t.d))) : '—',
      sub: `${ageing.length} open longer than ${cfg.ageing}d`,
      tone: 'default',
      target: { kind: 'tickets', typeFilter: 'ageing' },
    },
    {
      id: 'oldest',
      label: 'Oldest open',
      value: oldest ? fmtDays(oldest.d) : '—',
      sub: oldest ? `${oldest.key} · ${oldest.midR[0] ?? 'no MID'}` : 'nothing open',
      tone: oldest ? 'age' : 'default',
      target: oldest ? { drawer: oldest.id } : null,
    },
    {
      id: 'eta',
      label: 'ETA breached',
      value: String(etaTickets),
      sub: `${etaFlags.filter(x => x.f.type === 'eta').length} ticket ETA · ${etaFlags.filter(x => x.f.type === 'stageEta').length} stage ETA`,
      tone: etaTickets > 0 ? 'red' : 'default',
      target: { kind: 'tickets', typeFilter: 'anyEta' },
    },
    {
      id: 'stale',
      label: `No update in ${cfg.stale}d+`,
      value: String(stale.length),
      sub: 'ball in our court',
      tone: stale.length > 0 ? 'amber' : 'default',
      target: { kind: 'tickets', typeFilter: 'stale' },
    },
  ];

  const people = [...new Set(tv.map(t => t.who).filter((w): w is string => w !== null))].sort();
  const deskOptions = [...new Set(tvAll.filter(t => t.kind === 'desk').map(t => t.src))].sort();
  const boardOptions = [...new Set(tvAll.filter(t => t.kind !== 'desk').map(t => t.src))].sort();
  // Abandoned tickets are old by definition, so the Created range doesn't apply; the other scoping does.
  const abandoned = [...byId.values()]
    .filter(t => isAbandoned(t, byId) && (scoped || t.midR.some(midMatch)) && srcOk(t) && ownOk(t))
    .sort((a, b) => b.d - a.d);

  return { kpis, buckets, merchants, merchantRows, ticketRows, people, deskOptions, boardOptions, byId, abandoned };
}

export interface Page<T> {
  rows: T[];
  page: number;
  pages: number;
  text: string;
}

export function paginate<T>(list: T[], page: number, per = 10): Page<T> {
  const pages = Math.max(1, Math.ceil(list.length / per));
  const cur = Math.min(Math.max(1, page), pages);
  const from = list.length ? (cur - 1) * per + 1 : 0;
  const to = Math.min(cur * per, list.length);
  return { rows: list.slice((cur - 1) * per, cur * per), page: cur, pages, text: `${from}–${to} of ${list.length}` };
}
