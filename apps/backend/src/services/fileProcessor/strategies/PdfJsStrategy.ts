import { BaseStrategy } from "./BaseStrategy"
import type { ProcessingResult, StrategyConfig, ChunkMetadata } from "../types"
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs"

export class PdfJsStrategy extends BaseStrategy {
    private config: Required<Pick<StrategyConfig, "chunkSize" | "chunkOverlap">>

    /**
     * Create a PdfJsStrategy with optional configuration
     * 
     * @param config - Strategy configuration
     * @param config.chunkSize - Maximum characters per chunk (default: 1000)
     * @param config.chunkOverlap - Characters to overlap between chunks (default: 200)
     */
    constructor(config?: StrategyConfig) {
        super()
        this.config = {
            chunkSize: config?.chunkSize ?? 1000,
            chunkOverlap: config?.chunkOverlap ?? 200,
        }
    }

    /**
     * Parse PDF and extract text chunks using pdfjs-dist with spatial awareness
     */
    async parse(buffer: Buffer, vespaDocId: string): Promise<ProcessingResult> {
        try {
            // Convert Buffer to Uint8Array for pdfjs-dist
            const data = new Uint8Array(buffer)

            // Load the document using legacy build for Node.js compatibility
            const loadingTask = pdfjsLib.getDocument({
                data,
                useSystemFonts: true,
                disableFontFace: true,
                verbosity: 0, // Suppress warnings
            })

            const doc = await loadingTask.promise
            const numPages = doc.numPages
            // Track which pages each paragraph came from
            const allParagraphs: string[] = []
            const paragraphPages: number[] = []  // parallel: page number for each paragraph

            // Extract text from each page using spatial logic
            for (let i = 1; i <= numPages; i++) {
                const page = await doc.getPage(i)

                const textContent = await page.getTextContent({
                    includeMarkedContent: false,
                    disableNormalization: false,
                })

                const lines: string[] = []
                let currentLine = ""
                let prevY: number | null = null
                let prevH: number | null = null
                let prevX: number | null = null
                let prevWidth: number | null = null

                // Iterate items to reconstruct layout based on Y coordinates
                for (const item of textContent.items as any[]) {
                    const str = item.str
                    if (!str) continue

                    // PDF matrix transform: [scaleX, skewY, skewX, scaleY, x, y]
                    const tr = Array.isArray(item.transform) ? item.transform : []
                    const x = typeof tr[4] === "number" ? tr[4] : null
                    const y = typeof tr[5] === "number" ? tr[5] : null
                    const w = typeof item.width === "number" ? item.width : 0
                    const h = typeof item.height === "number" ? item.height : 0

                    let isNewLine = false

                    // 1. Detect New Line (Vertical Check)
                    if (prevY != null && y != null) {
                        const tolerance = Math.max(prevH || 0, h || 0, 10) * 0.4
                        if (Math.abs(y - prevY) > tolerance) {
                            isNewLine = true
                        }
                    }

                    // 2. Detect Space (Horizontal Check)
                    let hasSpace = false
                    if (!isNewLine && prevX != null && x != null && prevWidth != null) {
                        const gap = x - (prevX + prevWidth)
                        if (gap > (h || 10) * 0.2) {
                            hasSpace = true
                        }
                    }

                    if (isNewLine || item.hasEOL) {
                        if (currentLine.trim().length > 0) lines.push(currentLine)
                        currentLine = str
                    } else {
                        if (hasSpace && currentLine.length > 0 && !currentLine.endsWith(" ")) {
                            currentLine += " "
                        }
                        currentLine += str
                    }

                    prevY = y
                    prevH = h
                    prevX = x
                    prevWidth = w
                }

                // Push the last line of the page
                if (currentLine.trim().length > 0) lines.push(currentLine)

                // Clean and filter extracted lines
                const pageParagraphs = lines
                    .map((l) => this.cleanLine(l))
                    .filter(l => l.length > 0)

                for (const para of pageParagraphs) {
                    allParagraphs.push(para)
                    paragraphPages.push(i)  // record the 1-indexed page for this paragraph
                }

                // Clean up page resources
                page.cleanup()
            }

            // pdfjs-dist v6 moved destroy() to the loading task; it tears down
            // the document and its worker.
            await loadingTask.destroy()

            // Chunk based on paragraphs, tracking which pages each chunk covers
            const { chunks, chunks_map } = this.chunkByParagraphsWithMeta(allParagraphs, paragraphPages)

            const documentOutline = await this.buildDocumentOutline(chunks, chunks_map, vespaDocId)

            return {
                chunks,
                chunks_map,
                chunks_pos: chunks_map.map(m => m.page_numbers[0] ?? 1),
                documentOutline,
                processingMethod: this.getName(),
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`PDF.js parsing failed: ${message}`)
        }
    }

    /**
     * Chunk paragraphs while tracking page metadata for each resulting chunk
     */
    private chunkByParagraphsWithMeta(
        paragraphs: string[],
        paragraphPages: number[],
    ): { chunks: string[]; chunks_map: ChunkMetadata[] } {
        const chunks: string[] = []
        const chunks_map: ChunkMetadata[] = []
        let currentChunk = ""
        let currentPages: Set<number> = new Set()
        let chunkIndex = 0
        const { chunkSize } = this.config

        for (let idx = 0; idx < paragraphs.length; idx++) {
            const para = paragraphs[idx]
            const page = paragraphPages[idx] ?? 1

            if (currentChunk.length + para.length + 2 > chunkSize && currentChunk.length > 0) {
                const pages = Array.from(currentPages).sort((a, b) => a - b)
                const pageLabel = pages.length === 1 ? `[Page ${pages[0]}]` : `[Pages ${pages.join(', ')}]`
                chunks.push(`${pageLabel}\n${currentChunk.trim()}`)
                chunks_map.push({
                    chunk_index: chunkIndex,
                    page_numbers: pages,
                    block_labels: [],
                })
                chunkIndex++
                currentChunk = ""
                currentPages = new Set()
            }

            currentChunk += (currentChunk ? "\n\n" : "") + para
            currentPages.add(page)
        }

            if (currentChunk.trim().length > 0) {
                const pages = Array.from(currentPages).sort((a, b) => a - b)
                const pageLabel = pages.length === 1 ? `[Page ${pages[0]}]` : `[Pages ${pages.join(', ')}]`
                chunks.push(`${pageLabel}\n${currentChunk.trim()}`)
                chunks_map.push({
                    chunk_index: chunkIndex,
                    page_numbers: pages,
                    block_labels: [],
                })
            }

        return { chunks, chunks_map }
    }

    /**
     * Clean text: normalize Unicode, remove control chars, fix spacing
     */
    private cleanLine(line: string): string {
        let s = line.normalize("NFC")
        s = s.replace(/[^\P{C}\n\t]/gu, "")
        s = s.replace(/\s+/g, " ").trim()
        return s
    }

    getName(): string {
        return "pdfjs-dist-advanced"
    }
}
