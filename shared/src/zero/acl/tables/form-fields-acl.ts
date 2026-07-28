import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestProjectAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class FormFieldsACL extends BaseQueryACL<'form_fields'> {
  constructor(ctx: Context) {
    super(ctx, 'form_fields');
  }

  canSelect<TReturn>(
    query: Query<'form_fields', Schema, TReturn>
  ): Query<'form_fields', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('form', (f) =>
        f.whereExists('formContextMappings', (fcm) =>
          fcm.whereExists('stage', (s) =>
            s.whereExists('board', (b) =>
              b
                .where('workspaceId', '=', this.ctx.workspaceId)
                .whereExists('project', (p) => p.where(guestProjectAccessWhere(this.ctx)))
            )
          )
        )
      );
    }

    // Direct workspaceId check through form - no need to traverse through createdByUser
    return query.whereExists('form', (f) =>
      f.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
