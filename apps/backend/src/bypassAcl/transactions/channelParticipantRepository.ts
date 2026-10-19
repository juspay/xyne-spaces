import { transaction } from '../base';
import { resolveWorkspaceIdFromModel } from '@/database/tenant/workspace-utils';
import { ChannelParticipantRepository, CreateChannelParticipantInput } from '@/database/repositories/channelParticipantRepository';
import { ChannelRole } from '@xyne/shared';


export function createTx(self: ChannelParticipantRepository, data: CreateChannelParticipantInput) {
  return transaction(['Channel', 'ChannelParticipant', 'ChannelStats', 'ChannelUserStatus', 'Conversation'], 'create: channel participant, status and stats creation must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    const now = new Date();
    const conversationSeenCutoffAt = await self.getConversationSeenCutoffAt(
      tx,
      data.channelId,
      now,
    );

    const workspaceId = await resolveWorkspaceIdFromModel(tx, 'channel', { id: data.channelId });

    const participant = await tx.channelParticipant.create({
      data: {
        channelId: data.channelId,
        workspaceId,
        userId: data.userId,
        role: data.role || 'MEMBER',
      }
    });

    // Automatically create status record. Use upsert so a pre-existing status
    // row (e.g. orphaned from a prior partial migration run) is left as-is
    // instead of throwing a unique-constraint error on (channelId, userId).
    // desktopNotificationLevel / mobileNotificationLevel intentionally omitted —
    // null (inherit global) is the DB column default.
    await tx.channelUserStatus.upsert({
      where: { channelId_userId: { channelId: data.channelId, userId: data.userId } },
      update: {},
      create: {
        channelId: data.channelId,
        workspaceId,
        userId: data.userId,
        isClosed: false,
        isStarred: false,
        lastViewedAt: now,
        conversationSeenCutoffAt,
      }
    });

    // Increment participantCount in channel_stats
    await tx.channelStats.upsert({
      where: { channelId: data.channelId },
      update: { participantCount: { increment: 1 } },
      create: { channelId: data.channelId, workspaceId, participantCount: 1, lastActivityAt: new Date()},
    });

    return participant;
  });
}
export function addParticipantTx(self: ChannelParticipantRepository, channelId: string, userId: string, conversationSeenCutoffAt: Date | null, role: ChannelRole, isClosed: boolean) {
  return transaction(['Channel', 'ChannelParticipant', 'ChannelStats', 'ChannelUserStatus'], 'addParticipant: single participant insert with status and stats must commit atomically; tx is not ACL-wrapped', self.db, async (tx) =>
    self.addParticipantInTransaction(tx, channelId, userId, conversationSeenCutoffAt, role, isClosed)
  );
}
export function removeParticipantTx(self: ChannelParticipantRepository, participant: any, channelId: string, userId: string) {
  return transaction(['ChannelParticipant', 'ChannelStats', 'ChannelUserStatus'], 'removeParticipant: participant, status and stats decrement must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    // Delete participant
    await tx.channelParticipant.delete({
      where: { id: participant.id }
    });

    // Also delete the status record
    await tx.channelUserStatus.deleteMany({
      where: { channelId, userId }
    });

    // Decrement participantCount in channel_stats
    await tx.channelStats.update({
      where: { channelId },
      data: { participantCount: { decrement: 1 } },
    });
  });
}
export function addParticipantsBatchTx(self: ChannelParticipantRepository, overrideCutoffAt: Date | undefined, channelId: string, userIds: string[], role: ChannelRole, isClosed: boolean) {
  return transaction(['Channel', 'ChannelParticipant', 'ChannelStats', 'ChannelUserStatus', 'Conversation'], 'addParticipantsBatch: batch participant inserts with status and stats must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    const now = new Date();
    const conversationSeenCutoffAt = overrideCutoffAt !== undefined
      ? overrideCutoffAt
      : await self.getConversationSeenCutoffAt(tx, channelId, now);
    const existingParticipants = await tx.channelParticipant.findMany({
      where: {
        channelId,
        userId: {
          in: userIds,
        },
      },
      select: {
        userId: true,
      },
    });

    const existingUserIds = new Set(existingParticipants.map((p) => p.userId));
    const newUserIds = userIds.filter((id) => !existingUserIds.has(id));

    if (newUserIds.length === 0) {
      return { addedCount: 0, existingCount: existingUserIds.size };
    }

    const workspaceId = await resolveWorkspaceIdFromModel(tx, 'channel', { id: channelId });

    await tx.channelParticipant.createMany({
      data: newUserIds.map((userId) => ({
        channelId,
        workspaceId,
        userId,
        role: role || 'MEMBER',
      })),
      skipDuplicates: true,
    });

    await tx.channelUserStatus.createMany({
      data: newUserIds.map((userId) => ({
        channelId,
        workspaceId,
        userId,
        isClosed,
        isStarred: false,
        lastViewedAt: now,
        conversationSeenCutoffAt,
      })),
      skipDuplicates: true,
    });

    await tx.channelStats.upsert({
      where: { channelId },
      update: { participantCount: { increment: newUserIds.length } },
      create: { channelId, workspaceId, participantCount: newUserIds.length, lastActivityAt: new Date() },
    });

    return { addedCount: newUserIds.length, existingCount: existingUserIds.size };
  });
}

