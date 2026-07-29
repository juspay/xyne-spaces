/**
 * Email Quick Rewrite Agent — Framework LLM Client
 *
 * This agent takes a pre-built query/prompt from the frontend and sends it to the LLM.
 * The prompt building logic remains on the frontend.
 */

import { LLMClient, createUserMessage } from '@framework';
import { AgentsConfig } from '../config.js';
import { logLLMCallStart, logLLMSuccess, logLLMError } from '../agentLogger.js';
import { orgLLMCredentialService } from '@/services/orgLLMCredentialService';
import { OrgLLMServiceAccountPurpose } from '@xyne/shared';

// ============================================================================
// Configuration
// ============================================================================

const AGENT_NAME = 'EmailQuickRewrite';

// ============================================================================
// Types
// ============================================================================

export interface EmailQuickRewriteContext {
  readonly userId?: string;
}

export interface EmailQuickRewriteInput {
  readonly query: string;
}

export interface EmailQuickRewriteOutput {
  readonly rewrittenText: string;
}

// ============================================================================
// Execution Function
// ============================================================================

/**
 * Rewrite email text based on the provided query/prompt
 *
 * @param input - The full query/prompt to send to the LLM
 * @param _context - The execution context (for API compatibility)
 * @param _onEvent - Kept for API compatibility, not used with direct calls
 * @param agentsConfig - Optional pre-fetched agents config
 * @returns The rewritten text
 */
export async function rewriteEmailText(
  input: EmailQuickRewriteInput,
  context: EmailQuickRewriteContext,
  _onEvent?: unknown,
  agentsConfig?: AgentsConfig,
): Promise<EmailQuickRewriteOutput> {
  const query = input.query.trim();
  if (!query) {
    return { rewrittenText: '' };
  }

  // Use model name from CAC config if provided, otherwise fetch or use default
  const cacConfig = agentsConfig ?? await AgentsConfig.fetch();
  const modelName = cacConfig.emailQuickRewriteModelName;
  const credential = await orgLLMCredentialService.getCredentialByUserId(
    context.userId,
    OrgLLMServiceAccountPurpose.DEFAULT,
  );
  if (!credential) {
    throw new Error('LiteLLM credentials are not configured for this organization');
  }

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
    // The query already contains all the instructions and formatting rules from the frontend
    const response = await llmClient.generate({
      messages: [createUserMessage(query)],
      parameters: {
        temperature: 0.3,
      },
      extraBody: {
        chat_template_kwargs: {
          enable_thinking: false,
        },
      },
    });

    // Log success
    logLLMSuccess(AGENT_NAME, response.content);

    // Return the raw content - no JSON parsing needed since frontend expects plain text
    return { rewrittenText: response.content };
  } catch (error) {
    // Log error
    logLLMError(AGENT_NAME, error);
    throw error;
  }
}
