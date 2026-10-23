/**
 * Canvas Duplicate Service - copies a canvas, or one of its saved versions,
 * into a new collaborative canvas that owns its content and its attachments.
 */

import * as Y from 'yjs';
import type { Canvas, MessageAttachment, Prisma } from '@prisma/client';
import { generateFilePath, normalizeStoragePath } from '@xyne/storage';
import { v4 as uuidv4 } from 'uuid';
import {
  AttachmentEntityType,
  CanvasDestinationAccessError,
  CanvasHierarchyResolutionError,
  CanvasRole,
  CanvasVisibility,
  DocType,
  assertCanvasDestinationAccess,
  resolveCanvasHierarchy,
} from '@xyne/shared';
import { db } from '@/database/client';
import { ConnectEntityType, newConnectId } from '@/database/connectGroup';
import { logger } from '@/utils/logger';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { vespaQueue } from '@/queues/vespaQueue';
import { fileSchema, SubApp } from '@/vespa/src/types';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { canvasAuthService } from './canvasAuthService';
import { userActivityTrackingService } from './userActivityTrackingService';
import { getAttachmentStorage } from './attachmentStorage';
import {
  YSWEET_XML_FRAGMENT,
  YSweetHttpError,
  blocksToYSweetDoc,
  readYSweetUpdateStrict,
  writeYSweetUpdateStrict,
} from '@/utils/ysweetUtils';
import { collectAttachmentIds, replaceAttachmentIds } from '@/utils/canvasAttachmentRefs';

/** Bounds the per-request fan-out of file copies and inserts. */
const MAX_DUPLICATE_ATTACHMENTS = 500;
/** File copies in flight at once. */
const FILE_COPY_CONCURRENCY = 5;
/**
 * Time a duplicate may take before it stops and removes what it copied, kept
 * under the gateway's 50s API timeout: a request the gateway has cut off must
 * not go on to create a copy the user was told failed.
 */
const DUPLICATE_DEADLINE_MS = 40_000;
/** Outlives the deadline, so the lock is only ever released by its request. */
const DUPLICATE_LOCK_TTL_SECONDS = 60;

export class CanvasDuplicateError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409 | 413 | 422 | 502 | 504,
    message: string
  ) {
    super(message);
    this.name = 'CanvasDuplicateError';
  }
}

function assertWithinDeadline(deadline: number): void {
  if (Date.now() > deadline) {
    throw new CanvasDuplicateError(504, 'This canvas took too long to duplicate. No copy was created.');
  }
}

export interface DuplicateCanvasParams {
  sourceCanvasId: string;
  userId: string;
  workspaceId: string;
  fromVersionId?: string;
}

