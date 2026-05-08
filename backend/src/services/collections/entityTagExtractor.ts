import OpenAI from 'openai';
import pLimit from 'p-limit';
import { FileProcessor } from '@/utils/fileProcessor/FileProcessor';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import vespaClient from '@/vespa/client';
import { fileSchema, type VespaEntityTags } from '@/vespa/src/types';
import { config } from '@/config/env';

// Cap parallel LLM calls to stay within provider's max_parallel_requests limit
const llmLimit = pLimit(4);

export interface ExtractedEntityTags {
  people: string[];
  productSpecifications: string[];
  merchants: string[];
}

const ENTITY_EXTRACTION_MAX_CHARS = 8000;
const RENAME_MAX_CHARS = 3000;
const MIN_TEXT_LENGTH = 100;

const SYSTEM_PROMPT = `You are an entity extraction assistant. Given document text, extract:
1. people: Full names of people mentioned (authors, contributors, contacts, signatories)
2. productSpecifications: Product names, model numbers, specs, or features described
3. merchants: Business names, vendor names, retailers, or company names mentioned

Return ONLY a JSON object:
{
  "people": ["Name One", "Name Two"],
  "productSpecifications": ["Product A v2.0"],
  "merchants": ["Acme Corp"]
}
Rules: arrays may be empty, deduplicate, max 20 entries each, do not invent entities.`;

function parseEntityTagsResponse(content: string): ExtractedEntityTags | null {
  const tryParse = (jsonStr: string): ExtractedEntityTags | null => {
    try {
      const parsed = JSON.parse(jsonStr);
      return {
        people: Array.isArray(parsed.people) ? parsed.people.filter((x: unknown) => typeof x === 'string') : [],
        productSpecifications: Array.isArray(parsed.productSpecifications)
          ? parsed.productSpecifications.filter((x: unknown) => typeof x === 'string')
          : [],
        merchants: Array.isArray(parsed.merchants) ? parsed.merchants.filter((x: unknown) => typeof x === 'string') : [],
      };
    } catch {
      return null;
    }
  };

  // Layer 1: direct parse
  const direct = tryParse(content);
  if (direct) return direct;

  // Layer 2: extract JSON object via regex
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const fromObject = tryParse(objectMatch[0]);
    if (fromObject) return fromObject;
  }

  // Layer 3: extract from code block
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    const fromCodeBlock = tryParse(codeBlockMatch[1]);
    if (fromCodeBlock) return fromCodeBlock;
  }

  return null;
}

