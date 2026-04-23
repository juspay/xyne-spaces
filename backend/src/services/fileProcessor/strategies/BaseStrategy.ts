import type { ProcessingResult, ChunkMetadata } from "../types"
import { config } from '../../../config/env.js'
import { logger } from '../../../utils/logger.js'

const OUTLINE_MAX_INPUT_CHARS = 40000
const OUTLINE_MAX_CHUNKS = 40

const OUTLINE_PROMPT = `You are an expert document analyzer. Below is the extracted text from the beginning of a document.
Please extract the Table of Contents or Document Outline.
ONLY output a valid markdown list. Do NOT add any conversational filler, intro, or concluding remarks.

Rules for page numbers:
- If a page number is explicitly visible next to a heading in the text (e.g. a TOC line like "Introduction ... 3" or "Chapter 1 (Page 5)"), include it as "- Section Title (Page N)".
- If no page number is visible for a section, output ONLY the title with NO page annotation: "- Section Title".
- NEVER guess or invent page numbers.

If no outline or structure is present at all, output "NO_OUTLINE".

--- DOCUMENT START ---
{TEXT}
--- DOCUMENT END ---`

/**
 * Abstract base class for all file parsing strategies
 */
export abstract class BaseStrategy {
    abstract parse(buffer: Buffer, vespaDocId: string): Promise<ProcessingResult>
    abstract getName(): string

    /**
     * Generate a document outline by sending the first N chunks to LiteLLM.
     * Tries config.litellm first, then env-var aliases (LITELLM_BASE_URL / OPENAI_API_BASE).
     * Returns undefined if no LLM is configured or all attempts fail.
     */
    protected async buildDocumentOutline(
        chunks: string[],
        _chunks_map: ChunkMetadata[],
    ): Promise<string | undefined> {
        if (chunks.length === 0) return undefined

        // Resolve base URL and API key — config takes priority, then env aliases
        const baseUrl =
            config.litellm.baseUrl ||
            process.env.LITELLM_BASE_URL ||
            process.env.OPENAI_API_BASE

        const apiKey =
            config.litellm.apiKey ||
            process.env.LITELLM_API_KEY ||
            process.env.OPENAI_API_KEY

        if (!baseUrl || !apiKey) {
            logger.debug('[BaseStrategy] No LLM configured, skipping outline generation')
            return undefined
        }

        const model =
            process.env.LITELLM_FAST_MODEL ||
            process.env.LITELLM_BEST_MODEL ||
            'glm-flash-experimental'

        const endpoint = baseUrl.endsWith('/v1')
            ? `${baseUrl}/chat/completions`
            : `${baseUrl}/v1/chat/completions`

        // Take first N chunks and cap total input size
        const sampled = chunks.slice(0, OUTLINE_MAX_CHUNKS).join('\n\n')
        const textContext = sampled.slice(0, OUTLINE_MAX_INPUT_CHARS)
        const prompt = OUTLINE_PROMPT.replace('{TEXT}', textContext)

        try {
            logger.info(`[BaseStrategy] Calling LiteLLM for document outline (model: ${model}, endpoint: ${endpoint}, chunks: ${chunks.length}, inputChars: ${textContext.length})`)
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    max_tokens: 4096,
                }),
                signal: AbortSignal.timeout(120000),
            })

            if (!response.ok) {
                const body = await response.text().catch(() => '')
                logger.warn(`[BaseStrategy] LiteLLM outline call failed: ${response.status} ${response.statusText} — ${body}`)
                return undefined
            }

            const data = await response.json() as any
            const msg = data?.choices?.[0]?.message
            // Thinking models (e.g. GLM-4.7-flash) put final answer in content; reasoning in reasoning_content.
            // If content is null (hit max_tokens during reasoning), fall back to reasoning_content.
            let text: string | undefined = (msg?.content ?? msg?.reasoning_content)?.trim()

            // Fallback for non-standard response schemas (e.g. Nemotron)
            if (!text && Array.isArray(data?.output)) {
                const msg = data.output.find((o: any) => o.type === 'message' || o.role === 'assistant')
                if (msg?.content && Array.isArray(msg.content)) {
                    const part = msg.content.find((c: any) => c.type === 'output_text' || c.text)
                    if (part) text = part.text?.trim()
                }
            }

            if (!text || text.includes('NO_OUTLINE') || text.length < 10) {
                logger.info(`[BaseStrategy] LiteLLM returned no outline`)
                return undefined
            }

            logger.info(`[BaseStrategy] Document outline generated (${text.length} chars): ${text.slice(0, 200)}`)
            return text
        } catch (err) {
            logger.warn('[BaseStrategy] LiteLLM outline generation failed:', err)
            return undefined
        }
    }
}
