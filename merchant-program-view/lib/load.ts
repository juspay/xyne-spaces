import type { SlimSpacesClient } from './vendor/spaces-sdk';
import { chunk, mapLimit, retryOnce } from './async';
import {
  DESK_CHANNEL_TYPES,
  DESK_CONCURRENCY,
  ID_BATCH,
  LINK_DEPTH,
  PAGE_SIZE,
  PARENT_CONCURRENCY,
  PROJECT_CONCURRENCY,
  RETRY_DELAY_MS,
  WINDOW_CONCURRENCY,
} from './config';
import { discoverMerchantFields, parseMids, resolveMids, type FormLike, type MerchantFields, type TicketWithFields } from './merchantFields';
import type { Link, LoadProgress, LoadWarning, Lookups, SubTicketWithMappings, Ticket } from './types';

export type Client = Pick<
  SlimSpacesClient,
  'users' | 'projects' | 'boards' | 'channels' | 'tickets' | 'supportTickets' | 'workspace' | 'forms'
>;

type KanbanOptions = Parameters<Client['tickets']['listKanban']>[0];
/** The server honours `filters.merchantIds` (backend zero/queries.ts) but the SDK type omits it. */
type KanbanFiltersWithMerchants = NonNullable<KanbanOptions['filters']> & { merchantIds?: string[] };

export interface DataStore {
  lookups: Lookups;
  tickets: Map<string, Ticket>;
  links: Link[];
  /** Sub-ticket ids already recorded in `links`. */
  linkKeys: Set<string>;
  /** Ticket ids whose sub-tickets have been read. */
  expanded: Set<string>;
  /** Ticket ids whose parent lookup has run. */
  parentChecked: Set<string>;
  /** MIDs per ticket (column + merchant custom fields), for tickets that have any. */
  mids: Map<string, string[]>;
  /** Merchant custom fields and the projects that can carry them. */
  merchantFields: MerchantFields;
  warnings: LoadWarning[];
}

export type OnUpdate = (store: DataStore, progress: LoadProgress) => void;

export function emptyStore(): DataStore {
  return {
    lookups: { workspaceId: '', meId: '', deskChannels: new Map(), projects: new Map(), boards: new Map(), users: new Map() },
    tickets: new Map(),
    links: [],
    linkKeys: new Set(),
    expanded: new Set(),
    parentChecked: new Set(),
    mids: new Map(),
    merchantFields: { fieldIds: [], projectIds: [] },
    warnings: [],
  };
}

export const retry = <T>(fn: () => Promise<T>): Promise<T> => retryOnce(fn, RETRY_DELAY_MS);

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function warn(store: DataStore, key: string, message: string): void {
  store.warnings.push({ key, message });
}

function addTickets(store: DataStore, rows: Ticket[]): Ticket[] {
  const added: Ticket[] = [];
  for (const t of rows) {
    if (store.tickets.has(t.id)) continue;
    store.tickets.set(t.id, t);
    added.push(t);
  }
  return added;
}

/**
 * Keep the rows that carry a MID (column or merchant custom field), merging their MIDs into
 * `store.mids`. The field values are dropped from the stored ticket to keep it small.
 */
export function ingest(store: DataStore, rows: TicketWithFields[]): void {
  const fieldIds = new Set(store.merchantFields.fieldIds);
  for (const row of rows) {
    const mids = resolveMids(row, fieldIds);
    if (mids.length === 0) continue;
    const { formEntityValues: _values, ...t } = row;
    // Newer rows win, but keep fields a different listing didn't return (Desk rows carry email fields).
    store.tickets.set(t.id, { ...store.tickets.get(t.id), ...t });
    store.mids.set(t.id, [...new Set([...(store.mids.get(t.id) ?? []), ...mids])]);
  }
}

/** Ticket ids carrying `mid`. */
export function ticketIdsForMid(store: DataStore, mid: string): string[] {
  return [...store.tickets.keys()].filter(id => (store.mids.get(id) ?? parseMids(store.tickets.get(id)!.merchantId)).includes(mid));
}

