import { BaseStrategy } from "./BaseStrategy"
import type { ProcessingResult, StrategyConfig } from "../types"
import JSZip from "jszip"
import { XMLParser } from "fast-xml-parser"

/**
 * DOCX parsing strategy that extracts text from .docx files
 * 
 * DOCX files are ZIP archives containing XML. The main document content
 * is in word/document.xml. This strategy extracts paragraph text from
 * the XML and chunks it for indexing.
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
            // DOCX is a ZIP containing XML files
            const zip = await JSZip.loadAsync(buffer)

            // Main document content is in word/document.xml
            const documentXml = zip.file("word/document.xml")
            if (!documentXml) {
                throw new Error("word/document.xml not found in DOCX archive")
            }

            const xmlContent = await documentXml.async("text")

            // Parse XML
            const parser = new XMLParser({
                ignoreAttributes: false,
                preserveOrder: false,
                removeNSPrefix: true, // Remove namespace prefixes for cleaner access
            })
            const parsed = parser.parse(xmlContent)

            // Extract text from paragraphs
            const paragraphs = this.extractParagraphs(parsed)

            // Chunk the extracted paragraphs
            const chunks = this.chunkByParagraphs(paragraphs)

            return {
                chunks,
                processingMethod: this.getName(),
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`DOCX parsing failed: ${message}`)
        }
    }

    /**
     * Recursively extract text from the DOCX XML structure
     * 
     * DOCX structure:
     *   document > body > p (paragraphs) > r (runs) > t (text)
     */
    private extractParagraphs(node: any): string[] {
        const paragraphs: string[] = []

        const body = node?.document?.body
        if (!body) return paragraphs

        // Get paragraphs - handle both array and single paragraph
        const pNodes = Array.isArray(body.p) ? body.p : body.p ? [body.p] : []

        for (const p of pNodes) {
            const text = this.extractTextFromParagraph(p)
            if (text.trim().length > 0) {
                paragraphs.push(text.trim())
            }
        }

        return paragraphs
    }

    /**
     * Extract text from a single paragraph node
     * 
     * A paragraph contains "runs" (r nodes) which contain text (t nodes)
     */
    private extractTextFromParagraph(p: any): string {
        if (!p) return ""

        // Handle text runs (r elements)
        const runs = Array.isArray(p.r) ? p.r : p.r ? [p.r] : []
        let text = ""

        for (const run of runs) {
            const t = run?.t
            if (typeof t === "string") {
                text += t
            } else if (typeof t === "object" && t !== null) {
                // Sometimes t is an object with #text property (when attrs exist)
                text += t["#text"] || ""
            }
        }

        return text
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
        return "docx-xml-parser"
    }
}
