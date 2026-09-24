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
 * `custom:ask-question` is listed even though it is control flow rather than
 * formatting. Two things changed the calculus:
 *   - Delivery already works here. renderUiWidget (claw-auth routes/webhook.ts)
 *     exempts `question` widgets from the conversation-mode drop that gates
 *     code/diff/chart, so a question card posts on every surface these tools
 *     reach — it is the one presentation tool with no delivery caveat.
 *   - The deferral cost is now one extra assistant turn, not a user round trip.
 *     A mid-run `load-tools` only started taking effect within the same run once
 *     xyne-claw wired pi's `prepareNextTurn` (apps/xyne-claw/src/agent.ts); before
 *     that, a lazily-loaded tool was uncallable until the next user message,
 *     which would have made a blocking question tool useless.
 * The trade stands: an agent must spend a `load-tools` turn before it can ask.
 * In exchange every thread run can ask a clarifying question, instead of only
 * those whose `tools.custom` happened to select it.
 *
 * Deliberately NOT listed:
 *   - the `builtin` todo tools — the plan primer requires a plan BEFORE the
 *     first tool call, so they must be active from turn one.
 */

/** Tool `source` values whose tools are response-only presentation cards. */
export const PRESENTATION_TOOL_SOURCES: ReadonlySet<string> = new Set([
  // post-code-block / post-diff / post-chart
  "custom:code-artifacts",
  // ask-user-question
  "custom:ask-question",
]);

/** Catalog source label used for presentation tools in the fast-mode catalog. */
export const PRESENTATION_CATALOG_SOURCE = "presentation";

export function isPresentationToolSource(source: string | undefined): boolean {
  return !!source && PRESENTATION_TOOL_SOURCES.has(source);
}
