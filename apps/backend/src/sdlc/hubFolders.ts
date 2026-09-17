import type { Prisma, PrismaClient } from '@prisma/client';
import {
  SDLC_HUB_ITEM_FLAT_RELATION,
  SDLC_HUB_ITEM_RELATION,
  SDLC_HUB_KNOWLEDGE_FOLDER,
  SDLC_HUB_WIKI_FOLDER,
  SDLC_WIKI_FOLDER,
  sdlcHubKnowledgeFolderId,
  sdlcHubWikiFolderId,
  sdlcRepositoryWikiFolderId,
  sdlcWikiFolderId,
} from '@xyne/shared';
import { ensureLink, type EntityLinkActor } from './entityLinkService';

type Db = PrismaClient | Prisma.TransactionClient;

async function ensureFolder(
  db: Db,
  actor: EntityLinkActor,
  folder: { id: string; name: string; channelId: string; parentType: 'CHANNEL' | 'FOLDER'; parentId: string }
): Promise<string> {
  await db.sdlcFolder.upsert({
    where: { id: folder.id },
    create: {
      id: folder.id,
      workspaceId: actor.workspaceId,
      name: folder.name,
      createdBy: actor.userId,
    },
    update: {},
  });
  await ensureLink(
    db,
    {
      channelId: folder.channelId,
      sourceType: folder.parentType,
      sourceId: folder.parentId,
      targetType: 'FOLDER',
      targetId: folder.id,
      relationType: SDLC_HUB_ITEM_RELATION,
    },
    actor
  );
  return folder.id;
}

async function ensureWikiRoot(db: Db, actor: EntityLinkActor, channelId: string): Promise<string> {
  return ensureFolder(db, actor, {
    id: sdlcWikiFolderId(channelId),
    name: SDLC_WIKI_FOLDER,
    channelId,
    parentType: 'CHANNEL',
    parentId: channelId,
  });
}

/** A repository's folder is named after it; a rename does not follow. */
export async function ensureRepositoryWikiFolder(
  db: Db,
  actor: EntityLinkActor,
  channelId: string,
  repository: { id: string; name: string }
): Promise<string> {
  const rootId = await ensureWikiRoot(db, actor, channelId);
  return ensureFolder(db, actor, {
    id: sdlcRepositoryWikiFolderId(channelId, repository.id),
    name: repository.name,
    channelId,
    parentType: 'FOLDER',
    parentId: rootId,
  });
}

export async function ensureHubWikiFolder(
  db: Db,
  actor: EntityLinkActor,
  channelId: string
): Promise<string> {
  const rootId = await ensureWikiRoot(db, actor, channelId);
  return ensureFolder(db, actor, {
    id: sdlcHubWikiFolderId(channelId),
    name: SDLC_HUB_WIKI_FOLDER,
    channelId,
    parentType: 'FOLDER',
    parentId: rootId,
  });
}

export async function ensureHubKnowledgeFolder(
  db: Db,
  actor: EntityLinkActor,
  channelId: string
): Promise<string> {
  return ensureFolder(db, actor, {
    id: sdlcHubKnowledgeFolderId(channelId),
    name: SDLC_HUB_KNOWLEDGE_FOLDER,
    channelId,
    parentType: 'CHANNEL',
    parentId: channelId,
  });
}

/** Files an item under `parentId` and mirrors it onto its scope folder for one-lookup reads. */
export async function placeHubItem(
  db: Db,
  actor: EntityLinkActor,
  item: {
    channelId: string;
    scopeFolderId: string;
    parentId: string;
    targetType: 'FOLDER' | 'CANVAS';
    targetId: string;
  }
): Promise<void> {
  await ensureLink(
    db,
    {
      channelId: item.channelId,
      sourceType: 'FOLDER',
      sourceId: item.parentId,
      targetType: item.targetType,
      targetId: item.targetId,
      relationType: SDLC_HUB_ITEM_RELATION,
    },
    actor
  );
  await ensureLink(
    db,
    {
      channelId: item.channelId,
      sourceType: 'FOLDER',
      sourceId: item.scopeFolderId,
      targetType: item.targetType,
      targetId: item.targetId,
      relationType: SDLC_HUB_ITEM_FLAT_RELATION,
    },
    actor
  );
}
