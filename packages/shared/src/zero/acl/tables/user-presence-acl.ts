import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { connectCoMemberPresenceWhere } from '../core/guest-acl-utils';

export class UserPresenceACL extends BaseQueryACL<'user_presence'> {
  constructor(ctx: Context) {
    super(ctx, 'user_presence');
  }

  // NOTE: 'user_presence' is opted out of the define-query.ts workspace backstop (Slack-Connect).
  canSelect<TReturn>(query: Query<'user_presence', Schema, TReturn>): Query<'user_presence', Schema, TReturn> {
    // Presence is a see-everyone feature (teammate online/away/status dots), so scope to the
    // workspace — plus foreign users I share a connect channel with (for cross-org presence).
    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('workspaceId', '=', this.ctx.workspaceId),
        // Departed members must NOT keep broadcasting presence (§5) — subject gated on active.
        connectCoMemberPresenceWhere(this.ctx)({ exists }),
      ),
    );
  }
}
