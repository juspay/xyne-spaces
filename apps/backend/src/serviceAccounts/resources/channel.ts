// A guest's channel access is two rows (guest_access + channel_participants); the guest ACL
// passes on either, so they are always added and removed together.
import { ChannelRole, ChannelScopeType, GuestEntity } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { ServiceAccountResourceType } from '../constants';
import { ServiceAccountError } from '../errors';
import type { ResourceType } from './types';

type SeenCutoffs = Map<string, Date | null>;

export const channelResource: ResourceType<SeenCutoffs> = {
  type: ServiceAccountResourceType.CHANNEL,

  async assertUsable(workspaceId, ids) {
    if (ids.length === 0) return;
    const channels = await db.channel.findMany({
      where: { id: { in: ids }, workspaceId },
      select: { id: true, isArchived: true, scopeType: true },
    });
    const missing = ids.filter((id) => !channels.some((channel) => channel.id === id));
    if (missing.length > 0) {
      throw new ServiceAccountError('not_found', `${missing.join(', ')} not found.`, { reason: 'channel_not_found' });
    }
    const archived = channels.filter((channel) => channel.isArchived).map((channel) => channel.id);
    if (archived.length > 0) {
      throw new ServiceAccountError('validation_failed', `${archived.join(', ')} is archived.`, {
        reason: 'channel_archived',
      });
    }
    const dms = channels
      .filter((channel) => channel.scopeType === ChannelScopeType.DM || channel.scopeType === ChannelScopeType.GROUP_DM)
      .map((channel) => channel.id);
    if (dms.length > 0) {
      throw new ServiceAccountError('validation_failed', `${dms.join(', ')} is a direct message.`, {
        reason: 'channel_not_allowed',
      });
    }
  },

  async administeredBy(userId, ids) {
    if (ids.length === 0) return new Set();
    const rows = await db.channelParticipant.findMany({
      where: { userId, channelId: { in: ids }, role: ChannelRole.ADMIN },
      select: { channelId: true },
    });
    return new Set(rows.map((row) => row.channelId));
  },

  async prepare(ids) {
    const entries = await Promise.all(
      ids.map(async (id) => [id, await repositories.channelParticipants.resolveSeenCutoff(id)] as const),
    );
    return new Map(entries);
  },

  async grant(tx, { workspaceId, userId, id, grantedBy }, seenCutoffs) {
    await tx.guestAccess.upsert({
      where: {
        userId_accessibleEntityId_accessibleEntityType: {
          userId,
          accessibleEntityId: id,
          accessibleEntityType: GuestEntity.CHANNEL,
        },
      },
      update: { invitedBy: grantedBy },
      create: {
        userId,
        workspaceId,
        accessibleEntityId: id,
        accessibleEntityType: GuestEntity.CHANNEL,
        invitedBy: grantedBy,
        createdAt: new Date(),
      },
    });
    await repositories.channelParticipants.addParticipantInTransaction(tx, id, userId, seenCutoffs.get(id) ?? null);
  },

  async revoke(tx, { workspaceId, userId, id }) {
    await tx.guestAccess.deleteMany({
      where: { workspaceId, userId, accessibleEntityId: id, accessibleEntityType: GuestEntity.CHANNEL },
    });
    const removed = await tx.channelParticipant.deleteMany({ where: { channelId: id, userId } });
    await tx.channelUserStatus.deleteMany({ where: { channelId: id, userId } });
    if (removed.count > 0) {
      await tx.channelStats.updateMany({
        where: { channelId: id },
        data: { participantCount: { decrement: removed.count } },
      });
    }
  },

  async heldBy(workspaceId, userIds) {
    const rows = await db.guestAccess.findMany({
      where: { workspaceId, userId: { in: userIds }, accessibleEntityType: GuestEntity.CHANNEL },
      select: { userId: true, accessibleEntityId: true },
      orderBy: { createdAt: 'asc' },
    });
    const byUser = new Map<string, string[]>();
    for (const row of rows) {
      byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.accessibleEntityId]);
    }
    return byUser;
  },

  async grantees(workspaceId, id, grantedBy) {
    const rows = await db.guestAccess.findMany({
      where: { workspaceId, accessibleEntityType: GuestEntity.CHANNEL, accessibleEntityId: id, invitedBy: grantedBy },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  },
};
