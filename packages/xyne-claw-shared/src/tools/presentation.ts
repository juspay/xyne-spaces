/**
 * Presentation tools — the response-only surface.
 *
 * These tools do not fetch, compute, or mutate anything. They exist purely to
 * render the agent's answer into the thread as a card (a code block, a diff, a
 * chart). The agent only needs them once it already knows what it wants to say,
 * so their schemas are dead weight in the prompt for the whole exploratory part
 * of a run — and in fast mode they are exactly what `search-tools`/`load-tools`
 * is for.
 *
 * Listing a tool's `source` here makes it a fast-mode catalog candidate rather
 * than an always-active tool (see apps/xyne-claw/src/tool-catalog.ts). It does
 * NOT change whether an agent is allowed the tool at all — that stays with the
 * per-agent `tools.custom` gate in xyne-claw's run dispatcher.
 *
 * To add a future response-only tool: give it a `source` and list that source
 * here. Nothing else needs to change.
 *
 * Deliberately NOT listed:
 *   - `custom:ask-question` — terminal control flow, not formatting. Deferring
 *     it would cost a round trip before the agent can ask a blocking question.
 *   - the `builtin` todo tools — the plan primer requires a plan BEFORE the
 *     first tool call, so they must be active from turn one.
 */

/** Tool `source` values whose tools are response-only presentation cards. */
export const PRESENTATION_TOOL_SOURCES: ReadonlySet<string> = new Set([
  // post-code-block / post-diff / post-chart
  "custom:code-artifacts",
  // visualize — renders a fenced ```chart block for the reply body
  "custom:visualize",
]);

/** Catalog source label used for presentation tools in the fast-mode catalog. */
export const PRESENTATION_CATALOG_SOURCE = "presentation";

export function isPresentationToolSource(source: string | undefined): boolean {
  return !!source && PRESENTATION_TOOL_SOURCES.has(source);
}