export interface DuplicatedCanvas {
  id: string;
  title: string;
  visibility: string;
  channelId: string | null;
  folderId: string | null;
  projectId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface DuplicateCanvasResult {
  canvas: DuplicatedCanvas;
  /** The source's own files that could not be copied because they are no longer in storage. */
  skippedAttachmentCount: number;
  /** The source's location was not one the user may create canvases in. */
  placedInPersonalRoot: boolean;
}

interface CanvasPlacement {
  channelId: string | null;
  folderId: string | null;
  projectId: string | null;
}

type SourceCanvas = {
  id: string;
  content: Prisma.JsonValue;
  isCollaborative: boolean;
};

function docFromBlocks(content: Prisma.JsonValue): Y.Doc {
  try {
    return blocksToYSweetDoc(Array.isArray(content) ? (content as unknown as BlockNoteBlock[]) : []);
  } catch (error) {
    // Saved content can hold a block type the editor no longer has.
    logger.warn('[CanvasDuplicate] Could not convert saved canvas content', error);
    throw new CanvasDuplicateError(422, 'This canvas has content that cannot be copied.');
  }
}

/** The live document, or null when Y-Sweet has never created one for this canvas. */
async function readLiveDoc(canvasId: string, userId: string): Promise<Y.Doc | null> {
  let update: Uint8Array;
  try {
    update = await readYSweetUpdateStrict(canvasId, userId);
  } catch (error) {
    if (error instanceof YSweetHttpError && error.status === 404) {
      return null;
    }
    logger.error(`[CanvasDuplicate] Could not read canvas ${canvasId} from Y-Sweet`, error);
    throw new CanvasDuplicateError(502, 'Could not read the canvas. Please try again.');
  }

  const doc = new Y.Doc();
  if (update.length > 0) {
    Y.applyUpdate(doc, update);
  }
  return doc;
}

async function loadSourceDoc(
  source: SourceCanvas,
  userId: string,
  fromVersionId: string | undefined
): Promise<{ doc: Y.Doc; versionName?: string }> {
  if (fromVersionId) {
    const version = await db.canvasVersion.findFirst({
      where: { id: fromVersionId, canvasId: source.id },
      select: { name: true, content: true },
    });
    if (!version) {
      throw new CanvasDuplicateError(404, 'Canvas version not found');
    }
    return { doc: docFromBlocks(version.content), versionName: version.name };
  }

  if (source.isCollaborative) {
    const liveDoc = await readLiveDoc(source.id, userId);
    if (liveDoc && liveDoc.getXmlFragment(YSWEET_XML_FRAGMENT).length > 0) {
      return { doc: liveDoc };
    }
  }

  // Non-collaborative canvases keep their content in the row. So does a
  // collaborative canvas whose live document is still empty: the editor seeds
  // that document from the row the first time it is opened.
  return { doc: docFromBlocks(source.content) };
}

/** Where the copy goes: beside the source when the user may create there, otherwise null. */
async function resolvePlacement(
  source: { channelId: string | null; folderId: string | null; projectId: string | null },
  userId: string
): Promise<CanvasPlacement | null> {
  try {
    const { folderId, projectId, channelId } = await resolveCanvasHierarchy({
      folderId: source.folderId,
      projectId: source.projectId,
      channelId: source.channelId,
      loadFolder: async id => {
        const folder = await db.canvasFolder.findUnique({
          where: { id },
          select: { projectId: true, channelId: true, createdBy: true },
        });
        // A personal folder, outside any project or channel, is its creator's
        // alone, as in the canvas_folders ACL.
        const isOthersPersonalFolder =
          folder && !folder.projectId && !folder.channelId && folder.createdBy !== userId;
        return isOthersPersonalFolder ? null : folder;
      },
      loadChannel: id => db.channel.findUnique({ where: { id }, select: { id: true } }),
    });

    await assertCanvasDestinationAccess({
      projectId,
      channelId,
      loadChannel: id =>
        db.channel.findUnique({ where: { id }, select: { projectId: true, isArchived: true } }),
      isChannelMember: async id =>
        Boolean(
          await db.channelParticipant.findUnique({
            where: { channelId_userId: { channelId: id, userId } },
            select: { id: true },
          })
        ),
      isProjectMember: async id =>
        Boolean(
          await db.channel.findFirst({
            where: { projectId: id, participants: { some: { userId } } },
            select: { id: true },
          })
        ),
    });

    return { folderId: folderId ?? null, projectId: projectId ?? null, channelId: channelId ?? null };
  } catch (error) {
    if (
      error instanceof CanvasHierarchyResolutionError ||
      error instanceof CanvasDestinationAccessError
    ) {
      return null;
    }
    throw error;
  }
}

/** An object written to storage for a duplicate, kept so a failed duplicate can remove it. */
interface CopiedObject {
  storage: ReturnType<typeof getAttachmentStorage>;
  path: string;
}

/** Best effort: a duplicate that did not complete should not leave copied files behind. */
async function removeCopiedObjects(copied: CopiedObject[]): Promise<void> {
  await Promise.all(
    copied.map(async ({ storage, path }) => {
      try {
        await storage.deleteFile(path);
      } catch (error) {
        logger.error(`[CanvasDuplicate] Could not remove copied file ${path}`, error);
      }
    })
  );
}

/**
 * The files the copy takes: those owned by the source canvas. Any other file
 * pasted into it, from a chat, a ticket, a recording or another canvas, keeps
 * its id and stays authorized where it came from: as a row of the copy it
 * would follow the copy's sharing, which can reach people its owner never
 * shared it with.
 */
async function findCopyableAttachments(
  attachmentIds: string[],
  sourceCanvasId: string,
  workspaceId: string
): Promise<MessageAttachment[]> {
  if (attachmentIds.length === 0) {
    return [];
  }

  return db.messageAttachment.findMany({
    where: {
      id: { in: attachmentIds },
      workspaceId,
      entityType: AttachmentEntityType.CANVAS,
      entityId: sourceCanvasId,
      isDeleted: false,
    },
  });
}

/**
 * Copy an attachment's stored file, and its thumbnail, to new paths under the
 * copy, in the bucket the attachment is read from. Null when the source file
 * is gone, so the copy keeps pointing at the original row like the source does.
 */
async function copyAttachmentFiles(
  attachment: MessageAttachment,
  newCanvasId: string,
  copied: CopiedObject[]
): Promise<{ url: string; thumbnailUrl: string | null } | null> {
  const storage = getAttachmentStorage(attachment);
  const sourcePath = normalizeStoragePath(attachment.url);
  if (!sourcePath || !(await storage.fileExists(sourcePath))) {
    return null;
  }

  const url = generateFilePath({
    filename: attachment.originalFilename,
    contentType: attachment.mimetype,
    scopeType: AttachmentEntityType.CANVAS,
    scopeId: newCanvasId,
  });
  await storage.copyFile(sourcePath, url);
  copied.push({ storage, path: url });

  if (!attachment.thumbnailUrl) {
    return { url, thumbnailUrl: null };
  }
  const thumbnailUrl = generateFilePath({
    filename: `${attachment.originalFilename}_thumb.jpg`,
    contentType: 'image/jpeg',
    scopeType: AttachmentEntityType.CANVAS,
    scopeId: newCanvasId,
  });
  try {
    await storage.copyFile(normalizeStoragePath(attachment.thumbnailUrl), thumbnailUrl);
    copied.push({ storage, path: thumbnailUrl });
    return { url, thumbnailUrl };
  } catch (error) {
    // The file itself still renders; only its preview image is lost.
    logger.warn(`[CanvasDuplicate] Could not copy thumbnail of attachment ${attachment.id}`, error);
    return { url, thumbnailUrl: null };
  }
}

/**
 * Attachment rows for the copy, each over its own copy of the stored file, so
 * the copy's files are authorized against the copy and deleting either canvas
 * leaves the other's files intact. Everything copied is recorded in `copied`.
 */
async function prepareAttachmentCopies(
  attachmentIds: string[],
  sourceCanvasId: string,
  newCanvasId: string,
  userId: string,
  workspaceId: string,
  copied: CopiedObject[],
  deadline: number
): Promise<{
  rows: Prisma.MessageAttachmentCreateManyInput[];
  replacements: Map<string, string>;
  fileCount: number;
}> {
  const attachments = await findCopyableAttachments(attachmentIds, sourceCanvasId, workspaceId);
  // Counted on the files the copy takes, so files pasted from elsewhere, which
  // keep their ids, do not count against it.
  if (attachments.length > MAX_DUPLICATE_ATTACHMENTS) {
    throw new CanvasDuplicateError(413, 'This canvas has too many files to duplicate');
  }

  const rows: Prisma.MessageAttachmentCreateManyInput[] = [];
  const replacements = new Map<string, string>();
  for (let i = 0; i < attachments.length; i += FILE_COPY_CONCURRENCY) {
    // Out of time: stop copying rather than finish only to remove it all again.
    assertWithinDeadline(deadline);
    const batch = attachments.slice(i, i + FILE_COPY_CONCURRENCY);
    // Settled, not all: every copy in flight must be recorded before a failure
    // is raised, or it would outlive the cleanup.
    const results = await Promise.allSettled(
      batch.map(attachment => copyAttachmentFiles(attachment, newCanvasId, copied))
    );
    const failure = results.find(result => result.status === 'rejected');
    if (failure) {
      logger.error(`[CanvasDuplicate] Could not copy files for canvas ${newCanvasId}`, failure.reason);
      throw new CanvasDuplicateError(502, 'Could not copy the canvas files. Please try again.');
    }

    batch.forEach((attachment, index) => {
      const result = results[index];
      const files = result?.status === 'fulfilled' ? result.value : null;
      if (!files) return;

      const id = uuidv4();
      replacements.set(attachment.id, id);
      const metadata =
        attachment.metadata && typeof attachment.metadata === 'object' && !Array.isArray(attachment.metadata)
          ? attachment.metadata
          : {};
      rows.push({
        id,
        entityId: newCanvasId,
        entityType: AttachmentEntityType.CANVAS,
        conversationId: `canvas_${newCanvasId}`,
        channelId: null,
        workspaceId,
        storageProvider: attachment.storageProvider,
        originalFilename: attachment.originalFilename,
        mimetype: attachment.mimetype,
        size: attachment.size,
        width: attachment.width,
        height: attachment.height,
        url: files.url,
        thumbnailUrl: files.thumbnailUrl,
        uploadStatus: attachment.uploadStatus,
        // The copy's owner put this row here; clonedFromAttachmentId records the
        // original, so uploader shortcuts elsewhere follow the copy's owner.
        uploadedByUserId: userId,
        createdBy: userId,
        // `type` is kept as is: it decides which bucket the file is read from.
        metadata: { ...metadata, canvasId: newCanvasId, clonedFromAttachmentId: attachment.id },
      });
    });
  }

  return { rows, replacements, fileCount: attachments.length };
}

/**
 * One duplicate of a canvas per user at a time: a second request, from another
 * tab or a retry while the first still runs, gets 409 instead of a second copy.
 */
export async function duplicateCanvas(params: DuplicateCanvasParams): Promise<DuplicateCanvasResult> {
  const startedAt = Date.now();

  const auth = await canvasAuthService.checkCanvasAccess(params.sourceCanvasId, params.userId);
  // Not found either way, so the answer does not reveal a canvas the user cannot see.
  if (!auth.canvas || !auth.canView) {
    throw new CanvasDuplicateError(404, 'Canvas not found');
  }
  // Keyed by the canvas's own id: the request may name it by an older access id.
  const sourceCanvasId = auth.canvas.id;

  const lock = await acquireLock(`lock:canvas-duplicate:${params.userId}:${sourceCanvasId}`, {
    ttlSeconds: DUPLICATE_LOCK_TTL_SECONDS,
  });
  if (!lock) {
    throw new CanvasDuplicateError(409, 'This canvas is already being duplicated.');
  }
  try {
    return await runDuplicate({ ...params, sourceCanvasId }, startedAt);
  } finally {
    await releaseLock(lock);
  }
}

/** The duplicate itself, for a source canvas the user may view, under its lock. */
async function runDuplicate(
  { sourceCanvasId, userId, workspaceId, fromVersionId }: DuplicateCanvasParams,
  startedAt: number
): Promise<DuplicateCanvasResult> {
  const deadline = startedAt + DUPLICATE_DEADLINE_MS;

  const source = await db.canvas.findUnique({
    where: { id: sourceCanvasId },
    select: {
      id: true,
      workspaceId: true,
      title: true,
      content: true,
      visibility: true,
      channelId: true,
      folderId: true,
      projectId: true,
      isCollaborative: true,
      docType: true,
    },
  });
  if (!source || source.workspaceId !== workspaceId) {
    throw new CanvasDuplicateError(404, 'Canvas not found');
  }
  if (source.docType !== DocType.Canvas) {
    throw new CanvasDuplicateError(400, 'Only canvases can be duplicated');
  }

  const { doc, versionName } = await loadSourceDoc(source, userId, fromVersionId);
  const fragment = doc.getXmlFragment(YSWEET_XML_FRAGMENT);

  const attachmentIds = collectAttachmentIds(fragment);

  const newCanvasId = uuidv4();
  // Every file copied from here on is removed again if the duplicate fails,
  // so a failed attempt leaves nothing behind in storage.
  const copiedObjects: CopiedObject[] = [];
  const now = new Date();
  let fileCount: number;
  let skippedAttachmentCount: number;
  let placement: CanvasPlacement | null;
  let canvas: Canvas;
  try {
    const prepared = await prepareAttachmentCopies(
      attachmentIds,
      source.id,
      newCanvasId,
      userId,
      workspaceId,
      copiedObjects,
      deadline
    );
    const { rows: attachmentRows } = prepared;
    fileCount = prepared.fileCount;
    skippedAttachmentCount = fileCount - attachmentRows.length;
    replaceAttachmentIds(fragment, prepared.replacements);

    placement = await resolvePlacement(source, userId);

    // The last point where stopping leaves nothing behind but copied files,
    // which the catch below removes.
    assertWithinDeadline(deadline);

    // Written before the row exists: inserting the row queues search indexing,
    // which reads the content from Y-Sweet. An empty copy needs no document; the
    // editor creates one on first open. Y-Sweet has no delete, so if the rows
    // then fail, this document stays behind under an id nothing refers to.
    if (fragment.length > 0) {
      try {
        await writeYSweetUpdateStrict(newCanvasId, Y.encodeStateAsUpdate(doc), userId);
      } catch (error) {
        logger.error(`[CanvasDuplicate] Could not write copy ${newCanvasId} to Y-Sweet`, error);
        throw new CanvasDuplicateError(502, 'Could not save the copy. Please try again.');
      }
    }

    const connectId = newConnectId();
    const sourceTitle = source.title.trim() || 'Untitled Canvas';
    const title = versionName ? `${sourceTitle} ${versionName}` : `${sourceTitle} (Copy)`;

    [canvas] = await db.$transaction([
      db.canvas.create({
        data: {
          id: newCanvasId,
          workspaceId,
          title,
          content: [],
          isCollaborative: true,
          createdBy: userId,
          // Public reaches every member wherever the canvas lives, but guests
          // only through its channel. A copy that cannot stay in the source's
          // location starts private and its owner decides who sees it.
          visibility: placement ? source.visibility : CanvasVisibility.PRIVATE,
          channelId: placement?.channelId ?? null,
          folderId: placement?.folderId ?? null,
          projectId: placement?.projectId ?? null,
          isTemplate: false,
          lastEditedBy: userId,
          lastEditedAt: now,
          createdAt: now,
          updatedAt: now,
          metadata: {
            duplicatedFrom: source.id,
            ...(fromVersionId ? { duplicatedFromVersionId: fromVersionId } : {}),
          },
          connectId,
        },
      }),
      db.connectGroup.create({
        data: {
          entityType: ConnectEntityType.CANVAS,
          entityId: newCanvasId,
          hostWorkspaceId: workspaceId,
          invitedEntityId: null,
          invitedWorkspaceId: null,
          connectId,
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        },
      }),
      db.canvasParticipant.create({
        data: {
          canvasId: newCanvasId,
          userId,
          workspaceId,
          role: CanvasRole.OWNER,
          canvasConnectId: connectId,
        },
      }),
      ...(attachmentRows.length > 0
        ? [db.messageAttachment.createMany({ data: attachmentRows })]
        : []),
    ]);
  } catch (error) {
    await removeCopiedObjects(copiedObjects);
    throw error;
  }

  // Rows written here bypass the Zero canvas side effects, so record the
  // creation and queue indexing the way they would.
  void userActivityTrackingService.trackCanvasCreated(userId, {
    canvasId: canvas.id,
    title: canvas.title,
    channelId: canvas.channelId,
  });
  try {
    await vespaQueue.addJob({
      schema: fileSchema,
      docId: newCanvasId,
      jobType: 'feed',
      userId,
      app: SubApp.CANVAS,
      workspaceId,
    });
  } catch (error) {
    logger.error(`[CanvasDuplicate] Failed to queue Vespa job for canvas ${newCanvasId}:`, error);
  }

  logger.info('analytics_event', {
    event: 'canvas_duplicated',
    timestamp: now.toISOString(),
    userId,
    sourceCanvasId: source.id,
    canvasId: newCanvasId,
    source: fromVersionId ? 'version' : source.isCollaborative ? 'collaborative' : 'legacy',
    attachmentCount: fileCount,
    skippedAttachmentCount,
    placedInPersonalRoot: !placement,
    durationMs: Date.now() - startedAt,
  });

  return {
    canvas: {
      id: canvas.id,
      title: canvas.title,
      visibility: canvas.visibility,
      channelId: canvas.channelId,
      folderId: canvas.folderId,
      projectId: canvas.projectId,
      createdBy: canvas.createdBy,
      createdAt: canvas.createdAt.getTime(),
      updatedAt: canvas.updatedAt.getTime(),
    },
    skippedAttachmentCount,
    placedInPersonalRoot: !placement,
  };
}
