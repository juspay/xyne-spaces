import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { User } from '@/src/machines/appStateMachine';
import {
  areQueryTypesCompleted,
  canUseReturningSessionFastPath,
  computeChannelsWatermark,
  computeUsersWatermark,
  filterAllChannelsForWorkspace,
  filterUsersForWorkspace,
  filterVisibleChannelRowsForWorkspace,
  takeLatestVisibleChannelStatusRows,
  getRetryDelay,
  getStartupLabel,
  getStartupReadinessProgress,
  isNotificationColdLaunch,
  resolveNotificationProcessAgeMs,
  persistedContextMatchesSession,
  shouldDeferReturningStartupRefresh,
  type AllChannelRow,
  type StartupReadiness,
} from '@/src/providers/initialStateLoaderUtils';

const user = (id: string, workspaceId: string, updatedAt?: number): User =>
  ({ id, workspaceId, updatedAt }) as unknown as User;

const channelRow = (workspaceId: string | null, updatedAt?: number): AllChannelRow =>
  ({ workspaceId, updatedAt }) as unknown as AllChannelRow;

const readiness = (over: Partial<StartupReadiness> = {}): StartupReadiness => ({
  hasRequiredStartupContext: false,
  hasSplashHidden: false,
  isChannelsStartupReady: false,
  isProtectedStartupReady: false,
  isUserStartupReady: false,
  isVisibleChannelsStartupReady: false,
  ...over,
});

describe('areQueryTypesCompleted', () => {
  it('is true only when every type is complete', () => {
    assert.equal(areQueryTypesCompleted(['complete', 'complete']), true);
    assert.equal(areQueryTypesCompleted(['complete', 'unknown']), false);
    assert.equal(areQueryTypesCompleted(['error']), false);
  });

  it('is true for an empty list', () => {
    assert.equal(areQueryTypesCompleted([]), true);
  });
});

describe('watermarks', () => {
  it('computes the max user updatedAt, treating missing as 0', () => {
    assert.equal(computeUsersWatermark([user('a', 'w', 5), user('b', 'w'), user('c', 'w', 9)]), 9);
    assert.equal(computeUsersWatermark([]), 0);
  });

  it('computes the max channel updatedAt', () => {
    assert.equal(computeChannelsWatermark([channelRow('w', 3), channelRow('w', 7)]), 7);
    assert.equal(computeChannelsWatermark([]), 0);
  });
});

describe('workspace filters', () => {
  it('keeps only users in the workspace', () => {
    const rows = [user('a', 'w1'), user('b', 'w2')];
    assert.deepEqual(
      filterUsersForWorkspace(rows, 'w1').map(u => u.id),
      ['a'],
    );
  });

  it('returns [] for users when workspace or rows are missing', () => {
    assert.deepEqual(filterUsersForWorkspace(undefined, 'w1'), []);
    assert.deepEqual(filterUsersForWorkspace([user('a', 'w1')], null), []);
  });

  it('keeps only channels matching the workspace', () => {
    const rows = [channelRow('w1'), channelRow('w2'), channelRow(null)];
    assert.equal(filterAllChannelsForWorkspace(rows, 'w1').length, 1);
  });

  it('passes undefined visible rows through and empties them when workspace is falsy', () => {
    assert.equal(filterVisibleChannelRowsForWorkspace(undefined, 'w1'), undefined);
    const rows = [{ channel: { workspaceId: 'w1' } }] as unknown as Parameters<
      typeof filterVisibleChannelRowsForWorkspace
    >[0];
    assert.deepEqual(filterVisibleChannelRowsForWorkspace(rows, null), []);
    assert.equal(filterVisibleChannelRowsForWorkspace(rows, 'w1')?.length, 1);
  });
});

describe('takeLatestVisibleChannelStatusRows', () => {
  it('drops a status row that is absent from the latest full snapshot', () => {
    const cached = [
      { channelId: 'open', isClosed: false },
      { channelId: 'left', isClosed: false },
    ];
    const liveFullSet = [{ channelId: 'open', isClosed: false }];

    const mergedById = new Map(cached.map(row => [row.channelId, row]));
    for (const row of liveFullSet) {
      mergedById.set(row.channelId, row);
    }
    assert.deepEqual([...mergedById.keys()].sort(), ['left', 'open']);

    assert.deepEqual(
      takeLatestVisibleChannelStatusRows(liveFullSet).map(row => row.channelId),
      ['open'],
    );
  });

  it('returns [] when the latest snapshot is missing', () => {
    assert.deepEqual(takeLatestVisibleChannelStatusRows(undefined), []);
  });
});

