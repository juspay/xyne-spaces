/**
 * Mutation-path containment contract (node:test, env-free).
 *
 * The non-negotiable: sync-side bookkeeping failures must NEVER reject the user's mutation
 * (in any mode, including shadow). Zero-side errors propagate untouched. A failed fold
 * leaves no partial overlay behind.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncMutatorFn } from './mutatorSync.js';
import { initSyncEngine, getSyncHost } from './runtime.js';
import type { SyncTransport } from './syncClient.js';

// Engine up with inert transport/store so getSyncHost() returns a REAL IvmHost.
const transport: SyncTransport = { emit: () => {}, on: () => {}, off: () => {} };
initSyncEngine(transport);

/** A conversations row whose spread throws — poisons normalize/fold, not the Zero write. */
function poisonedRow(): Record<string, unknown> {
  const row: Record<string, unknown> = { channelId: 'ch1', workspaceId: 'w1' };
  Object.defineProperty(row, 'conversationId', {
    enumerable: true,
    get() {
      throw new Error('poisoned row');
    },
  });
  return row;
}

function fakeTx(mutationID: number, zeroCalls: string[]) {
  return {
    location: 'client',
    mutationID,
    reason: 'optimistic',
    mutate: {
      conversations: {
        insert: async (arg: unknown) => {
          zeroCalls.push('conversations.insert');
          void arg;
          return undefined;
        },
      },
    },
    run: async () => [],
  };
}

test('a poisoned fold never rejects the mutation; Zero write ran; no overlay survives', async () => {
  const host = getSyncHost();
  assert.ok(host);
  const zeroCalls: string[] = [];
  const mutator = syncMutatorFn(async ({ tx }: { tx: ReturnType<typeof fakeTx> }) => {
    await tx.mutate.conversations.insert(poisonedRow());
    return 'mutator-result';
  });

  const result = await mutator({ tx: fakeTx(7, zeroCalls) });
  assert.equal(result, 'mutator-result', 'the user mutation must resolve normally');
  assert.deepEqual(zeroCalls, ['conversations.insert'], 'the real Zero write went through');

  // No partial overlay for the poisoned mutation: a later good mutation on the same host
  // works, and settling mid 7 is a no-op (nothing recorded to drop or retire).
  host!.noteMutationSettled(7, true);
  const good = syncMutatorFn(async ({ tx }: { tx: ReturnType<typeof fakeTx> }) => {
    await tx.mutate.conversations.insert({ conversationId: 'c-ok', channelId: 'ch1', workspaceId: 'w1', createdAt: 1, createdBy: 'u', initialMessageId: 'm', lastActivityAt: 1, replyCount: 0, pinned: false, initial_message_md: 'x' });
    return 'ok';
  });
  assert.equal(await good({ tx: fakeTx(8, []) }), 'ok');
});

test('Zero-side errors propagate untouched (one-way containment)', async () => {
  const failingTx = {
    location: 'client',
    mutationID: 9,
    reason: 'optimistic',
    mutate: {
      conversations: {
        insert: async () => {
          throw new Error('zero write failed');
        },
      },
    },
    run: async () => [],
  };
  const mutator = syncMutatorFn(async ({ tx }: { tx: typeof failingTx }) => {
    await tx.mutate.conversations.insert();
    return 'unreachable';
  });
  await assert.rejects(() => mutator({ tx: failingTx }), /zero write failed/);
});

test('setup failure degrades to the un-proxied mutator (mutation still runs)', async () => {
  // A tx whose `mutate` getter throws poisons proxy construction itself.
  const tx: Record<string, unknown> = { location: 'client', mutationID: 10, reason: 'optimistic', run: async () => [] };
  Object.defineProperty(tx, 'mutate', {
    enumerable: true,
    get() {
      throw new Error('setup poison');
    },
  });
  let ran = false;
  const mutator = syncMutatorFn(async (_opts: unknown) => {
    ran = true;
    return 'done';
  });
  assert.equal(await mutator({ tx }), 'done');
  assert.ok(ran, 'the user mutation ran un-proxied');
});
