/**
 * Singleton logging utility for JAF-based agents.
 *
 * Usage:
 *   const agentLogger = createAgentEventLogger('TicketDuplicate', 'LITELLM_API_KEY');
 *   // Pass as onEvent to run() / runStream(), or compose with an existing handler:
 *   const composed = composeEventHandlers(agentLogger, existingOnEvent);
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
 * @param keyName   - Env-var name of the API key in use, e.g. 'LITELLM_API_KEY'
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
          const truncated =
            content.length > MAX_OUTPUT_LOG_LENGTH
              ? `${content.slice(0, MAX_OUTPUT_LOG_LENGTH)}… [truncated]`
              : content;
          logger.info(`${prefix} Success: ${truncated}`);
        }
        break;
      }

      case 'run_end': {
        const outcome = event.data.outcome;
        if (outcome.status === 'error') {
          const err = outcome.error as Record<string, unknown>;
          const tag = String(err._tag ?? 'UnknownError');
          const code = err.statusCode ?? err.status ?? err.code ?? '';
          const detail = err.message ?? err.detail ?? '';
          const parts = [code ? String(code) : null, tag, detail ? String(detail) : null]
            .filter(Boolean)
            .join(': ');
          logger.error(`${prefix} Error: ${parts}`);
        }
        break;
      }

      default:
        break;
    }
  };
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
