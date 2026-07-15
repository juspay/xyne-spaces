// Main processor
export { FileProcessor, isSupportedMimeType, SUPPORTED_MIME_TYPES } from "./FileProcessor"

// Types
export type { ProcessingResult, StrategyConfig, ChunkMetadata } from "./types"

// Strategies
export {
    BaseStrategy,
    TextStrategy,
    PdfJsStrategy,
    DocxStrategy,
    SpreadsheetStrategy,
    DoclingStrategy,
} from "./strategies"

// Docling Service
export { DoclingService } from "./DoclingService"
