/**
 * Instant KB answer orchestration: classify -> single search -> optional
 * deep-dive -> answer -> follow-up suggestion chips. Runs entirely on claw
 * (this pod) as a deliberate short-circuit of the normal agentic loop —
 * see `processTask` in routes/run.ts, which calls `processInstantTask`
 * here at its very top when the request carries `instant: true`, before
 * any of the heavy agentic-loop setup (workspace, sandbox, skills, MCP
 * tool-definition loading, subagent resolution) runs.
 *
 * Architecture note (why this file exists on claw, not claw-auth): claw-auth
 * is authentication/orchestration only — it resolves the agent, mints a
 * session token, and forwards the whole request here, exactly like every
 * agentic dispatch. The ONE thing this flow needs that lives on claw-auth
 * (the `kb-search`/`kb-search-within-doc` tool) is reached the SAME way the
 * real agentic tool loop reaches it: an authenticated callback over
 * `POST /claw/api/v1/sessions/:sessionId/mcp/call` (see `authFetch` below),
 * never a local function call. Classify/answer LLM completions
 * (`completeInstantAsk`/`streamInstantAnswer`, ./instant-ask.ts) and
 * follow-up-suggestion generation (`generateFollowUpSuggestions`,
 * ./follow-up-generator.ts) are now plain in-process calls, since this is
 * the same process — no more S2S round trips for either.
 */

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { Citation } from "xyne-claw-shared";
import type { PendingQuestion } from "xyne-claw-shared";
import { authFetch } from "./mcp.js";
import { completeInstantAsk, streamInstantAnswer } from "./instant-ask.js";
import {
  generateFollowUpSuggestions,
  buildFollowUpGenerationStartEvent,
  buildFollowUpGenerationEndEvent,
  asFollowUpPendingQuestion,
  type FollowUpAgentContext,
  type FollowUpConversationMessage,
  type FollowUpGenerationResult,
} from "./follow-up-generator.js";
import {
  pushInvocation,
  pushDebugProgress,
  pushStreamChunk,
  cloneForDebug,
  type ToolInvocation,
  type DebugEventRecord,
  type DebugSessionSnapshot,
  type ProgressDest,
} from "./agent.js";
import { ensureSessionDebugDir } from "./session-store.js";
import { gcsUploadDebugRun } from "./gcs.js";
import { createLogger } from "./logger.js";

const log = createLogger("instant-run");

// Deliberately placed AFTER the agent's own systemPrompt and opens with an
// explicit override: an agent's configured prompt is normally written for
// the full agentic tool loop and may describe tools like vespaSearch/
// getChunks as available, and may instruct it to never answer from a
// partial/truncated snippet. Instant mode never wires up tool-calling for
// this completion (no `tools` param, no loop) and only ever gives it one
// page of search snippets — without this override the model either (a)
// announces it will call a tool and stops, since nothing executes that
// "call", or (b) complies with its own "always read the full document
// first" instruction by asking the user for permission to fetch more
// instead of answering. Both produced incomplete/non-answers in testing;
// this override forecloses both.
const ANSWER_SYSTEM_PROMPT_PREFIX = `IMPORTANT — this turn overrides any tool-use or "read the full document first" instructions above: you have NO tools available right now, and nothing you write will trigger a tool call or another turn. The single search step has already run; the retrieved snippets below (this turn's search results, plus — when this is a follow-up in an ongoing conversation — whatever was already retrieved for the previous message, in a <previous_turn_context> block) are ALL the information you will get, even if a snippet looks partial or truncated. This is a single-turn, non-interactive answer — do not say you will search or read more, do not offer to fetch a document, do not ask the user whether they'd like you to look something up, and do not end your reply with a question. Answer now, directly and completely, synthesizing the best answer you can from exactly what's below. If the snippets are genuinely insufficient to answer, say plainly what's missing instead of asking permission to go look for it.

You are a knowledge-base assistant. Answer the user's question using ONLY the information in the retrieved snippets below — do not use outside knowledge. If the results don't contain the answer, say so plainly instead of guessing.

When you state something drawn from a specific result, cite it inline immediately after that sentence using the exact "cite" attribute value from that <hit> element (for example: "...as described in the setup guide [clf-abc123#0]."). Reuse the same token whenever you reference that result again. Never invent a citation token and never cite a result you didn't actually use.

`;

