/**
 * Splits a source PDF into page-parts and stages them to GCS.
 * Ported from xyne-search `PdfProcessor.stageDoclingPageParts` (pdf-lib).
 * xyne-search wrote parts to local disk; here every part is uploaded to a GCS
 * key so the submitter (a different pod) can read it back.
 */
import { PDFDocument } from 'pdf-lib';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { partKey, stagingPaths, writePartBuffer, writeJson } from './storage';
import type { DoclingStagedPart, DoclingStagedParts } from '../types';

export const stagePdfParts = async (input: {
  fileId: string;
  sourceBuffer: Buffer;
  vespaDocId: string;
  fileName: string;
  pageChunkSize?: number;
}): Promise<DoclingStagedParts> => {
  const pageChunkSize = input.pageChunkSize ?? config.doclingScheduler.pageChunkSize;
  if (!Number.isFinite(pageChunkSize) || pageChunkSize <= 0) {
    throw new Error('Docling page chunk size must be greater than zero');
  }

  const source = await PDFDocument.load(input.sourceBuffer, { ignoreEncryption: true });
  const totalPages = source.getPageCount();
  if (totalPages <= 0) {
    throw new Error(`PDF ${input.fileId} has no pages`);
  }

  const { stageDir, partsDir, manifestPath } = stagingPaths(input.fileId);
  const parts: DoclingStagedPart[] = [];
  let partIndex = 0;

  logger.info('[DOCLING_SCHEDULER] Splitting PDF into parts', {
    fileId: input.fileId,
    vespaDocId: input.vespaDocId,
    totalPages,
    pageChunkSize,
  });

  for (let startPage = 0; startPage < totalPages; startPage += pageChunkSize) {
    const endPage = Math.min(startPage + pageChunkSize, totalPages);
    const pageIndexes = Array.from({ length: endPage - startPage }, (_, i) => startPage + i);

    const partDocument = await PDFDocument.create();
    const copiedPages = await partDocument.copyPages(source, pageIndexes);
    for (const page of copiedPages) {
      partDocument.addPage(page);
    }
    const partBytes = await partDocument.save();
    const partBuffer = Buffer.from(partBytes);

    const key = partKey(input.fileId, partIndex);
    await writePartBuffer(key, partBuffer);

    parts.push({
      partIndex,
      partDocId: `${input.vespaDocId}__docling_part_${partIndex}`,
      partPath: key,
      startPage,
      endPage,
      partSizeBytes: partBuffer.length,
    });
    partIndex += 1;
  }

  const stagedParts: DoclingStagedParts = {
    stageDir,
    partsDir,
    manifestPath,
    totalPages,
    partsTotal: parts.length,
    pageChunkSize,
    parts,
  };

  await writeJson(manifestPath, {
    fileId: input.fileId,
    vespaDocId: input.vespaDocId,
    fileName: input.fileName,
    totalPages,
    pageChunkSize,
    partsTotal: parts.length,
    parts,
  });

  logger.info('[DOCLING_SCHEDULER] PDF staged', {
    fileId: input.fileId,
    parts: parts.length,
    totalPages,
  });

  return stagedParts;
};
