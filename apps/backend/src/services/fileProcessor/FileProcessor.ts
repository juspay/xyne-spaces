import { getStorageService } from "@/services/storage"
import { logger } from "@/utils/logger"
import { config } from "@/config/env"
import type { ProcessingResult, StrategyConfig } from "./types"
import { BaseStrategy } from "./strategies/BaseStrategy"
import { TextStrategy } from "./strategies/TextStrategy"
import { PdfJsStrategy } from "./strategies/PdfJsStrategy"
import { DocxStrategy } from "./strategies/DocxStrategy"
import { PptxStrategy } from "./strategies/PptxStrategy"
import { ImageDescriptionStrategy } from "./strategies/ImageStrategy"
import { SpreadsheetStrategy } from "./strategies/SpreadsheetStrategy"
import { PdfFallbackProcessor } from "./PdfFallbackProcessor"
import { DoclingService } from "./DoclingService"

/**
 * Supported MIME types for file processing.
 * Files with these MIME types will be parsed and indexed.
 */
export const SUPPORTED_MIME_TYPES = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    "text/plain",
    "text/markdown",
    "text/csv",
    "text/html",
    "application/json",
    "application/xml",
    "text/xml",
    // Images — described by a vision LLM (ImageDescriptionStrategy) so standalone
    // image attachments become searchable in Vespa via their generated description.
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
])

/**
 * Check if a MIME type is supported for file processing
 */
export function isSupportedMimeType(mimeType: string): boolean {
    return SUPPORTED_MIME_TYPES.has(mimeType)
}

/**
 * FileProcessor - Orchestrates file loading, parsing, and chunking
 * 
 * Uses strategy pattern to support multiple file formats.
 * The strategy is either specified explicitly or auto-detected from
 * the file extension or MIME type.
 * 
 * @example
 * // Auto-detect strategy from GCS file extension
 * const result = await FileProcessor.fromGcs("uploads/report.pdf", "doc-123");
 * 
 * @example
 * // Use a specific strategy
 * const processor = new FileProcessor(new DocxStrategy({ chunkSize: 2000 }));
 * const result = await processor.processBuffer(buffer, "doc-456");
 */
export class FileProcessor {
    private strategy: BaseStrategy

    constructor(strategy: BaseStrategy) {
        this.strategy = strategy
    }

    /**
     * Process a buffer using the configured strategy
     * 
     * @param buffer - File content as a Buffer
     * @param vespaDocId - Document ID for Vespa ingestion
     * @returns Processing result with text chunks
     */
    async processBuffer(buffer: Buffer, vespaDocId: string): Promise<ProcessingResult> {
        logger.info(`[FileProcessor] Processing buffer with strategy: ${this.strategy.getName()}`)
        const result = await this.strategy.parse(buffer, vespaDocId)
        logger.info(`[FileProcessor] Extracted ${result.chunks.length} chunks using ${result.processingMethod}`)        
        return result
    }

    /**
     * Factory method: Load a file from GCS and process it
     * 
     * Auto-detects the parsing strategy based on the file extension.
     * Parses spreadsheets locally; other formats try Docling before local fallback strategies.
     * Falls back to TextStrategy for unknown extensions.
     * 
     * @param gcsPath - Path to the file in GCS (e.g., "uploads/org123/report.pdf")
     * @param vespaDocId - Document ID for Vespa ingestion
     * @param config - Optional strategy configuration
     * @returns Processing result with text chunks
     */
    static async fromGcs(
        gcsPath: string,
        vespaDocId: string,
        strategyConfig?: StrategyConfig
    ): Promise<ProcessingResult> {
        const storage = getStorageService()
        const buffer = await storage.getFileBuffer(gcsPath)

        // Spreadsheets are already structured data. Parse them locally first so
        // sheet boundaries, cell coordinates, formulas, and links are stable.
        if (FileProcessor.isSpreadsheet(gcsPath)) {
            const processor = new FileProcessor(new SpreadsheetStrategy(strategyConfig))
            return processor.processBuffer(buffer, vespaDocId)
        }

        // Try Docling first if enabled
        const doclingResult = await FileProcessor.tryDocling(buffer, gcsPath, vespaDocId)
        if (doclingResult) {
            return doclingResult
        }

        // Fall back to local strategy detection
        const strategy = FileProcessor.detectStrategy(gcsPath, strategyConfig)
        const processor = new FileProcessor(strategy)

        return processor.processBuffer(buffer, vespaDocId)
    }

    /**
     * Factory method: Create a FileProcessor from a MIME type
     * 
     * Note: For buffer-based processing, use processBufferWithFallback for Docling support.
     * 
     * @param mimeType - MIME type of the file (e.g., "application/pdf")
     * @param config - Optional strategy configuration
     * @returns A FileProcessor configured with the appropriate strategy
     */
    static fromMimeType(mimeType: string, config?: StrategyConfig): FileProcessor {
        const strategy = FileProcessor.detectStrategyFromMimeType(mimeType, config)
        return new FileProcessor(strategy)
    }

