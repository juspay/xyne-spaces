import { transaction } from '../base';
import type { Request } from 'express';
import { db } from '@/database/client';
import { reactivateOrCreateSources } from '@/integrations/routes/social-media/app-store';
import { ChannelType, ChannelScopeType, ChannelVisibility, ChannelRole, DeskType, EmailMergeMode } from '@xyne/shared';


export function postAppStoreConnectTx(input: { keyId: string; privateKey: string; channelName: string; applications: { bundleId: string; }[]; projectId: string; boardId: string; visibility: "PUBLIC" | "PRIVATE" | "public" | "private"; assigneeUserGroupId?: string | undefined; }, applications: { appId: string; displayName: string; }[], userId: string, workspaceId: string, now: Date, encryptedCredentials: string) {
  return transaction(['Board', 'Channel', 'ChannelBoardMapping', 'ChannelParticipant', 'ChannelStats', 'ChannelUserStatus', 'EmailChannelPreference', 'ExternalSource'], 'postAppStoreConnect: app-store channel, participants, board mappings and external sources must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const channel = await tx.channel.create({
      data: {
        name: input.channelName,
        description: `App Store reviews for ${applications.length} application${
              applications.length === 1 ? '' : 's'
            }`,
        type: ChannelType.SOCIAL_MEDIA,
        scopeType: ChannelScopeType.DEFAULT,
        visibility: input.visibility.toUpperCase() as ChannelVisibility,
        createdBy: userId,
        projectId: input.projectId,
        workspaceId,
        participantCount: 1,
        lastActivityAt: now,
      },
    });
    await tx.channelParticipant.create({
      data: { workspaceId, channelId: channel.id, userId, role: ChannelRole.ADMIN },
    });
    await tx.channelUserStatus.create({
      data: { workspaceId, channelId: channel.id, userId, updatedAt: now },
    });
    await tx.channelStats.create({
      data: { workspaceId, channelId: channel.id, participantCount: 1, lastActivityAt: now },
    });
    await tx.emailChannelPreference.create({
      data: {
        channelId: channel.id,
        workspaceId,
        ownerUserId: userId,
        assigneeUserGroupId: input.assigneeUserGroupId,
        boardId: input.boardId,
        deskType: DeskType.SOCIAL_MEDIA,
        emailMergeMode: EmailMergeMode.DISABLED,
      },
    });

    const mappingBoards = await tx.board.findMany({
      where: { projectId: input.projectId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (mappingBoards.length > 0) {
      await tx.channelBoardMapping.createMany({
        data: mappingBoards.map((b, index) => ({
          channelId: channel.id,
          boardId: b.id,
          workspaceId,
          isDefault: input.boardId ? b.id === input.boardId : index === 0,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        })),
        skipDuplicates: true,
      });
    }
    // Inside the transaction on purpose: a source that is already connected elsewhere throws
    // 409 here, and outside it that would leave an orphan channel holding the requested name,
    // so the user's retry would fail with "a channel with that name exists".
    await reactivateOrCreateSources(tx, {
      workspaceId,
      channelId: channel.id,
      boardId: input.boardId,
      ownerUserId: userId,
      encryptedCredentials,
      applications,
    });
    return channel.id;
  });
}
export function postAppStoreAppsTx(workspaceId: string, req: Request, existing: any, applications: { appId: string; displayName: string; }[]) {
  return transaction(['ExternalSource'], 'postAppStoreApps: app-store source reactivate-or-create batch must commit atomically; tx is not ACL-wrapped', db, (tx) =>
    reactivateOrCreateSources(tx, {
      workspaceId,
      channelId: req.params.channelId,
      boardId: existing.boardId ?? '',
      ownerUserId: existing.ownerUserId ?? req.user!.id,
      encryptedCredentials: existing.credentials,
      applications,
    }),
  );
}
