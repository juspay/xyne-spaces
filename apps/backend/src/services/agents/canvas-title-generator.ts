import { z } from 'zod';
import { LLMClient, createUserMessage } from '@framework';

import { AgentsConfig } from '../../agents/config.js';
import { logLLMCallStart, logLLMSuccess, logLLMError } from '../../agents/agentLogger.js';
import { config } from '../../config/env.js';
import {
  buildCanvasTitleGeneratorUserPrompt,
  getCanvasTitleGeneratorSystemPrompt,
} from './prompts.js';
import { parseAgentOutput } from './utils.js';

const AGENT_NAME = 'CanvasTitleGenerator';
const MAX_CANVAS_TITLE_LENGTH = 100;
const CANVAS_TITLE_LLM_TIMEOUT_MS = 30_000;

function normalizeCanvasTitleLiteLLMBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
}

let cachedClient: LLMClient | null = null;

function getCanvasTitleLLMClient(defaultModel: string): LLMClient {
  if (!cachedClient) {
    cachedClient = new LLMClient({
      provider: {
        type: 'litellm',
        config: {
          apiKey: config.litellm.apiKey,
          baseUrl: normalizeCanvasTitleLiteLLMBaseUrl(config.litellm.baseUrl),
          timeout: CANVAS_TITLE_LLM_TIMEOUT_MS,
        },
      },
      defaultModel,
      retry: { maxAttempts: 1 },
    });
  }
  return cachedClient;
}

const CanvasTitleGeneratorOutputSchema = z.object({
  title: z.string().trim().min(1),
});

function extractCanvasTitle(content: string): string {
  try {
    return parseAgentOutput(content, CanvasTitleGeneratorOutputSchema).title;
  } catch {
    const withoutThinking = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const candidate = withoutThinking
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
      ?.replace(/^title\s*:\s*/i, '')
      .replace(/^['"]|['"]$/g, '')
      .trim();

    if (!candidate) throw new Error('Canvas title generator returned empty output');
    return candidate;
  }
}

export interface CanvasTitleGeneratorInput {
  readonly content: string;
  readonly maxLength?: number;
}

export interface CanvasTitleGeneratorContext {
  readonly userId?: string;
}

export interface CanvasTitleGeneratorOutput {
  readonly title: string;
}

export async function generateCanvasTitle(
  input: CanvasTitleGeneratorInput,
  _context: CanvasTitleGeneratorContext,
  agentsConfig?: AgentsConfig
): Promise<CanvasTitleGeneratorOutput> {
  const cacConfig = agentsConfig ?? (await AgentsConfig.fetch());
  const modelName = cacConfig.titleGeneratorModelName;
  const maxLength = Math.min(
    Math.max(Math.floor(input.maxLength ?? MAX_CANVAS_TITLE_LENGTH), 10),
    MAX_CANVAS_TITLE_LENGTH
  );

  const client = getCanvasTitleLLMClient(modelName);

  logLLMCallStart(AGENT_NAME, modelName, 'LITELLM_API_KEY');

  try {
    const response = await client.generate({
      model: modelName,
      messages: [createUserMessage(buildCanvasTitleGeneratorUserPrompt(input.content, maxLength))],
      systemPrompt: getCanvasTitleGeneratorSystemPrompt(),
      parameters: { temperature: 0.3 },
      extraBody: {
        chat_template_kwargs: { enable_thinking: false },
      },
    });

    logLLMSuccess(AGENT_NAME, response.content);
    const title = extractCanvasTitle(response.content).trim();

    return {
      title:
        title.length > maxLength
          ? `${title.substring(0, Math.max(0, maxLength - 3)).trimEnd()}...`
          : title,
    };
  } catch (error) {
    logLLMError(AGENT_NAME, error);
    throw error;
  }
}

export { CanvasTitleGeneratorOutputSchema };