export interface ParticipantRoleChange {
  userId: string;
  role: ChannelRole;
}

/**
 * New participants (each with its own role) and role changes for existing ones, in one transaction.
 * The result holds only what this transaction really did: inserts use ON CONFLICT DO NOTHING and
 * role updates are guarded on the old role, so two concurrent calls for the same user do it once
 * between them, and the status rows and participant count follow the rows actually created.
 */
export function applyParticipantChangesTx(self: ChannelParticipantRepository, channelId: string, adds: ParticipantRoleChange[], updates: ParticipantRoleChange[]) {
  return transaction(['Channel', 'ChannelParticipant', 'ChannelStats', 'ChannelUserStatus', 'Conversation'], 'applyParticipantChanges: participant inserts, role updates, status and stats must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    const now = new Date();
    const workspaceId = await resolveWorkspaceIdFromModel(tx, 'channel', { id: channelId });

    const inserted = adds.length === 0
      ? []
      : await tx.channelParticipant.createManyAndReturn({
          data: adds.map(({ userId, role }) => ({ channelId, workspaceId, userId, role })),
          skipDuplicates: true,
          select: { id: true, userId: true, role: true },
        });

    if (inserted.length > 0) {
      const conversationSeenCutoffAt = await self.getConversationSeenCutoffAt(tx, channelId, now);
      await tx.channelUserStatus.createMany({
        data: inserted.map(({ userId }) => ({
          channelId,
          workspaceId,
          userId,
          isClosed: false,
          isStarred: false,
          lastViewedAt: now,
          conversationSeenCutoffAt,
        })),
        skipDuplicates: true,
      });
      await tx.channelStats.upsert({
        where: { channelId },
        update: { participantCount: { increment: inserted.length } },
        create: { channelId, workspaceId, participantCount: inserted.length, lastActivityAt: now },
      });
    }

    const updated: Array<{ userId: string; oldRole: string; role: ChannelRole }> = [];
    if (updates.length > 0) {
      const before = await tx.channelParticipant.findMany({
        where: { channelId, userId: { in: updates.map(({ userId }) => userId) } },
        select: { userId: true, role: true },
      });
      const oldRole = new Map(before.map((participant) => [participant.userId, participant.role]));
      for (const { userId, role } of updates) {
        const previous = oldRole.get(userId);
        if (previous === undefined || previous === role) continue;
        const { count } = await tx.channelParticipant.updateMany({
          where: { channelId, userId, role: previous },
          data: { role },
        });
        if (count > 0) updated.push({ userId, oldRole: previous, role });
      }
    }

    return { inserted, updated };
  });
}
