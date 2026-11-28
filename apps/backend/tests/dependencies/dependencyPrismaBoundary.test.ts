import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
process.env.FORM_FIELD_TEXT_HASH_KEY ??= '1'.repeat(64);
const { withAclExtension, currentTransactionClient } = await import('../../src/database/tenant/acl-extension');
const { runInRequestContext } = await import('../../src/database/tenant/context');
const { ACLFactory } = await import('../../src/database/acl/acl-factory');
const { dependencyWriteData, setupTicketDependencies } = await import('../../src/database/middleware/ticketDependencies');
const { dependencyRequestMoveOptions, zeroDependencySql } = await import('../../src/bypassAcl/dependencyStageGate');

type QueryArgs = { model: string; operation: string; args: unknown; query: (args: unknown) => Promise<unknown> };
const request = { user: { id: 'actor', workspaceId: 'workspace', role: 'MEMBER' } } as Request;

test('Prisma authorization precedes the privileged dependency continuation', async t => {
  const originalFactory = ACLFactory.getACL;
  try {
    for (const [operation, allowed] of [['update', false], ['update', true], ['updateMany', true]] as const) {
      await t.test(`${operation}, authorized=${allowed}`, async () => {
        const events: string[] = [];
        let received: unknown;
        let handler!: (args: QueryArgs) => Promise<unknown>;
        const aclWhere = { workspaceId: 'workspace', id: { in: ['visible-editable'] } };
        ACLFactory.getACL = (() => ({ getMutateWhere: async () => { events.push('acl'); return aclWhere; } })) as typeof ACLFactory.getACL;
        const rawRoot = { marker: 'raw-root-without-encryption' } as unknown as PrismaClient;
        const fake = {
          ticket: { count: async () => { events.push('acl-count'); return allowed ? 1 : 0; } },
          $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ marker: 'transaction' }),
          $extends(extension: { query?: { $allModels: { $allOperations: typeof handler } } }) {
            if (extension.query) handler = extension.query.$allModels.$allOperations;
            return fake;
          },
        };
        withAclExtension(fake as unknown as PrismaClient, rawRoot, async (root, model, op, args, execute) => {
          assert.equal(root, rawRoot);
          assert.equal(model, 'Ticket');
          assert.equal(op, operation);
          events.push('dependency');
          received = args;
          return execute(args);
        });
        const input = { where: { id: 'visible-editable' }, data: { stageName: 'Done' } };
        const action = () => runInRequestContext(request, () => handler({ model: 'Ticket', operation, args: input, query: async () => { events.push('write'); return 'result'; } }));
        if (!allowed) {
          await assert.rejects(action(), /No Ticket found/);
          assert.deepEqual(events, ['acl', 'acl-count']);
          assert.equal(received, undefined);
        } else {
          assert.equal(await action(), 'result');
          assert.deepEqual(events, operation === 'update' ? ['acl', 'acl-count', 'dependency', 'write'] : ['acl', 'dependency', 'write']);
          assert.deepEqual(received, operation === 'updateMany' ? { ...input, where: { AND: [input.where, aclWhere] } } : input);
        }
      });
    }
  } finally { ACLFactory.getACL = originalFactory; }
});

test('already-authorized interactive transactions still pass through dependency enforcement on the same connection', async () => {
  let handler!: (args: QueryArgs) => Promise<unknown>;
  let written = false;
  const tx = { board: {}, marker: 'existing-transaction', ticket: { update: async (args: unknown) => handler({ model: 'Ticket', operation: 'update', args, query: async () => { written = true; return 'result'; } }) } };
  const rawRoot = {} as PrismaClient;
  const fake = {
    $transaction: async (fn: (transaction: unknown) => Promise<unknown>) => fn(tx),
    $extends(extension: { query?: { $allModels: { $allOperations: typeof handler } }; client?: { $transaction: typeof fake.$transaction } }) {
      if (extension.query) handler = extension.query.$allModels.$allOperations;
      if (extension.client) this.$transaction = extension.client.$transaction;
      return fake;
    },
  };
  let checked = false;
  const wrapped = withAclExtension(fake as unknown as PrismaClient, rawRoot, async (_root, _model, _operation, args, execute, connection) => {
    assert.equal(currentTransactionClient(), connection);
    assert.equal((connection as unknown as { marker: string }).marker, 'existing-transaction');
    checked = true;
    return execute(args);
  });
  await wrapped.$transaction(async transaction => transaction.ticket.update({ where: { id: 'ticket' }, data: { stageName: 'Done' } }));
  assert.equal(written, true);
  assert.equal(checked, true);
  assert.equal(currentTransactionClient(), undefined);
});

