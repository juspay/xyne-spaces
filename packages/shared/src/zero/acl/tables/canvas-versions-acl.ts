import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { connectReach } from '../core/connect-reach';

export class CanvasVersionsACL extends BaseQueryACL<'canvas_versions'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_versions');
  }

  canSelect<TReturn>(query: Query<'canvas_versions', Schema, TReturn>): Query<'canvas_versions', Schema, TReturn> {
    // Slack Connect: connectId → connect_group workspace truth; else workspaceId.
    return query.where(connectReach(this.ctx));
  }
}
