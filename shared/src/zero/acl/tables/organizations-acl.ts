import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { OrgRole } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class OrganizationsACL extends BaseQueryACL<'organizations'> {
  constructor(ctx: Context) {
    super(ctx, 'organizations');
  }

  canSelect<TReturn>(query: Query<'organizations', Schema, TReturn>): Query<'organizations', Schema, TReturn> {
    if (this.ctx.orgRole === OrgRole.ADMIN || this.ctx.orgRole === OrgRole.OWNER) {
      return query;
    }
    return query.whereExists('members', (m) =>
      m.where('memberId', '=', this.ctx.memberId).where('leftAt', 'IS', null)
    );
  }
}
