/**
 * Metadata for a text or image chunk extracted from a file
 */
export interface ChunkMetadata {
    /** Global index of this chunk across all chunks */
    chunk_index: number
    /** Page numbers this chunk appears on (if applicable) */
    page_numbers: number[]
    /** Semantic labels for this chunk (e.g., "heading", "paragraph", "table") */
    block_labels: string[]
}

/**
 * Standard result format for file processing strategies
 * 
 * Only `chunks` is required. Other fields are optional and can be
 * populated by more advanced strategies (OCR, Gemini, etc.)
 */
export interface ProcessingResult {
    /** Extracted text chunks (required) */
    chunks: string[]

    /** Position/index of each text chunk (optional) */
    chunks_pos?: number[]

    /** Metadata for each text chunk (optional) */
    chunks_map?: ChunkMetadata[]

    /** Extracted image chunks - base64 or URLs (optional) */
    image_chunks?: string[]

    /** Position/index of each image chunk (optional) */
    image_chunks_pos?: number[]

    /** Metadata for each image chunk (optional) */
    image_chunks_map?: ChunkMetadata[]

    /** Name of the strategy used for processing (optional) */
    processingMethod?: string
}

/**
 * Configuration for parsing strategies
 */
export interface StrategyConfig {
    /** Maximum size of each text chunk in characters */
    chunkSize?: number
    /** Number of characters to overlap between chunks */
    chunkOverlap?: number
    /** Whether to extract images from the file */
    extractImages?: boolean
    /** Whether to generate descriptions for extracted images */
    describeImages?: boolean
}