/**
 * Page a project's merchant tickets. The server's cursor is inclusive on `createdAt` alone
 * (`createdAt <= start.createdAt`), so a full page of same-timestamp tickets would repeat forever:
 * when a full page adds nothing new, step to `createdAt - 1` and report it through `onTies`
 * (the rest of that timestamp group is unreachable through this API).
 */
export async function loadProjectTickets(
  client: Client,
  projectId: string,
  /** MIDs to filter on server-side, or `null` for every ticket (projects with merchant custom fields). */
  merchantIds: string[] | null,
  onTies: () => void = () => undefined,
  /** Custom fields to attach to each ticket. */
  fieldIds: string[] = [],
  /** Only tickets created at or after this time (incremental sync, date windows). */
  createdSince?: number,
  /** Only tickets created at or before this time (date windows). */
  createdBefore?: number,
): Promise<TicketWithFields[]> {
  if (merchantIds !== null && merchantIds.length === 0) return []; // an empty list would mean "no filter" on the server
  const filters: KanbanFiltersWithMerchants = {
    ...(merchantIds !== null ? { merchantIds } : {}),
    ...(createdSince !== undefined ? { createdDateStart: createdSince } : {}),
    ...(createdBefore !== undefined ? { createdDateEnd: createdBefore } : {}),
  };
  const fields = fieldIds.length > 0 ? { formEntityValueFieldIds: fieldIds } : {};
  const seen = new Set<string>();
  const all: TicketWithFields[] = [];
  let start: { id: string; createdAt: number } | null = null;
  for (;;) {
    const page: TicketWithFields[] = await client.tickets.listKanban({ viewMode: 'project', projectId, limit: PAGE_SIZE, start, filters, ...fields });
    const fresh = page.filter(t => !seen.has(t.id));
    for (const t of fresh) seen.add(t.id);
    all.push(...fresh);
    if (page.length < PAGE_SIZE) return all;
    const last = page[page.length - 1];
    if (fresh.length > 0) {
      start = { id: last.id, createdAt: last.createdAt };
      continue;
    }
    // Nothing new on a full page. If the server already ignored a cursor below this page, stop.
    if (start !== null && start.createdAt < last.createdAt) return all;
    onTies();
    start = { id: last.id, createdAt: last.createdAt - 1 };
  }
}

export interface CreatedWindow {
  start?: number;
  end?: number;
}

const DAY_MS = 86_400_000;

/**
 * Contiguous, non-overlapping creation-date windows covering all time (both ends inclusive):
 * monthly for the last year, quarterly for the two years before, then everything older.
 */
export function createdWindows(now: number): CreatedWindow[] {
  const edges: number[] = [];
  for (let m = 1; m <= 12; m++) edges.push(now - m * 30 * DAY_MS);
  for (let q = 1; q <= 8; q++) edges.push(now - 360 * DAY_MS - q * 91 * DAY_MS);
  edges.sort((a, b) => a - b);
  const windows: CreatedWindow[] = [{ end: edges[0] - 1 }];
  for (let i = 0; i < edges.length - 1; i++) windows.push({ start: edges[i], end: edges[i + 1] - 1 });
  windows.push({ start: edges[edges.length - 1] });
  return windows;
}

/** Crawl a whole project with custom fields attached, several creation-date windows at a time. */
export async function loadProjectTicketsWindowed(
  client: Client,
  projectId: string,
  fieldIds: string[],
  onTies: () => void,
  windows: CreatedWindow[],
): Promise<TicketWithFields[]> {
  const pages = await mapLimit(windows, WINDOW_CONCURRENCY, w =>
    retry(() => loadProjectTickets(client, projectId, null, onTies, fieldIds, w.start, w.end)),
  );
  const byId = new Map<string, TicketWithFields>();
  for (const t of pages.flat()) byId.set(t.id, t);
  return [...byId.values()];
}

/** Desk rows carry `lastEmailAt` at runtime (the Desk page cursor); the SDK Ticket type omits it. */
type DeskRow = Ticket & { lastEmailAt?: number | null };