// Trimmed adaptation of xyne-search's classify prompt — same four decisions
// (direct-answer short-circuit, query rewrite, follow-up detection,
// search-keyword extraction).
const CLASSIFY_SYSTEM_PROMPT = `You are a query classifier for a knowledge-base retrieval-augmented generation (RAG) system. You are not authorized to reject a user query — only classify it.

Given the user's latest message and the conversation so far, decide:

1. **Direct answer, no search:** If the message is a greeting, small talk, a basic calculation, or a question about the conversation itself (e.g. "what did I just ask?"), answer it directly using ONLY the conversation history and put your reply in "answer". Otherwise "answer" must be null — never guess at knowledge-base content here.

2. **Ambiguity resolution:** If the message contains pronouns or references ("it", "that", "the document") that only make sense given prior conversation, or is a command with no concrete reference, rewrite it into a fully standalone question and put it in "queryRewrite". Otherwise leave "queryRewrite" null.

3. **Follow-up detection:** Set "isFollowUp" to true only if the latest message explicitly refers back to specific content in the previous assistant reply (pronouns, "the one you mentioned", "tell me more about that", named/numbered back-references). A topically related but self-contained new question is NOT a follow-up — set it false. Always false if there is no prior conversation.

4. **Search keywords:** Extract the core search intent into "filterQuery" — specific names, topics, or identifiers worth searching for. Drop generic verbs ("find", "show", "search"), pronouns, and filler words. If nothing specific remains, set it null.

Output ONLY this JSON object, nothing else:
{"answer": "<string or null>", "queryRewrite": "<string or null>", "isFollowUp": <boolean>, "filterQuery": "<string or null>"}`;

/**
 * How many of kb-search's top hits get a chunk-level drill-down before the
 * answer call. kb-search's snippets are hard-truncated (kb-handlers.ts) —
 * enough to judge relevance, rarely enough to answer from. The full agentic
 * loop would let the model call `getChunks` itself on a promising hit;
 * instant mode has no such follow-up turn, so this runs the equivalent
 * lookup deterministically (in code, not as a model tool-call decision)
 * right after the search, for the top hits only.
 */
const MAX_DEEPDIVE_HITS = 2;

interface QueryClassification {
  answer: string | null;
  queryRewrite: string | null;
  isFollowUp: boolean;
  filterQuery: string | null;
}

const FAIL_OPEN_CLASSIFICATION: QueryClassification = {
  answer: null,
  queryRewrite: null,
  isFollowUp: false,
  filterQuery: null,
};

/** Tolerates code fences and stray prose around the JSON. */
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

interface McpCallResult {
  content: string;
  citations?: Citation[];
  isError?: boolean;
}

/**
 * The one thing this flow needs from claw-auth — reached the exact same way
 * the real agentic tool loop reaches ANY tool: an authenticated callback
 * over `/sessions/:sessionId/mcp/call` (see apps/xyne-claw-auth/backend/src/
 * routes/mcp.ts:1170, which derives userId/agentSlug from the session token
 * itself, not from this request body). Never a local function call into
 * claw-auth's kb-handlers.ts.
 */
async function callKbTool(
  sessionId: string,
  sessionToken: string,
  tool: "kb-search" | "kb-search-within-doc",
  params: Record<string, unknown>,
): Promise<McpCallResult> {
  return authFetch<McpCallResult>(
    `/claw/api/v1/sessions/${encodeURIComponent(sessionId)}/mcp/call`,
    sessionToken,
    {
      method: "POST",
      body: JSON.stringify({ serverType: "knowledge-base", tool, params }),
    },
  );
}

export interface ProcessInstantTaskArgs {
  sessionId: string;
  sessionToken: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  task: string;
  conversationId?: string;
  agentSlug?: string;
  systemPrompt?: string;
  provider?: string;
  providerConfigs?: Record<string, { apiKey: string; model: string; baseUrl?: string }>;
  collectionId?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  previousTurnContext?: string;
  generateFollowUpSuggestions?: boolean;
  followUpAgentContext?: FollowUpAgentContext;
  progressUrl: ProgressDest;
  callbackUrl: ProgressDest;
  /** Injected rather than imported — `sendCallback` is module-private in
   *  routes/run.ts (same file `processTask` and this function's only caller
   *  live in), so the caller passes it through instead of this file
   *  reimplementing callback delivery/retry/SSRF-guard logic. */
  sendCallback: (
    callbackUrl: ProgressDest,
    sessionToken: string,
    payload: Record<string, unknown>,
  ) => Promise<boolean>;
}

