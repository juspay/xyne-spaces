import { transaction } from '../base';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { MicrosoftDeskService, PendingChannelCreate } from '@/services/microsoftDeskService';
import { logger } from '@/utils/logger';
import { ChannelScopeType, ChannelType, ChannelRole, EmailMergeMode, DeskType } from '@xyne/shared';


export function createChannelAndSourceTx(channelData: PendingChannelCreate, sourceName: string, credentials: { accessToken: string; refreshToken?: string; email: string; expiresAt?: string; }, encryptedCredentials: string, self: MicrosoftDeskService, webhookUrl: string, clientState: string) {
  return transaction(['Board', 'Channel', 'ChannelBoardMapping', 'ChannelParticipant', 'ChannelStats', 'ChannelUserStatus', 'Conversation', 'EmailChannelPreference', 'ExternalSource'], 'createChannelAndSource: channel, participant, status, preference, board-mapping and external-source rows must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const channel = await tx.channel.create({
      data: {
        scopeType: ChannelScopeType.DEFAULT,
        name: channelData.name,
        description: channelData.description,
        visibility: channelData.visibility === 'private' ? 'PRIVATE' : 'PUBLIC',
        createdBy: channelData.userId,
        workspaceId: channelData.workspaceId,
        projectId: channelData.projectId,
        type: ChannelType.EMAIL,
      },
    });

    const now = new Date();
    const seenConversations = await tx.conversation.findMany({
      where: {
        channelId: channel.id,
        createdAt: { lte: now },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { createdAt: true },
    });
    const conversationSeenCutoffAt =
      seenConversations[seenConversations.length - 1]?.createdAt ?? now;

    await tx.channelParticipant.create({
      data: {
        channelId: channel.id,
        userId: channelData.userId,
        role: ChannelRole.ADMIN,
        workspaceId: channelData.workspaceId,
      },
    });

    await tx.channelUserStatus.create({
      data: {
        channelId: channel.id,
        userId: channelData.userId,
        lastViewedAt: now,
        conversationSeenCutoffAt,
        updatedAt: now,
        workspaceId: channelData.workspaceId,
      },
    });

    await tx.channelStats.create({
      data: {
        channelId: channel.id,
        lastActivityAt: now,
        participantCount: 1,
        workspaceId: channelData.workspaceId,
      },
    });

    // Reuse the project's boards (same pattern as Google) — no per-connection
    // board/stages creation. If the project has no boards yet, the mapping list is empty.
    const boards = await tx.board.findMany({
      where: { projectId: channelData.projectId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const board = boards[0] ?? null;

    // Populate ChannelBoardMapping so downstream consumers can resolve
    // channel→boards without going through channel.projectId.
    // Default: explicit channelData.boardId if provided, else the first (oldest) board.
    if (boards.length > 0) {
      // Honour the requested boardId only when it actually belongs to this
      // project's board set, otherwise fall back to the oldest board. Without
      // this guard a requested boardId outside the project yields a mapping
      // set with NO default row.
      const defaultBoardId =
        channelData.boardId && boards.some(b => b.id === channelData.boardId)
          ? channelData.boardId
          : boards[0].id;
      if (channelData.boardId && channelData.boardId !== defaultBoardId) {
        logger.warn(
          `[CBM_DEFAULT] Requested boardId ${channelData.boardId} is not in project ${channelData.projectId} for channel ${channel.id}; ` +
            `defaulting to oldest board ${defaultBoardId}.`,
        );
      }
      await tx.channelBoardMapping.createMany({
        data: boards.map(b => ({
          channelId: channel.id,
          boardId: b.id,
          workspaceId: channelData.workspaceId,
          isDefault: b.id === defaultBoardId,
          createdBy: channelData.userId,
          createdAt: now,
          updatedAt: now,
        })),
        skipDuplicates: true,
      });
    }

    await tx.externalSource.create({
      data: {
        name: sourceName,
        sourceType: 'microsoft',
        displayName: credentials.email,
        channelId: channel.id,
        boardId: channelData.boardId ?? board?.id, // @deprecated - kept for backward compatibility
        workspaceId: channelData.workspaceId,
        credentials: encryptedCredentials,
        isActive: true,
        // Cursor intentionally left null — the caller triggers an initial refetch
        // which takes the no-cursor fallback path and writes the cursor via nextCursor,
        // so the latest messages are auto-imported on first connect.
      },
    });

    // Create EmailChannelPreference for owner tracking and boardId
    // Author for auto-created tickets & postprocess actions — same user who's
    // creating the channel (matches the other `createdBy` rows above).
    // Note: We create it directly in the transaction, bypassing repository validation
    // since we already know this is an EMAIL channel
    await tx.emailChannelPreference.create({
      data: {
        channelId: channel.id,
        ownerUserId: channelData.userId,
        ...(channelData.assigneeUserGroupId && { assigneeUserGroupId: channelData.assigneeUserGroupId }),
        ...(channelData.boardId ? { boardId: channelData.boardId } : board?.id ? { boardId: board.id } : {}),
        emailMergeMode: config.emailMergeModeDefault as EmailMergeMode,
        deskType: DeskType.EMAIL,
        workspaceId: channelData.workspaceId,
      },
    });

    await self.registerGraphWebhook(credentials.accessToken, webhookUrl, clientState);

    return channel.id;
  }, {
    maxWait: 10_000,
    timeout: 30_000,
  });
}
