// Zero internal API (mapped via #imports in package.json)
import { asQueryInternals } from '#zero-internal/query-internals';
import { Context, schema, CONNECT_SCOPED_TABLES } from '@xyne/shared';
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
 * carry workspaceId.
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
};

/**
 * Tables that DO carry a workspaceId column, but whose read visibility is deliberately wider
 * than one workspace. The workspaceId on these rows is a denormalised "created in" stamp, not
 * the tenant boundary, so the generic workspace rule would hide rows the caller is entitled to.
 * Each rule must still be a strict tenant boundary derived only from server-side context.
 */
const CROSS_WORKSPACE_SCOPES: Record<string, OrgScopeRule> = {
  // App templates are org-level catalog rows (scope ORG) or marketplace rows (scope GLOBAL).
  // `apps.workspaceId` is the creating workspace, so a workspace filter hid org apps built in a
  // sibling workspace of the same org (Org Apps tab) and every other workspace's GLOBAL apps
  // (Marketplace tab). Mirrors the AppsACL read rule (packages/shared/src/zero/acl/tables/
  // apps-acl.ts), which define-query already opts out of its own workspace backstop for:
  //   - GLOBAL apps are visible to everyone (marketplace, cross-org by design);
  //   - ORG apps are visible only when the app's org contains the caller's workspace. This is
  //     resolved from ctx.workspaceId via the orgWorkspaces relation, never from a client
  //     argument, so a client passing another org's id in getOrgApps still sees nothing.
  // signingSecret is not a synced column (XYNE-56394), so no secret leaves the server.
  apps: (query, ctx) =>
    query.where(({ or, cmp, exists }: any) =>
      or(
        cmp('scope', '=', 'GLOBAL'),
        exists('orgWorkspaces', (w: ScopableQuery) => w.where('id', ctx.workspaceId)),
      ),
    ),
};

/** Reference data that is the same for every tenant. */
const GLOBAL_REFERENCE_TABLES = new Set(['lookup_values', 'merchants', 'resources']);

const zeroTables = schema.tables as Record<string, { columns: Record<string, unknown> }>;

export function scopeQueryToTenant<T>(query: T, ctx: Context, queryName: string): T {
  // @ts-ignore - asQueryInternals works with any Query type at runtime
  const table = String(asQueryInternals(query).ast.table);
  const scopable = query as unknown as ScopableQuery;

  // Slack Connect: connect-scoped tables are tenant-scoped by the defineQuery backstop (connectReach),
  // which runs inside queryDef.fn before this. Don't re-apply it here — that would add a second
  // connect_group subquery per row. Checked before the workspaceId-column gate so these tables don't
  // fall through to the "unscoped table" error once workspaceId is dropped from them.
  if (CONNECT_SCOPED_TABLES.has(table)) {
    return query;
  }
  const crossWorkspaceRule = CROSS_WORKSPACE_SCOPES[table];
  if (crossWorkspaceRule) {
    if (!ctx.workspaceId) {
      logger.warn('zero_query_missing_workspace', { query: queryName, table });
    }
    return crossWorkspaceRule(scopable, ctx) as unknown as T;
  }
  if (zeroTables[table] && 'workspaceId' in zeroTables[table].columns) {
    // Not expected on the read path — real callers carry a workspaceId. An absent
    // one still fails closed (Zero compiles `.where('workspaceId', undefined)` to
    // `workspaceId = null`, which matches no rows), but log it so an unexpected
    // context is visible rather than silently returning empty.
    if (!ctx.workspaceId) {
      logger.warn('zero_query_missing_workspace', { query: queryName, table });
    }
    return scopable.where('workspaceId', ctx.workspaceId) as unknown as T;
  }
  const customRule = CUSTOM_SCOPES[table];
  if (customRule) {
    if (!ctx.memberId) {
      logger.warn('zero_query_missing_member', { query: queryName, table });
    }
    return customRule(scopable, ctx) as unknown as T;
  }
  if (GLOBAL_REFERENCE_TABLES.has(table)) {
    return query;
  }
  logger.error('zero_query_unscoped_table', { query: queryName, table });
  throw new Error(`Query '${queryName}' cannot be served: table '${table}' has no tenant scope`);
}
