// Zero internal API (mapped via #imports in package.json)
import { asQueryInternals } from '#zero-internal/query-internals';
import { Context, schema } from '@xyne/shared';
import { logger } from '@/utils/logger';

// The tenant boundary is applied here, to every query, rather than trusting each
// query definition to include it: the root table is scoped to the caller's
// workspace, or to their organisation for the few tables that sit above workspaces.
// Tables that are neither must be listed as global reference data; an unlisted
// table is refused rather than served unscoped.

type ScopableQuery = {
  where: (...args: unknown[]) => ScopableQuery;
  whereExists: (...args: unknown[]) => ScopableQuery;
};

type OrgScopeRule = (query: ScopableQuery, ctx: Context) => ScopableQuery;

/**
 * Tables without a workspaceId column that need a bespoke scope rule — either the
 * caller's organisation membership (org-level tables) or a parent row that does
 * carry workspaceId (e.g. canvas comments, scoped through their canvas).
 */
const CUSTOM_SCOPES: Record<string, OrgScopeRule> = {
  // An organisation is visible to its own members and to the members of a
  // workspace it is linked to.
  organizations: (query, ctx) =>
    query.where(({ or, exists }: any) =>
      or(
        exists('members', (m: ScopableQuery) => m.where('memberId', ctx.memberId)),
        exists('workspaceOrgs', (wo: ScopableQuery) => wo.where('workspaceId', ctx.workspaceId)),
      ),
    ),
  org_members: (query, ctx) =>
    query.whereExists('organization', (o: ScopableQuery) =>
      o.whereExists('members', (m: ScopableQuery) => m.where('memberId', ctx.memberId)),
    ),
  // The caller's own workspace, plus the others in their organisation.
  workspaces: (query, ctx) =>
    query.where(({ cmp, or, exists }: any) =>
      or(
        cmp('id', '=', ctx.workspaceId),
        exists('orgMembers', (m: ScopableQuery) => m.where('memberId', ctx.memberId)),
      ),
    ),
  // Canvas comment tables carry canvasId, not workspaceId; scope through the canvas.
  canvas_comment_threads: (query, ctx) =>
    query.whereExists('canvas', (c: ScopableQuery) => c.where('workspaceId', ctx.workspaceId)),
  canvas_comments: (query, ctx) =>
    query.whereExists('thread', (t: ScopableQuery) =>
      t.whereExists('canvas', (c: ScopableQuery) => c.where('workspaceId', ctx.workspaceId)),
    ),
};

/** Reference data that is the same for every tenant. */
const GLOBAL_REFERENCE_TABLES = new Set(['lookup_values', 'merchants', 'resources']);

const zeroTables = schema.tables as Record<string, { columns: Record<string, unknown> }>;

export function scopeQueryToTenant<T>(query: T, ctx: Context, queryName: string): T {
  // @ts-ignore - asQueryInternals works with any Query type at runtime
  const table = String(asQueryInternals(query).ast.table);
  const scopable = query as unknown as ScopableQuery;

  if (zeroTables[table] && 'workspaceId' in zeroTables[table].columns) {
    return scopable.where('workspaceId', ctx.workspaceId) as unknown as T;
  }
  const customRule = CUSTOM_SCOPES[table];
  if (customRule) {
    return customRule(scopable, ctx) as unknown as T;
  }
  if (GLOBAL_REFERENCE_TABLES.has(table)) {
    return query;
  }
  logger.error('zero_query_unscoped_table', { query: queryName, table });
  throw new Error(`Query '${queryName}' cannot be served: table '${table}' has no tenant scope`);
}
