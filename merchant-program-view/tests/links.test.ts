import { describe, expect, it } from 'vitest';
import { emptyStore, expandDown, expandUp, loadAll } from '../lib/load';
import { ticket } from './fixtures';
import { fakeClient } from './fake-client';

const noop = (): void => undefined;

describe('expandDown', () => {
  it('follows sub-tickets into other boards and loads children without a MID', async () => {
    const { client } = fakeClient({
      projects: [{ id: 'p1', name: 'Euler' }],
      merchants: [{ id: 'm1', mid: 'ACME' }],
      kanban: { p1: [ticket('e1', { merchantId: 'ACME' })] },
      mappings: [
        { ticketId: 'e1', subTicketId: 's1' },
        { ticketId: 'e1', subTicketId: 's2' },
        { ticketId: 'px', subTicketId: 's3' },
      ],
      subTickets: [
        { id: 's1', title: 'Fix retry', mappedTicketId: 'px', createdAt: 101 },
        { id: 's2', title: 'Needs product', mappedTicketId: null, createdAt: 102 },
        { id: 's3', title: 'Hidden', mappedTicketId: 'secret', createdAt: 103 },
      ],
      extra: [ticket('px', { projectId: 'p2', boardId: 'b2' })],
    });
    const store = await loadAll(client, noop);
    expect([...store.tickets.keys()].sort()).toEqual(['e1', 'px']);
    expect(store.links).toEqual([
      { parentId: 'e1', subTicketId: 's1', childId: 'px', subTitle: 'Fix retry', subCreatedAt: 101 },
      { parentId: 'e1', subTicketId: 's2', childId: null, subTitle: 'Needs product', subCreatedAt: 102 },
      { parentId: 'px', subTicketId: 's3', childId: 'secret', subTitle: 'Hidden', subCreatedAt: 103 },
    ]);
  });

  it('stops after the configured depth', async () => {
    const chain = ['t0', 't1', 't2', 't3', 't4', 't5'];
    const { client } = fakeClient({
      mappings: chain.slice(0, -1).map((id, i) => ({ ticketId: id, subTicketId: `s${i}` })),
      subTickets: chain.slice(0, -1).map((_, i) => ({ id: `s${i}`, title: '', mappedTicketId: chain[i + 1] })),
      extra: chain.map(id => ticket(id)),
    });
    const store = emptyStore();
    store.tickets.set('t0', ticket('t0', { merchantId: 'ACME' }));
    await expandDown(client, store, ['t0'], 3);
    expect([...store.tickets.keys()]).toEqual(['t0', 't1', 't2', 't3']);
  });
});

describe('expandUp', () => {
  it('finds a Desk parent without a MID, then its other children', async () => {
    const { client, calls } = fakeClient({
      mappings: [
        { ticketId: 'd0', subTicketId: 's0' },
        { ticketId: 'd0', subTicketId: 's9' },
      ],
      subTickets: [
        {
          id: 's0',
          title: 'Escalated',
          mappedTicketId: 'e1',
          ticketMappings: [{ id: 'm0', workspaceId: 'w1', ticketId: 'd0', subTicketId: 's0' }],
        },
        { id: 's9', title: 'Sibling', mappedTicketId: 'e2' },
      ],
      extra: [ticket('d0', { channelId: 'c-desk' }), ticket('e2')],
    });
    const store = emptyStore();
    store.tickets.set('e1', ticket('e1', { merchantId: 'ACME' }));
    await expandUp(client, store, ['e1']);
    expect([...store.tickets.keys()].sort()).toEqual(['d0', 'e1', 'e2']);
    expect(store.links.map(l => `${l.parentId}>${l.childId}`).sort()).toEqual(['d0>e1', 'd0>e2']);

    await expandUp(client, store, ['e1']);
    expect(calls.listSubTicketsByMapped.filter(id => id === 'e1')).toHaveLength(1);
  });

  it('does not duplicate links found both downward and upward', async () => {
    const { client } = fakeClient({
      mappings: [{ ticketId: 'd0', subTicketId: 's0' }],
      subTickets: [
        {
          id: 's0',
          title: '',
          mappedTicketId: 'e1',
          ticketMappings: [{ id: 'm0', workspaceId: 'w1', ticketId: 'd0', subTicketId: 's0' }],
        },
      ],
      extra: [ticket('d0'), ticket('e1', { merchantId: 'ACME' })],
    });
    const store = emptyStore();
    store.tickets.set('d0', ticket('d0', { merchantId: 'ACME' }));
    store.tickets.set('e1', ticket('e1', { merchantId: 'ACME' }));
    await expandDown(client, store, ['d0', 'e1']);
    await expandUp(client, store, ['e1']);
    expect(store.links).toHaveLength(1);
  });

  it('skips the lookup for a ticket whose parent is already known, but climbs from that parent', async () => {
    const { client, calls } = fakeClient({
      mappings: [{ ticketId: 'e0', subTicketId: 's1' }],
      subTickets: [
        { id: 's1', title: '', mappedTicketId: 'px' },
        {
          id: 's0',
          title: '',
          mappedTicketId: 'e0',
          ticketMappings: [{ id: 'm', workspaceId: 'w1', ticketId: 'd0', subTicketId: 's0' }],
        },
      ],
      extra: [ticket('px'), ticket('d0')],
    });
    const store = emptyStore();
    store.tickets.set('e0', ticket('e0', { merchantId: 'ACME' }));
    await expandDown(client, store, ['e0']);
    await expandUp(client, store, ['px']);
    expect(calls.listSubTicketsByMapped).not.toContain('px');
    expect(store.tickets.has('d0')).toBe(true);
  });
});
