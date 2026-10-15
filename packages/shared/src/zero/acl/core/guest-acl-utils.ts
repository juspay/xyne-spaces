import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { ChannelScopeType, GuestEntity, WorkspaceRole } from '../../schema';

type GuestPredicate = (helpers: any) => any;

const directGuestAccessExists = (ctx: Context, entityType: GuestEntity) => (exists: any) =>
  exists('guestAccess', (mapping: any) =>
    mapping.where('userId', '=', ctx.userID).where('accessibleEntityType', '=', entityType),
  );

export const isGuestContext = (ctx: Context): boolean => ctx.role === WorkspaceRole.GUEST;

export const denyGuestSelect = <
  TTable extends keyof Schema['tables'],
  TReturn,
  TColumn extends Extract<keyof Schema['tables'][TTable]['columns'], string>,
>(
  query: Query<TTable, Schema, TReturn>,
  column: TColumn,
): Query<TTable, Schema, TReturn> => (query as any).where(column, '=', '');

export const guestChannelAccessWhere = (ctx: Context): GuestPredicate => ({
  or,
  and,
  cmp,
  exists,
}: any) =>
  or(
    directGuestAccessExists(ctx, GuestEntity.CHANNEL)(exists),
    exists('participants', (participant: any) => participant.where('userId', '=', ctx.userID)),
    and(
      or(
        cmp('scopeType', '=', ChannelScopeType.DM),
        cmp('scopeType', '=', ChannelScopeType.GROUP_DM),
      ),
      exists('participants', (participant: any) => participant.where('userId', '=', ctx.userID)),
    ),
  );

// A board is visible to a guest when one of its mapped channels (channel_board_mappings) is
// accessible to them.
export const guestBoardAccessWhere = (ctx: Context): GuestPredicate => ({ exists }: any) =>
  exists('channelMappings', (mapping: any) =>
    mapping
      .where('workspaceId', '=', ctx.workspaceId)
      .whereExists('channel', (channel: any) => channel.where(guestChannelAccessWhere(ctx))),
  );

// A project is visible to a guest when any of its boards is.
export const guestProjectAccessWhere = (ctx: Context): GuestPredicate => ({ exists }: any) =>
  exists('boards', (board: any) => board.where(guestBoardAccessWhere(ctx)));

export const guestTicketAccessWhere = (ctx: Context): GuestPredicate => ({ or, exists }: any) =>
  or(
    exists('channel', (channel: any) => channel.where(guestChannelAccessWhere(ctx))),
  );

export const guestSubTicketAccessWhere = (ctx: Context): GuestPredicate => ({ or, exists }: any) =>
  or(
    exists('mappedTicket', (t: any) => t.where(guestTicketAccessWhere(ctx))),
    exists('conversation', (c: any) =>
      c.whereExists('channel', (ch: any) => ch.where(guestChannelAccessWhere(ctx))),
    ),
  );

export const guestCanvasAccessWhere = (ctx: Context): GuestPredicate => ({
  or,
  cmp,
  exists,
}: any) =>
  or(
    cmp('createdBy', '=', ctx.userID),
    exists('participants', (participant: any) => participant.where('userId', '=', ctx.userID)),
    exists('participants', (participant: any) =>
      participant.whereExists('channel', (channel: any) =>
        channel.where(guestChannelAccessWhere(ctx)),
      ),
    ),
    directGuestAccessExists(ctx, GuestEntity.CANVAS)(exists),
    exists('channel', (channel: any) =>
      channel.whereExists('guestAccess', (mapping: any) =>
        mapping
          .where('userId', '=', ctx.userID)
          .where('accessibleEntityType', '=', GuestEntity.CHANNEL),
      ),
    ),
  );

export const guestVisibleUserWhere = (ctx: Context): GuestPredicate => ({
  or,
  cmp,
  exists,
}: any) =>
  or(
    cmp('id', '=', ctx.userID),
    exists('channelParticipations', (channelParticipation: any) =>
      channelParticipation.whereExists('channel', (channel: any) =>
        channel.where('workspaceId', '=', ctx.workspaceId).where(guestChannelAccessWhere(ctx)),
      ),
    ),
  );
