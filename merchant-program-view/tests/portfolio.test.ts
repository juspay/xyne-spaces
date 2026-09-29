import { describe, expect, it } from 'vitest';
import { bucketOf, DEFAULT_PSTATE, defaultMidSuggestions, midSuggestions, paginate, portfolio } from '../lib/portfolio';
import type { MTicket, Model } from '../lib/model';

const base: MTicket = {
  id: 't', key: 'T-1', title: 'Ticket', kind: 'crm', src: 'Euler / ISSUE', stage: 'IN DEV', st: 'started', open: true, pri: 'medium',
  court: 'us', who: 'Lisa Roy', reporter: 'Vivek', mids: ['acme'], midR: ['acme'], d: 2, u: 1, eta: null, stageOverdue: false,
  createdAt: 0, updatedAt: 0, closedD: null, parent: null, kids: [], placeholders: [], root: 't', url: '',
};
const mk = (id: string, over: Partial<MTicket>): MTicket => ({ ...base, id, key: id.toUpperCase(), root: id, ...over });
function model(...ts: MTicket[]): Model {
  const byMid = new Map<string, MTicket[]>();
  for (const t of ts) for (const mid of t.midR) byMid.set(mid, [...(byMid.get(mid) ?? []), t]);
  return { tickets: new Map(ts.map(t => [t.id, t])), byMid, now: 0 };
}

// acme: one ETA-breached crm (red), one Desk ticket open 20d with a board child (desk, no flag), one closed.
// beta: one stale crm (amber) with the merchant court. gamma: healthy, one fresh ticket.
const M = model(
  mk('a1', { eta: -1, d: 5, u: 0.5, who: 'Lisa Roy', title: 'Refund webhook' }),
  mk('a2', { kind: 'desk', src: 'Desk · support', d: 20, u: 2, who: 'Vivek Nikam', kids: ['a3'] }),
  mk('a3', { kind: 'product', mids: [], d: 9, u: 1, parent: 'a2', root: 'a2' }),
  mk('a4', { open: false, st: 'completed', closedD: 3, d: 40 }),
  mk('b1', { midR: ['beta'], mids: ['beta'], u: 9, d: 16, court: 'us', who: 'Anita Desai' }),
  mk('b2', { midR: ['beta'], mids: ['beta'], kind: 'desk', src: 'Desk · support', d: 1, court: 'merchant', kids: ['x'] }),
  mk('g1', { midR: ['gamma'], mids: ['gamma'], d: 0.5, u: 0.1 }),
);

describe('bucketOf', () => {
  it('buckets ages 0–3, 4–7, 8–14, 15–30, 30+', () => {
    expect([0, 3, 3.5, 7, 7.9, 8, 14, 14.5, 15, 30, 31].map(bucketOf)).toEqual([0, 0, 0, 1, 1, 2, 2, 2, 3, 3, 4]);
  });
});

