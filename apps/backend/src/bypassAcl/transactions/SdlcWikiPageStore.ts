import { transaction } from '../base';
import { placeHubItem } from '@/sdlc/hubFolders';
import { sdlcChannelCanvasParticipant } from '@/sdlc/sdlcCanvasAccess';
import { PageAction, SdlcWikiPageStore, WikiScope, versionName } from '@/sdlc/wiki/SdlcWikiPageStore';
import { Prisma } from '@prisma/client';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { CanvasVisibility, SDLC_HUB_ITEM_RELATION } from '@xyne/shared';
import { randomUUID, createHash } from 'crypto';
import { advisoryXactLock } from '@/bypassAcl/lockServices';


export function ensureFolderPathTx(self: SdlcWikiPageStore, parent: string, name: string, scope: WikiScope, actor: { workspaceId: string; userId: string; }) {
  return transaction(['SdlcEntityLink', 'SdlcFolder'], 'ensureFolderPath: advisory-locked find-or-create of a wiki folder so parallel page writes into a new path create it once; tx is not ACL-wrapped', self.prisma, async (tx) => {
    // Parallel page writes into a new path would each create the folder.
    await advisoryXactLock(tx, ['SdlcEntityLink'],
      'sdlc wiki: serialize get-or-create of a folder node so parallel page writes do not duplicate it',
      `sdlc-wiki-folder:${parent}/${name}`);
    const children = await tx.sdlcEntityLink.findMany({
      where: {
        channelId: scope.channelId,
        sourceType: 'FOLDER',
        sourceId: parent,
        targetType: 'FOLDER',
        relationType: SDLC_HUB_ITEM_RELATION,
      },
      select: { targetId: true },
    });
    const existing = children.length
      ? await tx.sdlcFolder.findFirst({
          where: { id: { in: children.map((child) => child.targetId) }, name },
          select: { id: true },
        })
      : null;
    if (existing) return existing.id;
    const folderId = randomUUID();
    await tx.sdlcFolder.create({
      data: { id: folderId, workspaceId: scope.workspaceId, name, createdBy: scope.actorUserId },
    });
    await placeHubItem(tx, actor, {
      channelId: scope.channelId,
      scopeFolderId: scope.folderId,
      parentId: parent,
      targetType: 'FOLDER',
      targetId: folderId,
    });
    return folderId;
  });
}
export function createTx(self: SdlcWikiPageStore, scope: WikiScope, page: { title: string; action: "create"; markdown: string; folderPath?: string | undefined; }, content: BlockNoteBlock[], typeFolderId: string, commitSha: string | undefined, actor: { workspaceId: string; userId: string; }, parentId: string) {
  return transaction(['Canvas', 'SdlcArtifact'], 'create wiki page: canvas, SDLC artifact, hub placement and first version must commit together; tx is not ACL-wrapped', self.prisma, async (tx) => {
    const canvas = await tx.canvas.create({
      data: {
        workspaceId: scope.workspaceId,
        title: page.title,
        content: content as unknown as Prisma.InputJsonValue,
        channelId: scope.channelId,
        folderId: typeFolderId,
        projectId: scope.projectId,
        createdBy: scope.actorUserId,
        lastEditedBy: scope.actorUserId,
        lastEditedAt: new Date(),
        viewAccessId: randomUUID(),
        visibility: CanvasVisibility.PRIVATE,
        isCollaborative: true,
        metadata: {} as Prisma.InputJsonValue,
        participants: {
          create: sdlcChannelCanvasParticipant(scope.workspaceId, scope.channelId),
        },
      },
      select: { id: true },
    });
    await recordVersion(tx, scope, canvas.id, page.markdown, content, 'created', commitSha);
    await tx.sdlcArtifact.create({
      data: {
        workspaceId: scope.workspaceId,
        artifactId: canvas.id,
        artifactType: 'WIKI',
        artifactStatus: 'ACTIVE',
        ...(commitSha ? { generationCommit: commitSha } : {}),
        createdBy: scope.actorUserId,
      },
    });
    await placeHubItem(tx, actor, {
      channelId: scope.channelId,
      scopeFolderId: scope.folderId,
      parentId,
      targetType: 'CANVAS',
      targetId: canvas.id,
    });
    return { artifact: canvas.id, canvasId: canvas.id, content };
  });
}
export function editTx(self: SdlcWikiPageStore, existing: any, page: PageAction<"update" | "replace_section" | "insert_section" | "remove_section">, content: BlockNoteBlock[], scope: WikiScope, markdown: string, commitSha: string | undefined) {
  return transaction(['Canvas', 'SdlcArtifact'], 'edit wiki page: canvas update, version record and artifact commit sha must commit together; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await tx.canvas.update({
      where: { id: existing.id },
      data: {
        ...(page.action === 'update' && page.title ? { title: page.title } : {}),
        content: content as unknown as Prisma.InputJsonValue,
        lastEditedBy: scope.actorUserId,
        lastEditedAt: new Date(),
      },
    });
    await recordVersion(tx, scope, existing.id, markdown, content, page.action, commitSha);
    if (commitSha) {
      await tx.sdlcArtifact.update({
        where: { artifactId: existing.id },
        data: { generationCommit: commitSha },
      });
    }
    return { artifact: existing.id, canvasId: existing.id, content };
  });
}
export function moveTx(self: SdlcWikiPageStore, scope: WikiScope, existing: any, parentId: string, page: { canvasId: string; action: "move"; folderPath: string; title?: string | undefined; }) {
  return transaction(['Canvas', 'SdlcEntityLink'], 'move wiki page: removing the old hub placement and adding the new one must commit together; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await tx.sdlcEntityLink.deleteMany({
      where: {
        channelId: scope.channelId,
        relationType: SDLC_HUB_ITEM_RELATION,
        targetType: 'CANVAS',
        targetId: existing.id,
      },
    });
    await placeHubItem(
      tx,
      { workspaceId: scope.workspaceId, userId: scope.actorUserId },
      {
        channelId: scope.channelId,
        scopeFolderId: scope.folderId,
        parentId,
        targetType: 'CANVAS',
        targetId: existing.id,
      }
    );
    if (page.title) {
      await tx.canvas.update({ where: { id: existing.id }, data: { title: page.title } });
    }
  });
}

export async function recordVersion(tx: Prisma.TransactionClient, scope: WikiScope, canvasId: string, markdown: string, content: BlockNoteBlock[], action: string, commitSha: string | undefined): Promise<void> {
    const contentHash = createHash('sha256')
      .update(`${markdown}\0${commitSha ?? ''}`)
      .digest('hex');
    await tx.canvasVersion.upsert({
      where: { canvasId_contentHash: { canvasId, contentHash } },
      create: {
        workspaceId: scope.workspaceId,
        canvasId,
        name: versionName(action, commitSha),
        content: content as unknown as Prisma.InputJsonValue,
        contentHash,
        createdBy: scope.actorUserId,
      },
      update: { name: versionName(action, commitSha) },
    });
  }