/**
 * Page every non-archived ticket of one Desk channel with supportTickets.list (keyset cursor on
 * lastEmailAt + id). listFiltered returns a whole Desk in one response, which large Desks can't serve.
 * Stops early, via `onStuck`, if a full page ends on a row the cursor can't express.
 */
export async function loadDeskTickets(
  client: Client,
  channelId: string,
  onStuck: () => void = () => undefined,
  /** Only rows with email activity at or after this time; paging stops once past it (incremental sync). */
  emailSince?: number,
): Promise<Ticket[]> {
  const seen = new Set<string>();
  const all: Ticket[] = [];
  let start: { id: string; lastEmailAt: number } | undefined;
  const recent = (t: DeskRow): boolean => emailSince === undefined || (t.lastEmailAt ?? 0) >= emailSince;
  for (;;) {
    const page = (await retry(() => client.supportTickets.list(channelId, { limit: PAGE_SIZE, start }))) as DeskRow[];
    const fresh = page.filter(t => !seen.has(t.id));
    for (const t of fresh) seen.add(t.id);
    all.push(...fresh.filter(recent));
    if (page.length < PAGE_SIZE || fresh.length === 0) return all;
    const last = page[page.length - 1];
    if (!recent(last)) return all;
    if (typeof last.lastEmailAt !== 'number') {
      onStuck();
      return all;
    }
    start = { id: last.id, lastEmailAt: last.lastEmailAt };
  }
}

export async function loadUserNames(client: Client, store: DataStore): Promise<void> {
  try {
    let offset = 0;
    for (;;) {
      const page = await retry(() => client.users.listBasic({ limit: 100, offset }));
      for (const u of page.items) store.lookups.users.set(u.id, u.displayName ?? u.name);
      if (!page.hasMore || page.items.length === 0 || page.nextOffset <= offset) return;
      offset = page.nextOffset;
    }
  } catch (e) {
    warn(store, 'users', `Couldn't load user names: ${errMsg(e)}`);
  }
}

/** Fill board and project names for tickets whose board/project wasn't in the boot lists. */
export async function hydrateLookups(client: Client, store: DataStore): Promise<void> {
  const { boards, projects } = store.lookups;
  const rows = [...store.tickets.values()];
  const boardIds = [...new Set(rows.map(t => t.boardId).filter(id => id && !boards.has(id)))];
  const projectIds = [...new Set(rows.map(t => t.projectId).filter(id => id && !projects.has(id)))];
  try {
    for (const part of chunk(boardIds, ID_BATCH))
      for (const b of await retry(() => client.boards.getMany(part))) boards.set(b.id, b.name);
    for (const part of chunk(projectIds, ID_BATCH))
      for (const p of await retry(() => client.projects.getMany(part))) projects.set(p.id, p.name);
  } catch (e) {
    warn(store, 'lookups', `Couldn't load some board or project names: ${errMsg(e)}`);
  }
}

function addLink(store: DataStore, link: Link): void {
  if (store.linkKeys.has(link.subTicketId)) return;
  store.linkKeys.add(link.subTicketId);
  store.links.push(link);
}

/** getMany the ids not yet in the store. Ids it doesn't return stay absent and render as "No access". */
async function fetchMissing(client: Client, store: DataStore, ids: string[]): Promise<void> {
  const missing = [...new Set(ids)].filter(id => !store.tickets.has(id));
  for (const part of chunk(missing, ID_BATCH)) {
    try {
      addTickets(store, await retry(() => client.tickets.getMany(part)));
    } catch (e) {
      warn(store, `tickets:${part[0]}`, `Couldn't load ${part.length} linked tickets: ${errMsg(e)}`);
    }
  }
}

