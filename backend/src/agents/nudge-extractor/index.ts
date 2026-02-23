import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  run,
  type Agent,
  type RunConfig,
  type RunState,
} from '@xynehq/jaf';
import { config } from '../../config/env.js';
import {
  NudgeOutputSchemaLenient,
  type ProactiveNudgeOutputLenient,
} from '@/services/nudges/proactiveNudgeSchemas';
import { getPromptFromLangfuse, PROMPT_NAMES } from '../xyne-ai/langfuse/index.js';
import { logger } from '../../utils/logger.js';

export type ProactiveNudgeContext = {
  messageId: string;
  channelId: string;
  projectId: string;
};

export type ProactiveNudgeInput = {
  current_message: {
    id: string;
    text: string;
    author_user_id: string;
    author_display_name: string;
    timestamp_iso: string;
    channel_id: string;
    channel_name: string;
    thread_id: string;
  };
  current_thread_messages: Array<{
    id: string;
    text: string;
    author_user_id: string;
    author_display_name: string;
    timestamp_iso: string;
  }>;
  existing_project_tags: string[];
};

const LANGFUSE_PROMPT_LABEL = 'production';

async function resolveNudgePrompt(): Promise<string> {
  const prompt = (await getPromptFromLangfuse(PROMPT_NAMES.NUDGE_EXTRACTOR, {
    label: LANGFUSE_PROMPT_LABEL,
  }))?.trim() || null;

  if (prompt) {
    return prompt;
  }

  logger.error('[ProactiveNudgeExtractor] Prompt unavailable from Langfuse and fallback registry', {
    promptName: PROMPT_NAMES.NUDGE_EXTRACTOR,
    label: LANGFUSE_PROMPT_LABEL,
  });
  throw new Error(`[ProactiveNudgeExtractor] No prompt available for ${PROMPT_NAMES.NUDGE_EXTRACTOR}`);
}

const CODE_FENCE_REGEX = /```(?:json)?\s*([\s\S]*?)\s*```/i;
const DEFAULT_NUDGE_MODEL = "glm-flash-experimental"

export function parseLLMJson(content: string): unknown {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(CODE_FENCE_REGEX);
  const jsonPayload = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return JSON.parse(jsonPayload);
}

function buildPrompt(input: ProactiveNudgeInput): string {
  return JSON.stringify(input, null, 2);
}

export async function generateNudges(
  input: ProactiveNudgeInput,
  context: ProactiveNudgeContext
): Promise<ProactiveNudgeOutputLenient> {
  const systemPrompt = await resolveNudgePrompt();
  const agent: Agent<ProactiveNudgeContext, ProactiveNudgeOutputLenient> = {
    name: 'ProactiveNudgeExtractor',
    instructions: () => systemPrompt,
    modelConfig: { temperature: 0.1 },
  };

  const provider = makeLiteLLMProvider(config.litellm.baseUrl, config.litellm.apiKey);
  const prompt = buildPrompt(input);

  const initialState: RunState<ProactiveNudgeContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [{ role: 'user', content: prompt }],
    currentAgentName: 'ProactiveNudgeExtractor',
    context,
    turnCount: 0,
  };

  const runConfig: RunConfig<ProactiveNudgeContext> = {
    agentRegistry: new Map([['ProactiveNudgeExtractor', agent]]),
    modelProvider: provider as RunConfig<ProactiveNudgeContext>['modelProvider'],
    maxTurns: 2,
    modelOverride: DEFAULT_NUDGE_MODEL,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status === 'completed') {
    const output = result.outcome.output;
    const parsed = typeof output === 'string' ? parseLLMJson(output) : output;
    return NudgeOutputSchemaLenient.parse(parsed);
  }

  if (result.outcome.status === 'error') {
    throw new Error(`Proactive nudge extraction failed: ${result.outcome.error._tag}`);
  }

  throw new Error('Proactive nudge extraction interrupted.');
}
