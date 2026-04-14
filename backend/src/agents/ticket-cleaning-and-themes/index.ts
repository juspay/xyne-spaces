/**
 * Ticket Cleaning + Cluster Theme Agent using JAF (Juspay Agent Framework)
 *
 * - Cleans ticket descriptions for embeddings and clustering.
 * - Generates cluster themes for Product Insights.
 */

import { z } from 'zod';
import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  run,
  type Agent,
  type RunState,
  type RunConfig,
  type TraceEvent,
} from '@juspay-jaf/jaf';

import { config } from '../../config/env.js';
import { parseAgentOutput } from '../../services/agents/utils.js';
import { logger } from '../../utils/logger.js';
import { getPromptFromLangfuse, PROMPT_NAMES } from '../xyne-ai/langfuse/index.js';

export interface TicketDescriptionCleanerInput {
  title: string;
  description: string;
  description_images?: string[];
}

const TicketDescriptionCleanerOutputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
});

export type TicketDescriptionCleanerOutput = z.infer<typeof TicketDescriptionCleanerOutputSchema>;

export interface ClusterThemeTicketInput {
  docId: string;
  title: string;
  description?: string;
  clusterId?: string;
}

export type RawClusterInput = Record<string, ClusterThemeTicketInput[]>;

export interface ClusterTheme {
  theme_title: string;
  theme_description: string;
}

export interface MetaThemeGroupInput {
  impacted_clusters: string[];
}

export interface MetaTheme {
  meta_theme: string;
  description: string;
  impacted_clusters: string[];
}

export interface SingleClusterThemeAnalyzerInput {
  cluster_id: string;
  tickets: ClusterThemeTicketInput[];
}

export type SingleClusterThemeAnalyzerOutput = ClusterTheme;

export interface SingleMetaThemeClusterInput {
  cluster_id: string;
  theme_title: string;
  theme_description: string;
}

export interface SingleMetaThemeAnalyzerInput {
  impacted_clusters: string[];
  impacted_cluster_themes: SingleMetaThemeClusterInput[];
}

export interface SingleMetaThemeAnalyzerOutput {
  meta_theme: string;
  description: string;
}

const ClusterThemeSchema = z.object({
  theme_title: z.string(),
  theme_description: z.string(),
});

const MetaThemeSchema = z.object({
  meta_theme: z.string(),
  description: z.string(),
  impacted_clusters: z.array(z.string()),
});

const SingleMetaThemeOutputSchema = z.object({
  meta_theme: z.string(),
  description: z.string(),
});

const LITELLM_BASE_URL = config.litellm.baseUrl;
const LITELLM_API_KEY = config.litellm.apiKey;
const DEFAULT_MODEL = config.ticketDescriptionClean?.model || 'glm-latest';
const LANGFUSE_PROMPT_LABEL = 'production';

async function resolvePrompt(
  promptName: string,
  context:
    | 'TicketDescriptionCleaner'
    | 'ClusterThemeAnalyzer'
    | 'SingleClusterThemeAnalyzer'
    | 'SingleMetaThemeAnalyzer',
): Promise<string> {
  const prompt = (await getPromptFromLangfuse(promptName, {
    label: LANGFUSE_PROMPT_LABEL,
  }))?.trim() || null;

  if (prompt) {
    return prompt;
  }

  logger.error(`[${context}] Prompt unavailable from Langfuse and fallback registry`, {
    promptName,
    label: LANGFUSE_PROMPT_LABEL,
  });
  throw new Error(`[${context}] No prompt available for ${promptName}`);
}

async function getTicketDescriptionCleanerPrompt(): Promise<string> {
  return resolvePrompt(PROMPT_NAMES.TICKET_DESCRIPTION_CLEANER, 'TicketDescriptionCleaner');
}

async function getSingleClusterThemeAnalyzerPrompt(): Promise<string> {
  return resolvePrompt(PROMPT_NAMES.CLUSTER_THEME_SINGLE, 'SingleClusterThemeAnalyzer');
}

async function getSingleMetaThemeAnalyzerPrompt(): Promise<string> {
  return resolvePrompt(PROMPT_NAMES.META_THEME_SINGLE, 'SingleMetaThemeAnalyzer');
}

function createTicketDescriptionCleanerAgent<TOutput>(
  prompt: string,
): Agent<Record<string, never>, TOutput> {
  return {
    name: 'TicketDescriptionCleaner',
    instructions: () => prompt,
    modelConfig: {
      temperature: 0,
    },
  };
}

function parseTicketDescriptionCleanerOutput(content: string): TicketDescriptionCleanerOutput {
  const parsed = parseAgentOutput(content, TicketDescriptionCleanerOutputSchema);
  return {
    title: parsed.title.trim(),
    description: parsed.description.trim(),
  };
}

function parseSingleClusterThemeOutput(content: string): SingleClusterThemeAnalyzerOutput {
  const parsed = parseAgentOutput(content, ClusterThemeSchema);
  return {
    theme_title: parsed.theme_title.trim(),
    theme_description: parsed.theme_description.trim(),
  };
}

function parseSingleMetaThemeOutput(content: string): SingleMetaThemeAnalyzerOutput {
  const parsed = parseAgentOutput(content, SingleMetaThemeOutputSchema);
  return {
    meta_theme: parsed.meta_theme.trim(),
    description: parsed.description.trim(),
  };
}

export function createModelProvider() {
  return makeLiteLLMProvider(LITELLM_BASE_URL, LITELLM_API_KEY);
}