/** Read sub-tickets of `seedIds`, load their mapped children, and repeat up to `depth` levels. */
export async function expandDown(client: Client, store: DataStore, seedIds: string[], depth = LINK_DEPTH): Promise<void> {
  let frontier = [...new Set(seedIds)].filter(id => !store.expanded.has(id));
  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    for (const id of frontier) store.expanded.add(id);
    const childIds: string[] = [];
    for (const ids of chunk(frontier, ID_BATCH)) {
      try {
        const mappings = await retry(() => client.tickets.listSubTicketMappings(ids));
        const subIds = [...new Set(mappings.map(m => m.subTicketId))];
        const subs = new Map<string, { id: string; title: string; mappedTicketId: string | null; createdAt?: number }>();
        for (const part of chunk(subIds, ID_BATCH))
          for (const s of await retry(() => client.tickets.getSubTickets(part))) subs.set(s.id, s);
        for (const m of mappings) {
          const sub = subs.get(m.subTicketId);
          if (!sub) continue;
          addLink(store, {
            parentId: m.ticketId,
            subTicketId: sub.id,
            childId: sub.mappedTicketId,
            subTitle: sub.title,
            subCreatedAt: sub.createdAt,
          });
          if (sub.mappedTicketId) childIds.push(sub.mappedTicketId);
        }
      } catch (e) {
        warn(store, `links:${ids[0]}`, `Couldn't load sub-tickets for ${ids.length} tickets: ${errMsg(e)}`);
      }
    }
    await fetchMissing(client, store, childIds);
    frontier = [...new Set(childIds)].filter(id => store.tickets.has(id) && !store.expanded.has(id));
  }
}

/**
 * Find parents of `ticketIds` (up to `depth` levels), then expand those parents downward so
 * siblings appear. One call per ticket, so only run it for the selected merchant.
 */
export async function expandUp(client: Client, store: DataStore, ticketIds: string[], depth = LINK_DEPTH): Promise<void> {
  const newParents: string[] = [];
  let frontier = [...new Set(ticketIds)].filter(id => !store.parentChecked.has(id));
  for (let level = 0; level < depth && frontier.length > 0; level += 1) {
    const knownParent = new Map<string, string>();
    for (const l of store.links) if (l.childId && store.tickets.has(l.parentId)) knownParent.set(l.childId, l.parentId);
    for (const id of frontier) store.parentChecked.add(id);

    const next: string[] = [];
    const lookup: string[] = [];
    for (const id of frontier) {
      const parent = knownParent.get(id);
      if (parent) next.push(parent);
      else lookup.push(id);
    }
    await mapLimit(lookup, PARENT_CONCURRENCY, async id => {
      try {
        const subs = (await retry(() => client.tickets.listSubTicketsByMapped(id))) as SubTicketWithMappings[];
        for (const sub of subs)
          for (const m of sub.ticketMappings ?? []) {
            addLink(store, { parentId: m.ticketId, subTicketId: sub.id, childId: id, subTitle: sub.title, subCreatedAt: sub.createdAt });
            next.push(m.ticketId);
          }
      } catch (e) {
        warn(store, `parent:${id}`, `Couldn't look up the parent of ${store.tickets.get(id)?.xyneId ?? id}: ${errMsg(e)}`);
      }
    });
    await fetchMissing(client, store, next);
    const found = [...new Set(next)].filter(id => store.tickets.has(id));
    newParents.push(...found);
    frontier = found.filter(id => !store.parentChecked.has(id));
  }
  await expandDown(client, store, newParents);
}

interface Booted {
  projects: { id: string; name: string }[];
  desks: { id: string; name: string }[];
  merchantIds: string[];
  inScope: Set<string>;
}

