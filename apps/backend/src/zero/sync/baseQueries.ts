import type { AnyQuery } from '@rocicorp/zero';
import type { BaseQueryResolver, Context } from '@xyne/shared';
import { queryDefs } from '../queries';

/**
 * Query names whose principal-free base the sync engine is allowed to
 * materialize. Each must be a genuine shared base (ACL is pure routing, no
 * per-subscriber predicate/offset — see the shareability metric). The get-queries
 * transform serves the base ONLY for names in this set AND only to the
 * sync-service principal.
 */
export const SHARED_BASE_QUERIES: ReadonlySet<string> = new Set<string>([
  'channelLatestMultipleConversationsV4',
]);

type WithBase = { base?: BaseQueryResolver };

/** Resolve an allowlisted query's ACL-stripped base, or undefined if not allowlisted. */
export function resolveSharedBase(
  name: string,
  ctx: Context,
  args: unknown,
): AnyQuery | undefined {
  if (!SHARED_BASE_QUERIES.has(name)) return undefined;
  const def = (queryDefs as Record<string, WithBase>)[name];
  return def?.base?.({ ctx, args: args as Parameters<BaseQueryResolver>[0]['args'] });
}
