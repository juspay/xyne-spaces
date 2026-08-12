/**
 * Instant KB answer: classify -> single search -> single answer pass,
 * bypassing the full claw agentic tool loop entirely. Triggered per-request
 * by the `instant` flag on POST /claw/api/v1/run/stream (run-stream.ts) and
 * POST /agents/:slug/chat (agent-chat.ts).
 *
 * Mirrors xyne-search's non-agentic RAG design (classify -> search -> answer,
 * server/app/agent/services/nonAgenticQueryRouter.ts +
 * server/app/agent/services/nonAgenticAsk.ts) trimmed to this codebase:
 *   - Classify: one cheap LLM call (claw's `/internal/instant/complete`
 *     with model:"classify") that resolves query ambiguity, detects
 *     greetings/conversational turns that don't need a search at all,
 *     extracts search keywords, and flags follow-ups. See
 *     `classifyInstantQuery` below.
 *   - Follow-ups: instant mode never special-cases isFollowUp for
 *     retrieval — same principle as the full agentic loop, which doesn't
 *     branch on "is this a follow-up" either, it just always still has the
 *     previous turn's actual tool results sitting in its context. Instant
 *     mode approximates that: on any turn past the first,
 *     `resolvePreviousTurnContext` pulls the immediately preceding
 *     completed run's raw retrieved snippets (`agentRunRepository.
 *     findLatestToolInvocations`) and carries them into THIS turn's answer
 *     call alongside a normal fresh search — never instead of one. Costs one
 *     cheap indexed read, no extra LLM call, so it doesn't slow down the
 *     normal path in any way that matters next to the ~seconds-long answer
 *     completion. Fails open (silently omitted) if there's nothing to carry
 *     forward.
 *   - Search: `handleKbSearch` (mcp/kb-handlers.ts) — same KB-scope
 *     resolution, ACL re-check, and Vespa call the live kb-search tool uses.
 *     Its `content` already carries `[clf-__TOOL_CALL_ID__#N]` cite
 *     placeholders and a matching `Citation[]` array; we just substitute in
 *     a synthetic toolCallId instead of waiting for claw's tool-execution
 *     lifecycle to assign a real one.
 *   - Answer: a single completion via claw's `/internal/instant/complete`
 *     S2S endpoint (instantAskClient.ts) — claw-auth holds no LLM
 *     credentials, so the credential-holding call happens on claw, same as
 *     entity extraction and session curation.
 *   - Follow-up suggestion chips: same feature the full agentic loop already
 *     has (xyne-claw's run.ts + follow-up-generator.ts), same "V2 request
 *     flag" opt-in (`generateFollowUpSuggestions`) — just reached over S2S
 *     (followUpSuggestionsClient.ts) since claw-auth has no LiteLLM
 *     credential of its own. Kicked off concurrently with everything else in
 *     this turn (classify, search, deep-dive, answer) so enabling it never
 *     adds sequential latency; the result is appended to the SAME
 *     toolInvocations array claw's agentic path uses (an `ask-user-question`
 *     entry with `purpose: "follow_up_suggestions"` plus an
 *     `internal-follow-up-diagnostics` entry) — the existing chip-rendering
 *     and debug-panel code already just scans toolInvocations for these, so
 *     nothing downstream needed to change to pick this up.
 */

import { randomUUID } from "node:crypto";
import { handleKbSearch, handleKbSearchWithinDoc, type KbHandlerResult } from "../mcp/kb-handlers.js";
import { completeInstantViaClaw, streamInstantViaClaw, type InstantAskChatMessage, type InstantAskCredential } from "../services/instantAskClient.js";
import {
  generateFollowUpSuggestionsViaClaw,
  type FollowUpAgentContext,
  type FollowUpConversationMessage,
  type FollowUpGenerationResult,
} from "../services/followUpSuggestionsClient.js";
import { resolveAgentProviderConfigs } from "./agent-provider-config.js";
import { agentRunRepository } from "../repositories/agentRunRepository.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("instant-ask");

/**
 * Whether this agent is configured to ONLY ever run in instant mode — a
 * persisted per-agent setting (`agent.config.instantAgent`, a plain key on
 * the existing free-form `Agent.config` Json column, no schema migration),
 * not a per-message opt-in. Both call sites (run-stream.ts, agent-chat.ts)
 * treat this as the sole source of truth for whether a given request runs
 * instant — a client-sent `instant` request flag is no longer honored on
 * its own, in either direction: an instant agent always runs instant even
 * if the client omits the flag, and a non-instant agent never runs instant
 * even if the client sends one, so there's no way to bypass the setting
 * from either side.
 */
