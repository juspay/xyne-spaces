import { FLAG_CFG } from './config';
import { RANK, fmtDays, type Sev } from './flags';
import { BUCKETS, bucketOf, median, merchantRow, type FTicket, type MerchantRow } from './portfolio';
import type { Court, Model } from './model';

/** One merchant's page: KPIs, thread trees, age histogram, waiting-on and recently closed. */

export type ThreadStatus = 'open' | 'closed' | 'all';

interface RowBase {
  depth: number;
  /** Last among its siblings (draws └ instead of ├). */
  isLast: boolean;
  /** For each ancestor level 1..depth-1: whether a vertical rail continues past this row. */
  rails: boolean[];
}
export type ThreadRow = (RowBase & { kind: 'ticket'; t: FTicket; hasKids: boolean }) | (RowBase & { kind: 'placeholder'; title: string; d: number });

export interface Thread {
  rootId: string;
  rows: ThreadRow[];
  sev: Sev;
  anyOpen: boolean;
  /** Days since the thread's latest update. */
  lastU: number;
  origin: string;
  size: number;
}

export interface MKpi {
  id: 'open' | 'oldest' | 'median' | 'eta' | 'stale' | 'closed';
  label: string;
  value: string;
  sub: string;
  tone: 'default' | 'red' | 'amber' | 'green' | 'age';
}

export interface MerchantView {
  mid: string;
  row: MerchantRow;
  meta: string;
  kpis: MKpi[];
  threads: Thread[];
  threadCounts: Record<ThreadStatus, number>;
  hist: number[];
  court: { id: Court; label: string; count: number; pct: number }[];
  closed: FTicket[];
}

const ago = (d: number): string => (d < 1 / 24 ? 'just now' : `${fmtDays(d)} ago`);

export function merchantView(m: Model, byId: Map<string, FTicket>, mid: string, status: ThreadStatus, cfg = FLAG_CFG): MerchantView {
  const tickets = (m.byMid.get(mid) ?? []).map(t => byId.get(t.id)!).filter(Boolean);
  const row = merchantRow(mid, tickets);
  const inSet = new Set(tickets.map(t => t.id));
  const open = row.open;

  const roots = tickets.filter(t => !t.parent || !inSet.has(t.parent));
  const threadsAll: Thread[] = roots.map(root => {
    const rows: ThreadRow[] = [];
    const members: FTicket[] = [];
    const walk = (t: FTicket, depth: number, isLast: boolean, rails: boolean[]): void => {
      members.push(t);
      const kids = t.kids.filter(id => inSet.has(id)).map(id => byId.get(id)!);
      const total = kids.length + t.placeholders.length;
      rows.push({ kind: 'ticket', t, depth, isLast, rails, hasKids: total > 0 });
      const childRails = depth === 0 ? [] : [...rails, !isLast];
      kids.forEach((k, i) => walk(k, depth + 1, i === total - 1, childRails));
      t.placeholders.forEach((p, i) =>
        rows.push({ kind: 'placeholder', title: p.title, d: p.d, depth: depth + 1, isLast: kids.length + i === total - 1, rails: childRails }),
      );
    };
    walk(root, 0, true, []);
    const sev = members.filter(t => !t.borrowed).reduce<Sev>((w, t) => (RANK[t.sev] > RANK[w] ? t.sev : w), 'ok');
    const single = members.length === 1;
    const origin = root.kind === 'desk'
      ? single ? 'Desk only, not escalated' : 'Started in Desk'
      : single ? 'Board ticket, no sub-tickets' : 'Started on a board';
    return {
      rootId: root.id,
      rows,
      sev,
      anyOpen: members.some(t => t.open),
      lastU: Math.min(...members.map(t => t.u)),
      origin,
      size: members.length,
    };
  });
  // Counted in tickets so the Show menu agrees with the Open tickets KPI.
  const threadCounts = {
    open: open.length,
    closed: threadsAll.filter(t => !t.anyOpen).reduce((n, t) => n + t.size, 0),
    all: tickets.length,
  };
  const threads = threadsAll
    .filter(t => status === 'all' || (status === 'open' ? t.anyOpen : !t.anyOpen))
    .sort((a, b) => RANK[b.sev] - RANK[a.sev] || a.lastU - b.lastU);

  const closed = tickets.filter(t => !t.open && t.closedD != null && t.closedD <= 30).sort((a, b) => (a.closedD ?? 0) - (b.closedD ?? 0));
  const etaTickets = tickets.filter(t => t.flags.some(f => f.type === 'eta' || f.type === 'stageEta'));
  const staleOpen = open.filter(t => t.flags.some(f => f.type === 'stale'));
  const total = Math.max(1, open.length);
  const courtLabels: [Court, string][] = [['us', 'With us'], ['merchant', 'With merchant'], ['external', 'External']];

  return {
    mid,
    row,
    meta: `${open.length} open · ${row.desk} Desk · ${row.board} board · last activity ${ago(row.lastU)}`,
    kpis: [
      { id: 'open', label: 'Open tickets', value: String(open.length), sub: `${tickets.length} total`, tone: 'default' },
      { id: 'oldest', label: 'Oldest open', value: row.oldest ? fmtDays(row.oldest.d) : '—', sub: row.oldest ? row.oldest.key : 'nothing open', tone: row.oldest ? 'age' : 'default' },
      { id: 'median', label: 'Median age', value: open.length ? fmtDays(median(open.map(t => t.d))) : '—', sub: 'open tickets', tone: 'default' },
      {
        id: 'eta',
        label: 'ETA breached',
        value: String(etaTickets.length),
        sub: `${tickets.flatMap(t => t.flags).filter(f => f.type === 'eta').length} ticket · ${tickets.flatMap(t => t.flags).filter(f => f.type === 'stageEta').length} stage`,
        tone: etaTickets.length ? 'red' : 'default',
      },
      { id: 'stale', label: `No update ${cfg.stale}d+`, value: String(staleOpen.length), sub: 'ball in our court', tone: staleOpen.length ? 'amber' : 'default' },
      { id: 'closed', label: 'Closed · 30d', value: String(closed.length), sub: 'to share on the sync', tone: 'green' },
    ],
    threads,
    threadCounts,
    hist: row.counts,
    court: courtLabels.map(([id, label]) => ({ id, label, count: row.court[id], pct: Math.round((row.court[id] / total) * 100) })),
    closed,
  };
}

export { BUCKETS, bucketOf };
