import { BaseStrategy } from "./BaseStrategy"
import type { ProcessingResult, StrategyConfig } from "../types"
import { config } from '../../../config/env.js'
import { logger } from '../../../utils/logger.js'

/**
 * Prompt used to turn an image into searchable text. The description is what
 * lands in Vespa `chunks`, so it should be dense and literal — describe what is
 * actually visible (objects, people, UI, diagrams) and transcribe any legible
 * text verbatim, since that text is often what users search for.
 */
const IMAGE_DESCRIPTION_PROMPT = `You are an image-understanding assistant indexing images for search.
Describe this image in detail so it can be found later by a text search.

Include, when present:
- The main subjects/objects and what is happening.
- Any visible text, labels, numbers, or captions — transcribe them VERBATIM.
- If it is a screenshot/diagram/chart, describe the UI/structure and the data it conveys.

Write a single dense paragraph of plain text. Do NOT add conversational filler,
headings, or markdown. If the image is blank or unreadable, output "NO_DESCRIPTION".`

// Vision calls are slower than text; give them a generous ceiling.
const IMAGE_DESCRIPTION_TIMEOUT_MS = 120_000
const IMAGE_DESCRIPTION_MAX_TOKENS = 2048

/**
 * Strategy that describes an image via a vision-capable LLM and returns the
 * description as a single text chunk, making standalone image attachments
 * searchable in Vespa.
 *
 * Mirrors the LiteLLM call pattern in BaseStrategy.buildDocumentOutline, but
 * sends the image as an OpenAI/LiteLLM `image_url` content block.
 */
export class ImageDescriptionStrategy extends BaseStrategy {
    private mimeType: string

    constructor(mimeType: string, _config?: StrategyConfig) {
        super()
        this.mimeType = mimeType
    }

    async parse(buffer: Buffer, vespaDocId: string): Promise<ProcessingResult> {
        const description = await this.describeImage(buffer, vespaDocId)

        const chunks = description ? [description] : []
        return {
            chunks,
            chunks_pos: chunks.map((_, i) => i),
            chunks_map: chunks.map((_, i) => ({
                chunk_index: i,
                page_numbers: [] as number[],
                block_labels: ['image-description'] as string[],
            })),
            processingMethod: this.getName(),
        }
    }

    /**
     * Call the vision LLM and return the description, or undefined when no LLM is
     * configured / the model returns nothing usable. Network and HTTP errors are
     * thrown so the caller (mapFile/mapCollection) can log them; the surrounding
     * mapper swallows the throw and still inserts the doc with empty chunks.
     */
    private async describeImage(buffer: Buffer, vespaDocId: string): Promise<string | undefined> {
        // Resolve base URL and API key — config takes priority, then env aliases.
        const baseUrl =
            config.litellm.baseUrl ||
            process.env.LITELLM_BASE_URL ||
            process.env.OPENAI_API_BASE

        const apiKey =
            config.litellm.apiKey ||
            process.env.LITELLM_API_KEY ||
            process.env.OPENAI_API_KEY

        if (!baseUrl || !apiKey) {
            logger.warn(`[ImageStrategy] No LLM configured, skipping image description for ${vespaDocId}`)
            return undefined
        }

        // Dedicated vision override wins; otherwise reuse the best/fast models.
        // NOTE: the chosen model MUST be multimodal — text-only models (e.g. the
        // GLM family here) return HTTP 400 "is not a multimodal model".
        const model =
            process.env.IMAGE_DESCRIPTION_MODEL ||
            process.env.LITELLM_BEST_MODEL ||
            process.env.LITELLM_FAST_MODEL ||
            'glm-latest'

        const endpoint = baseUrl.endsWith('/v1')
            ? `${baseUrl}/chat/completions`
            : `${baseUrl}/v1/chat/completions`

        const dataUrl = `data:${this.mimeType};base64,${buffer.toString('base64')}`

        try {
            logger.info(`[ImageStrategy] Calling LiteLLM for image description (model: ${model}, endpoint: ${endpoint}, docId: ${vespaDocId}, bytes: ${buffer.length})`)
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: IMAGE_DESCRIPTION_PROMPT },
                                { type: 'image_url', image_url: { url: dataUrl } },
                            ],
                        },
                    ],
                    temperature: 0.2,
                    max_tokens: IMAGE_DESCRIPTION_MAX_TOKENS,
                }),
                signal: AbortSignal.timeout(IMAGE_DESCRIPTION_TIMEOUT_MS),
            })

            if (!response.ok) {
                const body = await response.text().catch(() => '')
                // Graceful degradation: log and return no description so the image
                // is still indexed by filename/metadata. A common cause is a
                // non-multimodal model — check IMAGE_DESCRIPTION_MODEL / LITELLM_BEST_MODEL.
                logger.error(`[ImageStrategy] LiteLLM image description call failed for ${vespaDocId}: ${response.status} ${response.statusText} — ${body}`)
                return undefined
            }

            const data = await response.json() as any
            const msg = data?.choices?.[0]?.message
            // Thinking models put the final answer in content and reasoning in
            // reasoning_content; fall back to the latter if content is null.
            const text: string | undefined = (msg?.content ?? msg?.reasoning_content)?.trim()

            if (!text || text.includes('NO_DESCRIPTION') || text.length < 3) {
                logger.info(`[ImageStrategy] LiteLLM returned no usable description for ${vespaDocId}`)
                return undefined
            }

            // Do NOT log the description text — it is the image content transcribed
            // verbatim and can contain secrets/PII (API keys, tokens, emails, etc.).
            logger.info(`[ImageStrategy] Image description generated (${text.length} chars) for ${vespaDocId}`)
            return text
        } catch (err) {
            // Network error / timeout / abort — degrade gracefully (no throw) so the
            // doc is still indexed and we don't burn Bull retries on a bad model.
            const message = err instanceof Error ? err.message : String(err)
            logger.error(`[ImageStrategy] Image description failed for ${vespaDocId}: ${message}`)
            return undefined
        }
    }

    getName(): string {
        return "image-description"
    }
}
