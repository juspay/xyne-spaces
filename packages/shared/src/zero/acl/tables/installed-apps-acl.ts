import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

/**
 * Read ACL for installed_apps. An install is readable only from its own workspace (resolved via the
 * bot user's workspace). Prevents one workspace/org from reading another's install rows — bot user
 * ids, per-install webhook URLs, etc. — including through relations on other queries.
 */
export class InstalledAppsACL extends BaseQueryACL<'installed_apps'> {
  constructor(ctx: Context) {
    super(ctx, 'installed_apps');
  }

  canSelect<TReturn>(
    query: Query<'installed_apps', Schema, TReturn>,
  ): Query<'installed_apps', Schema, TReturn> {
    return query.whereExists('user', (u) => u.where('workspaceId', this.ctx.workspaceId));
  }
}
