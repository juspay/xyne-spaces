// Zero is ESM-only and cannot load under this repo's CJS jest config, so this runs
// under node's own test runner via tsx:
//   npx tsx --test src/zero/tenant-scope.node-test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asQueryInternals } from '#zero-internal/query-internals';
import { createBuilder } from '@rocicorp/zero';
import { schema, type Context } from '@xyne/shared';
import { scopeQueryToTenant } from './tenant-scope';

const zql = createBuilder(schema);

const ctx: Context = {
  userID: 'user-1',
  workspaceId: 'ws-1',
  role: 'MEMBER',
  orgRole: 'MEMBER',
  memberId: 'member-1',
};

// @ts-ignore - asQueryInternals works with any Query type at runtime
const whereOf = (query: unknown): string => JSON.stringify(asQueryInternals(query).ast.where ?? null);

describe('scopeQueryToTenant', () => {
  it('pins a workspace-scoped table to the caller workspace', () => {
    const where = whereOf(scopeQueryToTenant(zql.invitations.orderBy('createdAt', 'desc'), ctx, 'getAllInvitations'));
    assert.match(where, /"name":"workspaceId"/);
    assert.match(where, /"value":"ws-1"/);
  });

  it('keeps the query own conditions and ANDs the workspace onto them', () => {
    const where = whereOf(
      scopeQueryToTenant(zql.workflows.where('workflowType', 'Automations'), ctx, 'automationsList'),
    );
    assert.match(where, /"type":"and"/);
    assert.match(where, /"name":"workflowType"/);
    assert.match(where, /"name":"workspaceId"/);
  });

  it('limits organisations to those the caller belongs to or is linked to', () => {
    const where = whereOf(scopeQueryToTenant(zql.organizations, ctx, 'availableOrganizations'));
    assert.match(where, /"type":"or"/);
    assert.match(where, /"table":"org_members"/);
    assert.match(where, /"value":"member-1"/);
    assert.match(where, /"table":"workspace_organizations"/);
    assert.match(where, /"value":"ws-1"/);
  });

  it('limits organisation members to organisations the caller is in', () => {
    const where = whereOf(scopeQueryToTenant(zql.org_members.where('orgId', 'other-org'), ctx, 'getOrgMembers'));
    assert.match(where, /"table":"organizations"/);
    assert.match(where, /"value":"member-1"/);
  });

  it('limits workspaces to the caller own and their organisation', () => {
    const where = whereOf(scopeQueryToTenant(zql.workspaces.where('id', 'ws-9'), ctx, 'getWorkspaceById'));
    assert.match(where, /"value":"ws-1"/);
    assert.match(where, /"table":"org_members"/);
  });

  it('leaves global reference data alone', () => {
    const query = zql.merchants.orderBy('mid', 'asc');
    assert.equal(scopeQueryToTenant(query, ctx, 'getAllMerchants'), query);
  });
});
