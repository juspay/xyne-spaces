/**
 * Async → sync fallback recovery.
 *
 * When the LightOnOCR async scheduler exhausts its OCR attempts for a file, this
 * runs the synchronous multi-engine ladder (PdfFallbackProcessor with OCR
 * disabled → Docling/PdfJs) on the SAME source PDF and writes the result to Vespa
 * via the existing mappers. The file degrades gracefully instead of being dropped
 * — an improvement over xyne-search, whose async scheduler has no fallback.
 *
 * Circular-import note: the mapper is lazy-imported (the documented TDZ trap in
 * workers.ts). This module imports the orchestrator (which never re-enters the
 * scheduler) plus ./store and ./storage only.
 */
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import vespaClient from '@/vespa/client';
import { fileSchema, type InsertDocument } from '@/vespa/src/types';
import { PdfFallbackProcessor } from '@/services/fileProcessor/PdfFallbackProcessor';
import { getDoclingFile, completeDoclingFileViaSyncFallback } from '../docling/scheduler/store';
import { readSourceBuffer } from '../docling/scheduler/storage';

const errMsg = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/**
 * Try to ingest a terminally-failed OCR file via the synchronous ladder.
 * Returns true if it recovered (written to Vespa + marked completed); false
 * otherwise (the caller then marks the file failed as usual).
 */
export const runSyncFallbackForFailedFile = async (
  fileId: string,
  reason: string,
): Promise<boolean> => {
  try {
    const file = await getDoclingFile(fileId);
    if (!file) {
      logger.warn('[DOCLING_SCHEDULER][fallback] no file row, cannot recover', { fileId });
      return false;
    }

    const sourceKey = file.sourceStorageKey || file.sourcePath;
    if (!sourceKey) {
      logger.warn('[DOCLING_SCHEDULER][fallback] no source key, cannot recover', { fileId });
      return false;
    }

    const isAttachment = file.collectionId === '';
    let vespaDocId: string;
    let fileName: string;
    if (isAttachment) {
      const att = await db.messageAttachment.findUnique({ where: { id: fileId } });
      if (!att) {
        logger.warn('[DOCLING_SCHEDULER][fallback] no attachment row', { fileId });
        return false;
      }
      vespaDocId = att.id;
      fileName = att.originalFilename || att.id;
    } else {
      const item = await db.collectionItem.findFirst({ where: { fileId, isLatest: true } });
      if (!item) {
        logger.warn('[DOCLING_SCHEDULER][fallback] no collection item', { fileId });
        return false;
      }
      vespaDocId = item.fileId;
      fileName = item.name;
    }

    logger.info('[DOCLING_SCHEDULER][fallback] attempting sync recovery', {
      fileId,
      reason,
      fileName,
    });

    const buffer = await readSourceBuffer(sourceKey);
    // Run the FULL sync ladder. Its OCR engines (Paddle/Docling) are different
    // services from the async LightOnOCR that just failed, so re-enabling OCR
    // here does not re-run the failed engine — it gives the best chance of a
    // quality recovery, degrading to PdfJs if those aren't configured/up.
    const result = await PdfFallbackProcessor.processWithFallback(
      buffer,
      fileName,
      vespaDocId,
    );

    if (!result.chunks || result.chunks.length === 0) {
      logger.warn('[DOCLING_SCHEDULER][fallback] recovery produced 0 chunks', { fileId });
      return false;
    }

    // Build the mapper override exactly like the writer, converting
    // the sync result's number[] positions to the string[] the mapper expects.
    const override = {
      chunks: result.chunks,
      chunks_pos: (result.chunks_pos ?? result.chunks.map((_, i) => i)).map(String),
      chunks_map: result.chunks_map ?? [],
      image_chunks: result.image_chunks ?? [],
      image_chunks_pos: (result.image_chunks_pos ?? []).map(String),
      documentOutline: result.documentOutline,
    };

    // Lazy import to avoid the circular-dependency TDZ at module load.
    const { mapCollection, mapFile } = await import('@/zero/vespa-injection/core/mapper');

    let vespaDoc;
    if (isAttachment) {
      const att = await db.messageAttachment.findUnique({ where: { id: fileId } });
      if (!att) {
        logger.warn('[DOCLING_SCHEDULER][fallback] no attachment row', { fileId });
        return false;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vespaDoc = await mapFile(att as any, undefined, undefined, override);
    } else {
      const item = await db.collectionItem.findFirst({
        where: { fileId, isLatest: true },
      });
      if (!item) {
        logger.warn('[DOCLING_SCHEDULER][fallback] no collection item', { fileId });
        return false;
      }
      vespaDoc = await mapCollection(item, override);
    }

    const [insertResult] = await vespaClient.crudService.insert(
      [vespaDoc as InsertDocument],
      fileSchema,
    );
    if (!insertResult.success) {
      logger.warn('[DOCLING_SCHEDULER][fallback] Vespa insert failed', {
        fileId,
        error: insertResult.error,
      });
      return false;
    }

    await completeDoclingFileViaSyncFallback(
      fileId,
      `Recovered via sync fallback (${result.processingMethod}) after OCR failed: ${reason}`,
    );

    logger.info('[DOCLING_SCHEDULER][fallback] ✅ recovered via sync fallback', {
      fileId,
      fileName,
      method: result.processingMethod,
      chunks: result.chunks.length,
    });
    return true;
  } catch (error) {
    logger.error('[DOCLING_SCHEDULER][fallback] sync recovery failed', {
      fileId,
      error: errMsg(error),
    });
    return false;
  }
};
