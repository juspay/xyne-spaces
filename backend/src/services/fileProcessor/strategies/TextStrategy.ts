import { BaseStrategy } from "./BaseStrategy"
import type { ProcessingResult, StrategyConfig } from "../types"

export class TextStrategy extends BaseStrategy {
    private config: Required<Pick<StrategyConfig, "chunkSize" | "chunkOverlap">>

    constructor(config?: StrategyConfig) {
        super()
        this.config = {
            chunkSize: config?.chunkSize ?? 2000,
            chunkOverlap: config?.chunkOverlap ?? 200,
        }
    }

    async parse(buffer: Buffer, vespaDocId: string): Promise<ProcessingResult> {
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
            const chunks_map = chunks.map((_, i) => ({
                chunk_index: i,
                page_numbers: [] as number[],
                block_labels: [] as string[],
            }))

            const documentOutline = await this.buildDocumentOutline(chunks, chunks_map, vespaDocId)

            return {
                chunks,
                chunks_map,
                documentOutline,
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

        const flush = () => {
            if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim())
            currentChunk = ""
        }

        for (const para of paragraphs) {
            // A single paragraph larger than chunkSize (e.g. minified JSON, a
            // single-line CSV/HTML) would otherwise become one unbounded chunk.
            // Split it on word boundaries so no chunk exceeds chunkSize.
            if (para.length > chunkSize) {
                flush()
                chunks.push(...this.splitLongParagraph(para))
                continue
            }

            if (currentChunk.length + para.length + 2 > chunkSize && currentChunk.length > 0) {
                flush()
            }
            currentChunk += (currentChunk ? "\n\n" : "") + para
        }

        flush()
        return chunks
    }

    /**
     * Split an oversized paragraph into <= chunkSize pieces, breaking on word
     * boundaries. A single word longer than chunkSize (e.g. minified JSON with
     * no whitespace) is hard-cut on char boundaries as an unavoidable fallback.
     */
    private splitLongParagraph(para: string): string[] {
        const chunks: string[] = []
        const { chunkSize } = this.config
        let buf = ""

        for (const word of para.split(/\s+/)) {
            if (!word) continue

            if (word.length > chunkSize) {
                if (buf) { chunks.push(buf); buf = "" }
                for (let i = 0; i < word.length; i += chunkSize) {
                    chunks.push(word.slice(i, i + chunkSize))
                }
                continue
            }

            // +1 for the joining space
            if (buf && buf.length + 1 + word.length > chunkSize) {
                chunks.push(buf)
                buf = ""
            }
            buf = buf ? `${buf} ${word}` : word
        }

        if (buf) chunks.push(buf)
        return chunks
    }

    getName(): string {
        return "text-smart"
    }
}
