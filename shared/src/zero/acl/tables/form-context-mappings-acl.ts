import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestProjectAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class FormContextMappingsACL extends BaseQueryACL<'forms_context_mapping'> {
  constructor(ctx: Context) {
    super(ctx, 'forms_context_mapping');
  }

  canSelect<TReturn>(
    query: Query<'forms_context_mapping', Schema, TReturn>
  ): Query<'forms_context_mapping', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('stage', (s) =>
        s.whereExists('board', (b) =>
          b
            .where('workspaceId', '=', this.ctx.workspaceId)
            .whereExists('project', (p) => p.where(guestProjectAccessWhere(this.ctx)))
        )
      );
    }

    // Direct workspaceId check through form - no need to traverse through createdByUser
    return query.whereExists('form', (f) =>
      f.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
