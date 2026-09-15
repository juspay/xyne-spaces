/**
 * Intake: route a PDF into the async OCR scheduler instead of the synchronous
 * FileProcessor. Handles all PDF-attachment entry points:
 *   - COLLECTIONS         (docId = collectionItem.fileId)
 *   - CHAT_ATTACHMENT     (docId = messageAttachment.id)
 *   - TICKET_ATTACHMENT   (docId = messageAttachment.id)
 *
 * Also handles PPTX/PPT the same way: the scheduler (and the LightOnOCR
 * model behind it) only ever operates on PDF bytes, so a pptx/ppt
 * attachment is converted to PDF first (the same LibreOffice conversion
 * the viewer uses, GCS-cached by content hash) and the *converted* PDF is
 * what actually gets staged/split -- otherwise pptx would only ever reach
 * the synchronous FileProcessor path's plain generic Docling endpoint,
 * never the dedicated OCR model real PDFs get here.
 *
 * Called from the file worker when config.doclingScheduler.routePdfs is on.
 * Inserts the pending_split row; the splitter takes over.
 */
import { db } from '@/database/client';
import { IngestionStatus, AttachmentEntityType } from '@xyne/shared';
import { runAsServiceActor } from '@/database/tenant/context';
import { SubApp } from '@/vespa/src/types';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { storageService } from '@/services/storage';
import { convertToPdf, getConvertedPdfGcsPath } from '@/services/officeConversionService';
import { getRuntimeConfig } from '../runtime/config';
import { inferDoclingSourcePriority, upsertDoclingAsyncFileForSplit } from './store';

const isPdf = (mime: string | null | undefined, name: string | null | undefined): boolean =>
  (mime || '').toLowerCase().includes('application/pdf') ||
  (name || '').toLowerCase().endsWith('.pdf');

const isPptx = (mime: string | null | undefined, name: string | null | undefined): boolean => {
  const ext = (name || '').toLowerCase().split('.').pop();
  return (
    ext === 'pptx' ||
    ext === 'ppt' ||
    mime === 'application/vnd.ms-powerpoint' ||
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  );
};

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

/**
 * Resolves the GCS key the splitter should read real PDF bytes from for
 * this attachment. A genuine PDF resolves to its own stored file. A
 * pptx/ppt is converted to PDF first and resolves to the converted file's
 * (content-hash-keyed, already GCS-cached) location instead. Anything else
 * returns null -- not routed to the scheduler, falls back to the
 * synchronous FileProcessor path.
 */
const resolveSourceKey = async (
  mime: string | null | undefined,
  name: string | null | undefined,
  url: string,
): Promise<string | null> => {
  if (isPdf(mime, name)) {
    return toGcsKey(url);
  }
  if (isPptx(mime, name)) {
    const buffer = await storageService.getFileBuffer(url);
    await convertToPdf(buffer, name || 'file.pptx');
    return getConvertedPdfGcsPath(buffer);
  }
  return null;
};

const pageChunkSize = () => getRuntimeConfig().pageChunkSize;

const routeCollection = async (fileId: string): Promise<boolean> => {
  const item = await db.collectionItem.findFirst({ where: { fileId, isLatest: true } });
  if (!item) return false;

  const attachment = await db.messageAttachment.findFirst({
    where: { entityId: item.id, entityType: AttachmentEntityType.COLLECTION },
  });
  if (!attachment?.url) return false;
  const sourceKey = await resolveSourceKey(attachment.mimetype, item.name, attachment.url);
  if (!sourceKey) return false;

  const { basePriority } = inferDoclingSourcePriority({ collectionId: item.rootCollectionId });

  const inserted = await runAsServiceActor('docling-intake', attachment.workspaceId,
    () => upsertDoclingAsyncFileForSplit({
      fileId: item.fileId,
      collectionId: item.rootCollectionId,
      sourcePath: sourceKey,
      sourceStorageKey: sourceKey,
      basePriority,
      pageChunkSize: pageChunkSize(),
    }),
  );

  if (inserted !== null) {
    await db.collectionItem.updateMany({
      where: { fileId: item.fileId, isLatest: true },
      data: { ingestionStatus: IngestionStatus.PROCESSING },
    });
  }

  logger.info('[DOCLING_SCHEDULER] Routed COLLECTION PDF to scheduler', {
    fileId: item.fileId,
    basePriority,
    alreadyQueued: inserted === null,
  });
  return true;
};

const routeAttachment = async (attachmentId: string, app: SubApp): Promise<boolean> => {
  const att = await db.messageAttachment.findUnique({ where: { id: attachmentId } });
  if (!att?.url) return false;
  const sourceKey = await resolveSourceKey(att.mimetype, att.originalFilename, att.url);
  if (!sourceKey) return false;

  const { basePriority } = inferDoclingSourcePriority({ collectionId: '' });

  const inserted = await runAsServiceActor('docling-intake', att.workspaceId,
    () => upsertDoclingAsyncFileForSplit({
      fileId: att.id,
      collectionId: '',  // empty sentinel = attachment, not collection
      sourcePath: sourceKey,
      sourceStorageKey: sourceKey,
      basePriority,
      pageChunkSize: pageChunkSize(),
    }),
  );

  logger.info('[DOCLING_SCHEDULER] Routed ATTACHMENT PDF to scheduler', {
    attachmentId: att.id, app, basePriority, alreadyQueued: inserted === null,
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
