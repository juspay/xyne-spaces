import { transaction } from '../base';
import type { ExternalSourcePlatform } from '@/integrations/core/types';
import { db } from '@/database/client';
import { newConnectId, createConnectGroupForEntity, ConnectEntityType } from '@/database/connectGroup';
import {
  ChannelType,
  ChannelScopeType,
  ChannelVisibility,
  ChannelRole,
  DeskType,
  EmailMergeMode,
} from '@xyne/shared';
import { logger } from '@/utils/logger';

export interface MetaDeskSetup {
  userId: string;
  workspaceId: string;
  channelName: string;
  projectId: string;
  boardId?: string;
  assigneeUserGroupId?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
}

/** One connected Instagram account or Facebook Page. */
export interface MetaDeskSource {
  name: string;
  displayName: string;
  externalIdentifier: string;
  encryptedCredentials: string;
}

export function createMetaDeskTx(
  state: MetaDeskSetup,
  sourceType: ExternalSourcePlatform,
  sources: MetaDeskSource[],
  now: Date,
) {
  return transaction(
    ['Board', 'Channel', 'ChannelBoardMapping', 'ChannelParticipant', 'ChannelStats', 'ChannelUserStatus', 'EmailChannelPreference', 'ExternalSource', 'ConnectGroup'],
    'getInstagramOauthCallback: channel, participant, status, preference, board-mapping and external-source rows must commit atomically; tx is not ACL-wrapped',
    db,
    async (tx) => {
      // Slack Connect: the channel is a shareable entity → its own connectId + a private connect_group row.
      const connectId = newConnectId();
      const channel = await tx.channel.create({
        data: {
          name: state.channelName,
          type: ChannelType.SOCIAL_MEDIA,
          scopeType: ChannelScopeType.DEFAULT,
          visibility: state.visibility === 'PUBLIC' ? ChannelVisibility.PUBLIC : ChannelVisibility.PRIVATE,
          createdBy: state.userId,
          projectId: state.projectId,
          workspaceId: state.workspaceId,
          participantCount: 1,
          lastActivityAt: now,
          connectId,
        },
      });
      await createConnectGroupForEntity(tx, {
        entityType: ConnectEntityType.CHANNEL,
        entityId: channel.id,
        hostWorkspaceId: state.workspaceId,
        connectId,
      });
      await tx.channelParticipant.create({
        data: {
          workspaceId: state.workspaceId,
          channelId: channel.id,
          userId: state.userId,
          role: ChannelRole.ADMIN,
        },
      });
      await tx.channelUserStatus.create({
        data: {
          workspaceId: state.workspaceId,
          channelId: channel.id,
          userId: state.userId,
          updatedAt: now,
        },
      });
      await tx.channelStats.create({
        data: {
          workspaceId: state.workspaceId,
          channelId: channel.id,
          participantCount: 1,
          lastActivityAt: now,
        },
      });
      await tx.emailChannelPreference.create({
        data: {
          channelId: channel.id,
          workspaceId: state.workspaceId,
          ownerUserId: state.userId,
          assigneeUserGroupId: state.assigneeUserGroupId,
          boardId: state.boardId,
          deskType: DeskType.SOCIAL_MEDIA,
          emailMergeMode: EmailMergeMode.DISABLED,
        },
      });
      // Dual-write: mirror the channel→project board set into ChannelBoardMapping
      // so downstream consumers never need to read channel.projectId.
      const mappingBoards = await tx.board.findMany({
        where: { projectId: state.projectId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (mappingBoards.length > 0) {
        const defaultBoardId =
          state.boardId && mappingBoards.some((b) => b.id === state.boardId)
            ? state.boardId
            : mappingBoards[0].id;
        if (state.boardId && state.boardId !== defaultBoardId) {
          logger.warn(
            `[CBM_DEFAULT] Requested boardId ${state.boardId} is not in project ${state.projectId} for channel ${channel.id}; ` +
              `defaulting to oldest board ${defaultBoardId}.`,
          );
        }
        await tx.channelBoardMapping.createMany({
          data: mappingBoards.map((b) => ({
            channelId: channel.id,
            boardId: b.id,
            workspaceId: state.workspaceId,
            isDefault: b.id === defaultBoardId,
            createdBy: state.userId,
            createdAt: now,
            updatedAt: now,
          })),
          skipDuplicates: true,
        });
      }

      await tx.externalSource.createMany({
        data: sources.map((source) => ({
          name: source.name,
          sourceType,
          displayName: source.displayName || state.channelName,
          channelId: channel.id,
          externalIdentifier: source.externalIdentifier,
          workspaceId: state.workspaceId,
          boardId: state.boardId,
          ownerUserId: state.userId,
          credentials: source.encryptedCredentials,
          isActive: true,
        })),
      });
      return { channelId: channel.id };
    },
  );
}

// Adds further Instagram accounts or Facebook Pages to an already-existing channel.
// Does NOT create a new Channel row — only ExternalSource.
export function addMetaSourcesToChannelTx(
  channelId: string,
  workspaceId: string,
  userId: string,
  boardId: string | undefined,
  sourceType: ExternalSourcePlatform,
  sources: MetaDeskSource[],
) {
  return transaction(
    ['ExternalSource'],
    'addMetaSourcesToChannel: create ExternalSource rows for additional accounts on existing channel; tx is not ACL-wrapped',
    db,
    async (tx) => {
      await tx.externalSource.createMany({
        data: sources.map((source) => ({
          name: source.name,
          sourceType,
          displayName: source.displayName || source.name,
          channelId,
          externalIdentifier: source.externalIdentifier,
          workspaceId,
          boardId,
          ownerUserId: userId,
          credentials: source.encryptedCredentials,
          isActive: true,
        })),
      });
      return { channelId };
    },
  );
}
