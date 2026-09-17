import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { OrgRole } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class WorkspaceOrganizationsACL extends BaseQueryACL<'workspace_organizations'> {
  constructor(ctx: Context) {
    super(ctx, 'workspace_organizations');
  }

  canSelect<TReturn>(query: Query<'workspace_organizations', Schema, TReturn>): Query<'workspace_organizations', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    if (this.ctx.orgRole === OrgRole.ADMIN || this.ctx.orgRole === OrgRole.OWNER) {
      return query;
    }
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
