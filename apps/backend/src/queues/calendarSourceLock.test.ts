// Mock every module the unit under test pulls in, so this suite stays hermetic:
// the real calendarSyncConfig reaches Superposition and the real logger loads
// config/env, neither of which a unit test should need.
jest.mock('@/services/calendarSyncConfig', () => ({
  CALENDAR_SOURCE_LOCK_TTL_SECONDS: 300,
  CALENDAR_SOURCE_LOCK_WAIT_MS: 30_000,
}));

jest.mock('@/utils/distributedLock', () => ({
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
}));

jest.mock('@/utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import {
  CalendarSourceBusyError,
  calendarSourceLockKey,
  withCalendarSourceLock,
} from './calendarSourceLock';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import {
  CALENDAR_SOURCE_LOCK_TTL_SECONDS,
  CALENDAR_SOURCE_LOCK_WAIT_MS,
} from '@/services/calendarSyncConfig';

const mockAcquire = acquireLock as jest.MockedFunction<typeof acquireLock>;
const mockRelease = releaseLock as jest.MockedFunction<typeof releaseLock>;

const HANDLE = { key: 'k', token: 't' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('calendarSourceLockKey', () => {
  it('namespaces by provider so the two queues never share a lock', () => {
    expect(calendarSourceLockKey('google', 'src-1')).toBe('lock:calendar-sync:google:src-1');
    expect(calendarSourceLockKey('microsoft', 'src-1')).toBe('lock:calendar-sync:microsoft:src-1');
    expect(calendarSourceLockKey('google', 'src-1')).not.toBe(
      calendarSourceLockKey('microsoft', 'src-1')
    );
  });
});

describe('withCalendarSourceLock', () => {
  it('runs the work and releases the lock', async () => {
    mockAcquire.mockResolvedValue(HANDLE);
    const fn = jest.fn().mockResolvedValue('done');

    await expect(withCalendarSourceLock('google', 'src-1', fn)).resolves.toBe('done');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledWith(HANDLE);
  });

  it('acquires with the configured TTL and wait window', async () => {
    mockAcquire.mockResolvedValue(HANDLE);

    await withCalendarSourceLock('microsoft', 'src-9', async () => undefined);

    expect(mockAcquire).toHaveBeenCalledWith('lock:calendar-sync:microsoft:src-9', {
      ttlSeconds: CALENDAR_SOURCE_LOCK_TTL_SECONDS,
      waitTimeoutMs: CALENDAR_SOURCE_LOCK_WAIT_MS,
    });
  });

  it('throws CalendarSourceBusyError without running the work when the source is busy', async () => {
    mockAcquire.mockResolvedValue(null);
    const fn = jest.fn();

    await expect(withCalendarSourceLock('google', 'src-2', fn)).rejects.toBeInstanceOf(
      CalendarSourceBusyError
    );

    expect(fn).not.toHaveBeenCalled();
    // Nothing was held, so nothing may be released — releasing here would delete
    // the lock belonging to the job that IS syncing this source.
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('releases the lock when the work throws, so a failure cannot wedge the source', async () => {
    mockAcquire.mockResolvedValue(HANDLE);
    const boom = new Error('sync exploded');

    await expect(
      withCalendarSourceLock('google', 'src-3', () => Promise.reject(boom))
    ).rejects.toBe(boom);

    expect(mockRelease).toHaveBeenCalledWith(HANDLE);
  });

  it('never runs two jobs for the same source at once', async () => {
    // Model the real lock: while one holder has it, acquire returns null.
    let held = false;
    mockAcquire.mockImplementation(async () => (held ? null : ((held = true), HANDLE)));
    mockRelease.mockImplementation(async () => {
      held = false;
    });

    const order: string[] = [];
    const first = withCalendarSourceLock('google', 'same', async () => {
      order.push('first:start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('first:end');
    });

    // Enters while the first still holds the lock. Assert on it immediately —
    // it rejects before the first settles, and an unattached rejection would
    // surface as an unhandled promise rejection rather than a test failure.
    const second = expect(
      withCalendarSourceLock('google', 'same', async () => {
        order.push('second:start');
      })
    ).rejects.toBeInstanceOf(CalendarSourceBusyError);

    await Promise.all([first, second]);

    // The second body never ran, so the first was never interleaved with it.
    expect(order).toEqual(['first:start', 'first:end']);
  });

  it('allows different sources to run concurrently', async () => {
    const heldKeys = new Set<string>();
    mockAcquire.mockImplementation(async (key: string) => {
      if (heldKeys.has(key)) return null;
      heldKeys.add(key);
      return { key, token: 't' };
    });
    mockRelease.mockImplementation(async (handle) => {
      if (handle) heldKeys.delete(handle.key);
    });

    let running = 0;
    let peak = 0;
    const work = async () => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    };

    await Promise.all([
      withCalendarSourceLock('google', 'a', work),
      withCalendarSourceLock('google', 'b', work),
      withCalendarSourceLock('google', 'c', work),
    ]);

    expect(peak).toBe(3);
  });
});
