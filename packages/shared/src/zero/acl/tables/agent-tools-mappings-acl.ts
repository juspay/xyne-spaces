import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class AgentToolsMappingsACL extends BaseQueryACL<'agent_tools_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'agent_tools_mappings');
  }

  canSelect<TReturn>(query: Query<'agent_tools_mappings', Schema, TReturn>): Query<'agent_tools_mappings', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
