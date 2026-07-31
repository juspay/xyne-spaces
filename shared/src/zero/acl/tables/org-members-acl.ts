import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { OrgRole } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class OrgMembersACL extends BaseQueryACL<'org_members'> {
  constructor(ctx: Context) {
    super(ctx, 'org_members');
  }

  canSelect<TReturn>(query: Query<'org_members', Schema, TReturn>): Query<'org_members', Schema, TReturn> {
    if (this.ctx.orgRole === OrgRole.ADMIN || this.ctx.orgRole === OrgRole.OWNER) {
      return query;
    }
    return query.where('memberId', '=', this.ctx.memberId);
  }
}
