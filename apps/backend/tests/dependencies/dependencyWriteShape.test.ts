import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSupportedDependencyWriteShape, dependencyBoardDestination } from '../../src/database/middleware/dependencyWriteShape';
import type { PrismaClient } from '@prisma/client';

// Loading the middleware validates backend configuration; no hashing or DB access is used here.
process.env.FORM_FIELD_TEXT_HASH_KEY ??= '1'.repeat(64);
const { dependencyWriteData, guardTicketDependencyWrite } = await import('../../src/database/middleware/ticketDependencies');

const reject = (model: string, data: unknown, operation = 'update', protect = true) =>
  assert.throws(() => assertSupportedDependencyWriteShape(model, operation, { data }, protect), {
    code: 'DEPENDENCY_UNSUPPORTED_WRITER',
  });

for (const field of ['stageName', 'statusV2', 'boardId', 'isArchived', 'eta']) {
  test(`nested ${field} updates cannot bypass the top-level ticket continuation`, () => {
    const data = { [field]: { set: 'private-value' } };
    reject('Board', { tickets: { update: { where: { id: 'private-id' }, data } } });
    reject('User', { assignedTickets: { updateMany: [{ where: {}, data }] } });
    reject('Conversation', { tickets: { upsert: { where: { id: 'private-id' }, update: data, create: {} } } });
  });
}

test('to-one shorthand, deep writes and nested board reassignments are covered', () => {
  reject('TicketDescription', { ticket: { update: { stageName: 'Done' } } });
  reject('Channel', { conversations: { update: { where: {}, data: {
    tickets: { update: { where: {}, data: { stageName: 'Done' } } },
  } } } });
  reject('User', { updatedTickets: { update: { where: {}, data: { board: { connect: { id: 'private-board' } } } } } });
});

for (const operator of ['connect', 'connectOrCreate', 'disconnect', 'set']) {
  test(`inverse Board.tickets.${operator} cannot silently reassign ticket boards`, () => {
    reject('Board', { tickets: { [operator]: { id: 'private-id' } } });
  });
}

test('nested board policies are guarded even while ticket enforcement is disabled', async () => {
  const input = { data: { board: { update: { metadata: { dependencyPolicy: { defaultStrength: 'SOFT' } } } } } };
  reject('Ticket', input.data, 'update', false);
  let executed = false;
  await assert.rejects(
    guardTicketDependencyWrite({} as PrismaClient, 'Ticket', 'update', input, async () => { executed = true; }),
    { code: 'DEPENDENCY_UNSUPPORTED_WRITER' },
  );
  assert.equal(executed, false);
  reject('Ticket', { board: { upsert: { create: {}, update: { metadata: null } } } }, 'update', false);
});

test('create/upsert branches cannot conceal nested updates to existing tickets or policies', () => {
  reject('Channel', { tickets: { update: { where: {}, data: { isArchived: true } } } }, 'create');
  assert.throws(() => assertSupportedDependencyWriteShape('Channel', 'upsert', {
    create: { conversations: { create: { tickets: { updateMany: { where: {}, data: { stageName: 'Done' } } } } } },
    update: {},
  }, true), { code: 'DEPENDENCY_UNSUPPORTED_WRITER' });
  reject('Ticket', { board: { connectOrCreate: { where: {}, create: {
    tickets: { update: { where: {}, data: { eta: null } } },
  } } } }, 'create');
});

test('JSON, predicates and ordinary nested edits are not mistaken for guarded writes', () => {
  for (const [model, data] of [
    ['Ticket', { metadata: { board: { update: { metadata: {} } }, tickets: { update: { stageName: 'Done' } } } }],
    ['Board', { tickets: { update: { where: { statusV2: 'TODO' }, data: { title: 'Renamed' } } } }],
    ['Ticket', { board: { update: { name: 'Renamed' } } }],
    ['Conversation', { tickets: { create: { stageName: 'Todo', statusV2: 'TODO' } } }],
    ['Board', { metadata: { dependencyPolicy: { defaultStrength: 'HARD' } } }],
  ] as const) {
    assert.doesNotThrow(() => assertSupportedDependencyWriteShape(model, 'update', { data }, true));
  }
  assert.doesNotThrow(() => assertSupportedDependencyWriteShape('Board', 'findMany', {
    where: { tickets: { some: { stageName: 'Done' } } },
  }, true));
});

test('disabled ticket enforcement preserves legacy nested ticket writers', () => {
  assert.doesNotThrow(() => assertSupportedDependencyWriteShape('Board', 'update', {
    data: { tickets: { updateMany: { where: {}, data: { stageName: 'Done' } } } },
  }, false));
});

test('board connect participates in the same stage gate without mutating caller arguments', () => {
  const data = { title: 'Renamed', board: { connect: { id: 'next-board' } }, stageName: { set: 'Todo' } };
  assert.deepEqual(dependencyWriteData(data), { ...data, stageName: 'Todo', boardId: 'next-board' });
  assert.deepEqual(data.stageName, { set: 'Todo' });
  assert.equal('boardId' in data, false);
  assert.deepEqual(dependencyWriteData({ board: { connect: { id: 'next-board' } } }), {
    board: { connect: { id: 'next-board' } }, boardId: 'next-board',
  });
  assert.equal(dependencyWriteData({ board: { update: { name: 'Rename' } } }), null);
});

test('ambiguous relational moves fail closed without returning body values', () => {
  for (const board of [
    null, { connect: { name: 'private-board' } }, { disconnect: true },
    { create: { name: 'private-board' } }, { connectOrCreate: { where: { id: 'private-board' }, create: {} } },
    { connect: { id: 'private-board' }, update: { name: 'private-title' } },
  ]) {
    assert.throws(() => dependencyBoardDestination({ board }), error => {
      assert.equal((error as { code: string }).code, 'DEPENDENCY_UNSUPPORTED_WRITER');
      assert.doesNotMatch(String(error), /private-board|private-title/);
      return true;
    });
  }
  assert.throws(() => dependencyWriteData({ boardId: 'one', board: { connect: { id: 'two' } } }), {
    code: 'DEPENDENCY_INPUT',
  });
});

test('the iterative schema walk is bounded and permits reused payload objects', () => {
  const shared = { title: 'Rename' };
  assert.doesNotThrow(() => assertSupportedDependencyWriteShape('Board', 'update', {
    data: { tickets: { update: [{ where: { id: 'a' }, data: shared }, { where: { id: 'b' }, data: shared }] } },
  }, true));
  const cyclic: Record<string, unknown> = {};
  cyclic.board = { update: { tickets: { update: { data: cyclic } } } };
  assert.throws(() => assertSupportedDependencyWriteShape('Ticket', 'update', { data: cyclic }, true), {
    code: 'DEPENDENCY_UNSUPPORTED_WRITER',
  });
});
