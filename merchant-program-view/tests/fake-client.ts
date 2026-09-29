import type { Client } from '../lib/load';
import type { Ticket } from '../lib/types';

export interface FakeSub {
  id: string;
  title: string;
  mappedTicketId: string | null;
  createdAt?: number;
  ticketMappings?: { id: string; workspaceId: string; ticketId: string; subTicketId: string }[];
}

export interface FakeData {
  projects?: { id: string; name: string }[];
  channels?: { id: string; name: string; type: string; isArchived?: boolean }[];
  merchants?: { id: string; mid: string }[];
  boards?: { id: string; name: string }[];
  /** projectId → tickets the kanban query can return (the fake applies merchantIds like the server). */
  kanban?: Record<string, Ticket[]>;
  /** channelId → Desk tickets. */
  desk?: Record<string, Ticket[]>;
  mappings?: { ticketId: string; subTicketId: string }[];
  subTickets?: FakeSub[];
  /** Tickets reachable only by id (getMany), e.g. product sub-tickets and Desk parents. */
  extra?: Ticket[];
  users?: { id: string; name: string; displayName: string | null }[];
  failProjects?: string[];
  /** When set, listKanban ignores the cursor and always returns the first page. */
  repeatPages?: boolean;
  /** When set, projects.list fails on its first call (a transient 5xx). */
  flakyBoot?: boolean;
  /** When set, users.listBasic always reports hasMore without advancing nextOffset. */
  stuckUserPaging?: boolean;
  /** forms.list() result; `'fail'` makes it throw. */
  forms?: unknown[] | 'fail';
  /** ticketId → form values, for forms.listValues. */
  formValues?: Record<string, { fieldId: string; fieldValue?: unknown; actualFieldValue?: unknown }[]>;
  /** Activity rows for listActivitiesForTickets. */
  activities?: { id: string; ticketId: string; timestamp: number }[];
  /** Newer versions of tickets, returned by getMany in place of the originals. */
  updated?: Ticket[];
}

export interface FakeCalls {
  listKanban: {
    projectId: string;
    filters: { merchantIds?: string[]; createdDateStart?: number; createdDateEnd?: number };
    start: unknown;
    formEntityValueFieldIds?: string[];
  }[];
  listSubTicketsByMapped: string[];
  deskPages: string[];
  activityPages: number;
  formValues: string[];
}

