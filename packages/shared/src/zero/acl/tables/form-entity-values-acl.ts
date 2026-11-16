import type { Query } from '@rocicorp/zero';
import { type Schema, type Context, FormEntityType, WorkspaceRole } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { channelAccessWhere } from '../core/channel-access';
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
    const inWorkspace = query.whereExists('form', (f) =>
      f.where('workspaceId', '=', this.ctx.workspaceId)
    );
    if (this.ctx.role === WorkspaceRole.ADMIN || this.ctx.role === WorkspaceRole.OWNER) {
      return inWorkspace;
    }
    // A channel's fields are read only by those who can see the channel (private ones: its members).
    // Release env-diff / migration rows are read only by those who can see the release ticket.
    return inWorkspace.where(({ or, and, cmp, exists }) =>
      or(
        and(
          cmp('entityType', '!=', FormEntityType.CHANNEL),
          cmp('entityType', '!=', FormEntityType.RELEASE_ENV_FORM),
          cmp('entityType', '!=', FormEntityType.RELEASE_MIGRATION_FORM)
        ),
        and(
          cmp('entityType', '=', FormEntityType.CHANNEL),
          exists('channel', (c) => c.where(channelAccessWhere(this.ctx)))
        ),
        and(
          or(
            cmp('entityType', '=', FormEntityType.RELEASE_ENV_FORM),
            cmp('entityType', '=', FormEntityType.RELEASE_MIGRATION_FORM)
          ),
          exists('contextTicket', (t) =>
            t.whereExists('channel', (c) => c.where(channelAccessWhere(this.ctx)))
          )
        )
      )
    );
  }
}
