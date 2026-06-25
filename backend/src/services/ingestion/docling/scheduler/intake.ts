/**
 * Intake: route a PDF into the async OCR scheduler instead of the synchronous
 * FileProcessor. Handles all PDF-attachment entry points:
 *   - COLLECTIONS         (docId = collectionItem.fileId)
 *   - CHAT_ATTACHMENT     (docId = messageAttachment.id)
 *   - TICKET_ATTACHMENT   (docId = messageAttachment.id)
 *
 * Called from the file worker when config.doclingScheduler.routePdfs is on.
 * Inserts the pending_split row; the splitter takes over.
 */
import { db } from '@/database/client';
import { IngestionStatus } from '@prisma/client';
import { SubApp } from '@/vespa/src/types';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getRuntimeConfig } from '../runtime/config';
import { inferDoclingSourcePriority, upsertDoclingAsyncFileForSplit } from './store';

const isPdf = (mime: string | null | undefined, name: string | null | undefined): boolean =>
  (mime || '').toLowerCase().includes('application/pdf') ||
  (name || '').toLowerCase().endsWith('.pdf');

const toGcsKey = (url: string): string => {
  if (url.startsWith('gs://')) {
    const m = url.match(/^gs:\/\/[^/]+\/(.+)$/);
    return m ? m[1] : url;
  }
  if (url.startsWith('http')) {
    try { return new URL(url).pathname.replace(/^\/[^/]+\//, ''); } catch { return url; }
  }
  return url;
};

const pageChunkSize = () => getRuntimeConfig().pageChunkSize;

const routeCollection = async (fileId: string): Promise<boolean> => {
  const item = await db.collectionItem.findFirst({ where: { fileId, isLatest: true } });
  if (!item) return false;

  const attachment = await db.messageAttachment.findFirst({
    where: { entityId: item.id, entityType: 'COLLECTION' },
  });
  if (!attachment?.url) return false;
  if (!isPdf(attachment.mimetype, item.name)) return false;

  const sourceKey = toGcsKey(attachment.url);
  const { basePriority } = inferDoclingSourcePriority({ collectionId: item.rootCollectionId });

  const inserted = await upsertDoclingAsyncFileForSplit({
    fileId: item.fileId,
    collectionId: item.rootCollectionId,
    sourcePath: sourceKey,
    sourceStorageKey: sourceKey,
    basePriority,
    pageChunkSize: pageChunkSize(),
  });

  if (inserted !== null) {
    await db.collectionItem.updateMany({
      where: { fileId: item.fileId, isLatest: true },
      data: { ingestionStatus: IngestionStatus.PROCESSING },
    });
  }

  logger.info('[DOCLING_SCHEDULER] Routed COLLECTION PDF to scheduler', {
    fileId: item.fileId,
    alreadyQueued: inserted === null,
  });
  return true;
};

const routeAttachment = async (attachmentId: string, app: SubApp): Promise<boolean> => {
  const att = await db.messageAttachment.findUnique({ where: { id: attachmentId } });
  if (!att?.url) return false;
  if (!isPdf(att.mimetype, att.originalFilename)) return false;

  const sourceKey = toGcsKey(att.url);
  const { basePriority } = inferDoclingSourcePriority({ collectionId: '' });

  const inserted = await upsertDoclingAsyncFileForSplit({
    fileId: att.id,
    collectionId: '',  // empty sentinel = attachment, not collection
    sourcePath: sourceKey,
    sourceStorageKey: sourceKey,
    basePriority,
    pageChunkSize: pageChunkSize(),
  });

  logger.info('[DOCLING_SCHEDULER] Routed ATTACHMENT PDF to scheduler', {
    attachmentId: att.id, app, alreadyQueued: inserted === null,
  });
  return true;
};

export const routePdfToScheduler = async (docId: string, app: SubApp): Promise<boolean> => {
  if (!config.doclingScheduler.routePdfs) return false;
  if (app === SubApp.COLLECTIONS) return routeCollection(docId);
  if (app === SubApp.CHAT_ATTACHMENT || app === SubApp.TICKET_ATTACHMENT) {
    return routeAttachment(docId, app);
  }
  return false;
};