export function isInstantAgent(config: unknown): boolean {
  return Boolean(config) && typeof config === "object" && !Array.isArray(config) &&
    (config as Record<string, unknown>)["instantAgent"] === true;
}

/**
 * Copies the normal agentic flow's agent-config resolution (its own
 * systemPrompt + resolveAgentProviderConfigs' "bring your own key" LiteLLM
 * credential) WITHOUT the tool-loop/subagent machinery that also reads from
 * agent config — instant mode never dispatches to claw's tool loop at all, so
 * there's nothing for that machinery to attach to. Called once per turn by
 * both call sites (run-stream.ts, agent-chat.ts) right before
 * `answerInstantAsk`.
 *
 * Only the "litellm" provider maps onto an OpenAI-compatible
 * `/chat/completions` endpoint — the one this flow's lightweight completion
 * function knows how to call. When the agent's resolved PRIMARY provider is
 * something else (claude/codex/copilot/openrouter, each a different wire
 * protocol) or unset (platform default), this deliberately falls back to
 * the platform default rather than attempting those protocols here.
 */
export async function resolveInstantAgentContext(agent: {
  id: string;
  config?: unknown;
  systemPrompt?: string | null;
}): Promise<{ agentPrompt?: string; providerConfig?: InstantAskCredential }> {
  const agentPrompt = agent.systemPrompt?.trim() || undefined;
  try {
    const resolved = await resolveAgentProviderConfigs(agent);
    const litellmCfg = resolved.providerConfigs["litellm"];
    if (litellmCfg && resolved.parent === "litellm") {
      return {
        ...(agentPrompt ? { agentPrompt } : {}),
        providerConfig: {
          apiKey: litellmCfg.apiKey,
          baseUrl: litellmCfg.baseUrl ?? CONFIG.litellmBaseUrl,
          model: litellmCfg.model,
        },
      };
    }
  } catch (err) {
    log.warn(`[instant-ask] agent provider resolution failed, using platform default: ${err instanceof Error ? err.message : String(err)}`);
  }
  return agentPrompt ? { agentPrompt } : {};
}

// Deliberately placed AFTER the agent's own systemPrompt (see
// answerInstantAsk below) and opens with an explicit override: an agent's
// configured prompt is normally written for the full agentic tool loop and
// may describe tools like vespaSearch/getChunks as available, and may
// instruct it to never answer from a partial/truncated snippet. Instant
// mode never wires up tool-calling for this completion (no `tools` param,
// no loop) and only ever gives it one page of search snippets — without
// this override the model either (a) announces it will call a tool and
// stops, since nothing executes that "call", or (b) complies with its own
// "always read the full document first" instruction by asking the user for
// permission to fetch more instead of answering. Both produced
// incomplete/non-answers in testing; this override forecloses both.
const ANSWER_SYSTEM_PROMPT_PREFIX = `IMPORTANT — this turn overrides any tool-use or "read the full document first" instructions above: you have NO tools available right now, and nothing you write will trigger a tool call or another turn. The single search step has already run; the retrieved snippets below (this turn's search results, plus — when this is a follow-up in an ongoing conversation — whatever was already retrieved for the previous message, in a <previous_turn_context> block) are ALL the information you will get, even if a snippet looks partial or truncated. This is a single-turn, non-interactive answer — do not say you will search or read more, do not offer to fetch a document, do not ask the user whether they'd like you to look something up, and do not end your reply with a question. Answer now, directly and completely, synthesizing the best answer you can from exactly what's below. If the snippets are genuinely insufficient to answer, say plainly what's missing instead of asking permission to go look for it.

You are a knowledge-base assistant. Answer the user's question using ONLY the information in the retrieved snippets below — do not use outside knowledge. If the results don't contain the answer, say so plainly instead of guessing.

When you state something drawn from a specific result, cite it inline immediately after that sentence using the exact "cite" attribute value from that <hit> element (for example: "...as described in the setup guide [clf-abc123#0]."). Reuse the same token whenever you reference that result again. Never invent a citation token and never cite a result you didn't actually use.

`;

