import { describe, expect, it } from 'vitest';
import { loadAll, loadProjectTickets } from '../lib/load';
import { ticket } from './fixtures';
import { fakeClient } from './fake-client';

const noop = (): void => undefined;
const many = (n: number, projectId: string) =>
  Array.from({ length: n }, (_, i) => ticket(`${projectId}-${i}`, { projectId, merchantId: 'ACME', createdAt: i }));

describe('loadAll — tickets', () => {
  it('pages MID-filtered board tickets per project', async () => {
    const { client, calls } = fakeClient({
      projects: [{ id: 'p1', name: 'Euler' }],
      merchants: [
        { id: 'm1', mid: ' ACME ' },
        { id: 'm2', mid: 'BETA' },
      ],
      kanban: { p1: [...many(250, 'p1'), ticket('nomid', { projectId: 'p1' })] },
    });
    const store = await loadAll(client, noop);
    expect(store.tickets.size).toBe(250);
    expect(calls.listKanban).toHaveLength(3);
    expect(calls.listKanban[0].filters.merchantIds).toEqual([' ACME ', 'ACME', 'BETA']);
    expect(store.lookups.workspaceId).toBe('w1');
    expect(store.lookups.meId).toBe('me-1');
    expect(store.lookups.projects.get('p1')).toBe('Euler');
  });

  it('skips the board crawl when no merchants are registered, and warns', async () => {
    const { client, calls } = fakeClient({
      projects: [{ id: 'p1', name: 'Euler' }],
      merchants: [],
      kanban: { p1: many(3, 'p1') },
      channels: [{ id: 'c-desk', name: 'Support Email', type: 'EMAIL' }],
      desk: { 'c-desk': [ticket('d1', { channelId: 'c-desk', merchantId: 'ACME' })] },
    });
    const store = await loadAll(client, noop);
    expect(calls.listKanban).toHaveLength(0);
    expect([...store.tickets.keys()]).toEqual(['d1']);
    expect(store.warnings.map(w => w.key)).toContain('merchants');
  });

  it('keeps only Desk tickets with a non-blank MID, from non-archived Desk channels', async () => {
    const { client } = fakeClient({
      merchants: [{ id: 'm1', mid: 'ACME' }],
      channels: [
        { id: 'c-desk', name: 'Support Email', type: 'EMAIL' },
        { id: 'c-slack', name: 'Slack Desk', type: 'SLACK' },
        { id: 'c-old', name: 'Old Desk', type: 'EMAIL', isArchived: true },
        { id: 'c-chat', name: 'general', type: 'DEFAULT' },
      ],
      desk: {
        'c-desk': [
          ticket('d1', { channelId: 'c-desk', merchantId: 'ACME' }),
          ticket('d2', { channelId: 'c-desk', merchantId: '   ' }),
          ticket('d3', { channelId: 'c-desk', merchantId: null }),
        ],
        'c-slack': [ticket('d4', { channelId: 'c-slack', merchantId: 'ZETA' })],
        'c-old': [ticket('d5', { channelId: 'c-old', merchantId: 'ACME' })],
        'c-chat': [ticket('d6', { channelId: 'c-chat', merchantId: 'ACME' })],
      },
    });
    const store = await loadAll(client, noop);
    expect([...store.tickets.keys()].sort()).toEqual(['d1', 'd4']);
    // Archived Desks aren't crawled but still classify linked tickets as Desk.
    expect([...store.lookups.deskChannels.keys()].sort()).toEqual(['c-desk', 'c-old', 'c-slack']);
  });

  it('keeps loading other projects when one fails, and records a warning', async () => {
    const { client } = fakeClient({
      projects: [
        { id: 'p1', name: 'Euler' },
        { id: 'p2', name: 'Broken' },
      ],
      merchants: [{ id: 'm1', mid: 'ACME' }],
      kanban: { p1: many(2, 'p1'), p2: many(2, 'p2') },
      failProjects: ['p2'],
    });
    const store = await loadAll(client, noop);
    expect(store.tickets.size).toBe(2);
    expect(store.warnings.find(w => w.key === 'project:p2')?.message).toContain('Broken');
  });

  it('loads user names and board names, and reports progress through to done', async () => {
    const phases: string[] = [];
    const { client } = fakeClient({
      projects: [{ id: 'p1', name: 'Euler' }],
      boards: [{ id: 'b1', name: 'Issue' }],
      merchants: [{ id: 'm1', mid: 'ACME' }],
      kanban: { p1: many(1, 'p1') },
      users: [
        { id: 'u9', name: 'asha.k', displayName: 'Asha' },
        { id: 'u8', name: 'ravi', displayName: null },
      ],
    });
    const store = await loadAll(client, (_s, p) => phases.push(p.phase));
    expect(store.lookups.users.get('u9')).toBe('Asha');
    expect(store.lookups.users.get('u8')).toBe('ravi');
    expect(store.lookups.boards.get('b1')).toBe('Issue');
    expect(phases[0]).toBe('boot');
    expect(phases.at(-1)).toBe('done');
    expect(phases).toContain('linking');
  });
});

