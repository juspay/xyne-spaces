import { BaseStrategy } from "./BaseStrategy"
import type { ProcessingResult, StrategyConfig, ChunkMetadata } from "../types"
import JSZip from "jszip"
import { XMLParser } from "fast-xml-parser"

/**
 * DOCX parsing strategy that extracts text from .docx files.
 *
 * DOCX files are ZIP archives containing XML. The main document content
 * is in word/document.xml. This strategy:
 *  - Extracts paragraph text
 *  - Tracks page boundaries via explicit page breaks (<w:br w:type="page"/>) 
 *    and paragraph-level pageBreakBefore properties
 *  - Records heading styles in block_labels
 *  - Builds chunks_map with real page_numbers so the LLM outline generation
 *    can produce accurate "Topic Page N" entries
 */
export class DocxStrategy extends BaseStrategy {
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
            const zip = await JSZip.loadAsync(buffer)

            const documentXml = zip.file("word/document.xml")
            if (!documentXml) {
                throw new Error("word/document.xml not found in DOCX archive")
            }

            const xmlContent = await documentXml.async("text")

            const parser = new XMLParser({
                ignoreAttributes: false,
                preserveOrder: false,
                removeNSPrefix: true,
                processEntities: {
                    maxTotalExpansions: 10000,
                    maxEntityCount: 1000,
                },
            })
            const parsed = parser.parse(xmlContent)

            // Extract paragraphs with page numbers and heading labels
            const paragraphData = this.extractParagraphsWithMeta(parsed)

            // Chunk while carrying page and label metadata forward
            const { chunks, chunks_map } = this.chunkByParagraphsWithMeta(paragraphData)

            const documentOutline = await this.buildDocumentOutline(chunks, chunks_map)

            return {
                chunks,
                chunks_map,
                documentOutline,
                processingMethod: this.getName(),
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`DOCX parsing failed: ${message}`)
        }
    }

    /**
     * Extract paragraphs from parsed DOCX XML, tracking:
     *  - Page number (incremented on explicit page breaks and pageBreakBefore)
     *  - Heading style (e.g. "heading1", "heading2") from paragraph style name
     */
    private extractParagraphsWithMeta(
        node: any,
    ): Array<{ text: string; page: number; blockLabel: string }> {
        const results: Array<{ text: string; page: number; blockLabel: string }> = []

        const body = node?.document?.body
        if (!body) return results

        const pNodes = Array.isArray(body.p) ? body.p : body.p ? [body.p] : []
        let currentPage = 1

        for (const p of pNodes) {
            // ── Detect page break in paragraph properties ────────────────
            const pPr = p?.pPr
            if (pPr) {
                // pageBreakBefore: paragraph starts on a new page
                if (pPr.pageBreakBefore != null && pPr.pageBreakBefore !== false) {
                    currentPage++
                }
            }

            // ── Detect explicit page break inside runs ────────────────────
            const runs = Array.isArray(p.r) ? p.r : p.r ? [p.r] : []
            let hasExplicitPageBreak = false
            for (const run of runs) {
                const brNodes = Array.isArray(run.br) ? run.br : run.br ? [run.br] : []
                for (const br of brNodes) {
                    // w:br w:type="page" — namespace prefix stripped by parser
                    const brType = br?.["@_type"] ?? br?.type ?? ""
                    if (brType === "page") {
                        hasExplicitPageBreak = true
                    }
                }
            }
            if (hasExplicitPageBreak) {
                currentPage++
            }

            // ── Extract heading style label ───────────────────────────────
            const styleId: string = pPr?.pStyle?.["@_val"] ?? pPr?.pStyle ?? ""
            const blockLabel = styleId.toLowerCase().startsWith("heading")
                ? styleId.toLowerCase()
                : "text"

            // ── Extract text ──────────────────────────────────────────────
            const text = this.extractTextFromParagraph(p)
            if (text.trim().length > 0) {
                results.push({ text: text.trim(), page: currentPage, blockLabel })
            }
        }

        return results
    }

    private extractTextFromParagraph(p: any): string {
        if (!p) return ""
        const runs = Array.isArray(p.r) ? p.r : p.r ? [p.r] : []
        let text = ""
        for (const run of runs) {
            const t = run?.t
            if (typeof t === "string") {
                text += t
            } else if (typeof t === "object" && t !== null) {
                text += t["#text"] || ""
            }
        }
        return text
    }

    /**
     * Chunk paragraphs while building chunks_map with real page numbers and
     * block labels derived from heading styles.
     */
    private chunkByParagraphsWithMeta(
        paragraphs: Array<{ text: string; page: number; blockLabel: string }>,
    ): { chunks: string[]; chunks_map: ChunkMetadata[] } {
        const chunks: string[] = []
        const chunks_map: ChunkMetadata[] = []

        let currentChunk = ""
        let currentPages = new Set<number>()
        let currentLabels = new Set<string>()
        let chunkIndex = 0
        const { chunkSize } = this.config

        const flush = () => {
            if (currentChunk.trim().length === 0) return
            const pages = Array.from(currentPages).sort((a, b) => a - b)
            const pageLabel = pages.length === 1 ? `[Page ${pages[0]}]` : `[Pages ${pages.join(', ')}]`
            chunks.push(`${pageLabel}\n${currentChunk.trim()}`)
            chunks_map.push({
                chunk_index: chunkIndex++,
                page_numbers: pages,
                block_labels: Array.from(currentLabels),
            })
            currentChunk = ""
            currentPages = new Set()
            currentLabels = new Set()
        }

        for (const { text, page, blockLabel } of paragraphs) {
            if (currentChunk.length + text.length + 2 > chunkSize && currentChunk.length > 0) {
                flush()
            }
            currentChunk += (currentChunk ? "\n\n" : "") + text
            currentPages.add(page)
            currentLabels.add(blockLabel)
        }

        flush()

        return { chunks, chunks_map }
    }

    getName(): string {
        return "docx-xml-parser"
    }
}

