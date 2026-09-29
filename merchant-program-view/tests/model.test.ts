import { describe, expect, it } from 'vitest';
import { buildModel, courtOf } from '../lib/model';
import { emptyStore } from '../lib/load';
import { ticket } from './fixtures';

const DAY = 86_400_000;
const NOW = 100 * DAY;

function sampleStore() {
  const store = emptyStore();
  store.lookups.workspaceId = 'w1';
  store.lookups.deskChannels.set('c-desk', 'merchant-business-support');
  store.lookups.projects.set('p1', 'Euler');
  store.lookups.projects.set('p2', 'Payments');
  store.lookups.boards.set('b1', 'ISSUE');
  store.lookups.boards.set('b2', 'Core');
  store.lookups.users.set('u1', 'Vivek Nikam');
  store.lookups.users.set('u2', 'Lisa Roy');
  const add = (t: ReturnType<typeof ticket>, mids?: string[]) => {
    store.tickets.set(t.id, t);
    if (mids) store.mids.set(t.id, mids);
  };
  add(ticket('d1', { xyneId: 'MERCHANTS1-1', channelId: 'c-desk', merchantId: 'acme', stageName: 'OPEN', assignedTo: 'u1', createdBy: 'u1', createdAt: NOW - 12 * DAY, updatedAt: NOW - 2 * DAY }), ['acme']);
  add(ticket('e1', { xyneId: 'EULER-1', merchantId: 'acme', stageName: 'IN DEV', statusV2: 'STARTED', priority: 'HIGH', assignedTo: 'u2', createdAt: NOW - 11 * DAY, updatedAt: NOW - 9 * DAY, eta: NOW - 2 * DAY }), ['acme']);
  add(ticket('p1', { xyneId: 'PAY-1', projectId: 'p2', boardId: 'b2', stageName: 'TO BE PICKED', statusV2: 'TODO', priority: 'CRITICAL', assignedTo: null, createdAt: NOW - 10 * DAY, updatedAt: NOW - 10 * DAY }));
  add(ticket('x1', { xyneId: 'EULER-2', merchantId: 'beta', stageName: 'ON-HOLD EXTERNAL', statusV2: 'PAUSED', createdAt: NOW - 5 * DAY, updatedAt: NOW - 1 * DAY }), ['beta', 'gamma']);
  add(ticket('c1', { xyneId: 'EULER-3', merchantId: 'acme', stageName: 'DONE', statusV2: 'CANCELLED', statusUpdatedAt: NOW - 4 * DAY, closedAt: null, createdAt: NOW - 30 * DAY, updatedAt: NOW - 4 * DAY }), ['acme']);
  store.links.push(
    { parentId: 'd1', subTicketId: 's1', childId: 'e1', subTitle: 'Escalate' },
    { parentId: 'e1', subTicketId: 's2', childId: 'p1', subTitle: 'Payments fix' },
    { parentId: 'e1', subTicketId: 's3', childId: null, subTitle: 'Risk review', subCreatedAt: NOW - 5 * DAY },
  );
  return store;
}

describe('courtOf', () => {
  it('maps stages to who the ball is with', () => {
    expect(courtOf('WAITING ON MERCHANT')).toBe('merchant');
    expect(courtOf('Awaiting merchant')).toBe('merchant');
    expect(courtOf('ON-HOLD EXTERNAL')).toBe('external');
    expect(courtOf('On hold external')).toBe('external');
    expect(courtOf('ON HOLD INTERNAL')).toBe('us');
    expect(courtOf('IN DEV')).toBe('us');
  });
});

