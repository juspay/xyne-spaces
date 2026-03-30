import { BaseStrategy } from "./BaseStrategy"
import type { ProcessingResult, StrategyConfig } from "../types"

export class TextStrategy extends BaseStrategy {
    private config: Required<Pick<StrategyConfig, "chunkSize" | "chunkOverlap">>

    constructor(config?: StrategyConfig) {
        super()
        this.config = {
            chunkSize: config?.chunkSize ?? 1000,
            chunkOverlap: config?.chunkOverlap ?? 200,
        }
    }

    async parse(buffer: Buffer, _vespaDocId: string): Promise<ProcessingResult> {
        try {
            // Convert Buffer to string (UTF-8)
            const text = buffer.toString("utf-8")

            // Normalize text: Unicode normalization and control char removal
            let normalizedText = text.normalize("NFC")
            normalizedText = normalizedText.replace(/[^\P{C}\n\t]/gu, "")

            // Split into paragraphs (handles \n, \r\n, and multiple newlines)
            const paragraphs = normalizedText
                .split(/\r?\n\r?\n+/)
                .map(p => p.trim())
                .filter(p => p.length > 0)

            // Chunk by paragraphs
            const chunks = this.chunkByParagraphs(paragraphs)

            return {
                chunks,
                processingMethod: this.getName(),
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`Text parsing failed: ${message}`)
        }
    }

    private chunkByParagraphs(paragraphs: string[]): string[] {
        const chunks: string[] = []
        let currentChunk = ""
        const { chunkSize } = this.config

        for (const para of paragraphs) {
            if (currentChunk.length + para.length + 2 > chunkSize && currentChunk.length > 0) {
                chunks.push(currentChunk.trim())
                currentChunk = ""
            }
            currentChunk += (currentChunk ? "\n\n" : "") + para
        }

        if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk.trim())
        }

        return chunks
    }

    getName(): string {
        return "text-smart"
    }
}