describe('loadProjectTickets', () => {
  it('stops paging when a page adds nothing new', async () => {
    const { client, calls } = fakeClient({ kanban: { p1: many(100, 'p1') }, repeatPages: true });
    const rows = await loadProjectTickets(client, 'p1', ['ACME']);
    expect(rows).toHaveLength(100);
    expect(calls.listKanban.length).toBeLessThanOrEqual(3);
  });

  it('steps past a full page of same-timestamp tickets instead of dropping everything older', async () => {
    const newer = Array.from({ length: 50 }, (_, i) => ticket(`n${i}`, { merchantId: 'ACME', createdAt: 2000 + i }));
    const tied = Array.from({ length: 150 }, (_, i) => ticket(`t${String(i).padStart(3, '0')}`, { merchantId: 'ACME', createdAt: 1000 }));
    const older = Array.from({ length: 50 }, (_, i) => ticket(`o${i}`, { merchantId: 'ACME', createdAt: 500 - i }));
    const { client } = fakeClient({ kanban: { p1: [...newer, ...tied, ...older] } });
    let ties = 0;
    const rows = await loadProjectTickets(client, 'p1', ['ACME'], () => {
      ties += 1;
    });
    const ids = new Set(rows.map(t => t.id));
    expect(newer.every(t => ids.has(t.id))).toBe(true);
    expect(older.every(t => ids.has(t.id))).toBe(true);
    expect(ties).toBe(1);
  });
});

describe('loadAll — resilience', () => {
  it('matches registry MIDs with stray whitespace exactly as the server stores them', async () => {
    const { client } = fakeClient({
      projects: [{ id: 'p1', name: 'Euler' }],
      merchants: [{ id: 'm1', mid: ' ACME ' }],
      kanban: { p1: [ticket('e1', { merchantId: ' ACME ' }), ticket('e2', { merchantId: 'ACME' })] },
    });
    const store = await loadAll(client, noop);
    expect([...store.tickets.keys()].sort()).toEqual(['e1', 'e2']);
  });

  it('retries a transient failure in the boot calls', async () => {
    const { client } = fakeClient({ projects: [{ id: 'p1', name: 'Euler' }], merchants: [{ id: 'm1', mid: 'ACME' }], kanban: { p1: many(1, 'p1') }, flakyBoot: true });
    const store = await loadAll(client, noop);
    expect(store.tickets.size).toBe(1);
  });

  it('stops walking users when the server does not advance the offset', async () => {
    const { client } = fakeClient({ users: [{ id: 'u9', name: 'asha', displayName: 'Asha' }], stuckUserPaging: true });
    const store = await loadAll(client, noop);
    expect(store.lookups.users.get('u9')).toBe('Asha');
  }, 3000);
});

