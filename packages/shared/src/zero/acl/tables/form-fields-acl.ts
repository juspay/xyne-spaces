import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestFormContextMappingWhere, isGuestContext } from '../core/guest-acl-utils';

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
          fcm.where(guestFormContextMappingWhere(this.ctx))
        )
      );
    }

    // Direct workspaceId check through form - no need to traverse through createdByUser
    return query.whereExists('form', (f) =>
      f.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
