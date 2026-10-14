import { Prisma, type Channel } from '@prisma/client';
import { ChannelRole, ChannelScopeType, ChannelVisibility } from '@xyne/shared';
import { transaction, type TxCapableClient } from '../base';
import { newConnectId } from '@/database/connectGroup';
import { createChannelWithConnectGroupMaybeTx } from './connectGroupEntities';
import type { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';

export interface OneOnOneDmInput {
  userId: string;
  targetUserId: string;
  channelParticipants: ChannelParticipantRepository;
  workspaceId: string;
  projectId: string;
  description?: string;
  creatorIsClosed?: boolean;
  targetIsClosed?: boolean;
}

/**
 * One attempt at finding or creating a 1:1 DM. The probe on the pair's
 * canonical name (sorted user ids) and the insert run in one SERIALIZABLE
 * transaction, so two concurrent requests for the same pair cannot both insert:
 * Postgres fails one commit with P2034 and the caller
 * (ChannelRepository.findOrCreateOneOnOneDMChannel) retries, finding the
 * winner's channel. A new channel is committed together with its connect_group
 * row, its board mappings and both participants.
 */
export function findOrCreateOneOnOneDmTx(
  client: TxCapableClient,
  input: OneOnOneDmInput,
): Promise<{ channel: Channel; isExisting: boolean }> {
  const {
    userId,
    targetUserId,
    channelParticipants,
    workspaceId,
    projectId,
    description,
    creatorIsClosed = false,
    targetIsClosed = false,
  } = input;
  const name = [userId, targetUserId].sort().join(',');

  return transaction(
    ['Channel', 'ConnectGroup', 'Board', 'ChannelBoardMapping', 'ChannelParticipant', 'ChannelStats', 'ChannelUserStatus'],
    'findOrCreateOneOnOneDm: DM probe and insert (channel, connect_group, board mappings, participants) must commit atomically under SERIALIZABLE; tx is not ACL-wrapped',
    client,
    async (tx) => {
      const existing = await tx.channel.findFirst({
        where: { workspaceId, scopeType: ChannelScopeType.DM, name },
        orderBy: { createdAt: 'asc' },
      });
      if (existing) return { channel: existing, isExisting: true };

      // Same channel + connect_group write as ChannelRepository.create, run on
      // this transaction so the DM is visible to connectReach from creation.
      const connectId = newConnectId();
      const { id: channelId } = await createChannelWithConnectGroupMaybeTx(
        tx,
        {
          scopeType: ChannelScopeType.DM,
          name,
          description,
          visibility: ChannelVisibility.PRIVATE,
          createdBy: userId,
          projectId,
          workspaceId,
          connectId,
        },
        workspaceId,
        connectId,
      );
      const channel = await tx.channel.findUniqueOrThrow({ where: { id: channelId } });

      // Preserve ChannelRepository.create's channel→board dual-write.
      const boards = await tx.board.findMany({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (boards.length > 0) {
        const now = new Date();
        await tx.channelBoardMapping.createMany({
          data: boards.map((board, index) => ({
            channelId: channel.id,
            boardId: board.id,
            workspaceId,
            isDefault: index === 0,
            createdBy: userId,
            createdAt: now,
            updatedAt: now,
          })),
          skipDuplicates: true,
        });
      }

      await channelParticipants.addParticipantInTransaction(
        tx, channel.id, userId, null, ChannelRole.ADMIN, creatorIsClosed,
      );
      await channelParticipants.addParticipantInTransaction(
        tx, channel.id, targetUserId, null, ChannelRole.MEMBER, targetIsClosed,
      );

      return { channel, isExisting: false };
    },
    {
      timeout: 10_000,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}
