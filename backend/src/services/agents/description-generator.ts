/**
 * Description Generator Agent using JAF (Juspay Agent Framework)
 *
 * Mirrors title-generator.ts. Produces a clean, structured ticket description
 * from raw context (email body, chat transcript, user note).
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
} from '@juspay-jaf/jaf';

// Import config for environment variables
// Import prompts
import {
  getDescriptionGeneratorSystemPrompt,
  buildDescriptionGeneratorUserPrompt,
} from './prompts.js';

// Import utilities
import { parseAgentOutput } from './utils.js';

// Import agents config
import { AgentsConfig } from '../../agents/config.js';
import { createAgentEventLogger, composeEventHandlers } from '../../agents/agentLogger.js';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';

// ============================================================================
// Types
// ============================================================================

export interface DescriptionGeneratorContext {
  readonly userId?: string;
  readonly channelId?: string;
}

export interface DescriptionGeneratorInput {
  readonly rawContext: string;
  readonly title?: string;
  readonly maxLength?: number; // Default: 1500 characters (information-rich single paragraph)
}

// ============================================================================
// Output Schema
// ============================================================================

/**
 * Zod schema for structured output validation.
 * Post-validation we trim and truncate to `maxLength`.
 */
const DescriptionGeneratorOutputSchema = z.object({
  description: z.string().min(1).describe('A clean, structured ticket description'),
});

export type AgentRawOutput = z.infer<typeof DescriptionGeneratorOutputSchema>;
export type DescriptionGeneratorOutput = AgentRawOutput;

// ============================================================================
// Agent Definition
// ============================================================================

export const descriptionGeneratorAgent: Agent<DescriptionGeneratorContext, AgentRawOutput> = {
  name: 'DescriptionGenerator',

  instructions: (_state: Readonly<RunState<DescriptionGeneratorContext>>) => {
    return getDescriptionGeneratorSystemPrompt();
  },

  modelConfig: {
    temperature: 0.3,
  },
};

/**
 * Parse and process description generator output.
 */
function parseDescriptionGeneratorOutput(
  content: string,
  maxLength: number,
): DescriptionGeneratorOutput {
  const parsed = parseAgentOutput(content, DescriptionGeneratorOutputSchema);

  let description = parsed.description.trim();
  if (description.length > maxLength) {
    description = description.substring(0, maxLength - 3) + '...';
  }
  return { description };
}

// ============================================================================
// Model Provider
// ============================================================================

export async function createModelProvider(context: DescriptionGeneratorContext) {
  const credential = await orgLLMCredentialService.getCredentialByUserId(
    context.userId,
    OrgLLMServiceAccountPurpose.DEFAULT,
  );
  if (!credential) {
    throw new Error('LiteLLM credentials are not configured for this organization');
  }
  return makeLiteLLMProvider(credential.baseUrl, credential.apiKey);
}

// ============================================================================
// Agent Registry
// ============================================================================

export const agentRegistry = new Map<string, Agent<DescriptionGeneratorContext, any>>([
  ['DescriptionGenerator', descriptionGeneratorAgent],
]);

// ============================================================================
// Execution Function
// ============================================================================

/**
 * Generate a description
 *
 * @param input - The raw context and options
 * @param context - The execution context
 * @param onEvent - Optional event handler for tracing
 * @param agentsConfig - Optional agents config with model name from CAC
 * @returns The generated description
 */
export async function generateDescription(
  input: DescriptionGeneratorInput,
  context: DescriptionGeneratorContext,
  onEvent?: (event: TraceEvent) => void,
  agentsConfig?: AgentsConfig,
): Promise<DescriptionGeneratorOutput> {
  const maxLength = input.maxLength ?? 1500;

  // No dedicated CAC entry yet — reuse the title generator's model since this
  // is a similarly lightweight text-generation agent. When a
  // `descriptionGeneratorModelName` is added to AgentsConfig, swap to it here.
  const cacConfig = agentsConfig ?? (await AgentsConfig.fetch());
  const modelName = cacConfig.titleGeneratorModelName;

  const modelProvider = await createModelProvider(context);

  const formattedPrompt = buildDescriptionGeneratorUserPrompt(
    input.rawContext,
    input.title,
    maxLength,
  );

  const agentLogger = createAgentEventLogger('DescriptionGenerator', 'ORG_LITELLM_SERVICE_ACCOUNT');
  const composedOnEvent = onEvent ? composeEventHandlers(agentLogger, onEvent) : agentLogger;

  const runConfig: RunConfig<DescriptionGeneratorContext> = {
    agentRegistry,
    modelProvider,
    maxTurns: 2,
    modelOverride: modelName,
    onEvent: composedOnEvent,
  };

  const initialState: RunState<DescriptionGeneratorContext> = {
    runId: generateRunId(),
    traceId: generateTraceId(),
    messages: [
      {
        role: 'user',
        content: formattedPrompt,
      },
    ],
    currentAgentName: 'DescriptionGenerator',
    context,
    turnCount: 0,
  };

  const result = await run(initialState, runConfig);

  if (result.outcome.status === 'completed') {
    const rawOutput = result.outcome.output;
    if (typeof rawOutput === 'string') {
      return parseDescriptionGeneratorOutput(rawOutput, maxLength);
    }
    // Trust the framework's typed output path, but still enforce length.
    const typed = rawOutput as DescriptionGeneratorOutput;
    if (typed.description.length > maxLength) {
      return { description: typed.description.substring(0, maxLength - 3) + '...' };
    }
    return typed;
  } else if (result.outcome.status === 'error') {
    throw new Error(`Description generation failed: ${result.outcome.error._tag}`);
  } else {
    throw new Error('Description generation was interrupted');
  }
}

// ============================================================================
// Exports
// ============================================================================

export { DescriptionGeneratorOutputSchema, type Message, type TraceEvent };
