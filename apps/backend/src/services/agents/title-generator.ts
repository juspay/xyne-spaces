/**
 * Title Generator Agent — Framework LLM Client
 *
 * This agent generates concise, descriptive titles from ticket descriptions.
 */

import { z } from 'zod';
import { LLMClient, createUserMessage } from '@framework';

// Import prompts
import { getTitleGeneratorSystemPrompt, buildTitleGeneratorUserPrompt } from './prompts.js';

// Import utilities
import { parseAgentOutput } from './utils.js';

// Import shared types
import { BaseTicketType, type ClassifiableTicketType } from '@xyne/shared';

// Import agents config
import { AgentsConfig } from '../../agents/config.js';

// Import logger
import { logLLMCallStart, logLLMSuccess, logLLMError } from '../../agents/agentLogger.js';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';

const AGENT_NAME = 'TitleGenerator';

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
// Parse and process title generator output
// ============================================================================

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
// Execution Function
// ============================================================================

/**
 * Generate a title
 *
 * @param input - The description and options
 * @param _context - The execution context (for API compatibility)
 * @returns The generated title
 */
export async function generateTitle(
  input: TitleGeneratorInput,
  context: TitleGeneratorContext,
  _onEvent?: unknown, // Kept for API compatibility, not used with direct calls
  agentsConfig?: AgentsConfig
): Promise<TitleGeneratorOutput> {
  // Use model name from CAC config if provided, otherwise fetch or use default
  const cacConfig = agentsConfig ?? await AgentsConfig.fetch();
  const modelName = cacConfig.titleGeneratorModelName;
  const credential = await orgLLMCredentialService.getCredentialByUserId(
    context.userId,
    OrgLLMServiceAccountPurpose.DEFAULT,
  );
  if (!credential) {
    throw new Error('LiteLLM credentials are not configured for this organization');
  }

  // Format description for the agent using prompt template
  const formattedPrompt = buildTitleGeneratorUserPrompt(input.description, input.maxLength);

  // Initialize LLM client
  const llmClient = new LLMClient({
    provider: {
      type: 'litellm',
      config: {
        apiKey: credential.apiKey,
        baseUrl: credential.baseUrl,
      },
    },
    defaultModel: modelName,
  });

  // Log LLM call start
  logLLMCallStart(AGENT_NAME, modelName, 'ORG_LITELLM_SERVICE_ACCOUNT');

  try {
    // Generate response using framework LLM client
    const response = await llmClient.generate({
      messages: [
        createUserMessage(formattedPrompt)
      ],
      systemPrompt: getTitleGeneratorSystemPrompt(),
      parameters: {
        temperature: 0.3
      },
      extraBody: {
        chat_template_kwargs: {
          enable_thinking: false
        }
      }
    });

    // Log success
    logLLMSuccess(AGENT_NAME, response.content);

    // Parse and return the result
    const result = parseTitleGeneratorOutput(response.content);
    return result;
  } catch (error) {
    // Log error
    logLLMError(AGENT_NAME, error);
    throw error;
  }
}

// ============================================================================
// Exports
// ============================================================================

export { TitleGeneratorOutputSchema };
