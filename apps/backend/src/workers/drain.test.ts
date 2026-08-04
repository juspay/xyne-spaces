jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { drainRole } from './drain';

/**
 * Shutdown behaviour test — one case per in-scope Bull/Redis worker role
 * (XYNE-55093). Every role's stop()/close() on SIGTERM now flows through
 * drainRole(), so proving drainRole's contract proves the per-role guarantees:
 *
 *   1. a role that drains within budget resolves 'drained' (in-flight finished)
 *   2. a role whose close() hangs is bounded to 'timeout' (never blocks forever
 *      — Bull v3 close() has no native timeout, so this is the only guard)
 *   3. a role whose stop() throws is isolated as 'error' and does NOT abort the
 *      shutdown of the roles queued after it
 */
describe('drainRole — per-role graceful shutdown contract', () => {
  const ROLES = [
    'entity-extraction',
    'stitch',
    'automation',
    'automation-schedule',
    'docling',
  ] as const;

  it.each(ROLES)('drains %s when its stop resolves within budget', async (role) => {
    const stop = jest.fn().mockResolvedValue(undefined);
    const outcome = await drainRole(role, stop, 1_000);
    expect(outcome).toBe('drained');
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it.each(ROLES)('bounds %s to a timeout when its close() hangs', async (role) => {
    // Simulate a stuck in-flight job: stop() never resolves.
    const stop = jest.fn().mockReturnValue(new Promise<void>(() => {}));
    const startedAt = Date.now();
    const outcome = await drainRole(role, stop, 50);
    expect(outcome).toBe('timeout');
    // Returned at (not long) after the budget, not hanging indefinitely.
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('isolates a throwing role and never rejects (siblings still drain)', async () => {
    const throwing = jest.fn().mockRejectedValue(new Error('close failed'));
    const sibling = jest.fn().mockResolvedValue(undefined);

    // Mirror worker.ts: roles are drained sequentially; a failure in one must
    // not prevent the next from being drained.
    const first = await drainRole('automation', throwing, 1_000);
    const second = await drainRole('automation-schedule', sibling, 1_000);

    expect(first).toBe('error');
    expect(second).toBe('drained');
    expect(sibling).toHaveBeenCalledTimes(1);
  });

  it('is safe to call a role stop twice (idempotent stop paths)', async () => {
    let calls = 0;
    const stop = jest.fn().mockImplementation(async () => {
      // Real stop()/close() implementations short-circuit on the second call.
      calls += 1;
    });
    expect(await drainRole('entity-extraction', stop, 1_000)).toBe('drained');
    expect(await drainRole('entity-extraction', stop, 1_000)).toBe('drained');
    expect(calls).toBe(2);
  });
});
