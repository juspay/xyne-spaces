/**
 * Utility helpers for working with agent.execute() results.
 *
 * Background
 * ----------
 * agent.execute() returns an AgentExecutionResult whose `messages` array contains
 * ALL messages in the conversation: system prompts, the original user prompt,
 * any tool-call/tool-result pairs, and finally the assistant response(s).
 *
 * The two common bugs this utility prevents:
 *
 *  1. Using `result.messages.at(-1)` without a type check.
 *     If the LLM failed to produce output (e.g. rate-limit, timeout) the last
 *     element may be the original user prompt or a tool_result — not the
 *     assistant reply.  This causes the original prompt / transcript to be
 *     returned verbatim as if it were a generated summary, PRD, or title.
 *
 *  2. Checking only `result.status === 'error'` (missing 'interrupted').
 *     The framework can also produce status='interrupted' when an abort signal
 *     fires mid-execution.  Treating that as success and then reading the last
 *     message repeats bug #1.
 */

import type { Message } from '@framework';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Returned when extraction succeeded */
interface AgentContentOk {
  ok: true;
  content: string;
}

/** Returned when extraction failed, with a machine-readable reason */
interface AgentContentErr {
  ok: false;
  /** Why extraction failed */
  reason: 'bad_status' | 'no_assistant_message' | 'empty_content';
  /** The raw status string when reason is 'bad_status' */
  status?: string;
}

export type AgentContentResult = AgentContentOk | AgentContentErr;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Framework status values that indicate a usable LLM completion:
 *   - 'completed'  — normal successful finish
 *   - 'max_turns'  — hit the maxTurns limit but still produced output
 *
 * Everything else ('error', 'interrupted') means the LLM did not produce a
 * reliable final response and the result should be discarded.
 *
 * Note: the orchestrator internally uses 'max_iterations', but Agent.execute()
 * maps that to 'max_turns' before returning. The public status is 'max_turns'.
 */
const SUCCESSFUL_STATUSES = new Set(['completed', 'max_turns']);

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Extracts the assistant's text content from an `agent.execute()` result.
 *
 * Validates all three conditions required for a usable LLM response:
 *   1. `result.status` is 'completed' or 'max_turns'
 *   2. At least one message with `type === 'assistant'` exists
 *   3. The last such assistant message has non-empty `content`
 *
 * Usage:
 * ```ts
 * const result = await agent.execute({ messages: [...] });
 * const extracted = extractAgentContent(result);
 * if (!extracted.ok) {
 *   logger.error(`my_operation_failed | reason=${extracted.reason} | status=${extracted.status ?? ''}`);
 *   return null;
 * }
 * // extracted.content is guaranteed to be a non-empty string
 * ```
 */
export function extractAgentContent(result: {
  status: string;
  messages: readonly Message[];
}): AgentContentResult {
  // Step 1 — status check
  if (!SUCCESSFUL_STATUSES.has(result.status)) {
    return { ok: false, reason: 'bad_status', status: result.status };
  }

  // Step 2 — find the last assistant message.
  // Walk backwards so we skip any trailing tool_call/tool_result/user messages
  // that may follow the final LLM turn when tools are involved.
  let lastAssistant: Message | undefined;
  for (let i = result.messages.length - 1; i >= 0; i--) {
    if (result.messages[i].type === 'assistant') {
      lastAssistant = result.messages[i];
      break;
    }
  }

  if (!lastAssistant) {
    return { ok: false, reason: 'no_assistant_message' };
  }

  // Step 3 — verify the content is non-empty
  const content = lastAssistant.content?.trim();
  if (!content) {
    return { ok: false, reason: 'empty_content' };
  }

  return { ok: true, content };
}
