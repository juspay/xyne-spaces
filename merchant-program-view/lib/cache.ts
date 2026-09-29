import { mapLimit } from './async';
import { emptyStore, type DataStore } from './load';
import type { Ticket } from './types';

/**
 * Per-user snapshot of the loaded data in app storage.
 *
 * Tickets are ACL-filtered per viewer, so the cache is ALWAYS user-scoped — never 'global'.
 * The snapshot is JSON, split into chunks that each serialise under the 64 KB record limit,
 * written under a fresh generation prefix; `meta` is written last so a reader never sees a
 * half-written generation, and the previous generation is deleted afterwards.
 */

export const CACHE_VERSION = 2;
export const CACHE_COLLECTION = 'mpv-cache-v1';
const MAX_RECORD_BYTES = 60_000;
const WRITE_CONCURRENCY = 4;
const GET_BATCH = 50;

/** The storage operations the cache needs; `userKV` adapts a storage collection. */
export interface KV {
  get(key: string): Promise<unknown | null>;
  getMany(keys: string[]): Promise<Map<string, unknown>>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface CollectionLike {
  get(key: string, options?: { scope?: 'user' }): Promise<{ value: unknown } | null>;
  getMany(keys: string[], options?: { scope?: 'user' }): Promise<Array<{ key: string; value: unknown }>>;
  put(key: string, value: unknown, options?: { scope?: 'user' }): Promise<unknown>;
  remove(key: string, options?: { scope?: 'user' }): Promise<unknown>;
}

/** Wrap a storage collection so every read and write is private to the viewer. */
export function userKV(collection: CollectionLike): KV {
  const scope = { scope: 'user' as const };
  return {
    get: async key => (await collection.get(key, scope))?.value ?? null,
    getMany: async keys => new Map((await collection.getMany(keys, scope)).map(r => [r.key, r.value])),
    put: async (key, value) => {
      await collection.put(key, value, scope);
    },
    delete: async key => {
      await collection.remove(key, scope);
    },
  };
}

export interface CacheMeta {
  version: number;
  workspaceId: string;
  generation: string;
  chunks: number;
  /** When the last full reload finished (epoch ms). */
  lastFullAt: number;
  /** Start time of the last successful load or sync (epoch ms). */
  lastSyncAt: number;
  savedAt: number;
}

interface Snapshot {
  tickets: Ticket[];
  mids: [string, string[]][];
  links: DataStore['links'];
  linkKeys: string[];
  expanded: string[];
  parentChecked: string[];
  lookups: {
    workspaceId: string;
    meId: string;
    deskChannels: [string, string][];
    projects: [string, string][];
    boards: [string, string][];
    users: [string, string][];
  };
  merchantFields: DataStore['merchantFields'];
}

/** Only the ticket fields the app reads; keeps the cache small. */
const TICKET_FIELDS = [
  'id', 'xyneId', 'title', 'statusV2', 'stageName', 'boardId', 'projectId', 'channelId',
  'merchantId', 'assignedTo', 'createdAt', 'updatedAt', 'closedAt', 'statusUpdatedAt', 'priority',
  'conversationId', 'eta', 'createdBy',
  // Runtime-only fields (not in the SDK Ticket type).
  'lastEmailAt', 'firstRespondedAt', 'aiCategory', 'isStageOverdue',
] as const;

function slimTicket(t: Ticket): Ticket {
  const src = t as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of TICKET_FIELDS) if (src[k] !== undefined) out[k] = src[k];
  return out as unknown as Ticket;
}

function toSnapshot(store: DataStore): Snapshot {
  const l = store.lookups;
  return {
    tickets: [...store.tickets.values()].map(slimTicket),
    mids: [...store.mids],
    links: store.links,
    linkKeys: [...store.linkKeys],
    expanded: [...store.expanded],
    parentChecked: [...store.parentChecked],
    lookups: {
      workspaceId: l.workspaceId,
      meId: l.meId,
      deskChannels: [...l.deskChannels],
      projects: [...l.projects],
      boards: [...l.boards],
      users: [...l.users],
    },
    merchantFields: store.merchantFields,
  };
}

