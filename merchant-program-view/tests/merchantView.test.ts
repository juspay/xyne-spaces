import { describe, expect, it } from 'vitest';
import { merchantView } from '../lib/merchantView';
import { withFlags } from '../lib/portfolio';
import type { MTicket, Model } from '../lib/model';

const base: MTicket = {
  id: 't', key: 'T-1', title: 'Ticket', kind: 'crm', src: 'Euler / ISSUE', stage: 'IN DEV', st: 'started', open: true, pri: 'medium',
  court: 'us', who: 'Lisa Roy', reporter: 'Vivek', mids: ['acme'], midR: ['acme'], d: 2, u: 1, eta: null, stageOverdue: false,
  createdAt: 0, updatedAt: 0, closedD: null, parent: null, kids: [], placeholders: [], root: 't', url: '',
};
const mk = (id: string, over: Partial<MTicket>): MTicket => ({ ...base, id, key: id.toUpperCase(), title: `Title ${id}`, root: id, ...over });
function model(...ts: MTicket[]): Model {
  const byMid = new Map<string, MTicket[]>();
  for (const t of ts) for (const mid of t.midR) byMid.set(mid, [...(byMid.get(mid) ?? []), t]);
  return { tickets: new Map(ts.map(t => [t.id, t])), byMid, now: 0 };
}

// Thread 1: Desk d1 → crm c1 (ETA breached) → products p1, p2 (+ placeholder on c1). Thread 2: lone crm c2 (closed 5d ago).
// Thread 3: Desk d2 only, open 1d, waiting on merchant.
const M = model(
  mk('d1', { kind: 'desk', d: 12, u: 0.5, kids: ['c1'], root: 'd1' }),
  mk('c1', { parent: 'd1', root: 'd1', eta: -2, d: 11, u: 3, kids: ['p1', 'p2'], placeholders: [{ title: 'Risk review', d: 5 }] }),
  mk('p1', { kind: 'product', mids: [], parent: 'c1', root: 'd1', d: 10, u: 2 }),
  mk('p2', { kind: 'product', mids: [], parent: 'c1', root: 'd1', open: false, st: 'completed', closedD: 4, d: 9 }),
  mk('c2', { open: false, st: 'completed', closedD: 5, d: 24 }),
  mk('d2', { kind: 'desk', d: 1, court: 'merchant' }),
);
const F = withFlags(M);

describe('merchantView', () => {
  const v = merchantView(M, F, 'acme', 'open');

  it('summarises the merchant', () => {
    expect(v.row.sev).toBe('red');
    expect(v.meta).toBe('4 open · 2 Desk · 2 board · last activity 12h ago');
    const k = Object.fromEntries(v.kpis.map(x => [x.id, x.value]));
    expect(k).toMatchObject({ open: '4', oldest: '12d', median: '10d', eta: '1', stale: '0', closed: '2' });
    expect(v.kpis.find(x => x.id === 'open')).toMatchObject({ label: 'Open tickets', sub: '6 total' });
    expect(v.kpis.map(x => `${x.label} ${x.sub}`).join(' ')).not.toMatch(/thread/i);
  });

  it('draws thread trees with depth, rails and placeholders', () => {
    const t1 = v.threads.find(t => t.rootId === 'd1')!;
    expect(t1.origin).toBe('Started in Desk');
    expect(t1.size).toBe(4);
    expect(t1.rows.map(r => [r.kind === 'ticket' ? r.t.id : `ph:${r.title}`, r.depth, r.isLast, r.rails])).toEqual([
      ['d1', 0, true, []],
      ['c1', 1, true, []],
      ['p1', 2, false, [false]],
      ['p2', 2, false, [false]],
      ['ph:Risk review', 2, true, [false]],
    ]);
    expect(v.threads.map(t => t.rootId)).toEqual(['d1', 'd2']);
    // Ticket counts (not groups), so the Show menu matches the Open tickets KPI.
    expect(v.threadCounts).toEqual({ open: 4, closed: 1, all: 6 });
    expect(merchantView(M, F, 'acme', 'closed').threads.map(t => [t.rootId, t.origin])).toEqual([['c2', 'Board ticket, no sub-tickets']]);
    expect(v.threads.find(t => t.rootId === 'd2')!.origin).toBe('Desk only, not escalated');
  });

  it('builds the histogram, waiting-on and recently closed', () => {
    expect(v.hist).toEqual([1, 0, 3, 0, 0]);
    expect(v.court).toEqual([
      { id: 'us', label: 'With us', count: 3, pct: 75 },
      { id: 'merchant', label: 'With merchant', count: 1, pct: 25 },
      { id: 'external', label: 'External', count: 0, pct: 0 },
    ]);
    expect(v.closed.map(t => t.id)).toEqual(['p2', 'c2']);
  });
});

describe('merchantView flags', () => {
  it('counts no-update KPI by the stale flag, and a borrowing parent does not colour its group', () => {
    const X = model(
      mk('g', { kind: 'product', mids: [], midR: ['m1'], who: null, borrowed: true, kids: ['k'], root: 'g' }),
      mk('k', { mids: ['m1'], midR: ['m1'], parent: 'g', root: 'g' }),
      mk('s', { kind: 'desk', mids: ['m1'], midR: ['m1'], u: 9, d: 1, court: 'us', kids: ['k'] }),
    );
    const v = merchantView(X, withFlags(X), 'm1', 'all');
    expect(v.kpis.find(x => x.id === 'stale')!.value).toBe('0');
    expect(v.threads.find(t => t.rootId === 'g')!.sev).toBe('ok');
  });
});
