export interface ProcessingResult {
    chunks: string[];
    processingMethod: string;
}

export interface StrategyConfig {
    chunkSize?: number;
    chunkOverlap?: number;
}