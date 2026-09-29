import { FLAG_CFG } from './config';
import { isAbandoned } from './cleanup';
import { RANK, fmtDays, type Sev } from './flags';
import { BUCKETS, bucketOf, median, merchantRow, type FTicket, type MerchantRow } from './portfolio';
import type { Court, Model, Pri } from './model';

/** One merchant's page: KPIs, thread trees, age histogram, waiting-on and recently closed. */

export type ThreadStatus = 'open' | 'closed' | 'all';

/** What a clicked KPI card or bar narrows the tickets list to. */
export type MFocus =
  | { kind: 'eta' }
  | { kind: 'stale' }
  | { kind: 'closed' }
  | { kind: 'ticket'; id: string }
  | { kind: 'bucket'; i: number }
  | { kind: 'court'; court: Court };

export const sameFocus = (a: MFocus | null, b: MFocus | null): boolean => JSON.stringify(a) === JSON.stringify(b);

interface RowBase {
  depth: number;
  /** Last among its siblings (draws └ instead of ├). */
  isLast: boolean;
  /** For each ancestor level 1..depth-1: whether a vertical rail continues past this row. */
  rails: boolean[];
}
// `match`: the ticket is one the focus picked; the rest of its chain is shown dimmed for context.
export type ThreadRow = (RowBase & { kind: 'ticket'; t: FTicket; hasKids: boolean; match: boolean }) | (RowBase & { kind: 'placeholder'; title: string; d: number });

/**
 * A one-click fix for a chain whose statuses disagree: open sub-tickets under a done parent
 * (`closeKids`), or an open parent whose sub-tickets are all finished (`closeParent`).
 */
export interface Nudge {
  kind: 'closeKids' | 'closeParent';
  /** The done parent (closeKids) or the parent to close (closeParent). */
  from: FTicket;
  /** Tickets the button marks done. */
  targets: FTicket[];
}

export interface Thread {
  rootId: string;
  nudges: Nudge[];
  rows: ThreadRow[];
  /** Worst flag in the chain; kept for callers, not shown in the list. */
  sev: Sev;
  anyOpen: boolean;
  /** Age in days of the oldest open ticket, or of the oldest ticket when nothing is open. */
  age: number;
  /** Highest priority among the open tickets (among all of them when nothing is open). */
  pri: Pri;
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
  /** Clicking narrows the list to these tickets; 'open' resets to the open list; null isn't clickable. */
  target: MFocus | 'open' | null;
}

export interface MerchantView {
  mid: string;
  row: MerchantRow;
  meta: string;
  kpis: MKpi[];
  threads: Thread[];
  focus: MFocus | null;
  focusLabel: string | null;
  /** Tickets the focus matched (equals the KPI or bar clicked). */
  focusCount: number;
  threadCounts: Record<ThreadStatus, number>;
  hist: number[];
  court: { id: Court; label: string; count: number; pct: number }[];
  closed: FTicket[];
  range: 'all' | number;
  /** This merchant's tickets that look abandoned, oldest first (whatever the Created range). */
  abandoned: FTicket[];
}

const ago = (d: number): string => (d < 1 / 24 ? 'just now' : `${fmtDays(d)} ago`);

const PRI_RANK: Record<Pri, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
const topPri = (ts: FTicket[]): Pri => ts.reduce<Pri>((w, t) => (PRI_RANK[t.pri] > PRI_RANK[w] ? t.pri : w), 'none');

/** Sibling order: open before closed, then oldest first, then higher priority, then most recently updated. */
const bySibling = (a: FTicket, b: FTicket): number =>
  Number(b.open) - Number(a.open) || b.d - a.d || PRI_RANK[b.pri] - PRI_RANK[a.pri] || a.u - b.u;

/** Chain order: chains with open tickets first, then oldest, then highest priority, then most recently updated. */
const byChain = (a: Thread, b: Thread): number =>
  Number(b.anyOpen) - Number(a.anyOpen) || b.age - a.age || PRI_RANK[b.pri] - PRI_RANK[a.pri] || a.lastU - b.lastU;