describe('portfolio', () => {
  const p = portfolio(M, DEFAULT_PSTATE);

  it('builds merchant rows sorted by health', () => {
    expect(p.merchantRows.map(r => [r.mid, r.sev])).toEqual([['acme', 'red'], ['beta', 'amber'], ['gamma', 'ok']]);
    const acme = p.merchantRows[0];
    expect(acme.openCount).toBe(3);
    expect(acme.counts).toEqual([0, 1, 1, 1, 0]);
    expect(acme.oldest?.id).toBe('a2');
    expect(acme.median).toBe(9);
    expect(acme.chips[0]).toMatchObject({ label: 'Ticket ETA breached', sev: 'red' });
    expect(acme.court).toEqual({ us: 3, merchant: 0, external: 0 });
    expect(p.merchantRows[1].court).toEqual({ us: 1, merchant: 1, external: 0 });
  });

  it('computes the six KPIs', () => {
    const k = Object.fromEntries(p.kpis.map(x => [x.id, x]));
    expect(k.attention).toMatchObject({ value: '2', sub: '1 critical · 1 at risk · of 3' });
    expect(k.open).toMatchObject({ value: '6', sub: '2 Desk · 4 board' });
    expect(k.median).toMatchObject({ value: '5d', sub: '1 open longer than 14d' });
    expect(k.oldest).toMatchObject({ value: '20d', sub: 'A2 · acme', target: { drawer: 'a2' } });
    expect(k.eta).toMatchObject({ value: '1', sub: '1 ticket ETA · 0 stage ETA' });
    expect(k.stale).toMatchObject({ value: '1', label: 'No update in 7d+' });
  });

  it('counts open tickets per age bucket', () => {
    expect(p.buckets).toEqual([2, 1, 1, 2, 0]);
  });

  it('filters merchants by health, assignee, desk and board', () => {
    const mids = (over: object) => portfolio(M, { ...DEFAULT_PSTATE, ...over }).merchantRows.map(r => r.mid);
    expect(mids({ health: ['red', 'amber'] })).toEqual(['acme', 'beta']);
    expect(mids({ health: ['ok'] })).toEqual(['gamma']);
    expect(mids({ owners: ['Anita Desai'] })).toEqual(['beta']);
    expect(mids({ desks: ['Desk · support'] })).toEqual(['acme', 'beta']);
    expect(mids({ boards: ['Euler / ISSUE'] })).toEqual(['acme', 'beta', 'gamma']);
  });

  it('lists every open or flagged ticket, narrowed by health, type, bucket, desk and board', () => {
    const t = (over: object) => portfolio(M, { ...DEFAULT_PSTATE, tab: 'tickets', ...over }).ticketRows.map(r => r.id);
    expect(t({})).toEqual(['a1', 'b1', 'a2', 'a3', 'b2', 'g1']);
    expect(t({ health: ['red'] })).toEqual(['a1']);
    expect(t({ health: ['ok'] })).toEqual(['a2', 'a3', 'b2', 'g1']);
    expect(t({ typeFilter: 'anyEta' })).toEqual(['a1']);
    expect(t({ bucket: 3 })).toEqual(['b1', 'a2']);
    expect(t({ desks: ['Desk · support'] })).toEqual(['a2', 'b2']);
    expect(t({ desks: ['Desk · support'], boards: ['Euler / ISSUE'] })).toHaveLength(6);
  });

  it('offers the desks and boards that have tickets', () => {
    expect(p.deskOptions).toEqual(['Desk · support']);
    expect(p.boardOptions).toEqual(['Euler / ISSUE']);
  });

  it('scopes the whole page to picked or searched merchant IDs', () => {
    const r = portfolio(M, { ...DEFAULT_PSTATE, mids: ['beta'] });
    expect(r.merchantRows.map(x => x.mid)).toEqual(['beta']);
    const k = Object.fromEntries(r.kpis.map(x => [x.id, x.value]));
    expect(k).toMatchObject({ attention: '1', open: '2' });
    const t = portfolio(M, { ...DEFAULT_PSTATE, tab: 'tickets', mids: ['beta', 'gamma'] });
    expect(t.ticketRows.map(x => x.id)).toEqual(['b1', 'b2', 'g1']);
    // Typed text matches merchant IDs only, not ticket text.
    expect(portfolio(M, { ...DEFAULT_PSTATE, search: 'bet' }).merchantRows.map(x => x.mid)).toEqual(['beta']);
    expect(portfolio(M, { ...DEFAULT_PSTATE, search: 'webhook' }).merchantRows).toEqual([]);
    expect(portfolio(M, { ...DEFAULT_PSTATE, search: 'GAM' }).kpis.find(x => x.id === 'open')!.value).toBe('1');
  });

  it('counts KPIs the same way as the lists they open', () => {
    const X = model(
      mk('s1', { kind: 'desk', d: 20, u: 9, court: 'us' }),
      mk('s2', { d: 20, u: 9, court: 'us' }),
    );
    const k = Object.fromEntries(portfolio(X, DEFAULT_PSTATE).kpis.map(x => [x.id, x]));
    const list = (typeFilter: string) => portfolio(X, { ...DEFAULT_PSTATE, tab: 'tickets', typeFilter: typeFilter as never }).ticketRows.length;
    expect(k.stale.value).toBe(String(list('stale')));
    expect(k.stale.value).toBe('1');
    expect(k.median.sub).toBe(`${list('ageing')} open longer than 14d`);
  });

  it('a ticket that only borrows merchant IDs from its sub-tickets does not set their severity', () => {
    const X = model(
      mk('g', { kind: 'product', mids: [], midR: ['m1', 'm2'], who: null, borrowed: true, kids: ['k1', 'k2'] }),
      mk('k1', { mids: ['m1'], midR: ['m1'], parent: 'g', root: 'g' }),
      mk('k2', { mids: ['m2'], midR: ['m2'], parent: 'g', root: 'g' }),
    );
    const r = portfolio(X, DEFAULT_PSTATE);
    expect(r.merchantRows.map(x => [x.mid, x.sev])).toEqual([['m1', 'ok'], ['m2', 'ok']]);
    expect(r.merchantRows[0].chips).toEqual([]);
    // It still shows up as a ticket that needs attention.
    expect(portfolio(X, { ...DEFAULT_PSTATE, tab: 'tickets', health: ['red'] }).ticketRows.map(x => x.id)).toEqual(['g']);
  });

  it('reuses flags and merchant rows across filter changes on the same model', () => {
    const a = portfolio(M, DEFAULT_PSTATE);
    const b = portfolio(M, { ...DEFAULT_PSTATE, owners: ['Lisa Roy'], tab: 'tickets', health: ['red'] });
    expect(b.byId).toBe(a.byId);
    expect(b.merchants).toBe(a.merchants);
    expect(portfolio(M, { ...DEFAULT_PSTATE, range: 7 }).merchants).not.toBe(a.merchants);
  });

  it('applies the created range to everything', () => {
    const r = portfolio(M, { ...DEFAULT_PSTATE, range: 7 });
    expect(r.merchantRows.map(x => x.mid)).toEqual(['acme', 'beta', 'gamma']);
    expect(r.kpis.find(k => k.id === 'open')!.value).toBe('3');
  });

  it('lists assignees for the filter', () => {
    expect(p.people).toEqual(['Anita Desai', 'Lisa Roy', 'Vivek Nikam']);
  });
});