export async function cleanTicketDescriptionWithLlm(
  input: TicketDescriptionCleanerInput,
  onEvent?: (event: TraceEvent) => void,
): Promise<TicketDescriptionCleanerOutput> {
  const prompt = await getTicketDescriptionCleanerPrompt();
  const agent = createTicketDescriptionCleanerAgent<TicketDescriptionCleanerOutput>(prompt);
  const modelProvider = createModelProvider();
  const promptInput = {
    title: input.title || '',
    description: input.description || '',
    description_images: Array.isArray(input.description_images) ? input.description_images : [],
  };

  const runConfig: RunConfig<Record<string, never>> = {
    agentRegistry: new Map([['TicketDescriptionCleaner', agent]]),
    modelProvider,
    maxTurns: 2,
    modelOverride: DEFAULT_MODEL,
    onEvent,
  };

  const initialState: RunState<Record<string, never>> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [
      {
        role: 'user',
        content: JSON.stringify(promptInput),
      },
    ],
    currentAgentName: 'TicketDescriptionCleaner',
    context: {},
    turnCount: 0,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status === 'completed') {
    const output = result.outcome.output;
    if (typeof output === 'string') {
      logger.info('[TicketDescriptionCleaner] LLM output', {
        length: output.length,
        output,
      });
      return parseTicketDescriptionCleanerOutput(output);
    }
    logger.info('[TicketDescriptionCleaner] LLM output', {
      output,
    });
    return output as TicketDescriptionCleanerOutput;
  }

  if (result.outcome.status === 'error') {
    logger.error('[TicketDescriptionCleaner] LLM run failed', {
      error: result.outcome.error,
    });
    throw new Error(`Ticket description cleaning failed: ${result.outcome.error._tag}`);
  }

  throw new Error('Ticket description cleaning was interrupted');
}

export async function generateSingleClusterThemeWithLlm(
  input: SingleClusterThemeAnalyzerInput,
): Promise<SingleClusterThemeAnalyzerOutput> {
  if (!input?.cluster_id?.trim()) {
    throw new Error('Cluster theme generation failed: missing cluster_id');
  }

  if (!Array.isArray(input.tickets) || input.tickets.length === 0) {
    throw new Error(`Cluster theme generation failed: no tickets for cluster ${input.cluster_id}`);
  }

  const prompt = await getSingleClusterThemeAnalyzerPrompt();
  const agent = createTicketDescriptionCleanerAgent<SingleClusterThemeAnalyzerOutput>(prompt);
  const modelProvider = createModelProvider();

  const runConfig: RunConfig<Record<string, never>> = {
    agentRegistry: new Map([['TicketDescriptionCleaner', agent]]),
    modelProvider,
    maxTurns: 2,
    modelOverride: DEFAULT_MODEL,
  };

  const initialState: RunState<Record<string, never>> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [
      {
        role: 'user',
        content: JSON.stringify(input),
      },
    ],
    currentAgentName: 'TicketDescriptionCleaner',
    context: {},
    turnCount: 0,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status === 'completed') {
    const output = result.outcome.output;
    if (typeof output === 'string') {
      logger.info('[SingleClusterThemeAnalyzer] LLM output', {
        length: output.length,
        output,
      });
      return parseSingleClusterThemeOutput(output);
    }
    logger.info('[SingleClusterThemeAnalyzer] LLM output', {
      output,
    });
    return output as SingleClusterThemeAnalyzerOutput;
  }

  if (result.outcome.status === 'error') {
    logger.error('[SingleClusterThemeAnalyzer] LLM run failed', {
      error: result.outcome.error,
    });
    throw new Error(`Single cluster theme analysis failed: ${result.outcome.error._tag}`);
  }

  throw new Error('Single cluster theme analysis was interrupted');
}

export async function generateSingleMetaThemeWithLlm(
  input: SingleMetaThemeAnalyzerInput,
): Promise<SingleMetaThemeAnalyzerOutput> {
  if (!Array.isArray(input?.impacted_clusters) || input.impacted_clusters.length === 0) {
    throw new Error('Meta theme generation failed: impacted_clusters is empty');
  }

  if (!Array.isArray(input.impacted_cluster_themes) || input.impacted_cluster_themes.length === 0) {
    throw new Error('Meta theme generation failed: impacted_cluster_themes is empty');
  }

  const prompt = await getSingleMetaThemeAnalyzerPrompt();
  const agent = createTicketDescriptionCleanerAgent<SingleMetaThemeAnalyzerOutput>(prompt);
  const modelProvider = createModelProvider();

  const runConfig: RunConfig<Record<string, never>> = {
    agentRegistry: new Map([['TicketDescriptionCleaner', agent]]),
    modelProvider,
    maxTurns: 2,
    modelOverride: DEFAULT_MODEL,
  };

  const initialState: RunState<Record<string, never>> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [
      {
        role: 'user',
        content: JSON.stringify(input),
      },
    ],
    currentAgentName: 'TicketDescriptionCleaner',
    context: {},
    turnCount: 0,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status === 'completed') {
    const output = result.outcome.output;
    if (typeof output === 'string') {
      logger.info('[SingleMetaThemeAnalyzer] LLM output', {
        length: output.length,
        output,
      });
      return parseSingleMetaThemeOutput(output);
    }
    logger.info('[SingleMetaThemeAnalyzer] LLM output', {
      output,
    });
    return output as SingleMetaThemeAnalyzerOutput;
  }

  if (result.outcome.status === 'error') {
    logger.error('[SingleMetaThemeAnalyzer] LLM run failed', {
      error: result.outcome.error,
    });
    throw new Error(`Single meta theme analysis failed: ${result.outcome.error._tag}`);
  }

  throw new Error('Single meta theme analysis was interrupted');
}

export { MetaThemeSchema, TicketDescriptionCleanerOutputSchema, type TraceEvent };
