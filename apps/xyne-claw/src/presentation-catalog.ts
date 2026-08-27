/**
 * Presentation tools as a Spaces-thread default.
 *
 * The presentation tools (post-code-block / post-diff / post-chart / visualize,
 * plus ask-user-question — see packages/xyne-claw-shared/src/tools/presentation.ts)
 * render a CARD inside a Spaces thread: the agent's answer, or the question it
 * needs answered before it can produce one. claw-auth's renderUiWidget
 * (routes/webhook.ts) posts them through /chat/postMessage, so they only mean
 * anything on a run that has a thread to post into.
 *
 * Because they exist for that surface, a thread run gets them regardless of the
 * agent's `tools.custom` selection — the same "framework default, not per-agent
 * config" rationale as the plan tools (todo-write / todo-read) in routes/run.ts.
 * The difference is delivery: plan tools go into the ALWAYS-ACTIVE set, these go
 * into the lazy CATALOG. The agent sees one index line per tool and pulls the
 * schema in with `load-tools` at the point of use, so a thread run pays almost
 * nothing for tools it may never call.
 *
 * How the catalog half already works (nothing here changes it):
 *   - buildToolCatalog tags them with PRESENTATION_CATALOG_SOURCE
 *   - buildFastModeDirectTools AND buildSubagentTools both skip them, so they
 *     never reach fastAlwaysActiveToolNames — which is what keeps them lazy
 *   - routes/run.ts keeps a catalog candidate only if it survived the
 *     `tools.custom` gate, which is the single thing this module unblocks
 */

import { isPresentationToolSource, PRESENTATION_CATALOG_SOURCE } from "xyne-claw-shared";

/**
 * Dispatch event types that mean "a person is talking to this agent in a Spaces
 * thread right now" — an ALLOWLIST, deliberately.
 *
 * claw-auth's /webhook emits exactly three mention event types (webhook.ts):
 * APP_MENTIONED, DIRECT_MESSAGE and USER_MENTIONED. USER_MENTIONED is absent
 * here on purpose: claw-auth sets responseMode "approval" for it, and
 * renderUiWidget DROPS code/diff/chart cards outside "conversation" mode. That
 * is the digital-twin draft-then-approve flow — it delivers through its own
 * approval surface, never as thread cards. Offering the tools there would be
 * worse than withholding them: the widget POST is fire-and-forget, so the tool
 * reports "Posted to the thread" while nothing ever appears.
 *
 * An allowlist and not "channelId is present, minus known exclusions", because
 * channelId ALONE does not mean Spaces thread. Two other dispatchers forward
 * one and send no eventType at all:
 *   - routes/run-stream.ts — the Ask AI composer (a dashboard chat surface)
 *   - routes/run.ts        — the S2S entry point, whose eventType is
 *                            caller-supplied and may be omitted
 * A deny-list predicate lets both through by default; this one cannot.
 */
export const THREAD_MENTION_EVENT_TYPES: ReadonlySet<string> = new Set([
  "APP_MENTIONED",
  "DIRECT_MESSAGE",
]);

export interface PresentationCatalogRunContext {
  /** Set when the run posts into a Spaces channel. Necessary but NOT
   *  sufficient — see THREAD_MENTION_EVENT_TYPES. */
  channelId: string | undefined;
  /** Dispatch event type. Absent on Studio and Ask AI runs. */
  eventType: string | undefined;
  conversationId: string | undefined;
  /** run.ts's isReadOnlyJob, injected so this module stays dependency-light
   *  and the caller keeps ownership of the scheduled/automation definition. */
  isScheduledOrAutomationRun: (eventType: string | undefined, conversationId: string | undefined) => boolean;
}