function fromSnapshot(s: Snapshot): DataStore {
  const store = emptyStore();
  for (const t of s.tickets) store.tickets.set(t.id, t);
  store.mids = new Map(s.mids);
  store.links = s.links;
  store.linkKeys = new Set(s.linkKeys);
  store.expanded = new Set(s.expanded);
  store.parentChecked = new Set(s.parentChecked);
  store.lookups = {
    workspaceId: s.lookups.workspaceId,
    meId: s.lookups.meId ?? '',
    deskChannels: new Map(s.lookups.deskChannels),
    projects: new Map(s.lookups.projects),
    boards: new Map(s.lookups.boards),
    users: new Map(s.lookups.users),
  };
  store.merchantFields = s.merchantFields;
  return store;
}

const encoder = new TextEncoder();
const serialisedBytes = (s: string): number => encoder.encode(JSON.stringify(s)).length;

/** Split `text` into pieces whose JSON serialisation stays within `maxBytes`. */
export function chunkText(text: string, maxBytes: number = MAX_RECORD_BYTES): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    let size = Math.min(text.length - i, maxBytes);
    while (size > 1 && serialisedBytes(text.slice(i, i + size)) > maxBytes) size = Math.floor(size * 0.8);
    // Never split a surrogate pair.
    const last = text.charCodeAt(i + size - 1);
    if (size > 1 && i + size < text.length && last >= 0xd800 && last <= 0xdbff) size -= 1;
    parts.push(text.slice(i, i + size));
    i += size;
  }
  return parts;
}

const chunkKey = (generation: string, i: number): string => `${generation}-${String(i).padStart(4, '0')}`;

export async function saveCache(
  kv: KV,
  store: DataStore,
  times: { lastFullAt: number; lastSyncAt: number },
): Promise<CacheMeta> {
  const previous = (await kv.get('meta')) as CacheMeta | null;
  const generation = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const parts = chunkText(JSON.stringify(toSnapshot(store)));
  await mapLimit(parts, WRITE_CONCURRENCY, (part, i) => kv.put(chunkKey(generation, i), part));
  const meta: CacheMeta = {
    version: CACHE_VERSION,
    workspaceId: store.lookups.workspaceId,
    generation,
    chunks: parts.length,
    lastFullAt: times.lastFullAt,
    lastSyncAt: times.lastSyncAt,
    savedAt: Date.now(),
  };
  await kv.put('meta', meta);
  if (previous?.generation && previous.generation !== generation) {
    const stale = Array.from({ length: previous.chunks ?? 0 }, (_, i) => chunkKey(previous.generation, i));
    await mapLimit(stale, WRITE_CONCURRENCY, key => kv.delete(key).catch(() => undefined));
  }
  return meta;
}

/** The cached store for this workspace, or null if there is none usable. */
export async function loadCache(kv: KV, workspaceId: string): Promise<{ store: DataStore; meta: CacheMeta } | null> {
  const meta = (await kv.get('meta')) as CacheMeta | null;
  if (!meta || meta.version !== CACHE_VERSION || meta.workspaceId !== workspaceId || !meta.generation) return null;
  const keys = Array.from({ length: meta.chunks }, (_, i) => chunkKey(meta.generation, i));
  const found = new Map<string, unknown>();
  for (let i = 0; i < keys.length; i += GET_BATCH) {
    for (const [k, v] of await kv.getMany(keys.slice(i, i + GET_BATCH))) found.set(k, v);
  }
  if (keys.some(k => typeof found.get(k) !== 'string')) return null;
  try {
    const snapshot = JSON.parse(keys.map(k => found.get(k) as string).join('')) as Snapshot;
    return { store: fromSnapshot(snapshot), meta };
  } catch {
    return null;
  }
}