// Trimmed adaptation of xyne-search's classify prompt
// (server/app/agent/services/nonAgenticQueryRouter.ts) — same four
// decisions (direct-answer short-circuit, query rewrite, follow-up
// detection, search-keyword extraction), collapsed out of xyne-search's
// agentPrompt/reasoning-mode prompt variants since this flow has neither.
const CLASSIFY_SYSTEM_PROMPT = `You are a query classifier for a knowledge-base retrieval-augmented generation (RAG) system. You are not authorized to reject a user query — only classify it.

Given the user's latest message and the conversation so far, decide:

1. **Direct answer, no search:** If the message is a greeting, small talk, a basic calculation, or a question about the conversation itself (e.g. "what did I just ask?"), answer it directly using ONLY the conversation history and put your reply in "answer". Otherwise "answer" must be null — never guess at knowledge-base content here.

2. **Ambiguity resolution:** If the message contains pronouns or references ("it", "that", "the document") that only make sense given prior conversation, or is a command with no concrete reference, rewrite it into a fully standalone question and put it in "queryRewrite". Otherwise leave "queryRewrite" null.

3. **Follow-up detection:** Set "isFollowUp" to true only if the latest message explicitly refers back to specific content in the previous assistant reply (pronouns, "the one you mentioned", "tell me more about that", named/numbered back-references). A topically related but self-contained new question is NOT a follow-up — set it false. Always false if there is no prior conversation.

4. **Search keywords:** Extract the core search intent into "filterQuery" — specific names, topics, or identifiers worth searching for. Drop generic verbs ("find", "show", "search"), pronouns, and filler words. If nothing specific remains, set it null.

Output ONLY this JSON object, nothing else:
{"answer": "<string or null>", "queryRewrite": "<string or null>", "isFollowUp": <boolean>, "filterQuery": "<string or null>"}`;

/** Caps how much prior conversation gets replayed into the answer call. */
const MAX_HISTORY_MESSAGES = 20;

/**
 * How many of kb-search's top hits get a chunk-level drill-down before the
 * answer call. kb-search's snippets are hard-truncated to 280 chars
 * (kb-handlers.ts) — enough to judge relevance, rarely enough to answer
 * from. The full agentic loop would let the model call `getChunks` itself
 * on a promising hit; instant mode has no such follow-up turn, so this runs
 * the equivalent lookup deterministically (in code, not as a model tool-call
 * decision) right after the search, for the top hits only.
 */
const MAX_DEEPDIVE_HITS = 2;

/**
 * Pulls the immediately preceding completed run's raw retrieved snippets
 * (the actual <search_results>/<doc_search> XML, not the final answer text)
 * for this conversation+agent — approximates what an agentic session's
 * persistent tool-result history already gives the model "for free" on
 * every subsequent turn, without instant mode needing a real multi-turn
 * tool loop. Called unconditionally past the first turn (never gated on
 * classify's isFollowUp — same as agentic, which doesn't gate on it
 * either). Fails open (null) on anything missing or malformed; the caller
 * just runs its normal fresh search with no prior-turn context in that
 * case, same fail-open discipline as classifyInstantQuery below.
 */
