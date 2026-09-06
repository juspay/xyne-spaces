import { logger } from "@/utils/logger";
import { config } from "@/config/env";
import type { ProcessingResult, ChunkMetadata } from "./types";

/**
 * Response from Docling /health endpoint
 */
interface HealthResponse {
  status: "ok";
}

/**
 * Single chunk from Docling response
 */
interface DoclingChunk {
  text: string;
  pages: number[];
}

/**
 * Full response from Docling /process-document/ endpoint
 */
interface DoclingProcessResponse {
  documentOutline: string;
  chunks: DoclingChunk[];
}

/**
 * Service for interacting with the Docling document processing API
 *
 * Features:
 * - Health check with caching to avoid repeated calls
 * - Document processing via multipart/form-data upload
 * - Response transformation to ProcessingResult format
 */
export class DoclingService {
  private baseUrl: string;
  private healthEndpoint: string;
  private processEndpoint: string;
  private timeoutMs: number;
  private healthCacheTtlMs: number;
  private doOcr: boolean;

  // Simple cached health check result (shared across instances)
  private static lastHealthCheck: { isHealthy: boolean; timestamp: number } | null = null;

  /**
   * Create a new DoclingService instance
   *
   * @param options - Configuration options (defaults to env config)
   */
  constructor(options?: {
    baseUrl?: string;
    healthEndpoint?: string;
    processEndpoint?: string;
    timeoutMs?: number;
    healthCacheTtlMs?: number;
    doOcr?: boolean;
  }) {
    const doclingConfig = config.docling;

    this.baseUrl = options?.baseUrl || doclingConfig.baseUrl || "";
    this.healthEndpoint = options?.healthEndpoint || doclingConfig.healthEndpoint || "/health";
    this.processEndpoint = options?.processEndpoint || doclingConfig.processEndpoint || "/process-document/";
    this.timeoutMs = options?.timeoutMs || doclingConfig.timeoutMs || 120000;
    this.healthCacheTtlMs = options?.healthCacheTtlMs || doclingConfig.healthCacheTtlMs || 30000;
    this.doOcr = options?.doOcr ?? doclingConfig.doOcr ?? true;
  }

