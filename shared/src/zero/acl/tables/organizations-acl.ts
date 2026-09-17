import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class OrganizationsACL extends BaseQueryACL<'organizations'> {
  constructor(ctx: Context) {
    super(ctx, 'organizations');
  }

  canSelect<TReturn>(query: Query<'organizations', Schema, TReturn>): Query<'organizations', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'orgId');
    }

    // Without a resolved memberId there is no membership to scope by, so return nothing.
    if (!this.ctx.memberId) {
      return denyGuestSelect(query, 'orgId');
    }

    // Membership scoping applies to every role: the org role is an intra-org tier, not a
    // platform-wide grant. Mirrors the Prisma-layer ACL.
    return query.whereExists('members', (m) =>
      m.where('memberId', '=', this.ctx.memberId).where('leftAt', 'IS', null)
    );
  }
}
