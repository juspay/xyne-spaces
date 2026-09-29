import { describe, expect, it } from 'vitest';
import { buildChains, normalizeMid } from '../lib/graph';
import type { ChainNode, Link } from '../lib/types';
import { LOOKUPS, ticket, ticketMap } from './fixtures';

const desk = ticket('d1', { channelId: 'c-desk', merchantId: 'ACME', createdAt: 10, updatedAt: 10 });
const crm = ticket('e1', { merchantId: 'ACME', assignedTo: 'u9', createdAt: 20, updatedAt: 50 });
const product = ticket('px', { projectId: 'p2', boardId: 'b2', createdAt: 30, updatedAt: 30 });
const link = (parentId: string, subTicketId: string, childId: string | null, subTitle = ''): Link => ({
  parentId,
  subTicketId,
  childId,
  subTitle,
});
const kids = (n: ChainNode): ChainNode[] => (n.type === 'ticket' ? n.children : []);

describe('normalizeMid', () => {
  it('normalises MIDs: trims, keeps case, blank is null', () => {
    expect(normalizeMid('  ACME ')).toBe('ACME');
    expect(normalizeMid('acme')).toBe('acme');
    expect(normalizeMid('   ')).toBeNull();
    expect(normalizeMid('')).toBeNull();
    expect(normalizeMid(null)).toBeNull();
  });
});

