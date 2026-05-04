/**
 * In-process citation routing.
 *
 * Tools (via the MCP HTTP client in `mcp.ts`) call `recordCitations` keyed by
 * the pi-coding-agent toolCallId. The agent loop's `tool_execution_end`
 * handler calls `takeCitations` to attach them to the recorded ToolInvocation
 * before it's sent back to claw-auth in the webhook callback payload.
 *
 * Subagents call `takeCitations` for each child invocation, accumulate them,
 * and re-record under the wrapper invocation's toolCallId so the parent
 * agent's loop sees a single aggregated set on its top-level invocation.
 */
import type { Citation } from "xyne-claw-shared";

const citationsByCallId = new Map<string, Citation[]>();

export function recordCitations(toolCallId: string, citations: Citation[] | undefined): void {
  if (!toolCallId || !citations || citations.length === 0) return;
  const existing = citationsByCallId.get(toolCallId);
  if (existing) {
    existing.push(...citations);
  } else {
    citationsByCallId.set(toolCallId, [...citations]);
  }
}

export function takeCitations(toolCallId: string): Citation[] | undefined {
  if (!toolCallId) return undefined;
  const found = citationsByCallId.get(toolCallId);
  if (!found) return undefined;
  citationsByCallId.delete(toolCallId);
  return found.length > 0 ? found : undefined;
}