describe('loadAll — Desk paging', () => {
  const deskRow = (i: number, over: Record<string, unknown> = {}) =>
    ({ ...ticket(`k${String(i).padStart(3, '0')}`, { channelId: 'c-big', merchantId: i % 2 === 0 ? 'ACME' : null }), lastEmailAt: 10_000 - i, ...over }) as ReturnType<typeof ticket>;

  it('pages through a large Desk and keeps only MID tickets', async () => {
    const { client, calls } = fakeClient({
      channels: [{ id: 'c-big', name: 'Big Desk', type: 'EMAIL' }],
      desk: { 'c-big': Array.from({ length: 250 }, (_, i) => deskRow(i)) },
    });
    const store = await loadAll(client, noop);
    expect(store.tickets.size).toBe(125);
    expect(calls.deskPages.filter(c => c === 'c-big')).toHaveLength(3);
    expect(store.warnings.filter(w => w.key.startsWith('desk:'))).toEqual([]);
  });

  it('stops paging a Desk whose page ends on a row without lastEmailAt, and warns', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => deskRow(i));
    rows[99] = deskRow(99, { lastEmailAt: null });
    const { client } = fakeClient({ channels: [{ id: 'c-big', name: 'Big Desk', type: 'EMAIL' }], desk: { 'c-big': rows } });
    const store = await loadAll(client, noop);
    expect(store.tickets.size).toBe(50);
    expect(store.warnings.map(w => w.key)).toContain('desk:c-big:cursor');
  });
});

describe('loadAll — merchant custom fields', () => {
  const forms = [
    {
      id: 'form-ms',
      formFields: [{ id: 'x', globalFieldId: 'g-mid', fieldName: null, globalField: { fieldName: 'Merchant Id', projectId: 'p-ms' } }],
      formContextMappings: [],
    },
  ];
  const withField = (id: string, value: string, over: Record<string, unknown> = {}) =>
    ({ ...ticket(id, { projectId: 'p-ms', ...over }), formEntityValues: [{ fieldId: 'g-mid', fieldValue: '', actualFieldValue: value }] }) as ReturnType<typeof ticket>;

  it('crawls projects that can carry the fields unfiltered, keeping custom-field MIDs', async () => {
    const { client, calls } = fakeClient({
      projects: [
        { id: 'p-ms', name: 'Merchant Support' },
        { id: 'p-euler', name: 'Euler' },
      ],
      merchants: [{ id: 'm1', mid: 'acme' }],
      forms,
      kanban: {
        'p-ms': [withField('ms1', 'smallcase'), withField('ms2', 'tvsmotor,tvspayout'), ticket('ms3', { projectId: 'p-ms' })],
        'p-euler': [ticket('e1', { projectId: 'p-euler', merchantId: 'acme' })],
      },
    });
    const store = await loadAll(client, noop);
    expect([...store.tickets.keys()].sort()).toEqual(['e1', 'ms1', 'ms2']);
    expect(store.mids.get('ms1')).toEqual(['smallcase']);
    expect(store.mids.get('ms2')).toEqual(['tvsmotor', 'tvspayout']);
    const ms = calls.listKanban.find(c => c.projectId === 'p-ms')!;
    const euler = calls.listKanban.find(c => c.projectId === 'p-euler')!;
    expect(ms.filters.merchantIds).toBeUndefined();
    expect(ms.formEntityValueFieldIds).toEqual(['g-mid']);
    expect(euler.filters.merchantIds).toEqual(['acme']);
    expect(store.merchantFields).toEqual({ fieldIds: ['g-mid'], projectIds: ['p-ms'] });
  });

  it('falls back to column-only loading when the forms call fails', async () => {
    const { client, calls } = fakeClient({
      projects: [{ id: 'p-ms', name: 'Merchant Support' }],
      merchants: [{ id: 'm1', mid: 'acme' }],
      forms: 'fail',
      kanban: { 'p-ms': [ticket('a1', { projectId: 'p-ms', merchantId: 'acme' })] },
    });
    const store = await loadAll(client, noop);
    expect([...store.tickets.keys()]).toEqual(['a1']);
    expect(calls.listKanban[0].filters.merchantIds).toEqual(['acme']);
    expect(store.warnings.map(w => w.key)).toContain('forms');
  });
});
