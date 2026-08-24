import type { Transaction } from '@rocicorp/zero';
import { ChannelVisibility, GuestEntity, Schema } from '@xyne/shared';
import { zql } from '../../queries';
import type { QueryContext } from './types';
import { MutationACLError } from './types';

export type TicketScope = {
  workspaceId: string;
  channelId: string;
  projectId: string;
};

export async function hasGuestChannelAccess(
  ctx: QueryContext,
  tx: Transaction<Schema>,
  channelId: string,
): Promise<boolean> {
  return hasGuestChannelAccessForUser(ctx, tx, ctx.userID, channelId);
}

export async function hasGuestChannelAccessForUser(
  ctx: QueryContext,
  tx: Transaction<Schema>,
  userId: string,
  channelId: string,
): Promise<boolean> {
  const channel = await tx.run(zql.channels.where('id', '=', channelId).one());
  if (!channel || channel.workspaceId !== ctx.workspaceId) {
    return false;
  }

  const channelAccess = await tx.run(
    zql.guest_access
      .where('workspaceId', '=', ctx.workspaceId)
      .where('userId', '=', userId)
      .where('accessibleEntityType', '=', GuestEntity.CHANNEL)
      .where('accessibleEntityId', '=', channelId)
      .one(),
  );
  if (channelAccess) {
    return true;
  }

  const channelParticipant = await tx.run(
    zql.channel_participants
      .where('channelId', '=', channelId)
      .where('userId', '=', userId)
      .one(),
  );
  return Boolean(channelParticipant);
}

export async function hasGuestTicketAccess(
  ctx: QueryContext,
  tx: Transaction<Schema>,
  ticket: TicketScope,
): Promise<boolean> {
  if (ticket.workspaceId !== ctx.workspaceId) {
    return false;
  }

  const channelAccess = await tx.run(
    zql.guest_access
      .where('workspaceId', '=', ctx.workspaceId)
      .where('userId', '=', ctx.userID)
      .where('accessibleEntityType', '=', GuestEntity.CHANNEL)
      .where('accessibleEntityId', '=', ticket.channelId)
      .one(),
  );
  if (channelAccess) {
    return true;
  }

  const channelParticipant = await tx.run(
    zql.channel_participants
      .where('channelId', '=', ticket.channelId)
      .where('userId', '=', ctx.userID)
      .one(),
  );
  return Boolean(channelParticipant);
}

/**
 * Slack-Connect — is the caller an ACTIVE member of this connect channel?
 * The write-side twin of the read predicate `connectChannelAccessWhere`. Grants cross-org
 * write access: an active `connect_channel_member` may mutate the (host) channel's content
 * regardless of workspace. `channelId` is always the HOST channel id.
 */
export async function isActiveConnectMember(
  ctx: QueryContext,
  tx: Transaction<Schema>,
  channelId: string,
): Promise<boolean> {
  const member = await tx.run(
    zql.connect_channel_member
      .where('channelId', '=', channelId)
      .where('userId', '=', ctx.userID)
      .where('leftAt', 'IS', null)
      .one(),
  );
  return Boolean(member);
}

export async function hasChannelMutationAccess(
  ctx: QueryContext,
  tx: Transaction<Schema>,
  channelId: string,
  options?: { allowPublicForNonGuests?: boolean },
): Promise<boolean> {
  // Slack-Connect: an active connect member may mutate the channel's content cross-org.
  if (await isActiveConnectMember(ctx, tx, channelId)) {
    return true;
  }

  const allowPublicForNonGuests = options?.allowPublicForNonGuests ?? true;

  const channel = await tx.run(zql.channels.where('id', '=', channelId).one());
  if (!channel || channel.workspaceId !== ctx.workspaceId) {
    return false;
  }

  if (ctx.role === 'GUEST') {
    return hasGuestChannelAccess(ctx, tx, channelId);
  }

  if (allowPublicForNonGuests && channel.visibility === ChannelVisibility.PUBLIC) {
    return true;
  }

  const participant = await tx.run(
    zql.channel_participants
      .where('channelId', '=', channelId)
      .where('userId', '=', ctx.userID)
      .one(),
  );

  return Boolean(participant);
}

export function assertGuestWriteBlocked(
  ctx: QueryContext,
  tableName: string,
  action: 'insert' | 'update' | 'delete' | 'upsert',
  subject: string,
): void {
  if (ctx.role === 'GUEST') {
    throw new MutationACLError(
      `${subject} ${action} failed: guests cannot modify ${subject.toLowerCase()}`,
      tableName,
    );
  }
}