describe('buildModel', () => {
  const m = buildModel(sampleStore(), NOW);
  const t = (id: string) => m.tickets.get(id)!;

  it('classifies Desk, board-with-MID and product sub-tickets', () => {
    expect(t('d1').kind).toBe('desk');
    expect(t('e1').kind).toBe('crm');
    expect(t('p1').kind).toBe('product');
  });

  it('inherits merchants down a chain and keeps several MIDs', () => {
    expect(t('p1').mids).toEqual([]);
    expect(t('p1').midR).toEqual(['acme']);
    expect(t('x1').midR).toEqual(['beta', 'gamma']);
    expect(m.byMid.get('gamma')!.map(x => x.id)).toEqual(['x1']);
    expect(m.byMid.get('acme')!.map(x => x.id).sort()).toEqual(['c1', 'd1', 'e1', 'p1']);
  });

  it('dates a reopened-then-closed ticket by its latest close, and knows when the reporter is unknown', () => {
    const store = sampleStore();
    store.tickets.set('r1', ticket('r1', { merchantId: 'acme', statusV2: 'COMPLETED', closedAt: NOW - 65 * DAY, statusUpdatedAt: NOW - 4 * DAY, createdBy: 'ghost', createdAt: NOW - 90 * DAY }));
    store.mids.set('r1', ['acme']);
    const r = buildModel(store, NOW).tickets.get('r1')!;
    expect(r.closedD).toBe(4);
    expect(r.reporter).toBeNull();
  });

  it('drops placeholder MIDs saved by older loads', () => {
    const store = sampleStore();
    store.mids.set('x1', ['Any', 'beta']);
    expect(buildModel(store, NOW).tickets.get('x1')!.mids).toEqual(['beta']);
    store.mids.set('d1', ['Any', 'acme']);
    store.mids.set('e1', ['for all merchants']);
    const m2 = buildModel(store, NOW);
    expect(m2.tickets.get('p1')!.midR).toEqual(['acme']);
    expect([...m2.byMid.keys()].sort()).toEqual(['acme', 'beta']);
  });

  it('marks tickets that only borrow merchant IDs from their sub-tickets', () => {
    const store = sampleStore();
    store.tickets.set('g1', ticket('g1', { xyneId: 'CORE-1', projectId: 'p2', boardId: 'b2', merchantId: null }));
    store.tickets.set('k1', ticket('k1', { xyneId: 'EULER-7', merchantId: 'm1' }));
    store.tickets.set('k2', ticket('k2', { xyneId: 'EULER-8', merchantId: 'm2' }));
    store.mids.set('k1', ['m1']);
    store.mids.set('k2', ['m2']);
    store.links.push({ parentId: 'g1', subTicketId: 's7', childId: 'k1', subTitle: 'm1' }, { parentId: 'g1', subTicketId: 's8', childId: 'k2', subTitle: 'm2' });
    const mm = buildModel(store, NOW);
    expect(mm.tickets.get('g1')!.midR).toEqual(['m1', 'm2']);
    expect(mm.tickets.get('g1')!.borrowed).toBe(true);
    expect(mm.tickets.get('k1')!.borrowed).toBe(false);
    // A sub-ticket without an ID under a merchant ticket belongs to that merchant.
    expect(t('p1').borrowed).toBe(false);
  });

  it('links parents, children, roots and unlinked sub-tickets', () => {
    expect(t('e1').parent).toBe('d1');
    expect(t('e1').kids).toEqual(['p1']);
    expect(t('p1').root).toBe('d1');
    expect(t('e1').placeholders).toEqual([{ title: 'Risk review', d: 5 }]);
  });

  it('computes timing, status, priority, court, names and sources', () => {
    expect(t('e1')).toMatchObject({ d: 11, u: 9, eta: -2, st: 'started', pri: 'high', court: 'us', open: true, who: 'Lisa Roy', src: 'Euler / ISSUE' });
    expect(t('p1')).toMatchObject({ pri: 'critical', who: null, src: 'Payments / Core', st: 'todo' });
    expect(t('d1')).toMatchObject({ src: 'Desk · merchant-business-support', reporter: 'Vivek Nikam', eta: null });
    expect(t('x1')).toMatchObject({ court: 'external', st: 'paused' });
    expect(t('c1')).toMatchObject({ open: false, closedD: 4, st: 'cancelled' });
    expect(t('e1').url).toBe('https://spaces.xyne.juspay.net/w1/projects/p1/b1/e1');
  });
});
