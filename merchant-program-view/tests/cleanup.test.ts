import { describe, expect, it } from 'vitest';
import { CLEANUP, isAbandoned } from '../lib/cleanup';
import type { FTicket } from '../lib/portfolio';

const t = (id: string, over: Partial<FTicket> = {}): FTicket =>
  ({ id, key: id.toUpperCase(), open: true, st: 'todo', d: 200, u: 60, eta: null, kids: [], flags: [], sev: 'ok', ...over }) as FTicket;
const map = (...ts: FTicket[]) => new Map(ts.map(x => [x.id, x]));

describe('isAbandoned', () => {
  it('is an open ticket older than 90 days with no update in 30 days', () => {
    expect(CLEANUP).toEqual({ age: 90, idle: 30 });
    const a = t('a');
    expect(isAbandoned(a, map(a))).toBe(true);
    expect(isAbandoned(t('b', { d: 90 }), map())).toBe(false);
    expect(isAbandoned(t('c', { u: 30 }), map())).toBe(false);
    expect(isAbandoned(t('d', { open: false, st: 'completed' }), map())).toBe(false);
  });

  it('leaves out tickets with a future ETA or an open ticket anywhere below them', () => {
    expect(isAbandoned(t('e', { eta: 5 }), map())).toBe(false);
    expect(isAbandoned(t('f', { eta: -40 }), map())).toBe(true);
    const kid = t('k2'), mid = t('k1', { open: false, st: 'completed', kids: ['k2'] }), top = t('p', { kids: ['k1'] });
    expect(isAbandoned(top, map(top, mid, kid))).toBe(false);
    const doneKid = t('k3', { open: false, st: 'cancelled' }), top2 = t('q', { kids: ['k3'] });
    expect(isAbandoned(top2, map(top2, doneKid))).toBe(true);
  });
});