describe('midSuggestions', () => {
  const X = model(
    mk('x1', { midR: ['smallcase'], mids: ['smallcase'] }),
    mk('x2', { midR: ['smallcase'], mids: ['smallcase'], open: false }),
    mk('x3', { midR: ['bigsmall'], mids: ['bigsmall'] }),
    mk('x4', { midR: ['railyatri'], mids: ['railyatri'] }),
  );

  it('suggests matching MIDs, prefix matches first, with open and total counts', () => {
    expect(midSuggestions(X, 'small', [])).toEqual([
      { mid: 'smallcase', open: 1, total: 2 },
      { mid: 'bigsmall', open: 1, total: 1 },
    ]);
  });

  it('is case-insensitive, skips selected MIDs and caps the list', () => {
    expect(midSuggestions(X, 'SMALL', ['smallcase']).map(s => s.mid)).toEqual(['bigsmall']);
    expect(midSuggestions(X, 'a', [], 2)).toHaveLength(2);
  });

  it('ranks busier merchants first among equally good matches', () => {
    const Y = model(
      mk('y1', { midR: ['railbus'], mids: ['railbus'] }),
      mk('y2', { midR: ['railyatri'], mids: ['railyatri'] }),
      mk('y3', { midR: ['railyatri'], mids: ['railyatri'] }),
    );
    expect(midSuggestions(Y, 'rail', []).map(s => s.mid)).toEqual(['railyatri', 'railbus']);
  });

  it('suggests nothing for an empty query', () => {
    expect(midSuggestions(X, '  ', [])).toEqual([]);
  });
});

describe('defaultMidSuggestions', () => {
  const X = model(
    mk('x1', { midR: ['small'], mids: ['small'] }),
    mk('x2', { midR: ['big'], mids: ['big'] }),
    mk('x3', { midR: ['big'], mids: ['big'] }),
    mk('x4', { midR: ['mid'], mids: ['mid'] }),
  );

  it('shows most-searched merchants first, skipping ones that no longer have tickets or are picked', () => {
    expect(defaultMidSuggestions(X, ['gone', 'small', 'mid'], ['mid'])).toEqual({ title: 'Frequently searched', items: [{ mid: 'small', open: 1, total: 1 }] });
  });

  it('falls back to the busiest merchants when there is no history', () => {
    expect(defaultMidSuggestions(X, [], [], 2)).toEqual({ title: 'Busiest merchants', items: [{ mid: 'big', open: 2, total: 2 }, { mid: 'mid', open: 1, total: 1 }] });
  });
});

describe('paginate', () => {
  it('slices 10 per page and clamps the page', () => {
    const list = Array.from({ length: 23 }, (_, i) => i);
    expect(paginate(list, 1)).toMatchObject({ rows: list.slice(0, 10), page: 1, pages: 3, text: '1–10 of 23' });
    expect(paginate(list, 9)).toMatchObject({ page: 3, rows: [20, 21, 22], text: '21–23 of 23' });
    expect(paginate([], 1)).toMatchObject({ rows: [], pages: 1, text: '0–0 of 0' });
  });
});
