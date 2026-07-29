import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestProjectAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class FormEntityValuesACL extends BaseQueryACL<'form_entity_values'> {
  constructor(ctx: Context) {
    super(ctx, 'form_entity_values');
  }

  canSelect<TReturn>(
    query: Query<'form_entity_values', Schema, TReturn>
  ): Query<'form_entity_values', Schema, TReturn> {
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

    // Direct workspaceId check through form - formId is now on form_entity_values
    return query.whereExists('form', (f) =>
      f.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
