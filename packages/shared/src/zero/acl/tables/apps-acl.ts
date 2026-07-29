import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

/**
 * Read ACL for apps. An app is readable if it's GLOBAL (marketplace — cross-org by design) OR its
 * org contains the caller's workspace (resolved from ctx.workspaceId via the orgWorkspaces relation,
 * which the client can't spoof). This is the backstop: even an unscoped or mis-scoped apps query
 * can never return another org's ORG-scoped apps. Apps with no org yet (un-backfilled, null orgId)
 * are not readable until backfilled — fail-closed.
 */
export class AppsACL extends BaseQueryACL<'apps'> {
  constructor(ctx: Context) {
    super(ctx, 'apps');
  }

  canSelect<TReturn>(query: Query<'apps', Schema, TReturn>): Query<'apps', Schema, TReturn> {
    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('scope', '=', 'GLOBAL'),
        exists('orgWorkspaces', (w) => w.where('id', this.ctx.workspaceId)),
      ),
    );
  }
}
