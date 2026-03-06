/**
 * Title Generator Agent using JAF (Juspay Agent Framework)
 *
 * This agent generates concise, descriptive titles from ticket descriptions.
 */

import { z } from 'zod';

// Import JAF modules
import {
  makeLiteLLMProvider,
  generateRunId,
  generateTraceId,
  run,
  type Agent,
  type RunState,
  type RunConfig,
  type Message,
  type TraceEvent,
} from '@xynehq/jaf';

// Import config for environment variables
import { config } from '../../config/env.js';

// Import prompts
import { getTitleGeneratorSystemPrompt, buildTitleGeneratorUserPrompt } from './prompts.js';

// Import utilities
import { parseAgentOutput } from './utils.js';

// Import shared types
import { BaseTicketType, type ClassifiableTicketType } from '@xyne/shared';

// Import agents config
import { AgentsConfig } from '../../agents/config.js';

// ============================================================================
// Configuration - Loaded from environment variables
// ============================================================================

// LiteLLM proxy URL from environment
const LITELLM_BASE_URL = config.litellm.baseUrl;

// LiteLLM API key from environment
const LITELLM_API_KEY = config.litellm.apiKey;

// ============================================================================
// Types
// ============================================================================

/**
 * Context for the title generator agent
 */
export interface TitleGeneratorContext {
  readonly userId?: string;
  readonly channelId?: string;
}

/**
 * Input for generating a title
 */
export interface TitleGeneratorInput {
  readonly description: string;
  readonly maxLength?: number; // Default: 100 characters
}

// ============================================================================
// Output Schema
// ============================================================================

/**
 * Zod schema for structured output validation
 * Note: Max length is enforced post-validation to allow truncation
 */
const TitleGeneratorOutputSchema = z.object({
  title: z.string().min(1).describe('A concise, descriptive title for the ticket'),
  ticketType: z.nativeEnum(BaseTicketType).refine(
    (val): val is ClassifiableTicketType => val !== BaseTicketType.Release,
    { message: 'Release is not a classifiable ticket type' }
  ).describe('The classified ticket type'),
});

/**
 * Agent raw output (inferred from schema)
 */
export type AgentRawOutput = z.infer<typeof TitleGeneratorOutputSchema>;

/**
 * Structured output for the title (same as raw output for this agent)
 */
export type TitleGeneratorOutput = AgentRawOutput;

// ============================================================================
// Agent Definition
// ============================================================================

/**
 * Title Generator Agent
 *
 * This agent takes a ticket description and produces a concise, descriptive title.
 */
export const titleGeneratorAgent: Agent<TitleGeneratorContext, AgentRawOutput> = {
  name: 'TitleGenerator',

  instructions: (_state: Readonly<RunState<TitleGeneratorContext>>) => {
    return getTitleGeneratorSystemPrompt();
  },

  modelConfig: {
    temperature: 0.3,
  },
};

/**
 * Parse and process title generator output
 * Uses generic parser with Zod validation and applies post-processing
 */
function parseTitleGeneratorOutput(content: string): TitleGeneratorOutput {
  // Parse and validate using generic parser
  const parsed = parseAgentOutput(content, TitleGeneratorOutputSchema);

  // Post-processing: truncate title if needed
  let title = parsed.title.trim();
  if (title.length > 100) {
    title = title.substring(0, 97) + '...';
  }
  return {
    title,
    ticketType: parsed.ticketType as ClassifiableTicketType,
  };
}

// ============================================================================
// Model Provider
// ============================================================================

/**
 * Create the model provider instance
 * Uses LiteLLM for model access
 */
export function createModelProvider() {
  return makeLiteLLMProvider(LITELLM_BASE_URL, LITELLM_API_KEY);
}

// ============================================================================
// Agent Registry
// ============================================================================

/**
 * Agent registry containing all available agents
 */
export const agentRegistry = new Map<string, Agent<TitleGeneratorContext, any>>([
  ['TitleGenerator', titleGeneratorAgent],
]);

// ============================================================================
// Execution Function
// ============================================================================

/**
 * Generate a title
 *
 * @param input - The description and options
 * @param context - The execution context
 * @param onEvent - Optional event handler for tracing
 * @param agentsConfig - Optional agents config with model name from CAC
 * @returns The generated title
 */
export async function generateTitle(
  input: TitleGeneratorInput,
  context: TitleGeneratorContext,
  onEvent?: (event: TraceEvent) => void,
  agentsConfig?: AgentsConfig
): Promise<TitleGeneratorOutput> {
  // Use model name from CAC config if provided, otherwise fetch or use default
  const cacConfig = agentsConfig ?? await AgentsConfig.fetch();
  const modelName = cacConfig.titleGeneratorModelName;

  const modelProvider = createModelProvider();

  // Format description for the agent using prompt template
  const formattedPrompt = buildTitleGeneratorUserPrompt(input.description, input.maxLength);

  // Create the run configuration
  const runConfig: RunConfig<TitleGeneratorContext> = {
    agentRegistry,
    modelProvider,
    maxTurns: 2,
    modelOverride: modelName,
    onEvent,
  };

  // Create initial state
  const initialState: RunState<TitleGeneratorContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [
      {
        role: 'user',
        content: formattedPrompt,
      },
    ],
    currentAgentName: 'TitleGenerator',
    context,
    turnCount: 0,
  };

  // Execute the agent
  const result = await run(initialState, runConfig);

  // Handle the result
  if (result.outcome.status === 'completed') {
    const rawOutput = result.outcome.output;
    if (typeof rawOutput === 'string') {
      return parseTitleGeneratorOutput(rawOutput);
    }
    return rawOutput as TitleGeneratorOutput;
  } else if (result.outcome.status === 'error') {
    throw new Error(`Title generation failed: ${result.outcome.error._tag}`);
  } else {
    throw new Error('Title generation was interrupted');
  }
}

// ============================================================================
// Exports
// ============================================================================

export { TitleGeneratorOutputSchema, type Message, type TraceEvent };
