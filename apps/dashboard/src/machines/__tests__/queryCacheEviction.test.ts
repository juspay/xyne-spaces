import { describe, expect, it, vi } from 'vitest';

vi.useFakeTimers({ now: 0 });

const { queryCacheActor, retainCacheKey } = await import('@xyne/shared/machines');

const MINUTE = 60 * 1000;

const cache = (): Map<string, unknown> => queryCacheActor.getSnapshot().context.cache;

const setKey = (hash: string, rows: unknown[]): void => {
  queryCacheActor.send({ type: 'SET_KEY', hash, data: [rows, { type: 'complete' }] });
};

const seed = (bigKey: string): void => {
  queryCacheActor.send({ type: 'HYDRATE_CACHE', cacheData: {} });
  for (let i = 0; i < 300; i++) {
    setKey(`small-${i}`, [{ id: i }]);
  }
  setKey(
    bigKey,
    Array.from({ length: 1000 }, (_, i) => ({ id: `user-${i}`, name: `User ${i}` })),
  );
};

describe('query cache eviction', () => {
  it('evicts the largest idle entry once the cache is over its limit', () => {
    seed('users-unretained');

    vi.advanceTimersByTime(65 * MINUTE);

    expect(cache().has('users-unretained')).toBe(false);
    expect(cache().size).toBe(300);
  });

  it('never evicts a retained entry, and evicts it once released', () => {
    seed('users-retained');
    const release = retainCacheKey('users-retained');

    vi.advanceTimersByTime(120 * MINUTE);

    expect(cache().has('users-retained')).toBe(true);
    expect(cache().size).toBe(300);

    setKey('small-extra', [{ id: 'extra' }]);
    release();
    vi.advanceTimersByTime(65 * MINUTE);

    expect(cache().has('users-retained')).toBe(false);
  });

  it('keeps a key retained until every holder releases it', () => {
    seed('users-shared');
    const releaseFirst = retainCacheKey('users-shared');
    const releaseSecond = retainCacheKey('users-shared');

    releaseFirst();
    vi.advanceTimersByTime(65 * MINUTE);
    expect(cache().has('users-shared')).toBe(true);

    setKey('small-extra-2', [{ id: 'extra-2' }]);
    releaseSecond();
    vi.advanceTimersByTime(65 * MINUTE);
    expect(cache().has('users-shared')).toBe(false);
  });
});
