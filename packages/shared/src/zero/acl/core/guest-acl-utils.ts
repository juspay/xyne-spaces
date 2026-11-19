import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { ChannelScopeType, FormContextType, GuestEntity, WorkspaceRole } from '../../schema';

type GuestPredicate = (helpers: any) => any;

const directGuestAccessExists = (ctx: Context, entityType: GuestEntity) => (exists: any) =>
  exists('guestAccess', (mapping: any) =>
    mapping.where('userId', '=', ctx.userID).where('accessibleEntityType', '=', entityType),
  );

const nonDmParticipantChannelExists = (ctx: Context) => (exists: any) =>
  exists('channels', (channel: any) =>
    channel
      .where('scopeType', '!=', ChannelScopeType.DM)
      .where('scopeType', '!=', ChannelScopeType.GROUP_DM)
      .whereExists('participants', (participant: any) =>
        participant.where('userId', '=', ctx.userID),
      ),
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

export const guestProjectAccessWhere = (ctx: Context): GuestPredicate => ({ or, exists }: any) =>
  or(
    exists('channels', (channel: any) =>
      channel.whereExists('guestAccess', (mapping: any) =>
        mapping
          .where('userId', '=', ctx.userID)
          .where('accessibleEntityType', '=', GuestEntity.CHANNEL),
      ),
    ),
    nonDmParticipantChannelExists(ctx)(exists),
  );

// A board is visible to a guest only through a channel it is linked to (a channel can
// link several boards) — never through the board's project.
const guestBoardAccessWhere = (ctx: Context): GuestPredicate => ({ exists }: any) =>
  exists('channelMappings', (mapping: any) =>
    mapping.whereExists('channel', (channel: any) => channel.where(guestChannelAccessWhere(ctx))),
  );

// A form reaches a guest through the board it is bound to: directly for board-level
// custom fields (contextType BOARD), or via the stage for stage-level forms.
export const guestFormContextMappingWhere = (ctx: Context): GuestPredicate => ({
  or,
  and,
  cmp,
  exists,
}: any) => {
  const guestBoard = (board: any) =>
    board.where('workspaceId', '=', ctx.workspaceId).where(guestBoardAccessWhere(ctx));
  return or(
    exists('stage', (stage: any) => stage.whereExists('board', guestBoard)),
    and(cmp('contextType', '=', FormContextType.BOARD), exists('board', guestBoard)),
  );
};

export const guestTicketAccessWhere = (ctx: Context): GuestPredicate => ({ or, exists }: any) =>
  or(
    exists('channel', (channel: any) => channel.where(guestChannelAccessWhere(ctx))),
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