export async function extractEntityTags(text: string): Promise<ExtractedEntityTags | null> {
  if (!config.litellm.apiKey) {
    return null;
  }

  try {
    const client = new OpenAI({
      apiKey: config.litellm.apiKey,
      baseURL: config.litellm.baseUrl,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const response = await llmLimit(() =>
      client.chat.completions.create(
        {
          model: 'kimi-latest',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: text },
          ],
          response_format: { type: 'json_object' },
        },
        { signal: controller.signal },
      ).finally(() => clearTimeout(timeout))
    );

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    return parseEntityTagsResponse(content);
  } catch (err) {
    logger.warn('[ENTITY_TAGS] LLM call failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function triggerTagExtraction(
  itemId: string,
  storageKey: string,
  _mimeType: string,
): Promise<void> {
  try {
    logger.info(`[ENTITY_TAGS] Tag extraction started for item ${itemId}`);

    const result = await FileProcessor.fromGcs(storageKey).process(itemId);

    if (!result.chunks || result.chunks.length === 0) {
      logger.warn(`[ENTITY_TAGS] No chunks extracted for item ${itemId}`);
      return;
    }

    const text = result.chunks.join(' ').slice(0, ENTITY_EXTRACTION_MAX_CHARS);

    if (text.length < MIN_TEXT_LENGTH) {
      logger.warn(`[ENTITY_TAGS] Text too short for item ${itemId} (${text.length} chars)`);
      return;
    }

    const entityTags = await extractEntityTags(text);
    if (!entityTags) {
      logger.warn(`[ENTITY_TAGS] LLM returned no entity tags for item ${itemId}`);
      return;
    }

    const existing = await db.collectionItem.findUnique({
      where: { id: itemId },
      select: { metadata: true },
    });

    const existingMeta = (existing?.metadata as Record<string, unknown>) ?? {};

    await db.collectionItem.update({
      where: { id: itemId },
      data: {
        metadata: {
          ...existingMeta,
          entityTags: entityTags as unknown as Record<string, string[]>,
        },
      },
    });

    const structuredTags: VespaEntityTags = {
      people: entityTags.people ?? [],
      merchants: entityTags.merchants ?? [],
      productSpecs: entityTags.productSpecifications ?? [],
    };
    const hasAnyTags =
      structuredTags.people.length > 0 ||
      structuredTags.merchants.length > 0 ||
      structuredTags.productSpecs.length > 0;
    if (hasAnyTags) {
      await vespaClient.crudService.update([{ docId: itemId, fields: { tags: structuredTags } }], fileSchema);
    }

    logger.info(`[ENTITY_TAGS] Tag extraction completed for item ${itemId}`, {
      people: entityTags.people.length,
      productSpecifications: entityTags.productSpecifications.length,
      merchants: entityTags.merchants.length,
    });
  } catch (err) {
    logger.error(`[ENTITY_TAGS] Failed for item ${itemId}`, {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      storageKey,
    });
  }
}

// ── File rename based on content ──

const RENAME_SYSTEM_PROMPT = `You are a file naming assistant. Given a document's content, suggest a concise, descriptive filename (without extension).
Rules:
- 3 to 8 words
- Use title case (e.g. "Q3 Sales Report")
- No special characters except hyphens and spaces
- Be specific about the document's main topic
- Do NOT include the file extension
Return ONLY a JSON object: {"filename": "your suggested name"}`;

async function suggestDocumentName(
  text: string,
  originalName: string,
  itemId: string,
): Promise<string | null> {
  if (!config.litellm.apiKey) {
    logger.warn('[FILE_RENAME] Skipping LLM call — LITELLM_API_KEY not set');
    return null;
  }

  const model = 'kimi-latest';
  logger.info(`[FILE_RENAME] Calling LLM for name suggestion`, {
    itemId,
    originalName,
    model,
    textChars: text.length,
  });

  try {
    const client = new OpenAI({
      apiKey: config.litellm.apiKey,
      baseURL: config.litellm.baseUrl,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const response = await llmLimit(() =>
      client.chat.completions.create(
        {
          model,
          messages: [
            { role: 'system', content: RENAME_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Original filename: ${originalName}\n\nDocument content:\n${text}`,
            },
          ],
          response_format: { type: 'json_object' },
        },
        { signal: controller.signal },
      ).finally(() => clearTimeout(timeout))
    );

    const content = response.choices[0]?.message?.content;
    logger.info(`[FILE_RENAME] LLM raw response`, { itemId, content });

    if (!content) {
      logger.warn(`[FILE_RENAME] LLM returned empty content`, { itemId });
      return null;
    }

    const parsed = JSON.parse(content) as { filename?: unknown };
    const rawFilename = parsed.filename;

    logger.info(`[FILE_RENAME] Parsed LLM response`, {
      itemId,
      filenameType: typeof rawFilename,
      filenameValue: rawFilename,
    });

    if (typeof rawFilename !== 'string' || !rawFilename.trim()) {
      logger.warn(`[FILE_RENAME] LLM "filename" field is missing or not a string`, {
        itemId,
        filenameType: typeof rawFilename,
        filenameValue: rawFilename,
        rawContent: content,
      });
      return null;
    }

    const suggested = rawFilename.trim();

    // Strip characters that are invalid in filenames and cap length
    const sanitized = suggested.replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 80);

    logger.info(`[FILE_RENAME] Suggested name`, { itemId, suggested, sanitized });
    return sanitized || null;
  } catch (err) {
    logger.warn('[FILE_RENAME] LLM call failed', {
      itemId,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return null;
  }
}

export async function triggerFileRename(
  itemId: string,
  storageKey: string,
  originalName: string,
): Promise<void> {
  try {
    logger.info(`[FILE_RENAME] Starting for item ${itemId}`, { originalName, storageKey });

    const result = await FileProcessor.fromGcs(storageKey).process(itemId);

    const chunkCount = result.chunks?.length ?? 0;
    logger.info(`[FILE_RENAME] Content extracted`, { itemId, chunkCount });

    if (chunkCount === 0) {
      logger.warn(`[FILE_RENAME] No content extracted — skipping rename`, { itemId, storageKey });
      return;
    }

    const text = result.chunks.join(' ').slice(0, RENAME_MAX_CHARS);
    logger.info(`[FILE_RENAME] Text prepared for LLM`, { itemId, totalChars: text.length });

    if (text.length < MIN_TEXT_LENGTH) {
      logger.warn(`[FILE_RENAME] Content too short — skipping rename`, {
        itemId,
        textLength: text.length,
        minRequired: MIN_TEXT_LENGTH,
      });
      return;
    }

    const suggestedName = await suggestDocumentName(text, originalName, itemId);
    if (!suggestedName) {
      logger.warn(`[FILE_RENAME] No name suggested — keeping original`, { itemId, originalName });
      return;
    }

    // Preserve the original file extension
    const dotIndex = originalName.lastIndexOf('.');
    const ext = dotIndex !== -1 ? originalName.slice(dotIndex) : '';
    const newName = suggestedName + ext;

    logger.info(`[FILE_RENAME] Updating DB record`, { itemId, originalName, newName });

    await db.collectionItem.update({
      where: { id: itemId },
      data: { name: newName },
    });

    // Sync new name to Vespa
    vespaClient.crudService.update([{ docId: itemId, fields: { fileName: newName } }], fileSchema).catch(err => {
      logger.warn(`[FILE_RENAME] Failed to update Vespa fileName for ${itemId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    logger.info(`[FILE_RENAME] Completed`, { itemId, originalName, newName });
  } catch (err) {
    logger.error(`[FILE_RENAME] Unexpected failure for item ${itemId}`, {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      itemId,
      originalName,
      storageKey,
    });
  }
}
