import { LangfuseClient } from '@langfuse/client';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export type ActivityClassificationPromptRequest = {
  name: string;
  label?: string;
  templateVariables?: Record<string, string>;
  cacheTtlSeconds?: number;
};

export type ActivityClassificationPromptResult = {
  prompt: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LangfusePrompt = any;

const DEFAULT_CACHE_TTL_SECONDS = 300;
const DEFAULT_PROMPT_CACHE_TTL_MS = DEFAULT_CACHE_TTL_SECONDS * 1000;

const promptCache = new Map<
  string,
  {
    prompt: LangfusePrompt;
    cachedAt: number;
    ttlMs: number;
  }
>();

let langfuseClient: LangfuseClient | null = null;

const getLangfuseClient = (): LangfuseClient | null => {
  const { baseUrl, publicKey, secretKey } = config.langfuse;
  if (!publicKey || !secretKey) {
    return null;
  }

  if (!langfuseClient) {
    langfuseClient = new LangfuseClient({
      publicKey,
      secretKey,
      ...(baseUrl ? { baseUrl } : {}),
    });
  }

  return langfuseClient;
};

const getCacheKey = (name: string, label?: string): string => `${name}:${label ?? 'production'}`;

const getCachedPrompt = (cacheKey: string): LangfusePrompt | null => {
  const cached = promptCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > cached.ttlMs) {
    promptCache.delete(cacheKey);
    return null;
  }
  return cached.prompt;
};

const setCachedPrompt = (cacheKey: string, prompt: LangfusePrompt, ttlMs: number): void => {
  if (ttlMs <= 0) return;
  promptCache.set(cacheKey, {
    prompt,
    cachedAt: Date.now(),
    ttlMs,
  });
};

const compilePrompt = (
  prompt: LangfusePrompt,
  templateVariables?: Record<string, string>
): string => {
  let promptContent = prompt?.prompt;

  if (templateVariables) {
    try {
      promptContent = prompt.compile(templateVariables);
    } catch (error) {
      logger.error('[ActivityClassification][Langfuse] Failed to compile prompt', {
        errorMessage: error instanceof Error ? error.message : String(error ?? 'unknown error'),
      });
    }
  }

  if (typeof promptContent !== 'string') {
    throw new Error('[ActivityClassification][Langfuse] Prompt did not compile to text output.');
  }

  return promptContent;
};

const fetchPrompt = async (
  name: string,
  label: string,
  cacheTtlSeconds?: number
): Promise<LangfusePrompt | null> => {
  const cacheKey = getCacheKey(name, label);
  const cached = getCachedPrompt(cacheKey);
  if (cached) {
    logger.debug('[ActivityClassification][Langfuse] Using cached prompt', {
      promptName: name,
      promptLabel: label,
    });
    return cached;
  }

  const client = getLangfuseClient();
  if (!client) {
    return null;
  }

  const ttlMs =
    cacheTtlSeconds !== undefined ? cacheTtlSeconds * 1000 : DEFAULT_PROMPT_CACHE_TTL_MS;

  try {
    const prompt = await client.prompt.get(name, {
      label,
      cacheTtlSeconds,
    });
    setCachedPrompt(cacheKey, prompt, ttlMs);
    logger.debug('[ActivityClassification][Langfuse] Prompt fetched', {
      promptName: name,
      promptLabel: label,
    });
    return prompt;
  } catch (error) {
    logger.error('[ActivityClassification][Langfuse] Failed to fetch prompt', {
      promptName: name,
      promptLabel: label,
      errorMessage: error instanceof Error ? error.message : String(error ?? 'unknown error'),
    });
    return null;
  }
};

export const getActivityClassificationPrompt = async (
  options: ActivityClassificationPromptRequest
): Promise<ActivityClassificationPromptResult> => {
  const { name, label, templateVariables, cacheTtlSeconds } = options;
  const resolvedLabel = label ?? 'production';

  const client = getLangfuseClient();
  if (!client) {
    throw new Error(
      `[ActivityClassification][Langfuse] Missing configuration for prompt '${name}' (label: ${resolvedLabel}).`
    );
  }

  const prompt = await fetchPrompt(name, resolvedLabel, cacheTtlSeconds);
  if (!prompt) {
    throw new Error(
      `[ActivityClassification][Langfuse] Prompt '${name}' (label: ${resolvedLabel}) not found in Langfuse.`
    );
  }

  return {
    prompt: compilePrompt(prompt, templateVariables),
  };
};