describe('getStartupReadinessProgress', () => {
  it('is 1 when protected startup is ready', () => {
    assert.equal(getStartupReadinessProgress(readiness({ isProtectedStartupReady: true })), 1);
  });

  it('is the fraction of satisfied gates otherwise', () => {
    assert.equal(getStartupReadinessProgress(readiness()), 0);
    assert.equal(
      getStartupReadinessProgress(
        readiness({ hasSplashHidden: true, hasRequiredStartupContext: true }),
      ),
      2 / 5,
    );
  });
});

describe('getStartupLabel', () => {
  it('returns the earliest unsatisfied stage label', () => {
    assert.equal(getStartupLabel(readiness()), 'Starting your workspace');
    assert.equal(getStartupLabel(readiness({ hasSplashHidden: true })), 'Preparing your workspace');
    assert.equal(
      getStartupLabel(readiness({ hasSplashHidden: true, hasRequiredStartupContext: true })),
      'Setting up your workspace',
    );
    assert.equal(
      getStartupLabel(
        readiness({
          hasSplashHidden: true,
          hasRequiredStartupContext: true,
          isUserStartupReady: true,
        }),
      ),
      'Loading channels',
    );
    assert.equal(
      getStartupLabel(
        readiness({
          hasSplashHidden: true,
          hasRequiredStartupContext: true,
          isUserStartupReady: true,
          isChannelsStartupReady: true,
          isVisibleChannelsStartupReady: true,
        }),
      ),
      'Opening your workspace',
    );
  });
});

describe('persistedContextMatchesSession', () => {
  const ctx = { userId: 'u1', schemaVersion: 'v1', workspaceId: 'w1' };

  it('is true when all fields match', () => {
    assert.equal(persistedContextMatchesSession(ctx, 'u1', 'v1', 'w1'), true);
  });

  it('is false when any field differs', () => {
    assert.equal(persistedContextMatchesSession(ctx, 'u2', 'v1', 'w1'), false);
    assert.equal(persistedContextMatchesSession(ctx, 'u1', 'v2', 'w1'), false);
    assert.equal(persistedContextMatchesSession(ctx, 'u1', 'v1', 'w2'), false);
  });
});

describe('canUseReturningSessionFastPath', () => {
  it('requires persisted context and not a workspace switch', () => {
    assert.equal(canUseReturningSessionFastPath(true, false), true);
    assert.equal(canUseReturningSessionFastPath(true, true), false);
    assert.equal(canUseReturningSessionFastPath(false, false), false);
  });
});

describe('shouldDeferReturningStartupRefresh', () => {
  it('defers only a returning session that is not a workspace switch or notification launch', () => {
    assert.equal(
      shouldDeferReturningStartupRefresh({
        canUseReturningSessionFastPath: true,
        isWorkspaceSwitchStartup: false,
        isNotificationLaunch: false,
      }),
      true,
    );
    assert.equal(
      shouldDeferReturningStartupRefresh({
        canUseReturningSessionFastPath: true,
        isWorkspaceSwitchStartup: false,
        isNotificationLaunch: true,
      }),
      false,
    );
    assert.equal(
      shouldDeferReturningStartupRefresh({
        canUseReturningSessionFastPath: true,
        isWorkspaceSwitchStartup: true,
        isNotificationLaunch: false,
      }),
      false,
    );
  });
});

describe('resolveNotificationProcessAgeMs', () => {
  it('returns null when process uptime is missing instead of age 0', () => {
    assert.equal(resolveNotificationProcessAgeMs(50_000, undefined), null);
    assert.equal(resolveNotificationProcessAgeMs(Number.NaN, 1_000), null);
  });

  it('returns a non-negative age when process uptime is known', () => {
    assert.equal(resolveNotificationProcessAgeMs(21_000, 1_000), 20_000);
    assert.equal(resolveNotificationProcessAgeMs(500, 1_000), 0);
  });
});

describe('isNotificationColdLaunch', () => {
  it('is true only for a notification launch still inside the cold window', () => {
    assert.equal(
      isNotificationColdLaunch({ launchCause: 'notification', processAgeMs: 1_000 }),
      true,
    );
    assert.equal(
      isNotificationColdLaunch({ launchCause: 'notification', processAgeMs: 21_000 }),
      false,
    );
    assert.equal(isNotificationColdLaunch({ launchCause: 'direct', processAgeMs: 100 }), false);
  });

  it('does not treat a notification launch with unknown process age as cold', () => {
    assert.equal(
      isNotificationColdLaunch({
        launchCause: 'notification',
        processAgeMs: resolveNotificationProcessAgeMs(50_000, undefined),
      }),
      false,
    );
  });
});

describe('retry delays', () => {
  it('backs off exponentially and caps at 10s', () => {
    assert.equal(getRetryDelay(0), 1000);
    assert.equal(getRetryDelay(1), 2000);
    assert.equal(getRetryDelay(3), 8000);
    assert.equal(getRetryDelay(4), 10_000);
    assert.equal(getRetryDelay(10), 10_000);
  });
});
