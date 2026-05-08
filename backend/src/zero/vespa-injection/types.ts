export interface ProcessingResult {
    chunks: string[];
    chunks_pos?: number[];
    image_chunks?: string[];
    image_chunks_pos?: number[];
    processingMethod: string;
}

export interface StrategyConfig {
    chunkSize?: number;
    chunkOverlap?: number;
}