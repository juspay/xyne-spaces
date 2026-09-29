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

describe('merchantView order (oldest first, then highest priority)', () => {
  const done = { open: false, st: 'completed' as const, closedD: 1 };
  const order = (...ts: MTicket[]) => merchantView(model(...ts), withFlags(model(...ts)), 'acme', 'all').threads.map(t => t.rootId);

  it('orders chains by their oldest open ticket, then priority, then latest update; closed chains last', () => {
    expect(
      order(
        mk('a', { d: 5, pri: 'low', u: 1 }),
        // The closed root is older, but only open tickets count.
        mk('b', { ...done, d: 20, kids: ['b1'] }),
        mk('b1', { parent: 'b', root: 'b', d: 3 }),
        mk('c', { d: 5, pri: 'critical', u: 4 }),
        mk('e', { ...done, d: 30 }),
        mk('f', { ...done, d: 40 }),
        mk('g', { d: 5, pri: 'low', u: 0.5 }),
        // A closed urgent sub-ticket doesn't lift the chain's priority.
        mk('h', { d: 5, pri: 'low', u: 2, kids: ['h1'] }),
        mk('h1', { ...done, parent: 'h', root: 'h', pri: 'critical', d: 4, u: 3 }),
      ),
    ).toEqual(['c', 'g', 'a', 'h', 'b', 'f', 'e']);
  });

  it('orders sibling sub-tickets open first, then oldest, then priority, keeping the tree intact', () => {
    const X = model(
      mk('r', { d: 60, kids: ['k1', 'k2', 'k3', 'k4'], placeholders: [{ title: 'Later', d: 2 }] }),
      mk('k1', { ...done, parent: 'r', root: 'r', d: 50 }),
      mk('k2', { parent: 'r', root: 'r', d: 4, pri: 'low' }),
      mk('k3', { parent: 'r', root: 'r', d: 9, pri: 'low', kids: ['k5'] }),
      mk('k4', { parent: 'r', root: 'r', d: 4, pri: 'high' }),
      mk('k5', { parent: 'k3', root: 'r', d: 8 }),
    );
    const v = merchantView(X, withFlags(X), 'acme', 'all');
    expect(v.threads[0].rows.map(r => [r.kind === 'ticket' ? r.t.id : `ph:${r.title}`, r.depth, r.isLast, r.rails])).toEqual([
      ['r', 0, true, []],
      ['k3', 1, false, []],
      ['k5', 2, true, [true]],
      ['k4', 1, false, []],
      ['k2', 1, false, []],
      ['k1', 1, false, []],
      ['ph:Later', 1, true, []],
    ]);
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

describe('merchantView focus (clicked KPI or bar)', () => {
  const f = (focus: Parameters<typeof merchantView>[4]) => merchantView(M, F, 'acme', 'open', focus);
  const marks = (v: ReturnType<typeof merchantView>) =>
    v.threads.map(t => [t.rootId, t.rows.filter(r => r.kind === 'ticket' && r.match).map(r => (r.kind === 'ticket' ? r.t.id : ''))]);

  it('matches every row when nothing is focused', () => {
    expect(v0().focus).toBeNull();
    expect(v0().threads.flatMap(t => t.rows).filter(r => r.kind === 'ticket').every(r => r.kind === 'ticket' && r.match)).toBe(true);
  });
  const v0 = () => merchantView(M, F, 'acme', 'open');

  it('points the clickable KPIs at the tickets they count; median is not clickable', () => {
    expect(Object.fromEntries(v0().kpis.map(k => [k.id, k.target]))).toEqual({
      open: 'open',
      oldest: { kind: 'ticket', id: 'd1' },
      median: null,
      eta: { kind: 'eta' },
      stale: { kind: 'stale' },
      closed: { kind: 'closed' },
    });
  });

  it('keeps whole chains that contain a match, marking only the matching tickets', () => {
    const v = f({ kind: 'eta' });
    expect(marks(v)).toEqual([['d1', ['c1']]]);
    expect(v.threads[0].rows.map(r => (r.kind === 'ticket' ? r.t.id : 'ph'))).toEqual(['d1', 'c1', 'p1', 'p2', 'ph']);
    expect([v.focusLabel, v.focusCount]).toEqual(['ETA breached', 1]);
  });

  it('filters by age bucket and waiting-on, counting like the bars', () => {
    expect(marks(f({ kind: 'bucket', i: 2 }))).toEqual([['d1', ['d1', 'c1', 'p1']]]);
    expect(f({ kind: 'bucket', i: 2 }).focusCount).toBe(v0().hist[2]);
    expect(marks(f({ kind: 'bucket', i: 0 }))).toEqual([['d2', ['d2']]]);
    const w = f({ kind: 'court', court: 'merchant' });
    expect(marks(w)).toEqual([['d2', ['d2']]]);
    expect([w.focusLabel, w.focusCount]).toEqual(['With merchant', 1]);
  });

  it('shows recently closed tickets whatever the Show menu says, and the oldest ticket on its own', () => {
    const c = f({ kind: 'closed' });
    expect(marks(c)).toEqual([['d1', ['p2']], ['c2', ['c2']]]);
    expect([c.focusLabel, c.focusCount]).toEqual(['Closed in the last 30 days', 2]);
    const o = f({ kind: 'ticket', id: 'd1' });
    expect(marks(o)).toEqual([['d1', ['d1']]]);
    expect(o.focusLabel).toBe('Oldest open · D1');
  });
});

describe('merchantView nudges', () => {
  const done = { open: false, st: 'completed' as const, closedD: 1 };
  const nudges = (...ts: MTicket[]) =>
    merchantView(model(...ts), withFlags(model(...ts)), 'acme', 'all').threads.map(t => [t.rootId, t.nudges.map(n => [n.kind, n.from.id, n.targets.map(x => x.id)])]);

  it('offers to close open sub-tickets under a done parent, from the highest done ticket', () => {
    expect(nudges(mk('a', { ...done, kids: ['b', 'x'] }), mk('b', { parent: 'a', root: 'a', kids: ['c'] }), mk('c', { parent: 'b', root: 'a' }), mk('x', { ...done, parent: 'a', root: 'a' }))).toEqual([
      ['a', [['closeKids', 'a', ['b', 'c']]]],
    ]);
    expect(nudges(mk('a', { ...done, kids: ['b'] }), mk('b', { ...done, parent: 'a', root: 'a', kids: ['c'] }), mk('c', { parent: 'b', root: 'a' }))).toEqual([
      ['a', [['closeKids', 'a', ['c']]]],
    ]);
  });

  it('offers to close a parent once every sub-ticket is finished and at least one completed', () => {
    const cancelled = { open: false, st: 'cancelled' as const, closedD: 1 };
    expect(nudges(mk('q', { kids: ['r1', 'r2'] }), mk('r1', { ...done, parent: 'q', root: 'q' }), mk('r2', { ...cancelled, parent: 'q', root: 'q' }))).toEqual([
      ['q', [['closeParent', 'q', ['q']]]],
    ]);
    // All cancelled, a sub-ticket still open, or one not linked yet: nothing to suggest.
    expect(nudges(mk('s', { kids: ['s1'] }), mk('s1', { ...cancelled, parent: 's', root: 's' }))).toEqual([['s', []]]);
    expect(nudges(mk('u', { kids: ['u1', 'u2'] }), mk('u1', { ...done, parent: 'u', root: 'u' }), mk('u2', { parent: 'u', root: 'u' }))).toEqual([['u', []]]);
    expect(nudges(mk('t', { kids: ['t1'], placeholders: [{ title: 'Later', d: 1 }] }), mk('t1', { ...done, parent: 't', root: 't' }))).toEqual([['t', []]]);
  });
});
