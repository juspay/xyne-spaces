import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestTicketAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class PriorityConflictClaimsACL extends BaseQueryACL<'priority_conflict_claims'> {
  constructor(ctx: Context) {
    super(ctx, 'priority_conflict_claims');
  }

  // Two ways to read a claim, both still workspace-scoped:
  //
  //  1. Through the raising ticket, matching TicketStageRequestsACL. TicketsACL grants read to
  //     channel participants, which covers the raiser and everyone in the channel. The claim's
  //     own workspaceId is nullable (stamped on insert), so the ticket relation is the reliable
  //     tenant key here.
  //  2. Directly as the respondent. Normally redundant — the claim mutator rejects cross-channel
  //     claims, so the respondent starts out a participant of the raising ticket's channel. But
  //     if that ticket is later moved to another channel, path 1 alone would revoke read access
  //     from the one person who has to accept, deadlocking the negotiation with no way out.
  //
  // Guests never get the respondent shortcut: they are external and can only ever see claims on
  // tickets already shared with them.
  canSelect<TReturn>(
    query: Query<'priority_conflict_claims', Schema, TReturn>
  ): Query<'priority_conflict_claims', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('ticket', (t) =>
        t
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(guestTicketAccessWhere(this.ctx)),
      );
    }

    return query.where(({ or, cmp, exists }) =>
      or(
        exists('ticket', (t) => t.where('workspaceId', '=', this.ctx.workspaceId)),
        cmp('respondentId', '=', this.ctx.userID),
      ),
    );
  }
}
