import type { ProcessingResult } from "../types"

/**
 * Abstract base class for all file parsing strategies
 * 
 * Strategies are responsible for extracting text and images from file buffers
 * and chunking the content for vector database ingestion.
 */
export abstract class BaseStrategy {
    /**
     * Parse the file buffer and extract chunks
     * 
     * @param buffer - The file as a Buffer
     * @param vespaDocId - Document ID for Vespa ingestion
     * @returns Promise resolving to the processing result with chunks and metadata
     * @throws Error if parsing fails
     */
    abstract parse(buffer: Buffer, vespaDocId: string): Promise<ProcessingResult>

    /**
     * Get the name of this strategy
     * Used for logging and result metadata
     */
    abstract getName(): string
}
