import { describe, expect, it } from 'vitest';
import { flagsFor, fmtDays, sevOf } from '../lib/flags';
import type { MTicket, Model } from '../lib/model';

const base: MTicket = {
  id: 't', key: 'T-1', title: 'Ticket', kind: 'crm', src: 'Euler / ISSUE', stage: 'IN DEV', st: 'started', open: true, pri: 'medium',
  court: 'us', who: 'Lisa Roy', reporter: 'Vivek', mids: ['acme'], midR: ['acme'], d: 2, u: 1, eta: null, stageOverdue: false,
  createdAt: 0, updatedAt: 0, closedD: null, parent: null, kids: [], placeholders: [], root: 't', url: '',
};
const mk = (over: Partial<MTicket>): MTicket => ({ ...base, ...over });
const model = (...ts: MTicket[]): Model => ({ tickets: new Map(ts.map(t => [t.id, t])), byMid: new Map(), now: 0 });
const types = (t: MTicket, m: Model = model(t)) => flagsFor(t, m).map(f => `${f.type}:${f.sev}`);

describe('flagsFor', () => {
  it('ticket ETA passed and stage ETA passed are red', () => {
    expect(types(mk({ eta: -2 }))).toEqual(['eta:red']);
    expect(types(mk({ eta: 3 }))).toEqual([]);
    expect(types(mk({ stageOverdue: true }))).toEqual(['stageEta:red']);
    expect(types(mk({ eta: -2, open: false, st: 'completed', closedD: 1 }))).toEqual([]);
  });

  it('Desk closed while its board ticket is open is red', () => {
    const board = mk({ id: 'b', kind: 'crm', parent: 'd' });
    const desk = mk({ id: 'd', kind: 'desk', open: false, st: 'completed', closedD: 2, kids: ['b'] });
    expect(types(desk, model(desk, board))).toEqual(['deskEarly:red']);
  });

  it('board closed while a sub-ticket is open is red', () => {
    const product = mk({ id: 'p', kind: 'product', mids: [], parent: 'c', u: 1 });
    const crm = mk({ id: 'c', open: false, st: 'completed', closedD: 3, kids: ['p'] });
    expect(types(crm, model(crm, product))).toEqual(['crmEarly:red']);
  });

  it('a product sub-ticket is stuck when unassigned or not updated for 7d', () => {
    expect(types(mk({ kind: 'product', mids: [], who: null }))).toEqual(['productStuck:red']);
    expect(types(mk({ kind: 'product', mids: [], u: 8 }))).toEqual(['productStuck:red']);
    expect(types(mk({ kind: 'product', mids: [], u: 6 }))).toEqual([]);
  });

  it('board tickets open over 14d are ageing; Desk tickets are not', () => {
    expect(types(mk({ d: 15 }))).toEqual(['ageing:amber']);
    expect(types(mk({ d: 14 }))).toEqual([]);
    // Ages are whole days: 14.5d reads "14d", so it is not over a 14d limit.
    expect(types(mk({ d: 14.5 }))).toEqual([]);
    expect(types(mk({ kind: 'desk', d: 15, kids: ['x'] }), model(mk({ kind: 'desk', d: 15, kids: ['x'] }), mk({ id: 'x' })))).toEqual([]);
  });

  it('a board ticket with us and not updated for 7d is stale', () => {
    expect(types(mk({ u: 8 }))).toEqual(['stale:amber']);
    expect(types(mk({ u: 8, court: 'merchant' }))).toEqual([]);
  });

  it('long hold with merchant or external after 10d', () => {
    expect(types(mk({ court: 'external', u: 11 }))).toEqual(['longHold:amber']);
    expect(types(mk({ court: 'merchant', u: 9 }))).toEqual([]);
  });

  it('does not flag a ticket just because all its sub-tickets closed', () => {
    const product = mk({ id: 'p', kind: 'product', mids: [], open: false, st: 'completed', closedD: 5, parent: 'c' });
    const crm = mk({ id: 'c', kids: ['p'] });
    expect(types(crm, model(crm, product))).toEqual([]);
    const board = mk({ id: 'b', open: false, st: 'completed', closedD: 1, parent: 'd' });
    const desk = mk({ id: 'd', kind: 'desk', kids: ['b'] });
    expect(types(desk, model(desk, board))).toEqual([]);
  });

  it('unlinked sub-tickets older than 2d are amber', () => {
    expect(types(mk({ placeholders: [{ title: 'Risk review', d: 3 }, { title: 'New', d: 1 }] }))).toEqual(['placeholder:amber']);
  });

  it('a Desk ticket open over 3d with no board ticket is on watch', () => {
    expect(types(mk({ kind: 'desk', d: 4 }))).toEqual(['notEscalated:watch']);
    expect(types(mk({ kind: 'desk', d: 4, court: 'merchant' }))).toEqual([]);
    expect(types(mk({ kind: 'desk', d: 2 }))).toEqual([]);
  });

  it('explains each flag', () => {
    const [f] = flagsFor(mk({ eta: -2.4, stage: 'IN DEV' }), model());
    expect(f.label).toBe('Ticket ETA breached');
    expect(f.reason).toBe('ETA passed 2d ago, still in dev');
  });
});

describe('sevOf', () => {
  it('returns the worst severity', () => {
    expect(sevOf([])).toBe('ok');
    expect(sevOf([{ sev: 'watch' }, { sev: 'amber' }] as never)).toBe('amber');
    expect(sevOf([{ sev: 'amber' }, { sev: 'red' }] as never)).toBe('red');
  });
});

describe('fmtDays', () => {
  it('shows hours under a day without ever reading 24h', () => {
    expect([0.01, 0.5, 0.99, 1, 1.9].map(fmtDays)).toEqual(['just now', '12h', '23h', '1d', '1d']);
  });
});