/** Only the "litellm" provider maps onto an OpenAI-compatible
 *  `/chat/completions` endpoint — the one completeInstantAsk/
 *  streamInstantAnswer know how to call. */
function resolveInstantCredential(
  provider: string | undefined,
  providerConfigs: ProcessInstantTaskArgs["providerConfigs"],
): { apiKey: string; baseUrl?: string; model: string } | undefined {
  if (provider !== "litellm") return undefined;
  const cfg = providerConfigs?.["litellm"];
  return cfg?.apiKey && cfg.model
    ? { apiKey: cfg.apiKey, model: cfg.model, ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}) }
    : undefined;
}

export async function processInstantTask(args: ProcessInstantTaskArgs): Promise<void> {
  const runStartedAt = Date.now();
  const startedAtIso = new Date().toISOString();

  let seq = 0;
  const debugEvents: DebugEventRecord[] = [];
  const pushDebug = (
    kind: DebugEventRecord["kind"],
    data: Record<string, unknown>,
    extras: Partial<Pick<DebugEventRecord, "turn" | "llmCall" | "toolCallId">> = {},
  ): void => {
    seq += 1;
    const event: DebugEventRecord = { seq, at: new Date().toISOString(), kind, data, ...extras };
    debugEvents.push(event);
    pushDebugProgress(args.progressUrl, args.sessionId, event);
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

  const historyMessages = (args.history ?? []).filter((m) => m.content.trim());
  const credential = resolveInstantCredential(args.provider, args.providerConfigs);

  // Follow-up suggestion chips — fired now, before classify/search/answer
  // even start, exactly like the real agentic loop's own parallel dispatch
  // (routes/run.ts ~1585-1627): it races the ENTIRE rest of this turn
  // instead of adding to it, so enabling it costs nothing sequentially.
  const followUpStartedAt = new Date().toISOString();
  const followUpEnabled = args.generateFollowUpSuggestions === true;
  const followUpConversationHistory: FollowUpConversationMessage[] = historyMessages.slice(-12);
  const followUpGenerationInput = followUpConversationHistory.length > 0
    ? "conversation_history_and_prompt"
    : "prompt_only";
  if (followUpEnabled) {
    pushDebugProgress(args.progressUrl, args.sessionId, buildFollowUpGenerationStartEvent({
      seq: -1,
      at: followUpStartedAt,
      sessionId: args.sessionId,
      model: "fast",
      generationInput: followUpGenerationInput,
      conversationMessageCount: followUpConversationHistory.length,
      ...(args.followUpAgentContext ? { agentContext: args.followUpAgentContext } : {}),
    }));
  }
  const followUpPromise: Promise<FollowUpGenerationResult | null> = followUpEnabled
    ? generateFollowUpSuggestions(args.task, args.followUpAgentContext, followUpConversationHistory)
    : Promise.resolve(null);

  /**
   * Resolves the follow-up generation (if enabled) and turns it into the
   * SAME two synthetic tool-invocation shapes the real agentic finalize
   * block appends to `toolInvocations` (routes/run.ts ~3744-3805) — an
   * `ask-user-question` entry carrying the three suggestions (also pushed
   * into `pendingQuestions`, which is what claw-auth's existing
   * `extractFollowUpSuggestions(body.pendingQuestions)` already consumes
   * generically for the callback payload), plus an
   * `internal-follow-up-diagnostics` entry for the debug panel.
   */
  const buildFollowUpInvocations = async (
    content: string,
  ): Promise<{ invocations: ToolInvocation[]; pendingQuestions: PendingQuestion[] }> => {
    if (!followUpEnabled) return { invocations: [], pendingQuestions: [] };

    const generation = await followUpPromise;
    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - new Date(followUpStartedAt).getTime());
    const outcome: "delivered_inline" | "empty_answer" | "generation_failed" =
      content.trim().length === 0 ? "empty_answer" : !generation ? "generation_failed" : "delivered_inline";

    const invocations: ToolInvocation[] = [];
    const pendingQuestions: PendingQuestion[] = [];
    let suggestionCount = 0;
    if (outcome === "delivered_inline" && generation) {
      suggestionCount = generation.suggestions.length;
      const followUpQuestion = asFollowUpPendingQuestion(generation.suggestions);
      pendingQuestions.push(followUpQuestion);
      const askInvocation: ToolInvocation = {
        toolName: "ask-user-question",
        args: followUpQuestion,
        result: "Follow-up suggestions recorded.",
        isError: false,
        startedAt: completedAt.toISOString(),
        durationMs: 0,
        status: "completed",
        toolCallId: `follow-up-${followUpQuestion.questionId}`,
      };
      invocations.push(askInvocation);
      pushInvocation(args.progressUrl, args.sessionId, askInvocation);
    }

    const diagnosticInvocation: ToolInvocation = {
      toolName: "internal-follow-up-diagnostics",
      args: {
        purpose: "follow_up_debug",
        enabled: true,
        outcome,
        suggestionCount,
        generationInput: followUpGenerationInput,
        conversationMessageCount: followUpConversationHistory.length,
        agentContextProvided: Boolean(args.followUpAgentContext),
        agentContextName: args.followUpAgentContext?.name,
        agentContextDescription: args.followUpAgentContext?.description,
        generationSource: generation?.source,
        generationModel: generation?.model,
        failureCode: generation?.failureCode,
        failureMessage: generation?.failureMessage,
        httpStatus: generation?.httpStatus,
      },
      result: `Follow-up generation ${outcome}.`,
      isError: false,
      startedAt: followUpStartedAt,
      durationMs,
      status: "completed",
      toolCallId: `follow-up-debug-${args.sessionId}`,
    };
    invocations.push(diagnosticInvocation);
    pushInvocation(args.progressUrl, args.sessionId, diagnosticInvocation);

    pushDebugProgress(args.progressUrl, args.sessionId, buildFollowUpGenerationEndEvent({
      seq: -2,
      at: completedAt.toISOString(),
      startedAt: followUpStartedAt,
      sessionId: args.sessionId,
      model: generation?.model ?? "fast",
      generationInput: followUpGenerationInput,
      conversationMessageCount: followUpConversationHistory.length,
      ...(args.followUpAgentContext ? { agentContext: args.followUpAgentContext } : {}),
      generation: generation ?? { suggestions: [], source: "fallback", model: "fast", failureCode: "request_error", failureMessage: "generation unavailable" },
    }));

    return { invocations, pendingQuestions };
  };

  const classifyMessages = [
    { role: "system" as const, content: CLASSIFY_SYSTEM_PROMPT },
    ...historyMessages,
    { role: "user" as const, content: `user query: "${args.task}"` },
  ];
  pushDebug("session_prompt", {
    kind: "fresh",
    prompt: `user query: "${args.task}"`,
    messageCount: classifyMessages.length,
    messages: classifyMessages,
  }, { llmCall: 1, turn: 1 });
  const classifyStartedAt = Date.now();
  let classification: QueryClassification;
  try {
    const raw = await completeInstantAsk(classifyMessages, "classify", { model: "classify", jsonMode: true });
    classification = parseClassification(raw);
  } catch (err) {
    log.warn(`[instant-run] classify failed, falling back to raw-message search: ${err instanceof Error ? err.message : String(err)}`);
    classification = FAIL_OPEN_CLASSIFICATION;
  }
  pushDebug("assistant_turn_end", {
    message: { role: "assistant", content: [{ type: "text", text: JSON.stringify(classification) }] },
    assistantText: JSON.stringify(classification),
    durationMs: Date.now() - classifyStartedAt,
  }, { llmCall: 1, turn: 1 });

  const finalize = async (content: string, toolInvocations: ToolInvocation[], toolCount: number): Promise<void> => {
    const { invocations: followUpInvocations, pendingQuestions } = await buildFollowUpInvocations(content);
    const allInvocations = [...toolInvocations, ...followUpInvocations];
    pushDebug("session_end", {
      textLength: content.length,
      toolCount,
      latency: { totalMs: Date.now() - runStartedAt },
    });

    if (args.conversationId) {
      try {
        const debugDir = await ensureSessionDebugDir(args.conversationId);
        const snapshot: DebugSessionSnapshot = {
          schemaVersion: 1,
          conversationId: args.conversationId,
          sessionId: args.sessionId,
          ...(args.agentSlug ? { agentSlug: args.agentSlug } : {}),
          userId: args.userId,
          ...(args.userName ? { userName: args.userName } : {}),
          ...(args.userEmail ? { userEmail: args.userEmail } : {}),
          provider: "spaces",
          startedAt: startedAtIso,
          finishedAt: new Date().toISOString(),
          task: args.task,
          messages: [],
          toolInvocations: cloneForDebug(allInvocations),
          tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          latency: { totalMs: Date.now() - runStartedAt, llmDecodeMs: 0, llmWaitMs: 0, llmTotalMs: 0, llmTurns: 0, llmRetries: 0, toolMs: allInvocations.reduce((sum, inv) => sum + (inv.durationMs ?? 0), 0) },
          lastAssistantText: content,
          events: cloneForDebug(debugEvents),
        };
        await writeFile(`${debugDir}/debug-session.json`, JSON.stringify(snapshot, null, 2), "utf8");
        await writeFile(`${debugDir}/debug-events.json`, JSON.stringify(debugEvents, null, 2), "utf8");
        const safeSessionId = args.sessionId.replace(/[^a-zA-Z0-9_-]/g, "-");
        const runFile = `debug-run-${runStartedAt}-${safeSessionId}.json`;
        const runSnapshot = Buffer.from(JSON.stringify(snapshot), "utf8");
        if (!(await gcsUploadDebugRun(args.conversationId, runFile, runSnapshot))) {
          await writeFile(`${debugDir}/${runFile}`, runSnapshot);
        }
      } catch (err) {
        log.warn(`[instant-run] failed to write debug artifacts: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await args.sendCallback(args.callbackUrl, args.sessionToken, {
      sessionId: args.sessionId,
      userId: args.userId,
      conversationId: args.conversationId ?? null,
      agentSlug: args.agentSlug ?? null,
      status: "completed",
      result: content,
      toolsUsed: ["kb-search"],
      tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...(allInvocations.length > 0 ? { toolInvocations: allInvocations } : {}),
      ...(pendingQuestions.length > 0 ? { pendingQuestions } : {}),
      followUpsPending: false,
      provider: "spaces",
      model: credential?.model,
    });
  };

  // Greeting / small-talk / "what did I just ask" — classify answered it
  // directly from conversation history alone. No search, no citations.
  if (classification.answer) {
    pushStreamChunk(args.progressUrl, args.sessionId, { textDelta: classification.answer });
    await finalize(classification.answer, [], 0);
    return;
  }

  const searchQuery = classification.queryRewrite || classification.filterQuery || args.task;

  const runDeepDives = async (fileIds: string[]): Promise<{ invocations: ToolInvocation[]; xmlParts: string[] }> => {
    const invocations: ToolInvocation[] = [];
    const xmlParts: string[] = [];
    await Promise.all(
      fileIds.map(async (fileId) => {
        const diveToolCallId = `instant-${randomUUID()}`;
        const diveStartedAt = new Date();
        const diveArgs = { fileId, query: searchQuery };
        pushDebug("tool_execution_start", { toolName: "kb-search-within-doc", args: diveArgs }, { toolCallId: diveToolCallId, turn: 1 });

        let dive: McpCallResult | null = null;
        try {
          dive = await callKbTool(args.sessionId, args.sessionToken, "kb-search-within-doc", { fileId, query: searchQuery, limit: 4 });
        } catch (err) {
          log.warn(`[instant-run] deep-dive failed fileId=${fileId}: ${err instanceof Error ? err.message : String(err)}`);
        }

        const diveDurationMs = Date.now() - diveStartedAt.getTime();
        if (!dive || dive.isError || !dive.citations?.length) {
          pushDebug("tool_execution_end", { toolName: "kb-search-within-doc", args: diveArgs, result: dive?.content ?? "deep-dive failed", isError: true, durationMs: diveDurationMs }, { toolCallId: diveToolCallId, turn: 1 });
          return;
        }

        const diveXml = dive.content
          .replaceAll("__TOOL_CALL_ID__", diveToolCallId)
          .replace(/\n*Follow up with `kb-get-chunks`.*$/s, "");
        xmlParts.push(diveXml);
        const diveInvocation: ToolInvocation = {
          toolName: "kb-search-within-doc",
          args: diveArgs,
          result: diveXml,
          isError: false,
          startedAt: diveStartedAt.toISOString(),
          durationMs: diveDurationMs,
          status: "completed",
          toolCallId: diveToolCallId,
          citations: dive.citations,
        };
        invocations.push(diveInvocation);
        pushDebug("tool_execution_end", { toolName: "kb-search-within-doc", args: diveArgs, result: diveXml, isError: false, durationMs: diveDurationMs }, { toolCallId: diveToolCallId, turn: 1 });
        pushInvocation(args.progressUrl, args.sessionId, diveInvocation);
      }),
    );
    return { invocations, xmlParts };
  };

  const runAnswerCall = async (searchResultsXml: string): Promise<string> => {
    const answerSystemPrompt = args.systemPrompt?.trim()
      ? `${args.systemPrompt.trim()}\n\n---\n\n${ANSWER_SYSTEM_PROMPT_PREFIX}${searchResultsXml}`
      : ANSWER_SYSTEM_PROMPT_PREFIX + searchResultsXml;
    const messages = [
      { role: "system" as const, content: answerSystemPrompt },
      ...historyMessages,
      { role: "user" as const, content: args.task },
    ];
    pushDebug("session_prompt", {
      kind: "fresh",
      prompt: args.task,
      messageCount: messages.length,
      messages,
      ...(credential ? { model: credential.model } : {}),
    }, { llmCall: 2, turn: 1 });

    try {
      const answer = await streamInstantAnswer(messages, (delta) => {
        pushStreamChunk(args.progressUrl, args.sessionId, { textDelta: delta });
      }, { ...(credential ? { credential } : {}) });
      const trimmed = answer.trim();
      const content = trimmed || "I couldn't find anything relevant to that question in the knowledge base.";
      if (!trimmed) pushStreamChunk(args.progressUrl, args.sessionId, { textDelta: content });
      pushDebug("assistant_turn_end", {
        message: { role: "assistant", content: [{ type: "text", text: content }] },
        assistantText: content,
      }, { llmCall: 2, turn: 1 });
      return content;
    } catch (err) {
      log.error(`[instant-run] answer completion failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  };

  const toolCallId = `instant-${randomUUID()}`;
  const toolStartedAt = new Date();
  pushDebug("tool_execution_start", {
    toolName: "kb-search",
    args: { query: searchQuery, ...(args.collectionId ? { collectionId: args.collectionId } : {}) },
  }, { toolCallId, turn: 1 });

  const searchResult = await callKbTool(args.sessionId, args.sessionToken, "kb-search", {
    query: searchQuery,
    ...(args.collectionId ? { collectionId: args.collectionId } : {}),
  });

  const searchResultsXml = searchResult.content.replaceAll("__TOOL_CALL_ID__", toolCallId);
  const toolDurationMs = Date.now() - toolStartedAt.getTime();
  const toolInvocation: ToolInvocation = {
    toolName: "kb-search",
    args: { query: searchQuery, ...(args.collectionId ? { collectionId: args.collectionId } : {}) },
    result: searchResultsXml,
    isError: searchResult.isError === true,
    startedAt: toolStartedAt.toISOString(),
    durationMs: toolDurationMs,
    status: "completed",
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
  pushInvocation(args.progressUrl, args.sessionId, toolInvocation);

  if (searchResult.isError || !searchResult.citations?.length) {
    const content = searchResult.isError
      ? `I couldn't search the knowledge base: ${searchResult.content}`
      : "I couldn't find anything relevant to that question in the knowledge base.";
    pushStreamChunk(args.progressUrl, args.sessionId, { textDelta: content });
    await finalize(content, [toolInvocation], 1);
    return;
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
  // search — resolved by claw-auth (a Postgres read) and forwarded in the
  // request body, since instant mode has no persistent session of its own
  // on claw to carry this forward the way a real agentic session would.
  const fullContextXml = args.previousTurnContext
    ? `<previous_turn_context note="retrieved for the previous message in this conversation — may or may not still be relevant">\n${args.previousTurnContext}\n</previous_turn_context>\n\n${searchResultsWithDeepDivesXml}`
    : searchResultsWithDeepDivesXml;

  const content = await runAnswerCall(fullContextXml);
  await finalize(content, [toolInvocation, ...deepDiveInvocations], 1 + deepDiveInvocations.length);
}
