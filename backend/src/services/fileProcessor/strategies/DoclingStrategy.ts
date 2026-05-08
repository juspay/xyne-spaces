import { BaseStrategy } from "./BaseStrategy";
import type { ProcessingResult } from "../types";
import { DoclingService } from "../DoclingService";
import { logger } from "@/utils/logger";

/**
 * Docling document processing strategy
 *
 * This strategy uses the Docling service API to process documents.
 * It requires a running Docling server with health check support.
 *
 * Features:
 * - Automatic health check before processing
 * - Graceful fallback if Docling is unavailable
 * - Transforms Docling API responses to ProcessingResult format
 */
export class DoclingStrategy extends BaseStrategy {
  private doclingService: DoclingService;

  /**
   * Create a DoclingStrategy
   *
   * @param options - Optional Docling service configuration overrides
   */
  constructor(options?: ConstructorParameters<typeof DoclingService>[0]) {
    super();
    this.doclingService = new DoclingService(options);
  }

  /**
   * Parse a document using the Docling API
   *
   * @param buffer - Document content as Buffer
   * @param vespaDocId - Document ID for Vespa ingestion (used as filename hint)
   * @returns ProcessingResult with extracted chunks and metadata
   * @throws Error if Docling is unhealthy or processing fails
   */
  async parse(buffer: Buffer, vespaDocId: string): Promise<ProcessingResult> {
    logger.info(`[DoclingStrategy] Starting document processing for ${vespaDocId}`);

    // Check health first
    const health = await this.doclingService.checkHealth();

    if (!health.healthy) {
      const error = `Docling service is unhealthy: ${health.error || "Unknown error"}`;
      logger.error(`[DoclingStrategy] ${error}`);
      throw new Error(error);
    }

    // Process the document
    try {
      const result = await this.doclingService.processDocument(buffer, vespaDocId);

      logger.info(`[DoclingStrategy] Successfully processed ${vespaDocId}`, {
        chunkCount: result.chunks.length,
        hasOutline: !!result.documentOutline,
      });

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`[DoclingStrategy] Failed to process ${vespaDocId}: ${error}`);
      throw new Error(`Docling processing failed: ${error}`);
    }
  }

  /**
   * Get the strategy name
   */
  getName(): string {
    return "docling-service";
  }

  /**
   * Check if Docling is configured and available
   */
  async isAvailable(): Promise<{ available: boolean; error?: string }> {
    const health = await this.doclingService.checkHealth();
    return {
      available: health.healthy,
      error: health.error,
    };
  }
}