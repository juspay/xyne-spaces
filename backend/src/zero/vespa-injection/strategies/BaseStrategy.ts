import type { ProcessingResult } from "../types"

export abstract class BaseStrategy {
    abstract parse(buffer: Buffer, vespaDocId: string): Promise<ProcessingResult>;
    abstract getName(): string;
}