  /**
   * Check if Docling service is healthy
   *
   * Uses cached result if available and not expired.
   *
   * @returns Object with health status and optional error message
   */
  async checkHealth(): Promise<{ healthy: boolean; error?: string }> {
    // Check cache first
    const cached = DoclingService.lastHealthCheck;

    if (cached && Date.now() - cached.timestamp < this.healthCacheTtlMs) {
      logger.debug(`[DoclingService] Using cached health status: ${cached.isHealthy ? "healthy" : "unhealthy"}`);
      return { healthy: cached.isHealthy };
    }

    // Perform health check
    const healthUrl = `${this.baseUrl}${this.healthEndpoint}`;
    logger.info(`[DoclingService] Checking health at ${healthUrl}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout for health check

      const response = await fetch(healthUrl, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        const error = `Health check failed: ${response.status} ${response.statusText} - ${errorBody}`;
        logger.warn(`[DoclingService] ${error}`);

        // Cache the unhealthy state
        DoclingService.lastHealthCheck = {
          isHealthy: false,
          timestamp: Date.now(),
        };

        return { healthy: false, error };
      }

      const data = (await response.json()) as HealthResponse;

      if (data.status !== "ok") {
        const error = `Health check returned unexpected status: ${data.status}`;
        logger.warn(`[DoclingService] ${error}`);

        DoclingService.lastHealthCheck = {
          isHealthy: false,
          timestamp: Date.now(),
        };

        return { healthy: false, error };
      }

      logger.info(`[DoclingService] Health check passed`);

      // Cache the healthy state
      DoclingService.lastHealthCheck = {
        isHealthy: true,
        timestamp: Date.now(),
      };

      return { healthy: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn(`[DoclingService] Health check error: ${error}`);

      // Cache the unhealthy state
      DoclingService.lastHealthCheck = {
        isHealthy: false,
        timestamp: Date.now(),
      };

      return { healthy: false, error };
    }
  }

  /**
   * Process a document using the Docling API
   *
   * @param buffer - Document content as Buffer
   * @param filename - Original filename (used for form data)
   * @returns ProcessingResult with extracted chunks and metadata
   * @throws Error if processing fails
   */
  async processDocument(buffer: Buffer, filename: string): Promise<ProcessingResult> {
    const processUrl = `${this.baseUrl}${this.processEndpoint}`;
    logger.info(`[DoclingService] Processing document at ${processUrl}`, {
      filename,
      size: buffer.length,
      doOcr: this.doOcr,
    });

    // Create form data
    const formData = new FormData();
    const blob = new Blob([buffer]);
    formData.append("file", blob, filename);
    formData.append("do_ocr", this.doOcr.toString());

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(processUrl, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        throw new Error(`Document processing failed: ${response.status} ${response.statusText} - ${errorBody}`);
      }

      const data = (await response.json()) as DoclingProcessResponse;

      logger.info(`[DoclingService] Document processed successfully`, {
        filename,
        chunkCount: data.chunks?.length || 0,
        hasOutline: !!data.documentOutline,
      });

      return this.transformResponse(data, filename);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`[DoclingService] Document processing error for ${filename}: ${error}`);
      throw new Error(`Failed to process document with Docling: ${error}`);
    }
  }

  /**
   * Get file extension from filename
   *
   * @param filename - Original filename
   * @returns Lowercase file extension without dot
   */
  private getFileExtension(filename: string): string {
    const lastDotIndex = filename.lastIndexOf(".");
    if (lastDotIndex === -1) {
      return "";
    }
    return filename.slice(lastDotIndex + 1).toLowerCase();
  }

  /**
   * Check if file type should have page info appended
   *
   * @param extension - File extension
   * @returns True if page info should be appended
   */
  private shouldAppendPageInfo(extension: string): boolean {
    const supportedExtensions = ["pdf", "docx", "pptx", "ppt"];
    return supportedExtensions.includes(extension);
  }

  /**
   * Transform Docling response to ProcessingResult format
   *
   * @param response - Raw Docling API response
   * @param filename - Original filename (used to determine file type)
   * @returns ProcessingResult with normalized data
   */
  private transformResponse(response: DoclingProcessResponse, filename: string): ProcessingResult {
    const chunks: string[] = [];
    const chunks_map: ChunkMetadata[] = [];
    const chunks_pos: number[] = [];

    const extension = this.getFileExtension(filename);
    const appendPageInfo = this.shouldAppendPageInfo(extension);

    if (response.chunks && Array.isArray(response.chunks)) {
      response.chunks.forEach((chunk, index) => {
        // Build chunk metadata
        const pageNumbers = chunk.pages || [1];

        // Extract text content, optionally append page info for PDF/DOCX
        let chunkText = chunk.text;
        if (appendPageInfo && pageNumbers.length > 0) {
          const pageInfo = `[Page: ${pageNumbers.join(", ")}]\n`;
          chunkText = pageInfo + chunkText;
        }
        chunks.push(chunkText);

        chunks_map.push({
          chunk_index: index,
          page_numbers: pageNumbers,
          block_labels: [],
        });

        // Use first page as position indicator
        chunks_pos.push(pageNumbers[0] ?? 1);
      });
    }

    return {
      chunks,
      chunks_map,
      chunks_pos,
      documentOutline: response.documentOutline,
      processingMethod: "docling-service",
    };
  }

  /**
   * Clear the health check cache
   * Useful for forcing a fresh health check
   */
  static clearHealthCache(): void {
    DoclingService.lastHealthCheck = null;
    logger.info("[DoclingService] Health cache cleared");
  }

  /**
   * Check if Docling is configured and enabled
   */
  isConfigured(): boolean {
    return !!(config.docling.enabled && this.baseUrl);
  }
}