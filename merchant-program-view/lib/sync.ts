import { chunk, mapLimit } from './async';
import { ID_BATCH, PARENT_CONCURRENCY, PROJECT_CONCURRENCY } from './config';
import {
  boot,
  crawlDesks,
  crawlProjects,
  errMsg,
  expandDown,
  hydrateLookups,
  loadUserNames,
  retry,
  warn,
  type Client,
  type DataStore,
  type OnUpdate,
} from './load';
import { resolveMids, type TicketWithFields } from './merchantFields';
import type { LoadProgress } from './types';

const ACTIVITY_PAGE = 100;

/** Cached ticket ids with any activity at or after `since` (activity feed is newest first). */
async function changedSince(client: Client, ids: string[], since: number): Promise<string[]> {
  const changed = new Set<string>();
  await mapLimit(chunk(ids, ID_BATCH), PROJECT_CONCURRENCY, async batch => {
    let start: { timestamp: number; id: string } | undefined;
    for (;;) {
      const page = await retry(() => client.tickets.listActivitiesForTickets({ ticketIds: batch, limit: ACTIVITY_PAGE, start }));
      for (const a of page) if (a.timestamp >= since) changed.add(a.ticketId);
      const last = page[page.length - 1];
      if (page.length < ACTIVITY_PAGE || !last || last.timestamp < since) return;
      start = { timestamp: last.timestamp, id: last.id };
    }
  });
  return [...changed];
}

/** Re-read changed tickets, and their merchant custom fields where their project can carry them. */
async function refreshTickets(client: Client, store: DataStore, ids: string[]): Promise<void> {
  const inScope = new Set(store.merchantFields.projectIds);
  const fieldIds = new Set(store.merchantFields.fieldIds);
  const fresh: TicketWithFields[] = [];
  for (const part of chunk(ids, ID_BATCH)) fresh.push(...(await retry(() => client.tickets.getMany(part))));
  await mapLimit(fresh, PARENT_CONCURRENCY, async t => {
    if (inScope.has(t.projectId) && fieldIds.size > 0) {
      t.formEntityValues = await retry(() => client.forms.listValues(t.id));
    }
    const mids = resolveMids(t, fieldIds);
    const { formEntityValues: _values, ...ticket } = t;
    store.tickets.set(ticket.id, ticket);
    if (mids.length > 0) store.mids.set(ticket.id, mids);
    else store.mids.delete(ticket.id);
  });
}

/**
 * Bring a cached store up to date with changes since `since`: tickets created since then, Desk rows
 * with new email, and cached tickets with activity since then. Links are re-read for all of those.
 * Cannot see older tickets that newly gain a MID, deletions or access changes — a full load does.
 */
export interface SyncResult {
  /** New tickets carrying a MID. */
  added: number;
  /** Cached tickets re-read because they changed. */
  updated: number;
}

export async function syncStore(client: Client, store: DataStore, since: number, onUpdate: OnUpdate): Promise<SyncResult> {
  store.warnings = [];
  const progress: LoadProgress = { phase: 'boot', projectsDone: 0, projectsTotal: 0, desksDone: 0, desksTotal: 0 };
  const emit = (): void => onUpdate(store, { ...progress });
  emit();

  const cachedIds = [...store.tickets.keys()];
  const b = await boot(client, store);
  progress.phase = 'tickets';
  emit();
  const [changed] = await Promise.all([
    changedSince(client, cachedIds, since).catch((e: unknown) => {
      warn(store, 'activity', `Couldn't check cached tickets for changes: ${errMsg(e)}`);
      return [] as string[];
    }),
    crawlProjects(client, store, b, progress, emit, since),
    crawlDesks(client, store, b, progress, emit, since),
    loadUserNames(client, store),
  ]);
  try {
    await refreshTickets(client, store, changed);
  } catch (e) {
    warn(store, 'refresh', `Couldn't refresh ${changed.length} changed tickets: ${errMsg(e)}`);
  }

  progress.phase = 'linking';
  emit();
  const cached = new Set(cachedIds);
  const touched = [...new Set([...changed, ...[...store.tickets.keys()].filter(id => !cached.has(id))])];
  for (const id of touched) store.expanded.delete(id);
  await expandDown(client, store, touched);
  await hydrateLookups(client, store);

  progress.phase = 'done';
  emit();
  return { added: touched.filter(id => !cached.has(id) && store.mids.has(id)).length, updated: changed.length };
}
