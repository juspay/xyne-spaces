import { BaseStrategy } from "./BaseStrategy"
import type { ProcessingResult, StrategyConfig } from "../types"
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
    async parse(buffer: Buffer, _vespaDocId: string): Promise<ProcessingResult> {
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
            let allParagraphs: string[] = []

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

                allParagraphs.push(...pageParagraphs)

                // Clean up page resources
                page.cleanup()
            }

            // In older pdfjs-dist versions doc.destroy() might not exist
            if (doc.destroy) await doc.destroy()

            // Chunk based on paragraphs
            const chunks = this.chunkByParagraphs(allParagraphs)

            return {
                chunks,
                processingMethod: this.getName(),
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`PDF.js parsing failed: ${message}`)
        }
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

    /**
     * Chunk text by filling chunks with whole paragraphs
     */
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
        return "pdfjs-dist-advanced"
    }
}
