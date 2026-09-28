import { transaction } from '../base';
import { GoogleService } from '@/services/googleService';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import { config as appConfig } from '@/config/env';
import { db } from '@/database/client';
import { PendingChannelData } from '@/integrations/routes/google-auth';
import { logger } from '@/utils/logger';
import { ChannelScopeType, ChannelType, ChannelRole, EmailMergeMode, DeskType } from '@xyne/shared';


export function getAuthCallbackTx(cd: PendingChannelData, network: Awaited<ReturnType<typeof GoogleService.prepareExternalSourceNetwork>>, emailAddress: any) {
  return transaction(['Board', 'Channel', 'ChannelBoardMapping', 'ChannelParticipant', 'ChannelStats', 'ChannelUserStatus', 'Conversation', 'EmailChannelPreference', 'ExternalSource'], 'getAuthCallback: channel, participant, status, preference, board-mapping and external-source rows must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const ch = await tx.channel.create({
      data: {
        scopeType: ChannelScopeType.DEFAULT,
        name: cd.name,
        description: cd.description,
        visibility: cd.visibility === 'private' ? 'PRIVATE' : 'PUBLIC',
        createdBy: cd.userId,
        workspaceId: cd.workspaceId,
        projectId: cd.projectId,
        type: ChannelType.EMAIL,
      },
    });
    const now = new Date();
    const seenConversations = await tx.conversation.findMany({
      where: {
        channelId: ch.id,
        createdAt: { lte: now },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { createdAt: true },
    });
    const conversationSeenCutoffAt =
      seenConversations[seenConversations.length - 1]?.createdAt ?? now;

    await tx.channelParticipant.create({
      data: { channelId: ch.id, userId: cd.userId, role: ChannelRole.ADMIN, workspaceId: cd.workspaceId },
    });

    await tx.channelUserStatus.create({
      data: {
        channelId: ch.id,
        userId: cd.userId,
        lastViewedAt: now,
        conversationSeenCutoffAt,
        updatedAt: now,
        workspaceId: cd.workspaceId,
      },
    });

    await tx.channelStats.create({
      data: {
        channelId: ch.id,
        lastActivityAt: now,
        participantCount: 1,
        workspaceId: cd.workspaceId,
      },
    });

    // Create EmailChannelPreference for owner and assignee tracking
    // Note: We create it directly in the transaction, bypassing repository validation
    // since we already know this is an EMAIL channel
    await tx.emailChannelPreference.create({
      data: {
        channelId: ch.id,
        ownerUserId: cd.userId,
        ...(cd.assigneeUserGroupId && { assigneeUserGroupId: cd.assigneeUserGroupId }),
        ...(cd.boardId && { boardId: cd.boardId }),
        emailMergeMode: appConfig.emailMergeModeDefault as EmailMergeMode,
        deskType: DeskType.EMAIL,
        workspaceId: cd.workspaceId,
      },
    });

    const boards = await tx.board.findMany({
      where: { projectId: cd.projectId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const board = boards[0] ?? null;

    // Dual-write: mirror the channel→project board set into ChannelBoardMapping
    // so downstream consumers never need to read channel.projectId.
    if (boards.length > 0) {
      // Resolve the default board: honour the requested boardId only when it
      // actually belongs to this project's board set, otherwise fall back to
      // the oldest board. Without this guard a requested boardId outside the
      // project yields a mapping set with NO default row.
      const defaultBoardId =
        cd.boardId && boards.some((b) => b.id === cd.boardId)
          ? cd.boardId
          : boards[0].id;
      if (cd.boardId && cd.boardId !== defaultBoardId) {
        logger.warn(
          `[CBM_DEFAULT] Requested boardId ${cd.boardId} is not in project ${cd.projectId} for channel ${ch.id}; ` +
            `defaulting to oldest board ${defaultBoardId}.`,
        );
      }
      await tx.channelBoardMapping.createMany({
        data: boards.map((b) => ({
          channelId: ch.id,
          boardId: b.id,
          workspaceId: cd.workspaceId,
          isDefault: b.id === defaultBoardId,
          createdBy: cd.userId,
          createdAt: now,
          updatedAt: now,
        })),
        skipDuplicates: true,
      });
    }

    await tx.externalSource.create({
      data: {
        name: network.sourceName,
        sourceType: ExternalSourcePlatform.GOOGLE,
        displayName: emailAddress,
        channelId: ch.id,
        boardId: cd.boardId ?? board?.id,
        credentials: network.encryptedCredentials,
        ownerUserId: cd.userId,
        isActive: true,
        workspaceId: cd.workspaceId,
        lastSyncCursor: network.watchResult.historyId,
      },
    });

    return { channelId: ch.id };
  });
}
