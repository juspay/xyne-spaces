import type { AnyQuery } from '@rocicorp/zero';
import type { BaseQueryResolver, Context } from '@xyne/shared';
import { workspacePartitionedBase, isWorkspacePartitioned } from '@xyne/shared';
import { queryDefs } from '../queries';

/**
 * Query names whose principal-free base the sync engine is allowed to materialize on the GATE path
 * (per-user gate + room-broadcast). Each must be a genuine shared base (ACL collapses to a gate, no
 * per-subscriber predicate/offset — see the shareability metric). Workspace-partitioned BROADCAST
 * queries (getUsersV2, getAllUserGroups: ACL = workspaceId == ws) live here too; their override base
 * comes from `@xyne/shared`'s single-source `WORKSPACE_PARTITIONED_REGISTRY`. Row-level queries are
 * NOT here — they take the `rowLevelQueries` path.
 */
export const SHARED_BASE_QUERIES: ReadonlySet<string> = new Set<string>([
  'channelLatestMultipleConversationsV4',
  'getUsersV2',
  'getAllUserGroups',
]);

// Re-exported for the gateway: a workspace-partitioned GATE query forces its `workspaceId` partition
// from the socket (the tenant boundary; never client args). `isWorkspacePartitioned` also covers
// row-level queries, but those exit via `subscribeRowLevel` before the gateway's forcing branch.
export { isWorkspacePartitioned };

type WithBase = { base?: BaseQueryResolver };

/** Resolve an allowlisted query's ACL-stripped base, or undefined if not allowlisted. */
export function resolveSharedBase(
  name: string,
  ctx: Context,
  args: unknown,
): AnyQuery | undefined {
  if (!SHARED_BASE_QUERIES.has(name)) return undefined;
  // Workspace-partitioned queries (getUsersV2, getAllUserGroups) have a workspace-implicit `.base`
  // (scoped only by the ACL backstop the base strips), so it has no partition. Use the single-source
  // override base, which reads `args.workspaceId` (socket-forced). `queries.ts` stays untouched.
  const wp = workspacePartitionedBase(name, args);
  if (wp) return wp;
  const def = (queryDefs as Record<string, WithBase>)[name];
  return def?.base?.({ ctx, args: args as Parameters<BaseQueryResolver>[0]['args'] });
}
