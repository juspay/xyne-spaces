import { describe, expect, it } from 'vitest';
import { CACHE_VERSION, chunkText, loadCache, saveCache, type KV } from '../lib/cache';
import { emptyStore, type DataStore } from '../lib/load';
import { ticket } from './fixtures';

function memoryKV(): KV & { data: Map<string, unknown>; log: string[] } {
  const data = new Map<string, unknown>();
  const log: string[] = [];
  return {
    data,
    log,
    get: async key => (data.has(key) ? data.get(key)! : null),
    getMany: async keys => new Map(keys.filter(k => data.has(k)).map(k => [k, data.get(k)!])),
    put: async (key, value) => {
      if (JSON.stringify(value).length > 64 * 1024) throw new Error(`value for ${key} exceeds 64 KB`);
      log.push(`put ${key}`);
      data.set(key, value);
    },
    delete: async key => {
      log.push(`delete ${key}`);
      data.delete(key);
    },
  };
}

function sampleStore(n: number): DataStore {
  const store = emptyStore();
  store.lookups.workspaceId = 'w1';
  store.lookups.meId = 'me-1';
  store.lookups.projects.set('p1', 'Euler');
  store.lookups.boards.set('b1', 'Issue');
  store.lookups.deskChannels.set('c-desk', 'Support Email');
  store.lookups.users.set('u9', 'Asha');
  for (let i = 0; i < n; i++) {
    const t = {
      ...ticket(`t${i}`, { merchantId: 'acme', title: `Ticket "${i}" with quotes \\ and slashes`, closedAt: 77, priority: 'HIGH', conversationId: 'conv', eta: 88, createdBy: 'u9' }),
      description: 'x'.repeat(500),
      lastEmailAt: 55,
      firstRespondedAt: 44,
      aiCategory: 'Refunds',
      isStageOverdue: true,
    };
    store.tickets.set(t.id, t);
    store.mids.set(t.id, ['acme', `m${i % 7}`]);
  }
  store.links.push({ parentId: 't0', subTicketId: 's1', childId: 't1', subTitle: 'Escalate' });
  store.linkKeys.add('s1');
  store.expanded.add('t0');
  store.parentChecked.add('t1');
  store.merchantFields = { fieldIds: ['g-mid'], projectIds: ['p1'] };
  return store;
}

describe('chunkText', () => {
  it('splits so every piece serialises under the limit and rejoins exactly', () => {
    const text = JSON.stringify({ s: '"\\'.repeat(30_000) + 'tail' });
    const parts = chunkText(text, 10_000);
    expect(parts.join('')).toBe(text);
    for (const p of parts) expect(JSON.stringify(p).length).toBeLessThanOrEqual(10_000);
  });
});

describe('saveCache / loadCache', () => {
  it('round-trips the store through ≤64 KB user records, writing meta last', async () => {
    const kv = memoryKV();
    const store = sampleStore(600);
    await saveCache(kv, store, { lastFullAt: 1000, lastSyncAt: 2000 });
    expect(kv.log.at(-1)).toBe('put meta');
    expect(kv.log.filter(l => l.startsWith('put ') && l !== 'put meta').length).toBeGreaterThan(1);

    const loaded = await loadCache(kv, 'w1');
    expect(loaded).not.toBeNull();
    const { store: s, meta } = loaded!;
    expect(meta).toMatchObject({ version: CACHE_VERSION, workspaceId: 'w1', lastFullAt: 1000, lastSyncAt: 2000 });
    expect(s.tickets.size).toBe(600);
    expect(s.tickets.get('t5')!.title).toBe('Ticket "5" with quotes \\ and slashes');
    expect((s.tickets.get('t5') as unknown as { description?: string }).description).toBeUndefined();
    expect(s.tickets.get('t5')).toMatchObject({ closedAt: 77, priority: 'HIGH', conversationId: 'conv', lastEmailAt: 55, firstRespondedAt: 44, aiCategory: 'Refunds', eta: 88, createdBy: 'u9', isStageOverdue: true });
    expect(s.lookups.meId).toBe('me-1');
    expect(s.mids.get('t5')).toEqual(['acme', 'm5']);
    expect(s.links).toEqual(store.links);
    expect([...s.linkKeys]).toEqual(['s1']);
    expect([...s.expanded]).toEqual(['t0']);
    expect([...s.parentChecked]).toEqual(['t1']);
    expect(s.lookups.users.get('u9')).toBe('Asha');
    expect(s.lookups.deskChannels.get('c-desk')).toBe('Support Email');
    expect(s.merchantFields).toEqual({ fieldIds: ['g-mid'], projectIds: ['p1'] });
  });

  it('ignores a cache from another workspace or version, or with a missing chunk', async () => {
    const kv = memoryKV();
    await saveCache(kv, sampleStore(50), { lastFullAt: 1, lastSyncAt: 1 });
    expect(await loadCache(kv, 'other-workspace')).toBeNull();

    const meta = kv.data.get('meta') as Record<string, unknown>;
    kv.data.set('meta', { ...meta, version: CACHE_VERSION + 1 });
    expect(await loadCache(kv, 'w1')).toBeNull();

    kv.data.set('meta', meta);
    const chunkKey = [...kv.data.keys()].find(k => k !== 'meta')!;
    kv.data.delete(chunkKey);
    expect(await loadCache(kv, 'w1')).toBeNull();
  });

  it('removes the previous generation after saving a new one', async () => {
    const kv = memoryKV();
    await saveCache(kv, sampleStore(50), { lastFullAt: 1, lastSyncAt: 1 });
    const first = [...kv.data.keys()].filter(k => k !== 'meta');
    await saveCache(kv, sampleStore(50), { lastFullAt: 1, lastSyncAt: 2 });
    const second = [...kv.data.keys()].filter(k => k !== 'meta');
    expect(second.some(k => first.includes(k))).toBe(false);
    expect((await loadCache(kv, 'w1'))!.meta.lastSyncAt).toBe(2);
  });

  it('returns null when nothing is cached', async () => {
    expect(await loadCache(memoryKV(), 'w1')).toBeNull();
  });
});
