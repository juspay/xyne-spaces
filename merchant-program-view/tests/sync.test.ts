import { describe, expect, it } from 'vitest';
import { loadAll } from '../lib/load';
import { syncStore } from '../lib/sync';
import { ticket } from './fixtures';
import { fakeClient } from './fake-client';

const noop = (): void => undefined;
const SINCE = 10_000;

const forms = [
  {
    id: 'form-ms',
    formFields: [{ id: 'x', globalFieldId: 'g-mid', fieldName: null, globalField: { fieldName: 'Merchant Id', projectId: 'p-ms' } }],
    formContextMappings: [],
  },
];
const base = {
  projects: [
    { id: 'p-euler', name: 'Euler' },
    { id: 'p-ms', name: 'Merchant Support' },
  ],
  merchants: [{ id: 'm1', mid: 'acme' }],
  forms,
};

describe('syncStore', () => {
  it('adds tickets created since the last sync, asking the server only for those', async () => {
    const old = ticket('e-old', { projectId: 'p-euler', merchantId: 'acme', createdAt: 5_000 });
    const fresh = ticket('e-new', { projectId: 'p-euler', merchantId: 'acme', createdAt: 12_000 });
    const first = fakeClient({ ...base, kanban: { 'p-euler': [old] } });
    const store = await loadAll(first.client, noop);

    const later = fakeClient({ ...base, kanban: { 'p-euler': [old, fresh] } });
    const result = await syncStore(later.client, store, SINCE, noop);
    expect([...store.tickets.keys()].sort()).toEqual(['e-new', 'e-old']);
    expect(result).toEqual({ added: 1, updated: 0 });
    const euler = later.calls.listKanban.filter(c => c.projectId === 'p-euler');
    expect(euler.every(c => c.filters.createdDateStart === SINCE)).toBe(true);
  });

  it('refreshes cached tickets with activity since the last sync, re-reading their MIDs', async () => {
    const t1 = ticket('ms1', { projectId: 'p-ms', statusV2: 'TODO', createdAt: 1_000 });
    const withMid = { ...t1, formEntityValues: [{ fieldId: 'g-mid', fieldValue: 'smallcase', actualFieldValue: 'smallcase' }] };
    const first = fakeClient({ ...base, kanban: { 'p-ms': [withMid as typeof t1] } });
    const store = await loadAll(first.client, noop);
    expect(store.mids.get('ms1')).toEqual(['smallcase']);

    const later = fakeClient({
      ...base,
      kanban: { 'p-ms': [withMid as typeof t1] },
      activities: [
        { id: 'a2', ticketId: 'ms1', timestamp: 11_000 },
        { id: 'a1', ticketId: 'ms1', timestamp: 9_000 },
      ],
      updated: [{ ...t1, statusV2: 'COMPLETED' }],
      formValues: { ms1: [{ fieldId: 'g-mid', fieldValue: 'smallcase,acme', actualFieldValue: 'smallcase,acme' }] },
    });
    const result = await syncStore(later.client, store, SINCE, noop);
    expect(result).toEqual({ added: 0, updated: 1 });
    expect(store.tickets.get('ms1')!.statusV2).toBe('COMPLETED');
    expect(store.mids.get('ms1')).toEqual(['smallcase', 'acme']);
    expect(later.calls.formValues).toEqual(['ms1']);
  });

  it('leaves unchanged cached tickets alone', async () => {
    const t1 = ticket('e1', { projectId: 'p-euler', merchantId: 'acme', createdAt: 1_000 });
    const store = await loadAll(fakeClient({ ...base, kanban: { 'p-euler': [t1] } }).client, noop);
    const before = store.tickets.get('e1');
    const later = fakeClient({ ...base, kanban: { 'p-euler': [t1] }, activities: [{ id: 'a1', ticketId: 'e1', timestamp: 9_000 }] });
    await syncStore(later.client, store, SINCE, noop);
    expect(later.calls.formValues).toEqual([]);
    expect(store.tickets.get('e1')).toBe(before);
  });

  it('pages a Desk only back to the last sync', async () => {
    const desk = (i: number, lastEmailAt: number) =>
      ({ ...ticket(`k${String(i).padStart(3, '0')}`, { channelId: 'c-big', merchantId: 'acme' }), lastEmailAt }) as ReturnType<typeof ticket>;
    const rows = [...Array.from({ length: 150 }, (_, i) => desk(i, 20_000 - i)), ...Array.from({ length: 150 }, (_, i) => desk(150 + i, 5_000 - i))];
    const later = fakeClient({ ...base, channels: [{ id: 'c-big', name: 'Big Desk', type: 'EMAIL' }], desk: { 'c-big': rows } });
    const store = await loadAll(fakeClient({ ...base }).client, noop);
    await syncStore(later.client, store, SINCE, noop);
    expect([...store.tickets.keys()].filter(k => k.startsWith('k')).length).toBe(150);
    expect(later.calls.deskPages.length).toBe(2);
  });

  it('links sub-tickets of newly synced tickets', async () => {
    const fresh = ticket('e-new', { projectId: 'p-euler', merchantId: 'acme', createdAt: 12_000 });
    const store = await loadAll(fakeClient({ ...base }).client, noop);
    const later = fakeClient({
      ...base,
      kanban: { 'p-euler': [fresh] },
      mappings: [{ ticketId: 'e-new', subTicketId: 's1' }],
      subTickets: [{ id: 's1', title: 'Fix', mappedTicketId: 'px' }],
      extra: [ticket('px', { projectId: 'p-pay' })],
    });
    await syncStore(later.client, store, SINCE, noop);
    expect(store.links.map(l => `${l.parentId}>${l.childId}`)).toEqual(['e-new>px']);
    expect(store.tickets.has('px')).toBe(true);
  });

  it('refreshes fields of a cached Desk ticket that got new email', async () => {
    const row = (lastEmailAt: number) =>
      ({ ...ticket('d1', { channelId: 'c-desk', merchantId: 'acme' }), lastEmailAt }) as ReturnType<typeof ticket>;
    const withDesk = { ...base, channels: [{ id: 'c-desk', name: 'Desk', type: 'EMAIL' }] };
    const store = await loadAll(fakeClient({ ...withDesk, desk: { 'c-desk': [row(9_000)] } }).client, noop);
    await syncStore(fakeClient({ ...withDesk, desk: { 'c-desk': [row(15_000)] } }).client, store, SINCE, noop);
    expect((store.tickets.get('d1') as unknown as { lastEmailAt: number }).lastEmailAt).toBe(15_000);
  });
});
