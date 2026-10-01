import { transaction } from '../base';
import { db } from '@/database/client';
import { newConnectId, createConnectGroupForEntity } from '@/database/connectGroup';
import { buildGooglePlaySourceRecords } from '@/integrations/adapters/social-media/google-play/sourceRecords';
import { logger } from '@/utils/logger';
import { ChannelType, ChannelScopeType, ChannelVisibility, ChannelRole, DeskType, EmailMergeMode } from '@xyne/shared';


interface GooglePlayConnectInput {
  channelName: string;
  applications: Array<{
    packageName: string;
    displayName: string;
  }>;
  projectId: string;
  boardId: string;
  assigneeUserGroupId?: string;
  visibility: 'PUBLIC' | 'PRIVATE';
}

export function postGooglePlayConnectTx(state: GooglePlayConnectInput & { userId: string; workspaceId: string }, encryptedCredentials: string, now: Date) {
  return transaction(['Board', 'Channel', 'ChannelBoardMapping', 'ChannelParticipant', 'ChannelStats', 'ChannelUserStatus', 'EmailChannelPreference', 'ExternalSource', 'ConnectGroup'], 'postGooglePlayConnect: channel, participant, status, preference, board-mapping and external-source rows must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    // Slack Connect: the channel is a shareable entity → its own connectId + a private connect_group row.
    const connectId = newConnectId();
    const channel = await tx.channel.create({
      data: {
        name: state.channelName,
        description: `Google Play reviews for ${state.applications.length} application${
            state.applications.length === 1 ? '' : 's'
          }`,
        type: ChannelType.SOCIAL_MEDIA,
        scopeType: ChannelScopeType.DEFAULT,
        visibility: state.visibility as ChannelVisibility,
        createdBy: state.userId,
        projectId: state.projectId,
        workspaceId: state.workspaceId,
        participantCount: 1,
        lastActivityAt: now,
        connectId,
      },
    });
    await createConnectGroupForEntity(tx, {
      entityType: 'channel',
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
      // Resolve the default board: honour the requested boardId only when it
      // actually belongs to this project's board set, otherwise fall back to
      // the oldest board. Without this guard a requested boardId outside the
      // project yields a mapping set with NO default row.
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

    const sourceRecords = buildGooglePlaySourceRecords({
      workspaceId: state.workspaceId,
      channelId: channel.id,
      boardId: state.boardId,
      ownerUserId: state.userId,
      encryptedCredentials,
      applications: state.applications,
    });
    await Promise.all(
      sourceRecords.map((data) =>
        tx.externalSource.create({
          data,
          select: { id: true },
        })
      )
    );
    return { channelId: channel.id };
  });
}
