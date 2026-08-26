import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { ChannelScopeType, GuestEntity, WorkspaceRole } from '../../schema';

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

/**
 * Slack-Connect — channel-level predicate: "this channel is a connect channel and I am
 * an ACTIVE member of it" (a `connect_channel_member` row for my userId with leftAt IS NULL).
 *
 * Used to relax content ACLs cross-org: a content table's channel gate becomes
 * `OR(workspaceId = ctx, connectChannelAccessWhere(ctx))`. User-scoped by design — you can
 * only read a connect channel's content if you are actually in it (host or guest, same rule).
 * Departed members (leftAt set) lose access; their past authorship still resolves via §5.
 */
export const connectChannelAccessWhere = (ctx: Context): GuestPredicate => ({ exists }: any) =>
  exists('connectMembers', (member: any) =>
    member.where('userId', '=', ctx.userID).where('leftAt', 'IS', null),
  );

/**
 * Slack-Connect — USERS-table predicate: "this user shares ≥1 connect channel with me"
 * (the co-membership self-join, §5). A foreign user U is visible iff U has ANY membership
 * (active OR departed) in some channel C where I am an ACTIVE connect member.
 *
 * ASYMMETRIC on purpose (§5): the SUBJECT is NOT gated on leftAt — a DEPARTED member's name/
 * avatar must still resolve so their old messages don't render as a broken "User". Only the
 * READER (me) must be active. Used to relax the `users` read ACL:
 * `OR(workspaceId = ctx, connectCoMemberUserWhere)`. For presence use
 * {@link connectCoMemberPresenceWhere} instead (a departed member must not keep broadcasting).
 * Requires the `connectMemberships` (users→member) and `channel` (member→channels)
 * relationships plus `connectMembers` (channels→member).
 */
export const connectCoMemberUserWhere = (ctx: Context): GuestPredicate => ({ exists }: any) =>
  exists('connectMemberships', (membership: any) =>
    // NO leftAt filter on the subject — departed authors still resolve (historical authorship).
    membership.whereExists('channel', (ch: any) =>
      ch.whereExists('connectMembers', (me: any) =>
        me.where('userId', '=', ctx.userID).where('leftAt', 'IS', null),
      ),
    ),
  );

/**
 * Slack-Connect — USER_PRESENCE predicate. Same co-membership self-join as
 * {@link connectCoMemberUserWhere} but the SUBJECT MUST be active (`leftAt IS NULL`): a member
 * who LEFT a connect channel must not keep broadcasting live presence into it (§5). Departed
 * users still resolve name/avatar via `connectCoMemberUserWhere`, just not presence.
 */
export const connectCoMemberPresenceWhere = (ctx: Context): GuestPredicate => ({ exists }: any) =>
  exists('connectMemberships', (membership: any) =>
    membership.where('leftAt', 'IS', null).whereExists('channel', (ch: any) =>
      ch.whereExists('connectMembers', (me: any) =>
        me.where('userId', '=', ctx.userID).where('leftAt', 'IS', null),
      ),
    ),
  );

/**
 * Slack-Connect — channel-level visibility combinator: the normal same-workspace rule
 * OR active connect membership. Use inside `ch.where(...)` (or on the channels table
 * directly) wherever a content ACL gates on the channel:
 *
 *   ch.where(channelVisibleWhere(ctx, (h) => or(PUBLIC, participant)))
 *
 * `baseInner` is the workspace-relative rule (e.g. public-or-participant, or
 * `guestChannelAccessWhere(ctx)`); it is ANDed with `workspaceId = ctx` so the
 * same-workspace path is unchanged, and the connect path is added as an alternative.
 *
 * IMPORTANT: any table using this must be opted out of the define-query.ts workspace
 * backstop (else the root `workspaceId = ctx` re-clamp nullifies the connect branch).
 */
export const channelVisibleWhere =
  (ctx: Context, baseInner: GuestPredicate): GuestPredicate =>
  (h: any) =>
    h.or(
      h.and(h.cmp('workspaceId', '=', ctx.workspaceId), baseInner(h)),
      connectChannelAccessWhere(ctx)(h),
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
