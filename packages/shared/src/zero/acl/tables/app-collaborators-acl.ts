import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

/**
 * Read ACL for app_collaborators. A collaborator row is readable if its app is readable by the
 * caller — GLOBAL (marketplace) or the app's org contains the caller's workspace — mirroring the
 * `apps` read ACL. Rows whose app has no org yet are not readable (fail-closed).
 */
export class AppCollaboratorsACL extends BaseQueryACL<'app_collaborators'> {
  constructor(ctx: Context) {
    super(ctx, 'app_collaborators');
  }

  canSelect<TReturn>(
    query: Query<'app_collaborators', Schema, TReturn>,
  ): Query<'app_collaborators', Schema, TReturn> {
    return query.whereExists('app', (app) =>
      app.where(({ or, cmp, exists }) =>
        or(
          cmp('scope', '=', 'GLOBAL'),
          exists('orgWorkspaces', (w) => w.where('id', this.ctx.workspaceId)),
        ),
      ),
    );
  }
}
