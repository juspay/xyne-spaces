/**
 * Logging utility for agents (JAF-based and direct LLM calls).
 *
 * Usage:
 *   // For JAF agents:
 *   const agentLogger = createAgentEventLogger('TicketDuplicate', 'ORG_LITELLM_SERVICE_ACCOUNT');
 *   // Pass as onEvent to run() / runStream(), or compose with an existing handler:
 *   const composed = composeEventHandlers(agentLogger, existingOnEvent);
 *
 *   // For direct LLM calls (framework):
 *   logLLMCallStart('TitleGenerator', modelName, 'ORG_LITELLM_SERVICE_ACCOUNT');
 *   logLLMSuccess('TitleGenerator', responseContent);
 *   logLLMError('TitleGenerator', error);
 */

import type { TraceEvent } from '@juspay-jaf/jaf';
import { logger } from '../utils/logger.js';

const MAX_OUTPUT_LOG_LENGTH = 1000;

/**
 * Creates an onEvent handler that logs LLM call activity for a JAF agent.
 *
 * Emits:
 *   [AgentName] Calling "<model>" with "<keyName>"    — on llm_call_start
 *   [AgentName] Success: <raw LLM output, truncated>  — on llm_call_end (success)
 *   [AgentName] Error: <code>: <tag>: <detail>        — on run_end (error)
 *
 * @param agentName - Short label shown in brackets, e.g. 'AskAI', 'TicketDuplicate'
 * @param keyName   - Env-var name of the API key in use, e.g. 'ORG_LITELLM_SERVICE_ACCOUNT'
 */
export function createAgentEventLogger(
  agentName: string,
  keyName: string,
): (event: TraceEvent) => void {
  const prefix = `[${agentName}]`;

  return (event: TraceEvent): void => {
    switch (event.type) {
      case 'llm_call_start': {
        const model = event.data.model ?? 'unknown';
        logger.info(`${prefix} Calling "${model}" with "${keyName}"`);
        break;
      }

      case 'llm_call_end': {
        const content = event.data.choice?.message?.content;
        if (typeof content === 'string') {
          logLLMSuccess(agentName, content);
        }
        break;
      }

      case 'run_end': {
        const outcome = event.data.outcome;
        if (outcome.status === 'error') {
          const err = outcome.error as Record<string, unknown>;
          logStructuredError(agentName, err);
        }
        break;
      }

      default:
        break;
    }
  };
}

/**
 * Log the start of an LLM call for direct framework calls.
 *
 * @param agentName - Short label shown in brackets, e.g. 'TitleGenerator'
 * @param model - Model name being called
 * @param keyName - Env-var name of the API key in use
 */
export function logLLMCallStart(
  agentName: string,
  model: string,
  keyName: string,
): void {
  const prefix = `[${agentName}]`;
  logger.info(`${prefix} Calling "${model}" with "${keyName}"`);
}

/**
 * Log successful LLM response for direct framework calls.
 *
 * @param agentName - Short label shown in brackets
 * @param content - Raw LLM output content
 */
export function logLLMSuccess(
  agentName: string,
  content: string,
): void {
  const prefix = `[${agentName}]`;
  const truncated =
    content.length > MAX_OUTPUT_LOG_LENGTH
      ? `${content.slice(0, MAX_OUTPUT_LOG_LENGTH)}… [truncated]`
      : content;
  logger.info(`${prefix} Success: ${truncated}`);
}

/**
 * Log LLM error for direct framework calls.
 *
 * @param agentName - Short label shown in brackets
 * @param error - Error object or message
 */
export function logLLMError(
  agentName: string,
  error: Error | Record<string, unknown> | unknown,
): void {
  const prefix = `[${agentName}]`;
  
  if (error instanceof Error) {
    logger.error(`${prefix} Error: ${error.message}`);
  } else if (typeof error === 'object' && error !== null) {
    logStructuredError(agentName, error as Record<string, unknown>);
  } else {
    logger.error(`${prefix} Error: ${String(error)}`);
  }
}

/**
 * Internal helper to log structured error details.
 */
function logStructuredError(
  agentName: string,
  err: Record<string, unknown>,
): void {
  const prefix = `[${agentName}]`;
  const tag = String(err._tag ?? err.name ?? 'UnknownError');
  const code = err.statusCode ?? err.status ?? err.code ?? '';
  const detail = err.message ?? err.detail ?? String(err);
  const parts = [code ? String(code) : null, tag, detail ? String(detail) : null]
    .filter(Boolean)
    .join(': ');
  logger.error(`${prefix} Error: ${parts}`);
}

/**
 * Merges multiple void onEvent handlers into one.
 * All handlers receive every event; order is preserved.
 */
export function composeEventHandlers(
  ...handlers: Array<(event: TraceEvent) => void>
): (event: TraceEvent) => void {
  return (event: TraceEvent): void => {
    for (const handler of handlers) {
      handler(event);
    }
  };
}