test('middleware only forwards; it never performs privileged reads or redirects an unauthorized write', async () => {
  let middleware!: (params: unknown, next: (value: unknown) => Promise<unknown>) => Promise<unknown>;
  const raw = { $use: (value: typeof middleware) => { middleware = value; } };
  setupTicketDependencies(raw as unknown as PrismaClient);
  const params = { model: 'Ticket', action: 'update', args: { data: { stageName: 'Done' } }, runInTransaction: true };
  assert.equal(await middleware(params, async received => { assert.equal(received, params); return 'forwarded'; }), 'forwarded');
});

test('stage fields normalize Prisma set operands without rewriting unrelated data', () => {
  const eta = new Date();
  assert.deepEqual(dependencyWriteData({ stageName: { set: 'Done' }, eta }), { stageName: 'Done', eta });
  assert.equal(dependencyWriteData({ title: 'Unrelated edit' }), null);
});

test('move authority is context-derived, not request-derived', () => {
  assert.deepEqual(dependencyRequestMoveOptions('trusted-actor', { actorId: 'forged', automation: true, dependencyReason: 'Risk', dependencyAdminOverride: true }), {
    actorId: 'trusted-actor', automation: false, reason: 'Risk', adminOverride: true,
  });
});

test('Zero SQL adapter requires and reuses the existing adapter transaction', async () => {
  assert.throws(() => zeroDependencySql({}), { code: 'DEPENDENCY_UNSUPPORTED_WRITER' });
  const values = ['private'];
  const connection = { query: async (text: string, parameters: unknown[]) => {
    assert.equal(text, 'SELECT $1'); assert.equal(parameters, values); return [{ value: 'result' }];
  } };
  assert.deepEqual(await zeroDependencySql({ dbTransaction: connection }).query('SELECT $1', values), [{ value: 'result' }]);
});

test('nested policy refusal stays behind the outer model ACL and never executes a write', async () => {
  const originalFactory = ACLFactory.getACL;
  try {
    for (const allowed of [false, true]) {
      const events: string[] = [];
      let handler!: (args: QueryArgs) => Promise<unknown>;
      ACLFactory.getACL = (() => ({ getMutateWhere: async () => {
        events.push('acl');
        return { workspaceId: 'workspace' };
      } })) as typeof ACLFactory.getACL;
      const fake = {
        ticket: { count: async () => { events.push('acl-count'); return allowed ? 1 : 0; } },
        $transaction: async () => { throw new Error('Must not open a transaction'); },
        $extends(extension: { query?: { $allModels: { $allOperations: typeof handler } } }) {
          if (extension.query) handler = extension.query.$allModels.$allOperations;
          return fake;
        },
      };
      withAclExtension(fake as unknown as PrismaClient);
      const action = () => runInRequestContext(request, () => handler({
        model: 'Ticket', operation: 'update',
        args: { where: { id: 'ticket' }, data: { board: { update: { metadata: {
          dependencyPolicy: { defaultStrength: 'SOFT' },
        } } } } },
        query: async () => { events.push('write'); },
      }));
      if (allowed) await assert.rejects(action(), { code: 'DEPENDENCY_UNSUPPORTED_WRITER' });
      else await assert.rejects(action(), /No Ticket found/);
      assert.deepEqual(events, ['acl', 'acl-count']);
    }
  } finally { ACLFactory.getACL = originalFactory; }
});
