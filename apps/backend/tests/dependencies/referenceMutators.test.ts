import test from 'node:test';
import assert from 'node:assert/strict';
import { mutators } from '../../../../packages/shared/src/zero/mutators';

type Reference = {
  id: string;
  sourceTicketId: string;
  targetTicketId: string;
  relationType: string;
};
const ctx = { userID: 'actor', workspaceId: 'workspace', role: 'MEMBER' };
const reference = (relationType: string): Reference => ({
  id: 'reference',
  sourceTicketId: 'source',
  targetTicketId: 'target',
  relationType,
});

function transaction(existing?: Reference) {
  const writes: { operation: string; value: unknown }[] = [];
  const tx = {
    run: async () => existing,
    mutate: {
      ticket_reference_mappings: Object.fromEntries(
        ['insert', 'update', 'delete'].map((operation) => [
          operation,
          async (value: unknown) => {
            writes.push({ operation, value });
          },
        ]),
      ),
    },
  };
  // The test implements only the table touched by these mutators, not an entire Zero engine.
  return { tx: tx as never, writes };
}

const createArgs = (relationType: string) => ({
  sourceTicketId: 'source',
  targetTicketId: 'target',
  relationType,
  timestamp: 1,
  referenceId: 'new-reference',
});

test('optimistic create refuses BLOCKS before querying or writing', async () => {
  const { tx, writes } = transaction();
  await assert.rejects(
    mutators.ticketReference.create.fn({ ctx, tx, args: createArgs('BLOCKS') as never }),
    /dependency mutations/,
  );
  assert.deepEqual(writes, []);
});

test('optimistic update refuses conversion TO BLOCKS without touching LINKED', async () => {
  const { tx, writes } = transaction(reference('LINKED'));
  await assert.rejects(
    mutators.ticketReference.updateRelationType.fn({
      ctx,
      tx,
      args: {
        id: 'reference',
        relationType: 'BLOCKS',
        timestamp: 1,
      } as never,
    }),
    /dependency mutations/,
  );
  assert.deepEqual(writes, []);
});

test('optimistic update refuses conversion FROM BLOCKS', async () => {
  const { tx, writes } = transaction(reference('BLOCKS'));
  await assert.rejects(
    mutators.ticketReference.updateRelationType.fn({
      ctx,
      tx,
      args: {
        id: 'reference',
        relationType: 'LINKED',
        timestamp: 1,
      } as never,
    }),
    /dependency mutations/,
  );
  assert.deepEqual(writes, []);
});

test('optimistic delete refuses BLOCKS', async () => {
  const { tx, writes } = transaction(reference('BLOCKS'));
  await assert.rejects(
    mutators.ticketReference.delete.fn({ ctx, tx, args: { id: 'reference' } }),
    /dependency mutations/,
  );
  assert.deepEqual(writes, []);
});

for (const relationType of ['LINKED', 'DUPLICATE_POSSIBLE', 'DUPLICATE_CONFIRMED', 'MERGED_INTO']) {
  test(`${relationType} creation and deletion retain their existing behavior`, async () => {
    const create = transaction();
    await mutators.ticketReference.create.fn({
      ctx,
      tx: create.tx,
      args: createArgs(relationType) as never,
    });
    assert.equal(create.writes.length, 1);
    assert.equal(create.writes[0].operation, 'insert');
    assert.equal((create.writes[0].value as Reference).relationType, relationType);
    const remove = transaction(reference(relationType));
    await mutators.ticketReference.delete.fn({ ctx, tx: remove.tx, args: { id: 'reference' } });
    assert.deepEqual(remove.writes, [{ operation: 'delete', value: { id: 'reference' } }]);
  });
}

test('duplicate LINKED creation and missing reference errors remain unchanged', async () => {
  const { tx } = transaction(reference('LINKED'));
  await assert.rejects(
    mutators.ticketReference.create.fn({ ctx, tx, args: createArgs('LINKED') as never }),
    /already exists/,
  );
  await assert.rejects(
    mutators.ticketReference.delete.fn({ ctx, tx: transaction().tx, args: { id: 'missing' } }),
    /not found/,
  );
});

test('non-dependency reference relation updates still work', async () => {
  const { tx, writes } = transaction(reference('DUPLICATE_POSSIBLE'));
  await mutators.ticketReference.updateRelationType.fn({
    ctx,
    tx,
    args: {
      id: 'reference',
      relationType: 'DUPLICATE_CONFIRMED',
      timestamp: 1,
    } as never,
  });
  assert.deepEqual(writes, [
    {
      operation: 'update',
      value: {
        id: 'reference',
        relationType: 'DUPLICATE_CONFIRMED',
        updatedAt: 1,
      },
    },
  ]);
});
