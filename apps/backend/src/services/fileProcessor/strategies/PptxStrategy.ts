import { BaseStrategy } from "./BaseStrategy"
import type { ProcessingResult, StrategyConfig, ChunkMetadata } from "../types"
import { parsePptxSlides } from "../pptxSlideParser"

const TITLE_PLACEHOLDER_TYPES = new Set(["title", "ctrTitle", "subTitle"])

/**
 * PPTX parsing strategy — native text extraction for uploaded .ppt/.pptx
 * files, used as the fallback when Docling is disabled/unavailable/fails
 * (see FileProcessor.processBufferWithFallback). Docling remains the OCR
 * path for text baked into slide images/screenshots; this strategy covers
 * the common case of native, machine-readable slide text reliably and
 * without any external dependency.
 *
 * PPTX files are ZIP archives containing XML, same family as DOCX — this
 * mirrors DocxStrategy's structure (JSZip + fast-xml-parser, paragraph-style
 * chunking with page/label metadata), reading ppt/slides/slideN.xml via the
 * shared pptxSlideParser instead of DocxStrategy's word/document.xml walk.
 * A slide stands in for a "page"; the placeholder type (title vs body)
 * stands in for heading level.
 */
export class PptxStrategy extends BaseStrategy {
    private config: Required<Pick<StrategyConfig, "chunkSize" | "chunkOverlap">>

    constructor(config?: StrategyConfig) {
        super()
        this.config = {
            chunkSize: config?.chunkSize ?? 1000,
            chunkOverlap: config?.chunkOverlap ?? 200,
        }
    }

    async parse(buffer: Buffer, vespaDocId: string): Promise<ProcessingResult> {
        try {
            const { slides } = await parsePptxSlides(buffer)

            const paragraphs = this.extractParagraphsWithMeta(slides)
            const { chunks, chunks_map } = this.chunkByParagraphsWithMeta(paragraphs)

            const documentOutline = await this.buildDocumentOutline(chunks, chunks_map, vespaDocId)

            return {
                chunks,
                chunks_map,
                documentOutline,
                processingMethod: this.getName(),
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`PPTX parsing failed: ${message}`)
        }
    }

    /**
     * Flatten parsed slides into paragraph-like entries — one per shape's
     * text-body paragraph, tagged with its slide number (standing in for
     * page) and a "title"/"text" label derived from the shape's placeholder
     * type — so the same greedy chunker DocxStrategy uses can run unchanged.
     */
    private extractParagraphsWithMeta(
        slides: Awaited<ReturnType<typeof parsePptxSlides>>["slides"],
    ): Array<{ text: string; page: number; blockLabel: string }> {
        const results: Array<{ text: string; page: number; blockLabel: string }> = []

        for (const slide of slides) {
            for (const shape of slide.shapes) {
                if (shape.kind !== "text" || !shape.runs) continue
                const blockLabel =
                    shape.placeholderType && TITLE_PLACEHOLDER_TYPES.has(shape.placeholderType)
                        ? "title"
                        : "text"
                for (const run of shape.runs) {
                    const text = run.text.trim()
                    if (text.length > 0) {
                        results.push({ text, page: slide.index, blockLabel })
                    }
                }
            }
        }

        return results
    }

    /**
     * Chunk paragraphs while building chunks_map with real slide numbers and
     * placeholder-derived block labels. Identical shape to DocxStrategy's
     * chunkByParagraphsWithMeta — [Slide N] instead of [Page N].
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
            const pageLabel = pages.length === 1 ? `[Slide ${pages[0]}]` : `[Slides ${pages.join(", ")}]`
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
            // A slide boundary always starts a fresh chunk — unlike DOCX,
            // where an unbroken multi-page paragraph flow is common, PPTX
            // slides are naturally discrete units and mixing two slides'
            // text into one chunk (just because both are small) muddies the
            // per-slide citation this is meant to preserve.
            if (currentPages.size > 0 && !currentPages.has(page)) {
                flush()
            } else if (currentChunk.length + text.length + 2 > chunkSize && currentChunk.length > 0) {
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
        return "pptx-xml-parser"
    }
}
