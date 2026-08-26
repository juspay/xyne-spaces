import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { connectChannelAccessWhere } from '../core/guest-acl-utils';

export class CanvasVersionsACL extends BaseQueryACL<'canvas_versions'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_versions');
  }

  // NOTE: 'canvas_versions' is opted out of the define-query.ts workspace backstop (Slack-Connect).
  // A version is visible if it belongs to my workspace OR its canvas's channel is a connect channel
  // I actively belong to (traverse canvas -> channel).
  canSelect<TReturn>(query: Query<'canvas_versions', Schema, TReturn>): Query<'canvas_versions', Schema, TReturn> {
    return query.where(({ or, cmp, exists }: any) =>
      or(
        cmp('workspaceId', '=', this.ctx.workspaceId),
        exists('canvas', (c: any) =>
          c.whereExists('channel', (ch: any) => ch.where(connectChannelAccessWhere(this.ctx))),
        ),
      ),
    );
  }
}
