import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { ChannelVisibility } from '../../schema';

/**
 * Scope a tickets-shaped query to the tickets the caller can reach: same workspace, and the
 * ticket's channel is PUBLIC or one the caller participates in.
 *
 * This is the same predicate TicketsACL.canSelect applies to a root `tickets` query. It is
 * exported because applyQueryACL only filters the ROOT table — a nested
 * `.related('targetTicket' | 'sourceTicket' | 'mappedTicket')` hop resolves a ticket by id
 * across channels with no ACL and no workspace backstop of its own, so those relations must
 * apply it inline.
 */
export const reachableTicketsOnly = <TReturn>(
  query: Query<'tickets', Schema, TReturn>,
  ctx: Context,
): Query<'tickets', Schema, TReturn> =>
  (query as any)
    .where('workspaceId', '=', ctx.workspaceId)
    .whereExists('channel', (ch: any) =>
      ch.where(({ or, cmp, exists }: any) =>
        or(
          cmp('visibility', ChannelVisibility.PUBLIC),
          exists('participants', (p: any) => p.where('userId', ctx.userID)),
        ),
      ),
    );
