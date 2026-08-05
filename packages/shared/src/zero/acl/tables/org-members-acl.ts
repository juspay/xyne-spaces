import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { OrgRole } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class OrgMembersACL extends BaseQueryACL<'org_members'> {
  constructor(ctx: Context) {
    super(ctx, 'org_members');
  }

  canSelect<TReturn>(query: Query<'org_members', Schema, TReturn>): Query<'org_members', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'memberId');
    }

    // Without a resolved memberId there is no membership to scope by, so return nothing.
    if (!this.ctx.memberId) {
      return denyGuestSelect(query, 'memberId');
    }

    if (this.ctx.orgRole === OrgRole.ADMIN || this.ctx.orgRole === OrgRole.OWNER) {
      // An org ADMIN/OWNER sees the members of the org(s) they themselves belong to — the role
      // is an intra-org tier, not a platform-wide grant. Mirrors the Prisma-layer
      // OrgMembersACL.
      return query.whereExists('organization', (o) =>
        o.whereExists('members', (m) =>
          m.where('memberId', '=', this.ctx.memberId).where('leftAt', 'IS', null),
        ),
      );
    }
    return query.where('memberId', '=', this.ctx.memberId);
  }
}
