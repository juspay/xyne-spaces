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
 *
 * The same store also carries an out-of-band `debug` payload (currently the
 * Vespa YQL from kb-search / spaces-search). It rides the same lifecycle —
 * record on tool return, take on tool_execution_end, pin onto the persisted
 * ToolInvocation — but never reaches the model.
 */
import type { Citation } from "xyne-claw-shared";
import { citationIconKey } from "xyne-claw-shared";

const citationsByCallId = new Map<string, Citation[]>();
const debugByCallId = new Map<string, Record<string, unknown>>();

/**
 * Stamp each citation with its lightweight brand-icon KEY (gmail/gcal/gdrive/
 * spaces) if not already set. Single chokepoint: every tool-emitted citation
 * flows through recordCitations (both direct MCP tools and subagent-propagated
 * ones). We persist only this tiny key — claw-auth re-attaches the actual
 * `data:` SVG URI at the send boundary (`hydrateCitationIcons`), so the heavy
 * icon bytes never hit the DB. Adding a new source's icon is a one-file change
 * in xyne-claw-shared's CITATION_ICONS.
 */
function stampIconKeys(citations: Citation[]): void {
  for (const c of citations) {
    if (!c.iconKey) {
      const key = citationIconKey(c);
      if (key) c.iconKey = key;
    }
  }
}

export function recordCitations(toolCallId: string, citations: Citation[] | undefined): void {
  if (!toolCallId || !citations || citations.length === 0) return;
  stampIconKeys(citations);
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

/**
 * Stash an arbitrary debug-metadata blob against a tool call. Today only
 * kb-search and spaces-search populate this — both with the Vespa YQL +
 * bound query params under `{ payloads: [...] }`. Multiple calls to the
 * same toolCallId shallow-merge (last-write-wins per top-level key); typical
 * MCP flow is exactly one record per call, so collisions are rare.
 */
export function recordDebug(toolCallId: string, debug: Record<string, unknown> | undefined): void {
  if (!toolCallId || !debug || Object.keys(debug).length === 0) return;
  const existing = debugByCallId.get(toolCallId);
  if (existing) {
    debugByCallId.set(toolCallId, { ...existing, ...debug });
  } else {
    debugByCallId.set(toolCallId, { ...debug });
  }
}

export function takeDebug(toolCallId: string): Record<string, unknown> | undefined {
  if (!toolCallId) return undefined;
  const found = debugByCallId.get(toolCallId);
  if (!found) return undefined;
  debugByCallId.delete(toolCallId);
  return Object.keys(found).length > 0 ? found : undefined;
}
