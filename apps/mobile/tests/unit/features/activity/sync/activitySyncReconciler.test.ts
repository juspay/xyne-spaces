import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  reconcileActivityFirstPage,
  reconcileUnreadActivities,
} from '@/src/features/activity/sync/activitySyncReconciler';

type ReconcileUnreadArgs = Parameters<typeof reconcileUnreadActivities>[0];
type ReconcileFirstPageArgs = Parameters<typeof reconcileActivityFirstPage>[0];
type ZeroRunner = ReconcileUnreadArgs['zero'];

type ZeroRun = (query: unknown, options: unknown) => Promise<unknown>;

const makeZero = (run: ZeroRun): ZeroRunner => ({ run }) as unknown as ZeroRunner;

// Unique per test so the module-level in-flight cache never collides across cases.
let nonceSeq = 1;
const nextNonce = (): number => nonceSeq++;

describe('reconcileUnreadActivities', () => {
  it('filters unread activities down to the requested workspace', async () => {
    const calls: unknown[] = [];
    const zero = makeZero(async (_query, options) => {
      calls.push(options);
      return [
        { id: 'a', workspaceId: 'W', actorAction: 'mentioned_user', isRead: false, createdAt: 1 },
        {
          id: 'b',
          workspaceId: 'OTHER',
          actorAction: 'mentioned_user',
          isRead: false,
          createdAt: 2,
        },
        { id: 'c', workspaceId: null, actorAction: 'mentioned_user', isRead: false, createdAt: 3 },
      ];
    });

    const result = await reconcileUnreadActivities({
      zero,
      currentUserId: 'u1',
      workspaceId: 'W',
      refreshNonce: nextNonce(),
    });

    assert.deepEqual(
      result.map(a => a.id),
      ['a', 'c'],
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { type: 'complete' });
  });

  it('shares a single in-flight promise for identical arguments', async () => {
    let calls = 0;
    let resolveRun: ((value: unknown) => void) | undefined;
    const pending = new Promise<unknown>(resolve => {
      resolveRun = resolve;
    });
    const zero = makeZero(async () => {
      calls += 1;
      return pending;
    });

    const args: ReconcileUnreadArgs = {
      zero,
      currentUserId: 'u1',
      workspaceId: 'W',
      refreshNonce: nextNonce(),
    };

    const first = reconcileUnreadActivities(args);
    const second = reconcileUnreadActivities(args);
    assert.equal(first, second);

    resolveRun?.([{ id: 'a', workspaceId: 'W' }]);
    await first;
    assert.equal(calls, 1);
  });
});

describe('reconcileActivityFirstPage', () => {
  const baseArgs = (
    zero: ZeroRunner,
    resolveDisplayPage: ReconcileFirstPageArgs['resolveDisplayPage'],
  ): ReconcileFirstPageArgs => ({
    zero,
    currentUserId: 'u1',
    workspaceId: 'W',
    refreshNonce: nextNonce(),
    activeTab: 'all',
    showUnreadOnly: false,
    currentTypes: ['mentioned_user'],
    classificationFilter: undefined,
    pageSize: 2,
    resolveDisplayPage,
  });

  it('returns visible rows, cursor and unread count without the display fallback', async () => {
    const rawPage = [
      {
        id: 'r1',
        workspaceId: 'W',
        actorAction: 'mentioned_user',
        classification: null,
        isRead: false,
        createdAt: 100,
        updatedAt: 150,
      },
      {
        id: 'r2',
        workspaceId: 'W',
        actorAction: 'mentioned_user',
        classification: null,
        isRead: false,
        createdAt: 200,
      },
    ];
    const unread = [
      { id: 'u9', workspaceId: 'W', actorAction: 'mentioned_user', isRead: false, createdAt: 5 },
    ];

    let runCount = 0;
    const zero = makeZero(async () => {
      runCount += 1;
      return runCount === 1 ? rawPage : unread;
    });

    let resolveCalled = false;
    const resolveDisplayPage: ReconcileFirstPageArgs['resolveDisplayPage'] = async () => {
      resolveCalled = true;
      throw new Error('resolveDisplayPage should not be called on the happy path');
    };

    const result = await reconcileActivityFirstPage(baseArgs(zero, resolveDisplayPage));

    assert.equal(result.queryRowCount, 2);
    assert.equal(result.hasMore, true);
    assert.deepEqual(result.nextCursor, { id: 'r2', updatedAt: 200 });
    assert.deepEqual(
      result.rows.map(r => r.id),
      ['r1', 'r2'],
    );
    assert.equal(result.unreadActivities.length, 1);
    assert.equal(resolveCalled, false);
  });

  it('delegates to resolveDisplayPage when the first page has no visible rows', async () => {
    const rawPage = [
      {
        id: 'r1',
        workspaceId: 'OTHER',
        actorAction: 'mentioned_user',
        createdAt: 100,
        updatedAt: 150,
      },
      { id: 'r2', workspaceId: 'OTHER', actorAction: 'mentioned_user', createdAt: 200 },
    ];

    let runCount = 0;
    const zero = makeZero(async () => {
      runCount += 1;
      return runCount === 1 ? rawPage : [];
    });

    let receivedHasMore: boolean | undefined;
    const resolveDisplayPage: ReconcileFirstPageArgs['resolveDisplayPage'] = async (
      _rows,
      _cursor,
      hasMore,
    ) => {
      receivedHasMore = hasMore;
      return {
        rows: [{ id: 'd1' }] as never,
        nextCursor: { id: 'd1', updatedAt: 5 },
        hasMore: false,
        queryRowCount: 7,
      };
    };

    const result = await reconcileActivityFirstPage(baseArgs(zero, resolveDisplayPage));

    assert.equal(receivedHasMore, true);
    assert.equal(result.queryRowCount, 7);
    assert.equal(result.hasMore, false);
    assert.deepEqual(result.nextCursor, { id: 'd1', updatedAt: 5 });
    assert.deepEqual(
      result.rows.map(r => r.id),
      ['d1'],
    );
  });
});
