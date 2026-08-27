import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import {
  guestChannelAccessWhere,
  isGuestContext,
  channelVisibleWhere,
  connectChannelAccessWhere,
} from '../core/guest-acl-utils';

export class TicketStageEtaACL extends BaseQueryACL<'ticket_stage_eta'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_stage_eta');
  }

  // NOTE: 'ticket_stage_eta' is opted out of the define-query.ts workspace backstop
  // (Slack-Connect), so every branch must be fully self-scoping.
  canSelect<TReturn>(
    query: Query<'ticket_stage_eta', Schema, TReturn>
  ): Query<'ticket_stage_eta', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('ticket', (t: any) =>
        t.whereExists('channel', (ch: any) =>
          ch.where(channelVisibleWhere(this.ctx, guestChannelAccessWhere(this.ctx))),
        ),
      );
    }

    // Same-workspace: any workspace member may read ETAs on tickets in their tenant.
    // Connect: an active member of the ticket's connect channel may read them cross-org.
    return query.whereExists('ticket', (t: any) =>
      t.where(({ or, cmp, exists }: any) =>
        or(
          cmp('workspaceId', '=', this.ctx.workspaceId),
          exists('channel', (ch: any) => ch.where(connectChannelAccessWhere(this.ctx))),
        ),
      ),
    );
  }
}
