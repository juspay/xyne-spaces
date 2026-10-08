// Zero internal API (mapped via #imports in package.json)
import { asQueryInternals } from '#zero-internal/query-internals';
import { Context, schema, WorkspaceRole } from '@xyne/shared';
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
 * The user row shares a channel or canvas with the caller: both are participants of the
 * same channel (DMs included), or of the same canvas (or the caller created it).
 */
function sharesSurfaceWithCaller(ctx: Context) {
  const isMe = (q: ScopableQuery): ScopableQuery => q.where('userId', ctx.userID);
  return ({ or, exists }: any) =>
    or(
      exists('channelParticipations', (cp: ScopableQuery) =>
        cp.whereExists('channel', (ch: ScopableQuery) => ch.whereExists('participants', isMe)),
      ),
      exists('canvasParticipations', (cp: ScopableQuery) =>
        cp.whereExists('canvas', (c: ScopableQuery) =>
          c.where(({ or: anyOf, cmp, exists: has }: any) =>
            anyOf(cmp('createdBy', ctx.userID), has('participants', isMe)),
          ),
        ),
      ),
    );
}

/**
 * Guest visibility, both ways: a guest sees only themselves and the people they share a
 * channel or canvas with, and is seen only by those people. Workspace admins/owners see
 * everyone — they manage guests from the Members tab. Applied to root `users` reads only:
 * a user reached through a relation (a message's sender, a channel's participants) is
 * already on a surface the caller can see.
 */
function scopeUsersForGuests(query: ScopableQuery, ctx: Context): ScopableQuery {
  if (ctx.role === WorkspaceRole.ADMIN || ctx.role === WorkspaceRole.OWNER) {
    return query;
  }
  const sharesSurface = sharesSurfaceWithCaller(ctx);
  if (ctx.role === WorkspaceRole.GUEST) {
    return query.where((eb: any) => eb.or(eb.cmp('id', ctx.userID), sharesSurface(eb)));
  }
  return query.where((eb: any) => eb.or(eb.cmp('role', '!=', WorkspaceRole.GUEST), sharesSurface(eb)));
}

/** Reference data that is the same for every tenant. */
const GLOBAL_REFERENCE_TABLES = new Set(['lookup_values', 'merchants', 'resources']);

const zeroTables = schema.tables as Record<string, { columns: Record<string, unknown> }>;

export function scopeQueryToTenant<T>(query: T, ctx: Context, queryName: string): T {
  // @ts-ignore - asQueryInternals works with any Query type at runtime
  const table = String(asQueryInternals(query).ast.table);
  const scopable = query as unknown as ScopableQuery;

  if (zeroTables[table] && 'workspaceId' in zeroTables[table].columns) {
    // Not expected on the read path — real callers carry a workspaceId. An absent
    // one still fails closed (Zero compiles `.where('workspaceId', undefined)` to
    // `workspaceId = null`, which matches no rows), but log it so an unexpected
    // context is visible rather than silently returning empty.
    if (!ctx.workspaceId) {
      logger.warn('zero_query_missing_workspace', { query: queryName, table });
    }
    const scoped = scopable.where('workspaceId', ctx.workspaceId);
    return (table === 'users' ? scopeUsersForGuests(scoped, ctx) : scoped) as unknown as T;
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
