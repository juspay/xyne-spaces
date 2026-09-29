import { describe, expect, it } from 'vitest';
import { nextSort, sortMerchantRows, sortTicketRows, M_FIRST, T_FIRST } from '../lib/sort';
import type { FTicket, MerchantRow } from '../lib/portfolio';

const mr = (mid: string, over: Partial<MerchantRow>): MerchantRow =>
  ({ mid, sev: 'ok', tickets: [], open: [], openCount: 0, desk: 0, board: 0, counts: [], median: null, oldest: null, chips: [], court: { us: 0, merchant: 0, external: 0 }, lastU: 0, red: 0, amber: 0, ...over }) as MerchantRow;
const ft = (id: string, over: Partial<FTicket>): FTicket => ({ id, key: id, title: id, midR: [], who: null, st: 'started', open: true, d: 0, u: 0, flags: [], sev: 'ok', ...over }) as FTicket;

describe('nextSort', () => {
  it('starts a new column in its natural direction and flips on the next click', () => {
    const a = nextSort(null, 'open', M_FIRST);
    expect(a).toEqual({ key: 'open', dir: 'desc' });
    expect(nextSort(a, 'open', M_FIRST)).toEqual({ key: 'open', dir: 'asc' });
    expect(nextSort(a, 'mid', M_FIRST)).toEqual({ key: 'mid', dir: 'asc' });
  });
});

describe('sortMerchantRows', () => {
  const rows = [
    mr('beta', { openCount: 2, sev: 'amber', median: 4, lastU: 3, court: { us: 1, merchant: 0, external: 0 } }),
    mr('Acme', { openCount: 5, sev: 'red', median: null, lastU: 1, court: { us: 3, merchant: 0, external: 0 } }),
    mr('gamma', { openCount: 2, sev: 'ok', median: 9, lastU: 10, court: { us: 0, merchant: 0, external: 0 } }),
  ];
  const ids = (key: Parameters<typeof sortMerchantRows>[1] extends infer S ? S : never) => sortMerchantRows(rows, key).map(r => r.mid);

  it('keeps the given order when unsorted', () => {
    expect(ids(null)).toEqual(['beta', 'Acme', 'gamma']);
  });

  it('sorts by each column both ways, ties keeping the given order', () => {
    expect(ids({ key: 'open', dir: 'desc' })).toEqual(['Acme', 'beta', 'gamma']);
    expect(ids({ key: 'open', dir: 'asc' })).toEqual(['beta', 'gamma', 'Acme']);
    expect(ids({ key: 'mid', dir: 'asc' })).toEqual(['Acme', 'beta', 'gamma']);
    expect(ids({ key: 'sev', dir: 'asc' })).toEqual(['gamma', 'beta', 'Acme']);
    expect(ids({ key: 'age', dir: 'desc' })).toEqual(['gamma', 'beta', 'Acme']);
    expect(ids({ key: 'court', dir: 'desc' })).toEqual(['Acme', 'beta', 'gamma']);
    expect(ids({ key: 'activity', dir: 'desc' })).toEqual(['gamma', 'beta', 'Acme']);
  });

  it('does not mutate the input', () => {
    sortMerchantRows(rows, { key: 'mid', dir: 'desc' });
    expect(rows.map(r => r.mid)).toEqual(['beta', 'Acme', 'gamma']);
  });
});

describe('sortTicketRows', () => {
  const rows = [
    ft('T-10', { title: 'b', d: 3, u: 1, who: 'Zed', sev: 'amber' }),
    ft('T-9', { title: 'a', d: 8, u: 5, who: null, sev: 'red' }),
    ft('T-11', { title: 'c', d: 1, u: 2, who: 'Ann', open: false, st: 'completed' }),
  ];
  const ids = (s: Parameters<typeof sortTicketRows>[1]) => sortTicketRows(rows, s).map(r => r.id);

  it('sorts keys numerically and people with unassigned last', () => {
    expect(ids({ key: 'key', dir: 'asc' })).toEqual(['T-9', 'T-10', 'T-11']);
    expect(ids({ key: 'who', dir: 'asc' })).toEqual(['T-11', 'T-10', 'T-9']);
  });

  it('sorts age with closed tickets last either way, and issue by severity', () => {
    expect(ids({ key: 'age', dir: 'desc' })).toEqual(['T-9', 'T-10', 'T-11']);
    expect(ids({ key: 'age', dir: 'asc' })).toEqual(['T-10', 'T-9', 'T-11']);
    expect(ids({ key: 'issue', dir: 'desc' })).toEqual(['T-9', 'T-10', 'T-11']);
    expect(ids({ key: 'updated', dir: 'asc' })).toEqual(['T-10', 'T-11', 'T-9']);
  });

  it('text columns start ascending, numbers descending', () => {
    expect(T_FIRST.title).toBe('asc');
    expect(T_FIRST.age).toBe('desc');
  });
});
