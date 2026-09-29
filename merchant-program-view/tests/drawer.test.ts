import { describe, expect, it } from 'vitest';
import { drawer, type ActivityRow } from '../lib/drawer';
import { withFlags } from '../lib/portfolio';
import type { MTicket, Model } from '../lib/model';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const base: MTicket = {
  id: 't', key: 'T-1', title: 'Ticket', kind: 'crm', src: 'Euler / ISSUE', stage: 'IN DEV', st: 'started', open: true, pri: 'high',
  court: 'us', who: 'Lisa Roy', reporter: 'Vivek Nikam', mids: ['acme'], midR: ['acme'], d: 11, u: 9, eta: -2, stageOverdue: true,
  createdAt: NOW - 11 * DAY, updatedAt: NOW - 9 * DAY, closedD: null, parent: null, kids: [], placeholders: [], root: 't', url: 'u',
};
const mk = (id: string, over: Partial<MTicket>): MTicket => ({ ...base, id, key: id.toUpperCase(), title: `Title ${id}`, root: id, ...over });
const m: Model = (() => {
  const ts = [
    mk('d1', { kind: 'desk', src: 'Desk · support', kids: ['e1'], eta: null, stageOverdue: false, stage: 'OPEN', st: 'todo', d: 12 }),
    mk('e1', { parent: 'd1', root: 'd1', kids: ['p1'] }),
    mk('p1', { kind: 'product', mids: [], midR: ['acme'], parent: 'e1', root: 'd1', stage: 'TO BE PICKED', st: 'todo', who: null, eta: null, stageOverdue: false, d: 10 }),
  ];
  return { tickets: new Map(ts.map(t => [t.id, t])), byMid: new Map([['acme', ts]]), now: NOW };
})();
const byId = withFlags(m);
let seq = 0;
const a = (daysAgo: number, activityType: string, value: unknown): ActivityRow => ({ id: `a${++seq}`, ticketId: 'e1', activityType, value, timestamp: NOW - daysAgo * DAY });
const acts: ActivityRow[] = [
  a(0.5, 'METADATA', { field: 'customField' }),
  a(4, 'STATUS', { field: 'stageName', oldValue: 'TO BE PICKED', newValue: 'IN DEV' }),
  a(6, 'ASSIGNED_TO', { oldValue: null, newValue: 'u2' }),
  a(8, 'SUBTICKET_CREATED', { subTicketXyneId: 'P1' }),
  a(11, 'TICKET_CREATED', { field: 'ticketCreated', stageName: 'TO BE PICKED' }),
];

describe('drawer', () => {
  const users = new Map([['u2', 'Lisa Roy']]);

  it('shows header, flags and timing', () => {
    const d = drawer(m, byId, 'e1', acts, users, NOW);
    expect(d).toMatchObject({ kind: 'Board', key: 'E1', status: 'In progress', stage: 'IN DEV', priLabel: 'High', who: 'Lisa Roy' });
    expect(d.flags.map(f => f.type)).toEqual(['eta', 'stageEta', 'stale']);
    expect(d.timing).toEqual([
      { k: 'Age', v: '11d', sub: 'since created', tone: 'age' },
      { k: 'In current stage', v: '4d', sub: 'past its stage ETA', tone: 'red' },
      { k: 'Ticket ETA', v: '2d over', sub: 'breached', tone: 'red' },
      { k: 'Last update', v: '9d ago', sub: 'waiting on us', tone: 'amber' },
    ]);
  });

  it('builds stage history, details and linked tickets', () => {
    const d = drawer(m, byId, 'e1', acts, users, NOW);
    expect(d.history).toEqual([
      { name: 'TO BE PICKED', days: '7d', current: false },
      { name: 'IN DEV', days: '4d · now', current: true },
    ]);
    expect(d.fields).toContainEqual({ k: 'Merchant ID', v: 'acme' });
    expect(d.fields).toContainEqual({ k: 'Reporter', v: 'Vivek Nikam' });
    expect(d.links.map(l => [l.id, l.rel])).toEqual([['d1', 'parent'], ['p1', 'sub-ticket']]);
    expect(drawer(m, byId, 'p1', null, users, NOW).fields).toContainEqual({ k: 'Merchant ID', v: 'no MID · inherits acme' });
  });

  it('turns activity into readable lines, newest first, skipping noise', () => {
    const d = drawer(m, byId, 'e1', acts, users, NOW);
    expect(d.activity.map(x => x.text)).toEqual(['Moved to IN DEV', 'Assigned to Lisa Roy', 'Sub-ticket P1 created', 'Created in TO BE PICKED']);
    expect(d.activity[0].when).toBe('4d ago');
  });

  it('keeps long histories to the latest stages', () => {
    // 100 newest activities: the ticket's creation and earliest moves are cut off.
    const flips = Array.from({ length: 10 }, (_, i) =>
      a(10 - i, 'STATUS', { field: 'stageName', oldValue: i % 2 ? 'Closed' : 'In Progress', newValue: i % 2 ? 'In Progress' : 'Closed' }),
    );
    const d = drawer(m, byId, 'e1', flips, users, NOW);
    expect(d.history).toHaveLength(7);
    expect(d.history[0]).toEqual({ name: 'Earlier stages', days: '', current: false, earlier: true });
    expect(d.history[6]).toMatchObject({ name: 'In Progress', current: true });
  });

  it('leaves out an unknown reporter', () => {
    const t2 = { ...byId.get('e1')!, reporter: null };
    const d = drawer(m, new Map([...byId, ['e1', t2]]), 'e1', acts, users, NOW);
    expect(d.fields.map(f => f.k)).not.toContain('Reporter');
  });

  it('falls back while activity is loading', () => {
    const d = drawer(m, byId, 'e1', null, users, NOW);
    expect(d.timing[1]).toMatchObject({ k: 'In current stage', v: '…' });
    expect(d.history).toEqual([{ name: 'IN DEV', days: 'now', current: true }]);
    expect(d.activity).toEqual([]);
  });

  it('says the time in stage is unknown when activity failed to load', () => {
    const d = drawer(m, byId, 'e1', 'failed', users, NOW);
    expect(d.timing[1]).toMatchObject({ k: 'In current stage', v: '—' });
    expect(d.history).toEqual([{ name: 'IN DEV', days: 'now', current: true }]);
  });

  it('gives a lower bound when the fetched activity has no stage change or creation', () => {
    const cut = [a(0.5, 'METADATA', { field: 'customField' }), a(3, 'EMAIL_SENT', {})];
    const d = drawer(m, byId, 'e1', cut, users, NOW);
    expect(d.timing[1]).toMatchObject({ k: 'In current stage', v: 'over 3d' });
    expect(d.history).toEqual([
      { name: 'Earlier stages', days: '', current: false, earlier: true },
      { name: 'IN DEV', days: 'over 3d · now', current: true },
    ]);
  });
});
