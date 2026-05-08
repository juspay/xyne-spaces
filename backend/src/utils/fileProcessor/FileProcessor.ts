import { gcsService } from '@/services/gcsService';
import { logger } from '@/utils/logger';
import type { ProcessingResult } from './types';
import type { BaseStrategy } from './strategies/BaseStrategy';
import { PdfJsStrategy } from './strategies/PdfJsStrategy';
import { DocxStrategy } from './strategies/DocxStrategy';
import { TextStrategy } from './strategies/TextStrategy';

export class FileProcessor {
  private readonly storageKey: string;
  private readonly explicitStrategy?: BaseStrategy;

  /**
   * Create a FileProcessor that fetches from GCS.
   * @param storageKey  GCS object key
   * @param strategy    Optional explicit strategy; auto-detected when omitted
   */
  constructor(storageKey: string, strategy?: BaseStrategy) {
    this.storageKey = storageKey;
    this.explicitStrategy = strategy;
  }

  static fromGcs(storageKey: string, strategy?: BaseStrategy): FileProcessor {
    return new FileProcessor(storageKey, strategy);
  }

  async process(itemId: string): Promise<ProcessingResult> {
    let buffer: Buffer;
    try {
      buffer = await gcsService.getFileBuffer(this.storageKey);
    } catch (err) {
      logger.warn(`[FileProcessor] Failed to fetch buffer for item ${itemId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return { chunks: [] };
    }

    const strategy = this.explicitStrategy ?? FileProcessor.pickStrategy(itemId, buffer);
    try {
      return await strategy.parse(buffer, itemId);
    } catch (err) {
      logger.warn(`[FileProcessor] Strategy failed for item ${itemId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return { chunks: [] };
    }
  }

  private static pickStrategy(itemId: string, buffer: Buffer): BaseStrategy {
    const ext = itemId.split('.').pop()?.toLowerCase();

    // Detect by magic bytes first
    if (buffer.slice(0, 4).toString('ascii') === '%PDF') {
      return new PdfJsStrategy();
    }
    if (
      buffer[0] === 0x50 && buffer[1] === 0x4b &&
      buffer[2] === 0x03 && buffer[3] === 0x04
    ) {
      return new DocxStrategy();
    }

    if (ext === 'pdf') return new PdfJsStrategy();
    if (ext === 'docx') return new DocxStrategy();

    return new TextStrategy();
  }
}
