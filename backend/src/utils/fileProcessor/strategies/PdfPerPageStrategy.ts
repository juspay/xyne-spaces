import { BaseStrategy } from "./BaseStrategy"
import type { ProcessingResult } from "../types"
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs"

/**
 * PDF parsing strategy that produces one chunk per page.
 * Used for presentation PDFs where each page/slide needs its own chunk
 * so that slide URLs can be mapped 1:1 with chunks.
 */
export class PdfPerPageStrategy extends BaseStrategy {

    async parse(buffer: Buffer, _vespaDocId: string): Promise<ProcessingResult> {
        try {
            const data = new Uint8Array(buffer)

            const loadingTask = pdfjsLib.getDocument({
                data,
                useSystemFonts: true,
                disableFontFace: true,
                verbosity: 0,
            })

            const doc = await loadingTask.promise
            const numPages = doc.numPages
            const chunks: string[] = []
            const chunks_pos: number[] = []

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

                for (const item of textContent.items as any[]) {
                    const str = item.str
                    if (!str) continue

                    const tr = Array.isArray(item.transform) ? item.transform : []
                    const x = typeof tr[4] === "number" ? tr[4] : null
                    const y = typeof tr[5] === "number" ? tr[5] : null
                    const w = typeof item.width === "number" ? item.width : 0
                    const h = typeof item.height === "number" ? item.height : 0

                    let isNewLine = false

                    if (prevY != null && y != null) {
                        const tolerance = Math.max(prevH || 0, h || 0, 10) * 0.4
                        if (Math.abs(y - prevY) > tolerance) {
                            isNewLine = true
                        }
                    }

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

                if (currentLine.trim().length > 0) lines.push(currentLine)

                // Clean lines and join as a single chunk for this page
                const pageText = lines
                    .map((l) => this.cleanLine(l))
                    .filter(l => l.length > 0)
                    .join("\n")

                if (pageText.length > 0) {
                    chunks.push(pageText)
                    chunks_pos.push(i) // 1-indexed page number
                }

                page.cleanup()
            }

            if (doc.destroy) await doc.destroy()

            return {
                chunks,
                chunks_pos,
                processingMethod: this.getName(),
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`PDF per-page parsing failed: ${message}`)
        }
    }

    private cleanLine(line: string): string {
        let s = line.normalize("NFC")
        s = s.replace(/[^\P{C}\n\t]/gu, "")
        s = s.replace(/\s+/g, " ").trim()
        return s
    }

    getName(): string {
        return "pdfjs-per-page"
    }
}