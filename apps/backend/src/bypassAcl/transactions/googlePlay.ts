import { transaction } from '../base';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { db } from '@/database/client';
import { GooglePlayOAuthState } from '@/integrations/adapters/social-media/google-play/oauthStateService';
import { buildGooglePlaySourceRecords } from '@/integrations/adapters/social-media/google-play/sourceRecords';
import { logger } from '@/utils/logger';
import { ChannelType, ChannelScopeType, ChannelVisibility, ChannelRole, DeskType, EmailMergeMode } from '@xyne/shared';


export function getGooglePlayOauthCallbackTx(state: GooglePlayOAuthState, encryptedCredentials: string, now: Date) {
  return transaction(['Board', 'Channel', 'ChannelBoardMapping', 'ChannelParticipant', 'ChannelStats', 'ChannelUserStatus', 'EmailChannelPreference', 'ExternalSource'], 'getGooglePlayOauthCallback: channel, participant, status, preference, board-mapping and external-source rows must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    if (state.mode === 'reconnect' && state.channelId) {
      const [channel, preference, sources] = await Promise.all([
        tx.channel.findFirst({
          where: {
            id: state.channelId,
            workspaceId: state.workspaceId,
            type: ChannelType.SOCIAL_MEDIA,
          },
          select: { id: true, createdBy: true },
        }),
        tx.emailChannelPreference.findUnique({
          where: { channelId: state.channelId },
          select: { ownerUserId: true },
        }),
        tx.externalSource.findMany({
          where: {
            channelId: state.channelId,
            workspaceId: state.workspaceId,
            sourceType: ExternalSourcePlatform.GOOGLE_PLAY,
          },
          select: { id: true, externalIdentifier: true, isActive: true },
        }),
      ]);
      if (
        !channel ||
        (channel.createdBy !== state.userId && preference?.ownerUserId !== state.userId)
      ) {
        throw new Error('The user can no longer manage this social media desk');
      }

      const expectedPackages = new Set(
        state.applications.map((application) => application.packageName)
      );
      const sourcesToValidate = state.reactivateAll
        ? sources
        : sources.filter((source) => source.isActive);
      if (
        sourcesToValidate.length !== expectedPackages.size ||
        sourcesToValidate.some(
          (source) =>
            !source.externalIdentifier || !expectedPackages.has(source.externalIdentifier)
        )
      ) {
        throw new Error('Google Play app configuration changed during reconnection');
      }

      await tx.externalSource.updateMany({
        where: { id: { in: sources.map((source) => source.id) } },
        data: {
          credentials: encryptedCredentials,
          ...(state.reactivateAll && { isActive: true }),
        },
      });
      return {
        channelId: channel.id,
        sourceIds: sources.map((source) => source.id),
      };
    }

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
      },
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
