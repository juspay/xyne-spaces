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

  it('scopes a singular (.one()) query and preserves the singular result format', () => {
    const q = scopeQueryToTenant(zql.invitations.one(), ctx, 'oneInvitation');
    // the workspace filter chains on AFTER .one()
    assert.match(whereOf(q), /"name":"workspaceId"/);
    assert.match(whereOf(q), /"value":"ws-1"/);
    // ...and the singular result shape survives the rewrite
    // @ts-ignore - asQueryInternals works with any Query type at runtime
    assert.equal(asQueryInternals(q).format.singular, true);
  });

  it('scopes the root of a .related() query and keeps the related subquery', () => {
    const q = scopeQueryToTenant(zql.invitations.related('workspace'), ctx, 'invitationsWithWorkspace');
    // root table is scoped to the caller workspace
    assert.match(whereOf(q), /"name":"workspaceId"/);
    assert.match(whereOf(q), /"value":"ws-1"/);
    // the related subquery is not dropped by the rewrite
    // @ts-ignore - asQueryInternals works with any Query type at runtime
    const related = asQueryInternals(q).ast.related ?? [];
    assert.ok(related.length >= 1, 'related subquery preserved');
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

  it('scopes canvas comment tables through their canvas workspace', () => {
    const threads = whereOf(scopeQueryToTenant(zql.canvas_comment_threads.where('canvasId', 'cv'), ctx, 'canvasCommentThreads'));
    assert.match(threads, /"table":"canvases"/);
    assert.match(threads, /"name":"workspaceId"/);
    assert.match(threads, /"value":"ws-1"/);
    const comments = whereOf(scopeQueryToTenant(zql.canvas_comments.where('threadId', 'th'), ctx, 'canvasThreadComments'));
    assert.match(comments, /"table":"canvas_comment_threads"/);
    assert.match(comments, /"table":"canvases"/);
    assert.match(comments, /"value":"ws-1"/);
  });

  it('covers every Zero table — none is served unscoped or throws (guards against a new table missing a scope rule)', () => {
    const uncovered: string[] = [];
    for (const table of Object.keys(schema.tables)) {
      const q = (zql as Record<string, unknown>)[table];
      if (!q) continue;
      try { scopeQueryToTenant(q, ctx, table); }
      catch { uncovered.push(table); }
    }
    assert.deepEqual(uncovered, [], `Zero tables missing a tenant scope rule: ${uncovered.join(', ')}`);
  });

  it('refuses a table with no tenant scope rather than serving it unscoped', () => {
    // resources IS listed as global; assert the throw path exists for a truly unknown table.
    assert.throws(() => scopeQueryToTenant({}, ctx, 'bogus'));
  });

  it('leaves global reference data alone', () => {
    const query = zql.merchants.orderBy('mid', 'asc');
    assert.equal(scopeQueryToTenant(query, ctx, 'getAllMerchants'), query);
  });
});