const COURT_LABELS: [Court, string][] = [['us', 'With us'], ['merchant', 'With merchant'], ['external', 'External']];

export function merchantView(
  m: Model,
  byId: Map<string, FTicket>,
  mid: string,
  status: ThreadStatus,
  focus: MFocus | null = null,
  range: 'all' | number = 'all',
  cfg = FLAG_CFG,
): MerchantView {
  const everything = (m.byMid.get(mid) ?? []).map(t => byId.get(t.id)!).filter(Boolean);
  // The portfolio's Created range carries over: only tickets created in it count here.
  const tickets = range === 'all' ? everything : everything.filter(t => t.d <= range);
  const row = merchantRow(mid, tickets);
  const inSet = new Set(tickets.map(t => t.id));
  const open = row.open;
  const isEta = (t: FTicket): boolean => t.flags.some(f => f.type === 'eta' || f.type === 'stageEta');
  const isStale = (t: FTicket): boolean => t.open && t.flags.some(f => f.type === 'stale');
  const isClosed30 = (t: FTicket): boolean => !t.open && t.closedD != null && t.closedD <= 30;
  // Each focus matches exactly the tickets its KPI or bar counts.
  const matches = (t: FTicket): boolean => {
    if (!focus) return true;
    switch (focus.kind) {
      case 'eta': return isEta(t);
      case 'stale': return isStale(t);
      case 'closed': return isClosed30(t);
      case 'ticket': return t.id === focus.id;
      case 'bucket': return t.open && bucketOf(t.d) === focus.i;
      case 'court': return t.open && t.court === focus.court;
    }
  };

  const roots = tickets.filter(t => !t.parent || !inSet.has(t.parent));
  const threadsAll: Thread[] = roots.map(root => {
    const rows: ThreadRow[] = [];
    const members: FTicket[] = [];
    const walk = (t: FTicket, depth: number, isLast: boolean, rails: boolean[]): void => {
      members.push(t);
      const kids = t.kids.filter(id => inSet.has(id)).map(id => byId.get(id)!).sort(bySibling);
      const total = kids.length + t.placeholders.length;
      rows.push({ kind: 'ticket', t, depth, isLast, rails, hasKids: total > 0, match: matches(t) });
      const childRails = depth === 0 ? [] : [...rails, !isLast];
      kids.forEach((k, i) => walk(k, depth + 1, i === total - 1, childRails));
      t.placeholders.forEach((p, i) =>
        rows.push({ kind: 'placeholder', title: p.title, d: p.d, depth: depth + 1, isLast: kids.length + i === total - 1, rails: childRails }),
      );
    };
    walk(root, 0, true, []);
    const kidsOf = (t: FTicket): FTicket[] => t.kids.filter(id => inSet.has(id)).map(id => byId.get(id)!);
    const openBelow = (t: FTicket): FTicket[] => kidsOf(t).flatMap(k => [...(k.open ? [k] : []), ...openBelow(k)]);
    const nudges: Nudge[] = [];
    // Only the highest done ticket speaks for the open tickets below it.
    const visit = (t: FTicket, doneAbove: boolean): void => {
      if (!t.open && !doneAbove) {
        const targets = openBelow(t);
        if (targets.length) nudges.push({ kind: 'closeKids', from: t, targets });
      }
      const kids = kidsOf(t);
      // An unlinked sub-ticket isn't finished, and all-cancelled isn't a reason to complete the parent.
      if (t.open && kids.length && !t.placeholders.length && kids.every(k => !k.open) && kids.some(k => k.st === 'completed')) {
        nudges.push({ kind: 'closeParent', from: t, targets: [t] });
      }
      kids.forEach(k => visit(k, doneAbove || !t.open));
    };
    visit(root, false);
    const sev = members.filter(t => !t.borrowed).reduce<Sev>((w, t) => (RANK[t.sev] > RANK[w] ? t.sev : w), 'ok');
    const live = members.filter(t => t.open);
    const ranked = live.length ? live : members;
    const single = members.length === 1;
    const origin = root.kind === 'desk'
      ? single ? 'Desk only, not escalated' : 'Started in Desk'
      : single ? 'Board ticket, no sub-tickets' : 'Started on a board';
    return {
      rootId: root.id,
      nudges,
      rows,
      sev,
      anyOpen: live.length > 0,
      age: Math.max(...ranked.map(t => t.d)),
      pri: topPri(ranked),
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
  // A focus shows every chain with a match, whatever the Show menu says (closed tickets included).
  const threads = threadsAll
    .filter(t => (focus ? t.rows.some(r => r.kind === 'ticket' && r.match) : status === 'all' || (status === 'open' ? t.anyOpen : !t.anyOpen)))
    .sort(byChain);

  const closed = tickets.filter(isClosed30).sort((a, b) => (a.closedD ?? 0) - (b.closedD ?? 0));
  const etaTickets = tickets.filter(isEta);
  const staleOpen = open.filter(isStale);
  const total = Math.max(1, open.length);
  const focusLabel = !focus
    ? null
    : focus.kind === 'eta' ? 'ETA breached'
    : focus.kind === 'stale' ? `No update ${cfg.stale}d+`
    : focus.kind === 'closed' ? 'Closed in the last 30 days'
    : focus.kind === 'ticket' ? `Oldest open · ${byId.get(focus.id)?.key ?? ''}`
    : focus.kind === 'bucket' ? `Open ${BUCKETS[focus.i]}`
    : COURT_LABELS.find(([c]) => c === focus.court)![1];

  return {
    mid,
    row,
    meta: `${open.length} open · ${row.desk} Desk · ${row.board} board · last activity ${ago(row.lastU)}`,
    kpis: [
      { id: 'open', label: 'Open tickets', value: String(open.length), sub: `${tickets.length} total`, tone: 'default', target: 'open' },
      {
        id: 'oldest',
        label: 'Oldest open',
        value: row.oldest ? fmtDays(row.oldest.d) : '—',
        sub: row.oldest ? row.oldest.key : 'nothing open',
        tone: row.oldest ? 'age' : 'default',
        target: row.oldest ? { kind: 'ticket', id: row.oldest.id } : null,
      },
      { id: 'median', label: 'Median age', value: open.length ? fmtDays(median(open.map(t => t.d))) : '—', sub: 'open tickets', tone: 'default', target: null },
      {
        id: 'eta',
        label: 'ETA breached',
        value: String(etaTickets.length),
        sub: `${tickets.flatMap(t => t.flags).filter(f => f.type === 'eta').length} ticket · ${tickets.flatMap(t => t.flags).filter(f => f.type === 'stageEta').length} stage`,
        tone: etaTickets.length ? 'red' : 'default',
        target: { kind: 'eta' },
      },
      { id: 'stale', label: `No update ${cfg.stale}d+`, value: String(staleOpen.length), sub: 'ball in our court', tone: staleOpen.length ? 'amber' : 'default', target: { kind: 'stale' } },
      { id: 'closed', label: 'Closed · 30d', value: String(closed.length), sub: 'to share on the sync', tone: 'green', target: { kind: 'closed' } },
    ],
    threads,
    focus,
    focusLabel,
    focusCount: focus ? tickets.filter(matches).length : 0,
    threadCounts,
    hist: row.counts,
    court: COURT_LABELS.map(([id, label]) => ({ id, label, count: row.court[id], pct: Math.round((row.court[id] / total) * 100) })),
    closed,
    range,
    abandoned: everything.filter(t => isAbandoned(t, byId)).sort((a, b) => b.d - a.d),
  };
}

export { BUCKETS, bucketOf };
