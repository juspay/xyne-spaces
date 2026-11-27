import test from 'node:test';
import assert from 'node:assert/strict';
import { TicketReferenceMappingsACL as ReadACL } from '../../../../packages/shared/src/zero/acl/tables/ticket-reference-mappings-acl';

// Loading the server query registry validates backend configuration. No hashing,
// database access or authentication happens in these early-rejection unit tests.
process.env.FORM_FIELD_TEXT_HASH_KEY ??= '1'.repeat(64);
const { TicketReferenceMappingsACL: WriteACL } = await import('../../src/zero/acl/tables/ticket-reference-mappings-acl');

const ctx = { userID: 'actor', workspaceId: 'workspace', role: 'MEMBER', orgRole: '', memberId: '' };
const acl = new WriteACL(ctx);

test('raw Zero BLOCKS insert is refused before any ticket query', async () => {
  const tx = { run: async () => { throw new Error('must not query'); } };
  await assert.rejects(acl.canInsert({ relationType: 'BLOCKS' } as never, tx as never), /dependency mutations/);
});

test('raw Zero reference conversion to BLOCKS cannot bypass the dedicated writer', async () => {
  const tx = { run: async () => ({ id: 'map', relationType: 'LINKED' }) };
  await assert.rejects(acl.canUpdate({ id: 'map', relationType: 'BLOCKS' } as never, tx as never), /dependency mutations/);
});

test('raw Zero updates and deletes cannot touch existing BLOCKS rows', async () => {
  const tx = { run: async () => ({ id: 'map', relationType: 'BLOCKS' }) };
  await assert.rejects(acl.canUpdate({ id: 'map', relationType: 'LINKED' } as never, tx as never), /dependency mutations/);
  await assert.rejects(acl.canDelete({ id: 'map' }, tx as never), /dependency mutations/);
});

for (const role of ['MEMBER', 'GUEST']) {
  test(`raw reference sync excludes BLOCKS for ${role}, without removing legacy relation types`, () => {
    const whereCalls: unknown[][] = [];
    const query = {
      where: (...args: unknown[]) => { whereCalls.push(args); return query; },
      whereExists: () => query,
    };
    new ReadACL({ ...ctx, role } as never).canSelect(query as never);
    assert.deepEqual(whereCalls[0], ['relationType', '!=', 'BLOCKS']);
    // No allow-list: new unrelated legacy relation types retain their existing scope.
    assert.equal(whereCalls.length, 1);
  });
}

for (const role of ['ADMIN', 'MEMBER', 'GUEST']) {
  test(`private override audit denies generic user reads and writes for ${role}`, async () => {
    const { ACLFactory } = await import('../../src/database/acl/acl-factory');
    const auditAcl = ACLFactory.getACL('ticketDependencyOverride', { userId: 'actor', workspaceId: 'workspace', role }, {} as never);
    assert.deepEqual(await auditAcl.getWhereClause(), { id: { in: [] } });
    assert.deepEqual(await auditAcl.getMutateWhere(), { id: { in: [] } });
    assert.equal(await auditAcl.canCreate({}), false);
  });
}