/**
 * True when this run should get the presentation catalog for free — i.e. it is
 * an interactive Spaces thread mention with a channel to post cards into.
 *
 * The scheduled/automation check is redundant against the allowlist above (a
 * scheduled run carries eventType "scheduled"/"automation", not a mention type)
 * and is kept only to catch a mention-typed dispatch that is really a scheduled
 * replay — isReadOnlyJob also matches on a `scheduled_` conversationId prefix.
 */
export function presentationCatalogDefaultOn(ctx: PresentationCatalogRunContext): boolean {
  if (!ctx.channelId) return false;
  if (!ctx.eventType || !THREAD_MENTION_EVENT_TYPES.has(ctx.eventType)) return false;
  return !ctx.isScheduledOrAutomationRun(ctx.eventType, ctx.conversationId);
}

/**
 * True when `tool` is a presentation tool that this run gets for free — i.e.
 * the `tools.custom` gate in routes/run.ts should let it through even though
 * the agent never selected it. Returns false when the run isn't a thread run,
 * so the gate keeps its existing behaviour everywhere else.
 */
export function isFreePresentationTool(tool: { source?: string }, defaultOn: boolean): boolean {
  return defaultOn && isPresentationToolSource(tool.source);
}

/**
 * Context primer for a thread run that received the presentation catalog.
 *
 * Two jobs, both needed:
 *
 *  1. Tell the agent WHY it has these tools. The catalog index
 *     (renderToolCatalogForPrompt) lists them but says nothing about
 *     provenance, so an agent whose own tool config never mentioned
 *     post-chart can read the entry as something it is not entitled to and
 *     leave it alone. It is entitled to it — because of the SURFACE, not the
 *     config — and it should be told so plainly.
 *
 *  2. Tell it HOW to answer here. A Spaces thread is a chat surface: the reply
 *     is a message, not a document. Without guidance the common failure is
 *     posting a card AND repeating its contents in the text, which shows the
 *     user the same thing twice.
 *
 * Returns "" when the run's final catalog has no presentation entries — after
 * the read-only strips in routes/run.ts a thread run can still end up without
 * them, and a primer pointing at a catalog that isn't there is worse than
 * silence.
 */
export function buildPresentationPrimer(
  catalogEntries: ReadonlyArray<{ catalog: string }>,
): string {
  const count = catalogEntries.filter((e) => e.catalog === PRESENTATION_CATALOG_SOURCE).length;
  if (count === 0) return "";

  return [
    "## Answering in a Spaces Thread",
    "",
    "You were invoked by a mention in a Spaces thread, so your answer is delivered as",
    "chat messages in that thread — not as a document.",
    "",
    `Every thread run is given the \`${PRESENTATION_CATALOG_SOURCE}\` catalog. You have it because of WHERE`,
    "this run came from, not because this agent was configured with those tools, so",
    "treat them as yours to use. They are not loaded yet — pull in the whole set at once",
    `with \`load-tools\` (catalog \`${PRESENTATION_CATALOG_SOURCE}\`) as soon as you know you need any of them:`,
    "once you know what your answer is, or the moment you find you cannot answer without",
    "asking the user something.",
    "",
    "How to present the answer:",
    "- Blocked on a decision or a missing fact only the user has → ask with the",
    "  question card instead of guessing. Ask BEFORE you do the work, batch related",
    "  questions into one card, and stop your turn there — the answer arrives as a new",
    "  message. Don't spend a card on something you could look up yourself.",
    "- Code the reader will copy or apply (a patch, a config, a query they should run)",
    "  → post it as a card. A change to an existing file → post it as a diff.",
    "- Numbers worth comparing — a trend, a breakdown, a ranking → post a chart.",
    "- Short expressions, names, paths and single values → inline backticks in your",
    "  reply. Do NOT spend a card on them.",
    "- After posting a card, do NOT repeat its contents in your text. The user can",
    "  already see it. Write only what the card cannot say: what it shows and what to",
    "  do about it.",
    "- Prose is still the default. A card has to earn its place; a wall of cards does",
    "  not read as an answer.",
  ].join("\n");
}