/** Workspace lookups, Desk channels, registry MIDs and merchant custom fields. Refreshes `store.lookups`. */
export async function boot(client: Client, store: DataStore): Promise<Booted> {
  const [me, projects, boards, channels, merchants, forms] = await Promise.all([
    retry(() => client.users.me()),
    retry(() => client.projects.list()),
    retry(() => client.boards.list()),
    retry(() => client.channels.listAll()),
    retry(() => client.workspace.listMerchants()),
    retry(() => client.forms.list()).catch((e: unknown) => {
      warn(store, 'forms', `Couldn't read custom fields, so only the built-in Merchant ID is used: ${errMsg(e)}`);
      return [];
    }),
  ]);
  store.merchantFields = discoverMerchantFields(forms as unknown as FormLike[], new Map(boards.map(b => [b.id, b.projectId])));
  store.lookups.workspaceId = me.workspaceId;
  store.lookups.meId = me.id;
  for (const p of projects) store.lookups.projects.set(p.id, p.name);
  for (const b of boards) store.lookups.boards.set(b.id, b.name);
  // Every Desk-type channel classifies tickets as Desk; only non-archived ones are crawled.
  const deskTyped = channels.filter(c => DESK_CHANNEL_TYPES.has(c.type));
  for (const c of deskTyped) store.lookups.deskChannels.set(c.id, c.name);
  // The server matches `merchantIds` exactly, so send each registry MID as stored and trimmed.
  const merchantIds = [
    ...new Set(merchants.flatMap(m => [m.mid, m.mid.trim()]).filter(mid => mid.trim() !== '')),
  ];
  if (merchantIds.length === 0) {
    warn(
      store,
      'merchants',
      'No merchants are registered in this workspace, so board tickets were skipped. Desk tickets are still shown.',
    );
  }
  return { projects, desks: deskTyped.filter(c => !c.isArchived), merchantIds, inScope: new Set(store.merchantFields.projectIds) };
}

/**
 * Board tickets: projects that can carry merchant custom fields are crawled whole with the fields
 * attached; the rest are MID-filtered, and only when there are MIDs to filter on.
 */
export async function crawlProjects(
  client: Client,
  store: DataStore,
  b: Booted,
  progress: LoadProgress,
  emit: () => void,
  createdSince?: number,
): Promise<void> {
  const crawled = b.projects.filter(p => b.inScope.has(p.id) || b.merchantIds.length > 0);
  progress.projectsTotal = crawled.length;
  await mapLimit(crawled, PROJECT_CONCURRENCY, async p => {
    try {
      const onTies = (): void =>
        warn(store, `project:${p.id}:ties`, `Some tickets in ${p.name} created at the same instant may be missing.`);
      const whole = b.inScope.has(p.id);
      const rows =
        whole && createdSince === undefined
          ? await loadProjectTicketsWindowed(client, p.id, store.merchantFields.fieldIds, onTies, createdWindows(Date.now()))
          : await retry(() =>
              loadProjectTickets(client, p.id, whole ? null : b.merchantIds, onTies, whole ? store.merchantFields.fieldIds : [], createdSince),
            );
      ingest(store, rows);
    } catch (e) {
      warn(store, `project:${p.id}`, `Couldn't load project ${p.name}: ${errMsg(e)}`);
    }
    progress.projectsDone += 1;
    emit();
  });
}

/** Desk tickets with a MID in the column, from every non-archived Desk channel. */
export async function crawlDesks(
  client: Client,
  store: DataStore,
  b: Booted,
  progress: LoadProgress,
  emit: () => void,
  emailSince?: number,
): Promise<void> {
  progress.desksTotal = b.desks.length;
  await mapLimit(b.desks, DESK_CONCURRENCY, async c => {
    try {
      const onStuck = (): void =>
        warn(store, `desk:${c.id}:cursor`, `Stopped paging Desk ${c.name} early; some older tickets may be missing.`);
      ingest(store, await loadDeskTickets(client, c.id, onStuck, emailSince));
    } catch (e) {
      warn(store, `desk:${c.id}`, `Couldn't load Desk ${c.name}: ${errMsg(e)}`);
    }
    progress.desksDone += 1;
    emit();
  });
}

export async function loadAll(client: Client, onUpdate: OnUpdate): Promise<DataStore> {
  const store = emptyStore();
  const progress: LoadProgress = { phase: 'boot', projectsDone: 0, projectsTotal: 0, desksDone: 0, desksTotal: 0 };
  const emit = (): void => onUpdate(store, { ...progress });
  emit();

  const b = await boot(client, store);
  progress.phase = 'tickets';
  emit();
  await Promise.all([crawlProjects(client, store, b, progress, emit), crawlDesks(client, store, b, progress, emit), loadUserNames(client, store)]);

  progress.phase = 'linking';
  emit();
  await expandDown(client, store, [...store.tickets.keys()]);
  await hydrateLookups(client, store);

  progress.phase = 'done';
  emit();
  return store;
}