export function fakeClient(d: FakeData): { client: Client; calls: FakeCalls } {
  const calls: FakeCalls = { listKanban: [], listSubTicketsByMapped: [], deskPages: [], activityPages: 0, formValues: [] };
  const all = new Map<string, Ticket>();
  for (const rows of [...Object.values(d.kanban ?? {}), ...Object.values(d.desk ?? {}), d.extra ?? []])
    for (const t of rows) all.set(t.id, t);
  for (const t of d.updated ?? []) all.set(t.id, t);
  const users = d.users ?? [];
  let bootFailed = false;

  const client = {
    users: {
      me: async () => ({ id: 'me-1', workspaceId: 'w1' }),
      listBasic: async ({ offset = 0 }: { offset?: number } = {}) =>
        d.stuckUserPaging
          ? { items: users, hasMore: true, total: users.length, nextOffset: 0 }
          : {
              items: users.slice(offset, offset + 100),
              hasMore: offset + 100 < users.length,
              total: users.length,
              nextOffset: offset + 100,
            },
    },
    projects: {
      list: async () => {
        if (d.flakyBoot && !bootFailed) {
          bootFailed = true;
          throw new Error('503');
        }
        return d.projects ?? [];
      },
      getMany: async (ids: string[]) => (d.projects ?? []).filter(p => ids.includes(p.id)),
    },
    boards: {
      list: async () => d.boards ?? [],
      getMany: async (ids: string[]) => (d.boards ?? []).filter(b => ids.includes(b.id)),
    },
    channels: { listAll: async () => (d.channels ?? []).map(c => ({ isArchived: false, ...c })) },
    workspace: { listMerchants: async () => d.merchants ?? [] },
    forms: {
      list: async () => {
        if (d.forms === 'fail') throw new Error('forms down');
        return d.forms ?? [];
      },
      listValues: async (ticketId: string) => {
        calls.formValues.push(ticketId);
        return d.formValues?.[ticketId] ?? [];
      },
    },
    // Mirrors supportTicketsPageV4: non-archived rows of one channel, ordered lastEmailAt desc then
    // id desc, with an EXCLUSIVE keyset cursor on (lastEmailAt, id).
    supportTickets: {
      list: async (channelId: string, opts: { limit: number; start?: { id: string; lastEmailAt: number } }) => {
        calls.deskPages.push(channelId);
        const key = (t: Ticket): number => (t as Ticket & { lastEmailAt?: number | null }).lastEmailAt ?? 0;
        const rows = (d.desk?.[channelId] ?? [])
          .filter(t => !t.isArchived)
          .sort((a, b) => key(b) - key(a) || b.id.localeCompare(a.id));
        const s = opts.start;
        const after = s ? rows.filter(t => key(t) < s.lastEmailAt || (key(t) === s.lastEmailAt && t.id < s.id)) : rows;
        return after.slice(0, opts.limit);
      },
    },
    tickets: {
      // Mirrors kanbanTicketsPageV3: exact-match merchantIds, order createdAt desc then id asc,
      // and an INCLUSIVE cursor on createdAt only (`createdAt <= start.createdAt`).
      listKanban: async (opts: {
        projectId: string;
        limit: number;
        start: { id: string; createdAt: number } | null;
        filters?: { merchantIds?: string[]; createdDateStart?: number; createdDateEnd?: number };
        formEntityValueFieldIds?: string[];
      }) => {
        const filters = opts.filters ?? {};
        calls.listKanban.push({ projectId: opts.projectId, filters, start: opts.start, formEntityValueFieldIds: opts.formEntityValueFieldIds });
        if (d.failProjects?.includes(opts.projectId)) throw new Error('boom');
        const mids = filters.merchantIds;
        const rows = (d.kanban?.[opts.projectId] ?? [])
          .filter(t => !mids || (t.merchantId !== null && mids.includes(t.merchantId)))
          .filter(t => filters.createdDateStart === undefined || t.createdAt >= filters.createdDateStart)
          .filter(t => filters.createdDateEnd === undefined || t.createdAt <= filters.createdDateEnd)
          .map(t => (opts.formEntityValueFieldIds ? t : { ...t, formEntityValues: undefined }))
          .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
        const from = !d.repeatPages && opts.start ? rows.filter(t => t.createdAt <= opts.start!.createdAt) : rows;
        return from.slice(0, opts.limit);
      },
      listSubTicketMappings: async (ids: string[]) =>
        (d.mappings ?? [])
          .filter(m => ids.includes(m.ticketId))
          .map(m => ({ id: `m-${m.subTicketId}`, workspaceId: 'w1', ...m })),
      getSubTickets: async (ids: string[]) => (d.subTickets ?? []).filter(s => ids.includes(s.id)),
      getMany: async (ids: string[]) => ids.map(id => all.get(id)).filter((t): t is Ticket => t !== undefined),
      // Mirrors ticketActivitiesForTickets: newest first, exclusive keyset cursor on (timestamp, id).
      listActivitiesForTickets: async (opts: { ticketIds: string[]; limit?: number; start?: { timestamp: number; id: string } }) => {
        calls.activityPages += 1;
        const s = opts.start;
        return (d.activities ?? [])
          .filter(a => opts.ticketIds.includes(a.ticketId))
          .sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id))
          .filter(a => !s || a.timestamp < s.timestamp || (a.timestamp === s.timestamp && a.id < s.id))
          .slice(0, opts.limit ?? 100);
      },
      listSubTicketsByMapped: async (id: string) => {
        calls.listSubTicketsByMapped.push(id);
        return (d.subTickets ?? []).filter(s => s.mappedTicketId === id);
      },
    },
  };
  return { client: client as unknown as Client, calls };
}