describe('buildChains', () => {
  it('builds a Desk → board → product chain', () => {
    const chains = buildChains({
      tickets: ticketMap(desk, crm, product),
      links: [link('d1', 's1', 'e1'), link('e1', 's2', 'px')],
      lookups: LOOKUPS,
    });
    expect(chains).toHaveLength(1);
    const [c] = chains;
    expect(c.id).toBe('d1');
    expect(c.origin).toBe('desk');
    expect(c.size).toBe(3);
    expect(c.mids).toEqual(['ACME']);
    expect(c.crossesBoards).toBe(true);
    expect(c.lastActivity).toBe(50);
    expect(c.tickets.map(t => t.id)).toEqual(['d1', 'e1', 'px']);

    const e1 = kids(c.root)[0];
    const px = kids(e1)[0];
    expect(e1.type === 'ticket' && e1.ticket.sourceLabel).toBe('Euler / Issue');
    expect(e1.type === 'ticket' && e1.ticket.assigneeName).toBe('Asha');
    expect(px.type === 'ticket' && px.ticket.merchantIds).toEqual([]);
    expect(px.type === 'ticket' && px.ticket.sourceLabel).toBe('Payments / Core');
    expect(c.root.type === 'ticket' && c.root.ticket.sourceLabel).toBe('Desk · Support Email');
  });

  it('sets chainId, hasParent and childCount', () => {
    const [c] = buildChains({
      tickets: ticketMap(desk, crm, product),
      links: [link('d1', 's1', 'e1'), link('e1', 's2', 'px')],
      lookups: LOOKUPS,
    });
    const byId = new Map(c.tickets.map(t => [t.id, t]));
    expect(byId.get('d1')).toMatchObject({ chainId: 'd1', hasParent: false, childCount: 1 });
    expect(byId.get('e1')).toMatchObject({ chainId: 'd1', hasParent: true, childCount: 1 });
    expect(byId.get('px')).toMatchObject({ chainId: 'd1', hasParent: true, childCount: 0 });
  });

  it('builds deep links for Desk and board tickets', () => {
    const [c] = buildChains({ tickets: ticketMap(desk, crm), links: [link('d1', 's1', 'e1')], lookups: LOOKUPS });
    const byId = new Map(c.tickets.map(t => [t.id, t]));
    expect(byId.get('d1')!.url).toBe('https://spaces.xyne.juspay.net/w1/support/c-desk/D1');
    expect(byId.get('e1')!.url).toBe('https://spaces.xyne.juspay.net/w1/projects/p1/b1/e1');
  });

  it('renders an unmapped sub-ticket as a placeholder and an unreturned child as locked', () => {
    const [c] = buildChains({
      tickets: ticketMap(crm),
      links: [link('e1', 's3', null, 'Needs product'), link('e1', 's4', 'missing')],
      lookups: LOOKUPS,
    });
    expect(kids(c.root)).toEqual([
      { type: 'placeholder', subTicketId: 's3', title: 'Needs product' },
      { type: 'locked', ticketId: 'missing' },
    ]);
    expect(c.size).toBe(1);
  });

  it('keeps a ticket with no links as its own one-ticket chain', () => {
    const chains = buildChains({ tickets: ticketMap(crm), links: [], lookups: LOOKUPS });
    expect(chains).toHaveLength(1);
    expect(chains[0]).toMatchObject({ id: 'e1', size: 1, origin: 'board', crossesBoards: false });
    expect(kids(chains[0].root)).toEqual([]);
  });

  it('collects every MID in a chain', () => {
    const beta = ticket('e2', { merchantId: 'BETA' });
    const [c] = buildChains({ tickets: ticketMap(desk, beta), links: [link('d1', 's1', 'e2')], lookups: LOOKUPS });
    expect(c.mids).toEqual(['ACME', 'BETA']);
  });

  it('dedupes repeated sub-ticket links and second parents', () => {
    const other = ticket('e9', { merchantId: 'ACME' });
    const chains = buildChains({
      tickets: ticketMap(desk, crm, other),
      links: [link('d1', 's1', 'e1'), link('d1', 's1', 'e1'), link('e9', 's7', 'e1')],
      lookups: LOOKUPS,
    });
    const all = chains.flatMap(c => c.tickets.map(t => t.id));
    expect(all.filter(id => id === 'e1')).toHaveLength(1);
    expect(chains).toHaveLength(2);
  });

  it('breaks cycles and self-links, keeping every ticket exactly once', () => {
    const a = ticket('a', { merchantId: 'ACME' });
    const b = ticket('b', { merchantId: 'ACME' });
    const chains = buildChains({
      tickets: ticketMap(a, b),
      links: [link('a', 's1', 'b'), link('b', 's2', 'a'), link('a', 's3', 'a')],
      lookups: LOOKUPS,
    });
    const all = chains.flatMap(c => c.tickets.map(t => t.id)).sort();
    expect(all).toEqual(['a', 'b']);
    expect(chains).toHaveLength(1);
  });

  it('normalises MIDs on nodes and drops chains without any MID', () => {
    const spaced = ticket('e3', { merchantId: '  ACME ' });
    const blank = ticket('e4', { merchantId: '   ' });
    const chains = buildChains({ tickets: ticketMap(spaced, blank), links: [], lookups: LOOKUPS });
    expect(chains.map(c => c.id)).toEqual(['e3']);
    expect(chains[0].tickets[0].merchantIds).toEqual(['ACME']);
  });

  it('orders chains by most recent activity', () => {
    const old = ticket('o1', { merchantId: 'ACME', updatedAt: 5 });
    const fresh = ticket('f1', { merchantId: 'ACME', updatedAt: 500 });
    const chains = buildChains({ tickets: ticketMap(old, fresh), links: [], lookups: LOOKUPS });
    expect(chains.map(c => c.id)).toEqual(['f1', 'o1']);
  });

  it('uses resolved MIDs (custom fields, several per ticket) over the column', () => {
    const t = ticket('m1', { merchantId: null });
    const [c] = buildChains({
      tickets: ticketMap(t),
      links: [],
      lookups: LOOKUPS,
      mids: new Map([['m1', ['tvsmotor', 'tvspayout']]]),
    });
    expect(c.mids).toEqual(['tvsmotor', 'tvspayout']);
    expect(c.tickets[0].merchantIds).toEqual(['tvsmotor', 'tvspayout']);
  });
});