async function resolvePreviousTurnContext(conversationId: string, agentSlug: string): Promise<string | null> {
  try {
    const previousRun = await agentRunRepository.findLatestToolInvocations(conversationId, agentSlug);
    const invocations = previousRun?.toolInvocations;
    if (!Array.isArray(invocations) || invocations.length === 0) return null;
    const parts = (invocations as Array<{ result?: unknown }>)
      .map((inv) => (typeof inv?.result === "string" ? inv.result : null))
      .filter((r): r is string => r !== null);
    return parts.length > 0 ? parts.join("\n\n") : null;
  } catch (err) {
    log.warn(`[instant-ask] previous-turn context lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface InstantHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface InstantAskToolInvocation {
  toolName: string;
  args: unknown;
  result: string;
  isError: boolean;
  startedAt: string;
  durationMs: number;
  toolCallId: string;
  citations?: unknown[];
}

/**
 * Same shape/kind-vocabulary as xyne-claw's DebugEventRecord (agent.ts) —
 * session_start/tool_execution_start/tool_execution_end/session_prompt/
 * assistant_turn_end/session_end — so an instant run's debug bundle looks
 * like a (much shorter) normal agent run to anything that already knows how
 * to render those kinds. See run-stream.ts's instant branch and
 * agent-chat.ts's /debug route for how this gets persisted and served.
 */
export interface InstantDebugEvent {
  seq: number;
  at: string;
  kind:
    | "session_start"
    | "tool_execution_start"
    | "tool_execution_end"
    | "session_prompt"
    | "assistant_turn_end"
    | "session_end"
    | "follow_up_generation_start"
    | "follow_up_generation_end";
  turn?: number;
  llmCall?: number;
  toolCallId?: string;
  data: Record<string, unknown>;
}

export interface InstantAskResult {
  content: string;
  toolInvocations: InstantAskToolInvocation[];
  debugEvents: InstantDebugEvent[];
}

export interface QueryClassification {
  answer: string | null;
  queryRewrite: string | null;
  isFollowUp: boolean;
  filterQuery: string | null;
}

/** All-null/false — same fail-open shape as xyne-search's FAIL_OPEN_CLASSIFICATION. */
const FAIL_OPEN_CLASSIFICATION: QueryClassification = {
  answer: null,
  queryRewrite: null,
  isFollowUp: false,
  filterQuery: null,
};

/** Tolerates code fences and stray prose around the JSON, same as xyne-search's parseClassification. */
function parseClassification(raw: string): QueryClassification {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<QueryClassification>;
    return {
      answer: typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() : null,
      queryRewrite: typeof parsed.queryRewrite === "string" && parsed.queryRewrite.trim() ? parsed.queryRewrite.trim() : null,
      isFollowUp: parsed.isFollowUp === true,
      filterQuery: typeof parsed.filterQuery === "string" && parsed.filterQuery.trim() ? parsed.filterQuery.trim() : null,
    };
  } catch {
    return FAIL_OPEN_CLASSIFICATION;
  }
}

/**
 * Classify stage — one cheap LLM call before search. Fails OPEN (falls back
 * to "search using the raw message, not a follow-up") rather than blocking
 * the turn: a classify hiccup should degrade to the old single-search
 * behavior, never a hard error.
 */
async function classifyInstantQuery(
  task: string,
  history: InstantAskChatMessage[],
): Promise<QueryClassification> {
  const messages: InstantAskChatMessage[] = [
    { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: `user query: "${task}"` },
  ];
  try {
    const raw = await completeInstantViaClaw(messages, "classify", { model: "classify", jsonMode: true });
    return parseClassification(raw);
  } catch (err) {
    log.warn(`[instant-ask] classify failed, falling back to raw-message search: ${err instanceof Error ? err.message : String(err)}`);
    return FAIL_OPEN_CLASSIFICATION;
  }
}

export async function answerInstantAsk(args: {
  userId: string;
  agentSlug: string;
  conversationId: string;
  sessionId: string;
  task: string;
  history?: InstantHistoryMessage[];
  collectionId?: string;
  /** Same "V2 request flag" the agentic path's run.ts reads
   *  (shouldGenerateFollowUpSuggestions) — opt-in per request, forwarded
   *  from run-stream.ts's `generateFollowUpSuggestions` body field. */
  generateFollowUpSuggestions?: boolean;
  /** Agent name/description for grounding — same fields run-stream.ts
   *  already builds for the agentic path's `agentConfig.followUpAgentContext`
   *  (agentRow.name/description). Only used when the flag above is set. */
  followUpAgentContext?: FollowUpAgentContext;
  /** The agent's own configured systemPrompt — same persona/instructions a
   *  normal agentic run would see, layered under the KB-grounding/citation
   *  rules below. Copied from the normal flow's agent-config resolution; the
   *  tool-loop/subagent machinery that ALSO reads from agent config is
   *  deliberately not replicated here (see module doc). */
  agentPrompt?: string;
  /** The agent's resolved "bring your own key" LiteLLM credential, when it
   *  has one configured — same resolveAgentProviderConfigs() a normal
   *  agentic run uses. Only ever applied to the ANSWER call; classify keeps
   *  running on the platform default (a cheap decision node has no need for
   *  the agent's own paid key/model). Falls back to the platform default
   *  when absent — see instant-ask.ts (claw side) for that fallback. */
  providerConfig?: InstantAskCredential;
  /** Fired the instant each debug event is computed — mirrors the normal
   *  agentic flow's live `event: debug` frames (run-stream.ts's onDebug
   *  handler) instead of the caller waiting for the whole run to finish and
   *  replaying a batched array. Still returned in full on the resolved
   *  result too, for persistence. */
  onDebugEvent?: (event: InstantDebugEvent) => void;
  /** Fired for each answer token as it streams in from claw — mirrors the
   *  normal agentic flow's live `event: delta` frames. Called exactly once
   *  per return path even on the no-search-needed/no-results/search-failed
   *  shortcuts (with the whole shortcut message as a single "chunk"), so a
   *  caller never needs to separately write `result.content` after this
   *  resolves — everything the user sees has already gone through this
   *  callback by the time the promise settles. */
  onTextDelta?: (delta: string) => void;
  /** Fired the instant each tool call (kb-search, then each deep-dive)
   *  finishes — mirrors the normal agentic flow's live `event: invocation`
   *  frames. This is what the dashboard actually uses to resolve
   *  `[clf-<toolCallId>#<chunkIndex>]` citation tokens into clickable chips
   *  for the message currently on screen (XyneAIStreamManager.ts's
   *  `tool_invocation` handler builds `msg.toolInvocations` from exactly
   *  these frames) — without it the citations the model emits have nothing
   *  to resolve against until the page is reloaded and the message is
   *  refetched with its persisted toolInvocations attached. */
  onToolInvocation?: (invocation: InstantAskToolInvocation) => void;
}): Promise<InstantAskResult> {
  const runStartedAt = Date.now();

  let seq = 0;
  const debugEvents: InstantDebugEvent[] = [];
  const pushDebug = (
    kind: InstantDebugEvent["kind"],
    data: Record<string, unknown>,
    extras: Partial<Pick<InstantDebugEvent, "turn" | "llmCall" | "toolCallId">> = {},
  ): void => {
    seq += 1;
    const event: InstantDebugEvent = { seq, at: new Date().toISOString(), kind, data, ...extras };
    debugEvents.push(event);
    args.onDebugEvent?.(event);
  };

  pushDebug("session_start", {
    conversationId: args.conversationId,
    sessionId: args.sessionId,
    agentSlug: args.agentSlug,
    userId: args.userId,
    provider: "spaces",
    task: args.task,
    mode: "instant",
  });

  const historyMessages: InstantAskChatMessage[] = (args.history ?? [])
    .slice(-MAX_HISTORY_MESSAGES)
    .filter((turn) => turn.content.trim())
    .map((turn) => ({ role: turn.role, content: turn.content }));

  // Kicked off now, awaited later (right before the answer call) — runs
  // concurrently with classify below instead of after it, so it adds zero
  // sequential latency on top of an already-cheap indexed read. Only past
  // the first turn: nothing to carry forward on a fresh conversation.
  const previousTurnContextPromise: Promise<string | null> = historyMessages.length > 0
    ? resolvePreviousTurnContext(args.conversationId, args.agentSlug)
    : Promise.resolve(null);

  // Follow-up suggestion chips — same opt-in flag and concurrent-dispatch
  // shape as the agentic path (run.ts fires this alongside the main turn,
  // never after it). Kicked off now, before classify/search/answer even
  // start, so it's essentially free: it races the ENTIRE rest of this
  // multi-second turn rather than adding to it.
  const followUpKickoffAt = new Date();
  if (args.generateFollowUpSuggestions === true) {
    pushDebug("follow_up_generation_start", {
      sessionId: args.sessionId,
      generationInput: historyMessages.length > 0 ? "conversation_history_and_prompt" : "prompt_only",
      conversationMessageCount: historyMessages.length,
      agentContextProvided: Boolean(args.followUpAgentContext),
    });
  }
  const followUpPromise: Promise<FollowUpGenerationResult | null> = args.generateFollowUpSuggestions === true
    ? generateFollowUpSuggestionsViaClaw(args.task, args.followUpAgentContext, historyMessages as FollowUpConversationMessage[])
    : Promise.resolve(null);

  /**
   * Resolves the follow-up generation (if enabled) and turns it into the
   * SAME two synthetic tool-invocation shapes claw's agentic path appends
   * to `toolInvocations` (run.ts) — an `ask-user-question` entry carrying
   * the three suggestions, plus an `internal-follow-up-diagnostics` entry
   * for the debug panel. Existing chip-rendering/debug code already just
   * scans `toolInvocations` for these, so returning them here is the ONLY
   * wiring instant mode needs — no new persistence field.
   */
  const buildFollowUpInvocations = async (content: string): Promise<InstantAskToolInvocation[]> => {
    if (args.generateFollowUpSuggestions !== true) return [];

    const generation = await followUpPromise;
    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - followUpKickoffAt.getTime());
    const outcome: "delivered_inline" | "empty_answer" | "generation_failed" =
      content.trim().length === 0 ? "empty_answer" : !generation ? "generation_failed" : "delivered_inline";

    const invocations: InstantAskToolInvocation[] = [];
    let suggestionCount = 0;
    if (outcome === "delivered_inline" && generation) {
      suggestionCount = generation.suggestions.length;
      const questionId = randomUUID();
      const askInvocation: InstantAskToolInvocation = {
        toolName: "ask-user-question",
        args: { questionId, question: "Related questions", options: generation.suggestions, purpose: "follow_up_suggestions" },
        result: "Follow-up suggestions recorded.",
        isError: false,
        startedAt: completedAt.toISOString(),
        durationMs: 0,
        toolCallId: `follow-up-${questionId}`,
      };
      invocations.push(askInvocation);
      args.onToolInvocation?.(askInvocation);
    }

    const diagnosticInvocation: InstantAskToolInvocation = {
      toolName: "internal-follow-up-diagnostics",
      args: {
        purpose: "follow_up_debug",
        enabled: true,
        outcome,
        suggestionCount,
        conversationMessageCount: historyMessages.length,
        agentContextProvided: Boolean(args.followUpAgentContext),
        ...(generation ? { generationSource: generation.source, generationModel: generation.model } : {}),
        ...(generation?.failureCode ? { failureCode: generation.failureCode } : {}),
        ...(generation?.failureMessage ? { failureMessage: generation.failureMessage } : {}),
      },
      result: `Follow-up generation ${outcome}.`,
      isError: false,
      startedAt: followUpKickoffAt.toISOString(),
      durationMs,
      toolCallId: `follow-up-debug-${args.sessionId}`,
    };
    invocations.push(diagnosticInvocation);
    args.onToolInvocation?.(diagnosticInvocation);

    // The dashboard's debug panel renders this event's `data` directly as a
    // FollowUpDiagnostic (AskAIDebugPanel.tsx: kind === "follow_up_generation_end"
    // && typeof data.outcome === "string") — every field that type declares
    // required (sessionId, startedAt, runStatus, outcome, suggestionCount,
    // persistedRecorder, suggestions) MUST be present here, not just the
    // fields the internal-follow-up-diagnostics tool invocation above needs;
    // an event missing e.g. `suggestions` crashes that render with "Cannot
    // read properties of undefined (reading 'length')".
    pushDebug("follow_up_generation_end", {
      sessionId: args.sessionId,
      startedAt: followUpKickoffAt.toISOString(),
      completedAt: completedAt.toISOString(),
      runStatus: "completed",
      outcome,
      suggestionCount,
      persistedRecorder: outcome === "delivered_inline",
      suggestions: outcome === "delivered_inline" && generation ? generation.suggestions : [],
      conversationMessageCount: historyMessages.length,
      agentContextProvided: Boolean(args.followUpAgentContext),
      ...(args.followUpAgentContext?.name ? { agentContextName: args.followUpAgentContext.name } : {}),
      ...(args.followUpAgentContext?.description ? { agentContextDescription: args.followUpAgentContext.description } : {}),
      generationDurationMs: durationMs,
      ...(generation ? { generationSource: generation.source, generationModel: generation.model } : {}),
      ...(generation?.failureCode ? { failureCode: generation.failureCode } : {}),
      ...(generation?.failureMessage ? { failureMessage: generation.failureMessage } : {}),
      ...(generation?.httpStatus !== undefined ? { httpStatus: generation.httpStatus } : {}),
    });

    return invocations;
  };

  const classifyStartedAt = new Date();
  pushDebug("session_prompt", {
    kind: "fresh",
    prompt: `user query: "${args.task}"`,
    messageCount: historyMessages.length + 2,
    messages: [{ role: "system", content: CLASSIFY_SYSTEM_PROMPT }, ...historyMessages, { role: "user", content: `user query: "${args.task}"` }],
  }, { llmCall: 1, turn: 1 });
  const classification = await classifyInstantQuery(args.task, historyMessages);
  pushDebug("assistant_turn_end", {
    message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(classification) }] },
    assistantText: JSON.stringify(classification),
    durationMs: Date.now() - classifyStartedAt.getTime(),
  }, { llmCall: 1, turn: 1 });

  // Greeting / small-talk / "what did I just ask" — classify answered it
  // directly from conversation history alone. No search, no citations.
  if (classification.answer) {
    args.onTextDelta?.(classification.answer);
    const followUpInvocations = await buildFollowUpInvocations(classification.answer);
    pushDebug("session_end", {
      textLength: classification.answer.length,
      toolCount: 0,
      latency: { totalMs: Date.now() - runStartedAt },
    });
    return { content: classification.answer, toolInvocations: followUpInvocations, debugEvents };
  }

  const searchQuery = classification.queryRewrite || classification.filterQuery || args.task;

  /**
   * Deep-dive into the top hits with a real chunk-level search so the answer
   * call sees full chunk text instead of just the 280-char snippet — see
   * MAX_DEEPDIVE_HITS above for why this runs unconditionally in code rather
   * than waiting on a model tool-call decision instant mode has no follow-up
   * turn to execute.
   */
  const runDeepDives = async (fileIds: string[]): Promise<{ invocations: InstantAskToolInvocation[]; xmlParts: string[] }> => {
    const invocations: InstantAskToolInvocation[] = [];
    const xmlParts: string[] = [];
    await Promise.all(
      fileIds.map(async (fileId) => {
        const diveToolCallId = `instant-${randomUUID()}`;
        const diveStartedAt = new Date();
        const diveArgs = { fileId, query: searchQuery };
        pushDebug("tool_execution_start", {
          toolName: "kb-search-within-doc",
          args: diveArgs,
        }, { toolCallId: diveToolCallId, turn: 1 });

        let dive: KbHandlerResult | null = null;
        try {
          dive = await handleKbSearchWithinDoc({
            userId: args.userId,
            agentSlug: args.agentSlug,
            fileId,
            query: searchQuery,
            limit: 4,
          });
        } catch (err) {
          log.warn(`[instant-ask] deep-dive search-within-doc failed fileId=${fileId}: ${err instanceof Error ? err.message : String(err)}`);
        }

        const diveDurationMs = Date.now() - diveStartedAt.getTime();
        if (!dive || dive.isError || !dive.citations?.length) {
          pushDebug("tool_execution_end", {
            toolName: "kb-search-within-doc",
            args: diveArgs,
            result: dive?.content ?? "deep-dive failed",
            isError: true,
            durationMs: diveDurationMs,
          }, { toolCallId: diveToolCallId, turn: 1 });
          return;
        }

        // Strip the "Follow up with `kb-get-chunks`..." hint handleKbSearchWithinDoc
        // appends for the agentic tool loop — instant mode has no tools to follow
        // up with, and leaving it in risks the model repeating the same
        // no-tools-available mistake this prompt override already forecloses.
        const diveXml = dive.content
          .replaceAll("__TOOL_CALL_ID__", diveToolCallId)
          .replace(/\n*Follow up with `kb-get-chunks`.*$/s, "");
        xmlParts.push(diveXml);
        const diveInvocation: InstantAskToolInvocation = {
          toolName: "kb-search-within-doc",
          args: diveArgs,
          result: diveXml,
          isError: false,
          startedAt: diveStartedAt.toISOString(),
          durationMs: diveDurationMs,
          toolCallId: diveToolCallId,
          citations: dive.citations,
        };
        invocations.push(diveInvocation);

        pushDebug("tool_execution_end", {
          toolName: "kb-search-within-doc",
          args: diveArgs,
          result: diveXml,
          isError: false,
          durationMs: diveDurationMs,
        }, { toolCallId: diveToolCallId, turn: 1 });
        args.onToolInvocation?.(diveInvocation);
      }),
    );
    return { invocations, xmlParts };
  };

  /**
   * The ANSWER call always sees the user's original wording (not the
   * rewritten search query) — same split as xyne-search: queryRewrite only
   * steers retrieval, never what the model thinks the user actually asked.
   *
   * The agent's own systemPrompt (its persona/instructions, same field a
   * normal agentic run reads) comes FIRST, so it sets the voice; the
   * KB-grounding/citation contract comes after as non-negotiable platform
   * rules the agent's own instructions can't override.
   */
  const runAnswerCall = async (searchResultsXml: string): Promise<string> => {
    const answerSystemPrompt = args.agentPrompt?.trim()
      ? `${args.agentPrompt.trim()}\n\n---\n\n${ANSWER_SYSTEM_PROMPT_PREFIX}${searchResultsXml}`
      : ANSWER_SYSTEM_PROMPT_PREFIX + searchResultsXml;
    const messages: InstantAskChatMessage[] = [
      { role: "system", content: answerSystemPrompt },
      ...historyMessages,
      { role: "user", content: args.task },
    ];

    pushDebug("session_prompt", {
      kind: "fresh",
      prompt: args.task,
      messageCount: messages.length,
      messages,
      ...(args.providerConfig ? { model: args.providerConfig.model } : {}),
    }, { llmCall: 2, turn: 1 });

    try {
      const answer = await streamInstantViaClaw(messages, {
        sessionId: args.sessionId,
        purpose: "answer",
        ...(args.providerConfig ? { credential: args.providerConfig } : {}),
        onTextDelta: (delta) => args.onTextDelta?.(delta),
      });
      const trimmed = answer.trim();
      // The model streamed zero tokens (rare, but seen on a hard refusal/empty
      // completion) — nothing went through onTextDelta above, so the fallback
      // message needs its own delivery through the same callback or the caller
      // never sees it at all.
      const content = trimmed || "I couldn't find anything relevant to that question in the knowledge base.";
      if (!trimmed) args.onTextDelta?.(content);

      pushDebug("assistant_turn_end", {
        message: { role: "assistant", content: [{ type: "text", text: content }] },
        assistantText: content,
      }, { llmCall: 2, turn: 1 });

      return content;
    } catch (err) {
      log.error(`[instant-ask] answer completion failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  };

  const toolCallId = `instant-${randomUUID()}`;
  const toolStartedAt = new Date();

  pushDebug("tool_execution_start", {
    toolName: "kb-search",
    args: { query: searchQuery, ...(args.collectionId ? { collectionId: args.collectionId } : {}) },
  }, { toolCallId, turn: 1 });

  const searchResult = await handleKbSearch({
    userId: args.userId,
    agentSlug: args.agentSlug,
    query: searchQuery,
    ...(args.collectionId ? { collectionId: args.collectionId } : {}),
  });

  // Swap in the real synthetic toolCallId — handleKbSearch emits
  // `__TOOL_CALL_ID__` as a placeholder because in the normal agentic flow
  // the real id isn't known until claw's tool-execution lifecycle assigns
  // one; here we already generated it above. Applied before building
  // `toolInvocation` too, so the persisted `result` field matches what the
  // model actually saw instead of leaking the placeholder token.
  const searchResultsXml = searchResult.content.replaceAll("__TOOL_CALL_ID__", toolCallId);

  const toolDurationMs = Date.now() - toolStartedAt.getTime();
  const toolInvocation: InstantAskToolInvocation = {
    toolName: "kb-search",
    args: { query: searchQuery, ...(args.collectionId ? { collectionId: args.collectionId } : {}) },
    result: searchResultsXml,
    isError: searchResult.isError === true,
    startedAt: toolStartedAt.toISOString(),
    durationMs: toolDurationMs,
    toolCallId,
    ...(searchResult.citations?.length ? { citations: searchResult.citations } : {}),
  };

  pushDebug("tool_execution_end", {
    toolName: "kb-search",
    args: toolInvocation.args,
    result: searchResultsXml,
    isError: toolInvocation.isError,
    durationMs: toolDurationMs,
  }, { toolCallId, turn: 1 });
  args.onToolInvocation?.(toolInvocation);

  if (searchResult.isError || !searchResult.citations?.length) {
    const content = searchResult.isError
      ? `I couldn't search the knowledge base: ${searchResult.content}`
      : "I couldn't find anything relevant to that question in the knowledge base.";
    args.onTextDelta?.(content);
    const followUpInvocations = await buildFollowUpInvocations(content);
    pushDebug("session_end", {
      textLength: content.length,
      toolCount: 1,
      latency: { totalMs: Date.now() - runStartedAt },
    });
    return { content, toolInvocations: [toolInvocation, ...followUpInvocations], debugEvents };
  }

  const topFileIds = Array.from(
    new Set(
      (searchResult.citations ?? [])
        .map((c) => (c.kind === "collection-item" ? c.collectionItemId : undefined))
        .filter((id): id is string => typeof id === "string"),
    ),
  ).slice(0, MAX_DEEPDIVE_HITS);

  const { invocations: deepDiveInvocations, xmlParts: deepDiveXmlParts } = await runDeepDives(topFileIds);

  const searchResultsWithDeepDivesXml = deepDiveXmlParts.length
    ? `${searchResultsXml}\n\n${deepDiveXmlParts.join("\n\n")}`
    : searchResultsXml;

  // Same context an agentic session already has "for free" on every turn
  // past the first: whatever was retrieved for the previous message,
  // carried forward alongside (never instead of) this turn's own fresh
  // search — the model decides what's still relevant, same as it would
  // reading back through its own tool-call history.
  const previousTurnContext = await previousTurnContextPromise;
  const fullContextXml = previousTurnContext
    ? `<previous_turn_context note="retrieved for the previous message in this conversation — may or may not still be relevant">\n${previousTurnContext}\n</previous_turn_context>\n\n${searchResultsWithDeepDivesXml}`
    : searchResultsWithDeepDivesXml;

  const content = await runAnswerCall(fullContextXml);
  const followUpInvocations = await buildFollowUpInvocations(content);
  pushDebug("session_end", {
    textLength: content.length,
    toolCount: 1 + deepDiveInvocations.length,
    latency: { totalMs: Date.now() - runStartedAt },
  });

  return { content, toolInvocations: [toolInvocation, ...deepDiveInvocations, ...followUpInvocations], debugEvents };
}