    /**
     * Process a buffer with automatic Docling fallback
     * 
     * Parses spreadsheets locally. Other non-PDF formats try Docling before local fallbacks.
     * 
     * @param buffer - File content as Buffer
     * @param vespaDocId - Document ID for Vespa ingestion
     * @param filename - Original filename for Docling hint
     * @param mimeType - MIME type for local strategy selection
     * @param config - Optional strategy configuration
     * @returns Processing result with text chunks
     */
    static async processBufferWithFallback(
        buffer: Buffer,
        vespaDocId: string,
        filename: string,
        mimeType: string,
        config?: StrategyConfig
    ): Promise<ProcessingResult> {
        // PDFs go through the multi-engine fallback ladder
        // (LightOnOCR/Docling → PdfJs). It owns its own OCR/Docling attempt,
        // so we don't double-run tryDocling here.
        if (mimeType === "application/pdf") {
            return PdfFallbackProcessor.processWithFallback(
                buffer,
                filename,
                vespaDocId,
            )
        }

        // Prefer deterministic, coordinate-aware parsing over Docling for Excel.
        if (FileProcessor.isSpreadsheet(filename, mimeType)) {
            const processor = new FileProcessor(new SpreadsheetStrategy(config))
            return processor.processBuffer(buffer, vespaDocId)
        }

        // Images go straight to the vision-LLM describer — Docling/local text
        // strategies produce nothing useful for a standalone image.
        if (mimeType.startsWith("image/")) {
            const processor = new FileProcessor(new ImageDescriptionStrategy(mimeType, config))
            return processor.processBuffer(buffer, vespaDocId)
        }

        // Non-PDF: try Docling first if enabled, then the matching local strategy.
        const doclingResult = await FileProcessor.tryDocling(buffer, filename, vespaDocId)
        if (doclingResult) {
            return doclingResult
        }

        // Fall back to local strategy
        const strategy = FileProcessor.detectStrategyFromMimeType(mimeType, config)
        const processor = new FileProcessor(strategy)
        return processor.processBuffer(buffer, vespaDocId)
    }

    /**
     * Try to process with Docling if enabled and healthy
     * 
     * @param buffer - File content
     * @param filename - Filename hint for Docling
     * @param vespaDocId - Document ID
     * @returns ProcessingResult if Docling succeeds, null otherwise
     */
    private static async tryDocling(
        buffer: Buffer,
        filename: string,
        vespaDocId: string
    ): Promise<ProcessingResult | null> {
        // Check if Docling is enabled
        if (!config.docling.enabled || !config.docling.baseUrl) {
            return null
        }

        const doclingService = new DoclingService()

        // Check health first (uses cache)
        const health = await doclingService.checkHealth()
        if (!health.healthy) {
            logger.warn(`[FileProcessor] Docling unhealthy, skipping: ${health.error}`)
            return null
        }

        // Try to process with Docling
        try {
            logger.info(`[FileProcessor] Trying Docling for ${vespaDocId}`)
            const result = await doclingService.processDocument(buffer, filename)
            logger.info(`[FileProcessor] Docling succeeded for ${vespaDocId} with ${result.chunks.length} chunks`)
            return result
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err)
            logger.warn(`[FileProcessor] Docling failed for ${vespaDocId}, falling back: ${error}`)
            return null
        }
    }

    /**
     * Detect the appropriate strategy based on file extension
     */
    static detectStrategy(filePath: string, config?: StrategyConfig): BaseStrategy {
        const ext = filePath.split(".").pop()?.toLowerCase() || ""

        switch (ext) {
            case "pdf":
                return new PdfJsStrategy(config)
            case "docx":
                return new DocxStrategy(config)
            case "pptx":
            case "ppt":
                return new PptxStrategy(config)
            case "xls":
            case "xlsx":
                return new SpreadsheetStrategy(config)
            case "txt":
            case "md":
            case "csv":
            case "html":
            case "json":
            case "xml":
                return new TextStrategy(config)
            case "png":
                return new ImageDescriptionStrategy("image/png", config)
            case "jpg":
            case "jpeg":
                return new ImageDescriptionStrategy("image/jpeg", config)
            case "webp":
                return new ImageDescriptionStrategy("image/webp", config)
            case "gif":
                return new ImageDescriptionStrategy("image/gif", config)
            default:
                logger.warn(`[FileProcessor] Unknown extension "${ext}", defaulting to TextStrategy`)
                return new TextStrategy(config)
        }
    }

    /**
     * Detect the appropriate strategy based on MIME type
     */
    static detectStrategyFromMimeType(mimeType: string, config?: StrategyConfig): BaseStrategy {
        switch (mimeType) {
            case "application/pdf":
                return new PdfJsStrategy(config)
            case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                return new DocxStrategy(config)
            case "application/vnd.ms-powerpoint":
            case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
                return new PptxStrategy(config)
            case "application/vnd.ms-excel":
            case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                return new SpreadsheetStrategy(config)
            case "text/plain":
            case "text/markdown":
            case "text/csv":
            case "text/html":
            case "application/json":
            case "application/xml":
            case "text/xml":
                return new TextStrategy(config)
            default:
                if (mimeType.startsWith("image/")) {
                    return new ImageDescriptionStrategy(mimeType, config)
                }
                logger.warn(`[FileProcessor] Unknown MIME type "${mimeType}", defaulting to TextStrategy`)
                return new TextStrategy(config)
        }
    }

    private static isSpreadsheet(filename: string, mimeType?: string): boolean {
        const extension = filename.split(".").pop()?.toLowerCase()
        return (
            extension === "xls" ||
            extension === "xlsx" ||
            mimeType === "application/vnd.ms-excel" ||
            mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    }
}
