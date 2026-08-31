import {
  createAgentSession,
  AuthStorage,
  SessionManager,
  ModelRegistry,
  DefaultResourceLoader,
  type CreateAgentSessionOptions,
  type ToolDefinition,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { dirname, isAbsolute, join } from "node:path";
import { createLogger } from "./logger.js";
import { buildTwinDeliverMandate } from "./twin-deliver.js";
import { installMidTurnCompaction, forceCompaction } from "./mid-turn-compaction.js";
import { promoteIfOversized } from "./tool-output.js";
import { createScopedToolMap } from "./scoped-tools.js";
import { metric } from "./metrics.js";
import { compactionExtension } from "./compaction-extension.js";
import { takeCitations, takeDebug } from "./citations.js";
import { applyAutoCitations } from "./auto-citations.js";
import { extractSessionClfTokens } from "./citation-sanitizer.js";
import { getSandboxSession } from "xyne-claw-shared";
import type {
  ClawAttachmentPayload,
  ClawSandboxPreviewPayload,
  ClawStreamMeta,
  Todo,
} from "xyne-claw-shared";
import { type ThinkingLevel } from "@earendil-works/pi-ai";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { AGENT, LITELLM, PATHS, SANDBOX_PREVIEW, SERVER } from "./config.js";
import {
  hasSession,
  ensureSessionDir,
  toolOutputBaseDir,
  ensureSessionDebugDir,
  ensureFreshSession,
  scheduleSessionCheckpoint,
  flushSessionNow,
  markSessionActive,
  markSessionIdle,
} from "./session-store.js";
import { acquireSessionLock, refreshSessionLock, releaseSessionLock, SessionLockedError } from "./session-lock.js";
import { gcsUploadDebugRun } from "./storage.js";
import { createCommandGuard } from "./command-guard.js";
import { writeSessionSkills, deleteSessionSkills } from "./session-skills.js";
import { installLlmCallMetrics } from "./llm-call-metrics.js";
import { installToolBudget } from "./tool-budget.js";
import type { FastToolRuntimeController } from "./tool-catalog.js";

const log = createLogger("agent");

export interface Attachment {
  fileName: string;
  mimeType: string;
  data: string; // base64-encoded file content
}

export interface ToolInvocation {
  toolName: string;
  args: unknown;
  result: string;        // text-coerced; exactly what the model saw (already bounded in-execute by promoteIfOversized / pi's built-in caps)
  isError: boolean;
  startedAt: string;     // ISO
  durationMs: number;
  /** Lifecycle state. Pending rows are emitted on tool_execution_start so the UI
   *  can show "running" indicators before the tool completes; they're replaced
   *  by a "completed" row with the final result on tool_execution_end. */
  status?: "running" | "completed";
  /** Set when this invocation originated inside a subagent's own session.
   *  Points at the tool_call_id on the parent agent that invoked the subagent. */
  parentToolCallId?: string;
  /** Name of the subagent wrapping this invocation (e.g. "spaces", "bitbucket"). */
  subagentName?: string;
  /** The underlying pi-coding-agent tool_call_id for this specific call. */
  toolCallId?: string;
  /** Structured citations produced by the tool (Tier 1 propagation). For
   *  subagent wrapper invocations, this is the union of all child citations. */
  citations?: import("xyne-claw-shared").Citation[];
  /** Out-of-band debug metadata. Currently populated only by kb-search and
   *  spaces-search with `{ payloads: [{ stage, yql, vespaParams }] }` — the
   *  actual Vespa query spaces emitted. Persists alongside args/result so
   *  turn debugging can see the YQL without re-running the search. */
  debug?: Record<string, unknown>;
  /** Background (run_in_background) subagent lifecycle. `background` marks a
   *  wrapper invocation whose subagent runs DETACHED; `backgroundState` tracks
   *  running → completed/error independently of `status` (the spawning tool call
   *  returns immediately, so `status` is "completed" from the start). The UI
   *  renders these as a non-blocking chip, not a finished tool. Additive so the
   *  Phase-2 (Design B) upgrade doesn't change the wire shape. */
  background?: boolean;
  backgroundState?: "running" | "completed" | "error";
  backgroundTaskId?: string;
}

// --- Final-answer extraction -------------------------------------------------
// session.getLastAssistantText() returns ONLY the LAST assistant message's text.
// The plan tools (todo-write / todo-read) are pure bookkeeping — they drive the
// live checklist card but carry no answer content. Because pi splits a turn at
// every tool call, a final todo-write forces one more model turn, so the real
// answer and a short todo/wrap-up land in ADJACENT assistant turns — and which
// one holds the answer is nondeterministic:
//   Mode A: assistant [answer + todo-write]  ->  assistant ["done, all cited"]
//   Mode B: assistant ["let me synthesize" + todo-write]  ->  assistant [answer]
// getLastAssistantText() sees only the last turn, so it silently drops the answer
// in Mode A; walking back to a single "substantive" turn (the old approach) drops
// it in Mode B — the two shapes are identical
// ([text + todo-write] -> toolResult -> [text]) and no position-only rule can tell
// them apart. So by default we return ALL non-empty assistant turns of the
// current turn, joined in chronological order: the answer survives wherever the
// todo-write split lands, AND the stored/returned answer matches what the ask-ai
// UI streamed token-by-token across those turns — so completion no longer
// repaints the bubble down to a shorter "final" (the harsh jump users saw when
// the last answer collapsed away the intermediate narration).
//
// `maxTurns` caps how many trailing non-empty assistant turns are kept. Thread
// invocations (Spaces/Slack replies, where a channelId is present) pass 2 so the
// posted reply stays a clean answer + wrap-up without the intermediate "let me
// search…" narration; ask-ai and everything else leave it undefined = keep all.
//
// Empty turns (a bare todo-write, or a verification tool call interposed between
// turns) are skipped so they add no blank gaps, and we never cross a real user
// message (tool results are role "toolResult", not "user"), so we stay inside the
// current conversation turn. This value also feeds the citation-reflection gate,
// so a citation in any kept turn is seen.
type PiBlock = { type?: string; text?: string; name?: string };
type PiMsg = { role?: string; content?: PiBlock[] | string; stopReason?: string };

function piAssistantText(m: PiMsg): string {
  if (!Array.isArray(m.content)) return "";
  return m.content
    .filter((c): c is PiBlock => !!c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("")
    .trim();
}
export function extractFinalAnswerText(session: unknown, maxTurns?: number): string | undefined {
  const s = session as { messages?: unknown; getLastAssistantText?: () => string | undefined };
  const fallback = (): string | undefined =>
    typeof s.getLastAssistantText === "function" ? s.getLastAssistantText() : undefined;
  const msgs = Array.isArray(s.messages) ? (s.messages as PiMsg[]) : null;
  if (!msgs) return fallback();

  // Walk backward from the end, collecting non-empty assistant turns of the
  // current turn. Stop at the current turn's user message so we never reach into a
  // previous exchange; skip empty-text turns (bare tool calls) so they add no
  // blank gaps. With `maxTurns` set (thread replies pass 2) we stop after that
  // many turns; otherwise we keep them all so the stored answer matches the
  // ask-ai streamed transcript (no completion repaint).
  const picked: string[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (maxTurns !== undefined && picked.length >= maxTurns) break;
    const m = msgs[i];
    if (m?.role === "user") break;
    if (m?.role !== "assistant") continue;
    const text = piAssistantText(m);
    if (text.length === 0) continue;
    picked.push(text);
  }
  if (picked.length === 0) return fallback();
  // `picked` is newest-first; emit in chronological order.
  return picked.reverse().join("\n\n");
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Wall-clock breakdown of where a /run actually spent its time. Surfaces the
 * slow path (kimi decoding several KB of structured tool args) vs the noise
 * (one slow tool, infrastructure retries). All fields are best-effort and
 * derived from session events, not the model API — see agent.ts:subscribe.
 */
export interface LatencyMetrics {
  /** Total wall clock of runTask() from first prompt() to return. */
  totalMs: number;
  /** Sum of (firstDeltaAt → message_end) across all assistant turns. */
  llmDecodeMs: number;
  /** Sum of (turnStartedAt → firstDeltaAt) across all assistant turns. */
  llmWaitMs: number;
  /** llmDecodeMs + llmWaitMs (total model time, excluding tool ms). */
  llmTotalMs: number;
  /** Count of assistant message_end events seen. */
  llmTurns: number;
  /** auto_retry_start event count (e.g. "terminated" mid-stream). */
  llmRetries: number;
  /** Latest retry's terminated reason, truncated to 200 chars. */
  lastRetryReason?: string;
  /** TTFT of the very first assistant turn (cold start signal). */
  firstTurnTtftMs?: number;
  /** output_tokens / (llmDecodeMs / 1000), rounded. */
  tokensPerSec?: number;
  /** Estimated streamed characters per second (thinking + text). */
  streamCharsPerSec?: number;
  /** Total streamed assistant characters across the run. */
  streamChars?: number;
  /** Total streamed thinking characters across the run. */
  streamThinkingChars?: number;
  /** Total streamed visible text characters across the run. */
  streamTextChars?: number;
  /** Sum of tool durationMs across the run. */
  toolMs: number;
}

export interface RunResult {
  readonly text: string;
  readonly toolsUsed: string[];
  readonly toolInvocations: ToolInvocation[];
  readonly tokenUsage: TokenUsage;
  readonly latency?: LatencyMetrics;
  readonly attachments?: Attachment[];
  readonly reasoning?: string;
  /** Distinct real `[clf-<id>#n]` citation tokens seen ANYWHERE in the session
   *  transcript (all prior + current turns' tool outputs). Lets run.ts sanitize
   *  citations SESSION-wide so a follow-up turn can re-cite an earlier turn's
   *  tool chunk without the token being stripped as hallucinated. */
  readonly sessionClfTokens?: string[];
  /** Digital Twin mention flow: the structured delivery the model produced via
   *  the mandatory twin_deliver tool (react and/or reply, and where). Absent when
   *  the model never called the tool — claw-auth then stays silent (fail-closed),
   *  never posting the raw assistant text. */
  readonly twinDelivery?: import("xyne-claw-shared").TwinDelivery;
}

export class RunHandoffError extends Error {
  readonly lastTurn: number;
  readonly aborted: boolean;

  constructor(payload: { lastTurn: number; aborted?: boolean }) {
    super(payload.aborted ? "Run handoff requested after aborting in-flight turn" : "Run handoff requested at turn boundary");
    this.name = "RunHandoffError";
    this.lastTurn = payload.lastTurn;
    this.aborted = payload.aborted === true;
  }
}

/**
 * Thrown (or detected via `isQuotaExhaustedError`) when a premium provider
 * returns a quota-exhausted / rate-limit / insufficient-credit response.
 * Caught at the run.ts layer to trigger an automatic single retry against
 * the platform default model (Kimi via LiteLLM). After the retry, no
 * further fallback fires — if Kimi also fails it's a real outage.
 */
export class QuotaExhaustedError extends Error {
  constructor(public readonly provider: string, public readonly underlying: unknown) {
    super(`Provider quota exhausted: ${provider}`);
    this.name = "QuotaExhaustedError";
  }
}

type DebugEventKind =
  | "session_start"
  | "session_tools"
  | "mode_switch"
  | "session_prompt"
  | "stream_rate"
  | "thinking"
  | "assistant_turn_end"
  | "tool_execution_start"
  | "tool_execution_end"
  | "compaction_start"
  | "compaction_end"
  | "auto_retry_start"
  | "auto_retry_end"
  | "citation_reflection"
  | "twin_deliver_reflection"
  | "follow_up_generation_start"
  | "follow_up_generation_end"
  | "background_subagents_delivered"
  | "session_end"
  | "session_cancelled"
  | "session_error";

export interface DebugEventRecord {
  seq: number;
  at: string;
  kind: DebugEventKind;
  turn?: number;
  llmCall?: number;
  toolCallId?: string;
  parentToolCallId?: string;
  subagentName?: string;
  data: Record<string, unknown>;
}

interface StreamRateSample {
  offsetMs: number;
  streamsPerSec: number;
  streamsCollected: number;
}

interface DebugSessionSnapshot {
  schemaVersion: 1;
  conversationId?: string;
  sessionId?: string;
  agentSlug?: string;
  userId?: string;
  userName?: string;
  userEmail?: string;
  provider?: string;
  startedAt: string;
  finishedAt: string;
  task: string;
  context?: string;
  systemPromptOverride?: boolean;
  /** True when the snapshot was captured via the fallback writer in runTask's
   *  finally because the agent loop threw (cancel / transient provider error)
   *  before the success-path write could run. Tools list + messages are
   *  whatever state existed at throw time. UI can branch on this to mark the
   *  debugger view as "partial". */
  cancelled?: boolean;
  /** True for the incremental snapshot written at each turn boundary while the
   *  run is still in flight (so the debugger can show a PARTIAL trace instead of
   *  404ing until completion). Overwritten by the final snapshot on completion. */
  inProgress?: boolean;
  messages: unknown[];
  toolInvocations: ToolInvocation[];
  tokenUsage: TokenUsage;
  latency: LatencyMetrics;
  lastAssistantText: string;
  events: DebugEventRecord[];
}

function cloneForDebug<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

/**
 * Heuristic match for "provider says you're out of quota / rate-limited."
 * Covers the common error shapes we see from Codex (ChatGPT backend),
 * Anthropic (api.anthropic.com), Copilot (proxy), and OpenAI Platform.
 *
 *   - HTTP 429 in the error message
 *   - `insufficient_quota` (OpenAI Platform / Codex)
 *   - `quota_exceeded` (generic)
 *   - `rate_limit_exceeded` (OpenAI / Anthropic)
 *   - `usage limit reached` / `exceeded your usage` (Codex ChatGPT backend wording)
 *   - `out of credits` / `out_of_credit` (Anthropic billing)
 *   - `you exceeded your current quota` (OpenAI Platform message)
 *
 * Intentionally generous — false positives just trigger one extra retry on
 * Kimi (cheap), while false negatives leave a 429 unhandled (bad UX). Bias
 * toward catching, not filtering.
 */

/**
 * Provider AUTH failure — an expired OAuth token, revoked API key, or
 * permission error on the selected provider. Classified alongside quota so
 * runWithProviderFallback walks to the next provider (→ spaces) instead of
 * hard-failing the run: retrying the SAME provider is pointless (the
 * credential won't heal mid-run), but the fallback chain can still answer.
 * Matched on the provider-thrown error message; tool-call failures never
 * reach this classifier (they return as tool results, not thrown provider
 * errors).
 */
export function isProviderAuthError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (!msg) return false;
  return (
    /\b401\b/.test(msg) ||
    /\b403\b/.test(msg) ||
    msg.includes("unauthorized") ||
    msg.includes("authentication_error") ||
    msg.includes("authentication failed") ||
    msg.includes("invalid api key") ||
    msg.includes("invalid_api_key") ||
    msg.includes("permission_error") ||
    msg.includes("token expired") ||
    msg.includes("oauth token") && msg.includes("expired")
  );
}

export function isQuotaExhaustedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg) return false;
  if (/\b429\b/.test(msg)) return true;
  const lowered = msg.toLowerCase();
  return (
    lowered.includes("insufficient_quota") ||
    lowered.includes("quota_exceeded") ||
    // Space + hyphen variants — GitHub Copilot returns a bare "quota exceeded"
    // body, OpenRouter/others "quota exhausted" (prod 2026-06-11: copilot's
    // space variant fell through unclassified → run dropped with no reply).
    lowered.includes("quota exceeded") ||
    lowered.includes("quota exhausted") ||
    lowered.includes("quota-exceeded") ||
    lowered.includes("rate_limit_exceeded") ||
    lowered.includes("rate_limit_error") ||
    lowered.includes("exceeded your usage") ||
    lowered.includes("usage limit reached") ||
    lowered.includes("out of credits") ||
    lowered.includes("out_of_credit") ||
    lowered.includes("you exceeded your current quota") ||
    lowered.includes("rate limited") ||
    lowered.includes("you've exceeded your")
  );
}

/**
 * Thrown when an LLM attempt makes NO streaming/turn progress for too long —
 * i.e. the upstream call hung (provider/grid stall) instead of returning or
 * erroring. Classified as a transient provider error so the fallback chain
 * tries the next provider rather than letting the run hang forever.
 * (Prod 2026-06-15: copilot stalled during a node restart with no timeout →
 * no completion, no error, no fallback → release-announcer dropped silently
 * for hours.)
 */
export class ProviderStallError extends Error {
  readonly toolsUsed: string[];
  readonly toolInvocations: ToolInvocation[];
  readonly tokenUsage: TokenUsage;
  readonly partialText: string;

  constructor(
    public readonly provider: string,
    public readonly idleMs: number,
    progress?: {
      toolsUsed: string[];
      toolInvocations: ToolInvocation[];
      tokenUsage: TokenUsage;
      partialText: string;
    },
  ) {
    super(`Provider ${provider} stalled: no stream activity for ${idleMs}ms`);
    this.name = "ProviderStallError";
    this.toolsUsed = [...(progress?.toolsUsed ?? [])];
    this.toolInvocations = [...(progress?.toolInvocations ?? [])];
    this.tokenUsage = { ...(progress?.tokenUsage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }) };
    this.partialText = progress?.partialText ?? "";
  }
}

/**
 * Transient provider/network failures that should FALL BACK to the next provider
 * (ultimately "spaces") instead of dropping the run — connection resets, DNS
 * blips, fetch failures, socket hangups, request timeouts/aborts, 5xx gateways,
 * and a detected stall. These are the symptoms of a node restart / capacity blip
 * on the LLM path. Distinct from quota exhaustion (isQuotaExhaustedError) but
 * the fallback machine treats both the same way.
 *
 * NOTE: a genuine USER cancellation is a RunCancelledError and is gated out by
 * the fallback's isCancelled check BEFORE this runs, so the "aborted"/"timeout"
 * substrings here can't turn a user stop into a fallback.
 */
export function isTransientProviderError(err: unknown): boolean {
  if (err instanceof ProviderStallError) return true;
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("eai_again") ||
    msg.includes("enotfound") ||
    msg.includes("epipe") ||
    msg.includes("fetch failed") ||
    msg.includes("socket hang up") ||
    msg.includes("network error") ||
    msg.includes("connection error") ||
    msg.includes("terminated") ||
    msg.includes("aborted") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    /\b50[234]\b/.test(msg) ||
    msg.includes("bad gateway") ||
    msg.includes("service unavailable") ||
    msg.includes("gateway timeout") ||
    msg.includes("overloaded")
  );
}

export class RunCancelledError extends Error {
  readonly toolsUsed: string[];
  readonly toolInvocations: ToolInvocation[];
  readonly tokenUsage: TokenUsage;
  readonly partialText: string;

  constructor(message: string, payload: {
    toolsUsed: string[];
    toolInvocations: ToolInvocation[];
    tokenUsage: TokenUsage;
    partialText: string;
  }) {
    super(message);
    this.name = "RunCancelledError";
    this.toolsUsed = payload.toolsUsed;
    this.toolInvocations = payload.toolInvocations;
    this.tokenUsage = payload.tokenUsage;
    this.partialText = payload.partialText;
  }
}

function buildSystemPrompt(userId: string, userName?: string, userEmail?: string, mandateDeliver = false): string {
  const identity = userName ? `**${userName}**` : "the user";
  const emailLine = userEmail ? `\n- **Email:** ${userEmail}` : "";

  // Mention/approval flow only: the user NEVER sees your assistant text — only
  // what you pass to twin_deliver. Shared with the systemPromptOverride path in
  // run.ts (the ACTUAL prompt for the mention twin) via buildTwinDeliverMandate,
  // so the mandate lands regardless of which prompt path runs.
  const deliverySection = mandateDeliver ? buildTwinDeliverMandate(userName ? { userName } : {}) : "";

  return `You are the **Digital Twin** of ${identity}. You act, think, and respond exactly as this person would.

## Identity
You ARE this user's digital representative. When someone asks you a question, they are asking ${userName ?? "this user"} — not a generic assistant. Your job is to respond the way this person would, using their knowledge, context, communication style, and expertise.
- **Name:** ${userName ?? "unknown"}${emailLine}

To get your Spaces user ID for filtering tools (assignedTo, from, createdBy), call the \`spaces-whoami\` tool first.

## How to Build Context (do this FIRST)
Before answering any query, use your available tools to gather context. Look at the tools you have access to — they include tools for searching messages, tickets, activity, memory, users, channels, and more. Use them proactively:

1. **Recent activity** — Check for mentions, replies, and assignments.
2. **Knowledge base** — Search memory/facts/SOPs relevant to the query.
3. **Messages & conversations** — Read threads to understand communication style.
4. **Tickets & work items** — Check current workload and priorities.
5. **Search** — Broad search across all connected apps for relevant context.
6. **People lookup** — Resolve names to user IDs when needed.

Note: Tool names may be prefixed with the server name (e.g. \`xyne-spaces__spaces-search\`). Use the tools as they appear in your tool list.

## How to Respond
- **Mirror the user's communication style.** If they write short direct messages, you do too. If they use detailed explanations, match that.
- **Use the user's actual knowledge.** Ground every answer in data from their messages, tickets, memory, and activity. Do not guess.
- **For engineering queries** — use any available code/log/metrics tools.
- **Be the user.** Respond in first person ("I", "my", "we") as if you are them. Do not say "the user" or "they".
- **Acknowledge gaps honestly.** If you cannot find relevant information in the user's data, say so — don't fabricate.

## Critical Rules
1. NEVER fabricate information. Only use data retrieved from tools.
2. ALWAYS gather context before responding — do not answer from thin air.
3. Respond as the user, not as an assistant describing the user.
4. When the query is about "what are you working on" or "what do you know about X", search the user's actual data first.
5. Use the tools available to you — check your tool list, don't assume tool names.
6. NEVER narrate your process or expose the machinery. No "Saved to memory", "Searching…", "Got it", "Step N", "updating todos", or references to tools/memory. Only the final human message is your voice.

## Data Correlation Rules
When correlating data across different systems (e.g. tickets from Spaces + PRs from Bitbucket):
- ALWAYS clearly distinguish between verified facts and inferred/unverified data.
- Ticket board status (COMPLETED, "Merged" stage) is a WORKFLOW state — it does NOT prove a Bitbucket PR exists or was merged. These are separate systems.
- If Bitbucket search doesn't find a PR for a ticket, report it as "PR not found in search", NOT "No PR".
- When reporting ticket-to-PR mappings, use three clear categories:
  1. **PR verified** — matching PR found and confirmed in Bitbucket
  2. **PR not found in search** — Bitbucket search returned no match (PR may exist under different naming)
  3. **Board suggests done, PR not verified** — ticket board says Completed/Merged but no Bitbucket PR match found
- Never collapse categories 2 and 3 together. The user needs to know what was verified vs what was assumed.${deliverySection}`;
}

/**
 * (B) System-level parallelism preamble prepended to every parent agent's
 * persona. Same intent as SUBAGENT_PREAMBLE in subagent-tools.ts — push the
 * LLM toward emitting multiple tool_use blocks in a single assistant turn
 * when the next moves are independent. Particularly important for agents
 * whose tool palette is dominated by subagents (each subagent call is a full
 * nested LLM run, so serial dispatch costs scale linearly with the number of
 * calls).
 *
 * Kept short so it doesn't eat the user's persona budget.
 */
const PARENT_PARALLELISM_PREAMBLE = [
  "## Tool-use Operating Principles",
  "",
  "**Parallel tool calls.** When you decide your next move requires multiple tool calls AND those calls are independent (one's input does not need another's output), emit ALL of them in ONE assistant turn (multiple tool_use blocks in the same response). They will run concurrently. Sequential one-tool-per-turn dispatch multiplies wall-clock latency for no benefit. Examples:",
  "- Looking something up in TWO different sources → emit both tool_use blocks in the same turn",
  "- Searching with two different queries to triangulate → both queries in one turn",
  "- Querying a subagent for one thing AND fetching a ticket for another → both at once",
  "",
  "Only chain sequentially when a later call genuinely needs an earlier call's result.",
  "",
  "**Subagent batching.** Any tool whose description starts with `[Subagent — nested LLM run, expensive]` runs a full nested LLM loop and typically takes 20-60 seconds — much slower than a direct MCP tool. Therefore:",
  "- Prefer ONE well-scoped subagent question covering everything you need over 3-4 narrower follow-ups.",
  "- If you genuinely need multiple subagent calls, fire them in the SAME assistant turn (per the parallelism rule above) — never one-at-a-time across turns.",
  "- For a narrow, factual lookup, check whether a direct (non-`[Subagent ...]`) tool can answer it before reaching for the subagent.",
  "- **Background.** If a subagent call exposes a `run_in_background` option, set it when the work is slow AND independent of your immediate next step: you get an instant acknowledgement and keep working, and its result is delivered back to you automatically before you finish. Do NOT wait or poll for it. Use blocking (leave it unset) when you need the result to decide your very next move.",
  "",
  "---",
  "",
].join("\n");

function buildUserDetails(userId: string, userName?: string, userEmail?: string): string {
  const lines = [
    "## Current User",
    `- **Name:** ${userName ?? "unknown"}`,
  ];
  if (userEmail) lines.push(`- **Email:** ${userEmail}`);
  lines.push("", "To get your Spaces user ID for filtering tools (assignedTo, from, createdBy), call the `spaces-whoami` tool first.");
  return lines.join("\n");
}

export interface CopilotConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** "low" | "medium" | "high" — reasoning effort, only meaningful for reasoning-capable models. Falls back to provider default when undefined. */
  reasoningEffort?: string;
}

export interface ClaudeConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** "api_key" (default, uses x-api-key header) | "oauth_token" (claude setup-token, uses Authorization: Bearer). */
  authType?: string;
  /** "low" | "medium" | "high" — reasoning effort, only meaningful for reasoning-capable models. Falls back to provider default when undefined. */
  reasoningEffort?: string;
}

export interface CodexConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** "api_key" (default — Platform /v1/chat/completions) | "oauth_token" (ChatGPT backend Codex /responses, same path the Codex CLI uses). */
  authType?: string;
  /** "low" | "medium" | "high" — reasoning effort, only meaningful for gpt-5.x / o-series. Falls back to provider default when undefined. */
  reasoningEffort?: string;
}

/**
 * Applies the local Copilot proxy to a provider config (copilot only).
 * Returns the config rewritten to point at the proxy URL, or the original if non-copilot / proxy unavailable.
 */
export async function applyCopilotProxyIfNeeded<T extends { apiKey: string; model: string; baseUrl?: string }>(
  provider: string | undefined,
  config: T | undefined,
): Promise<T | undefined> {
  if (provider !== "copilot" || !config?.apiKey) return config;
  try {
    const { getOrCreateCopilotProxy } = await import("./copilot-proxy.js");
    const proxyUrl = await getOrCreateCopilotProxy(config.apiKey);
    return { ...config, apiKey: "none", baseUrl: proxyUrl };
  } catch (err) {
    log.error("[agent] Copilot proxy unavailable, falling back to direct:", err instanceof Error ? err.message : err);
    return config;
  }
}

// ── Tool-output guard ────────────────────────────────────────────────────────
// A single tool call (sandbox grep/read returning tens of thousands of tokens)
// can blow the model's context window in one shot, before compaction gets a
// chance to run — the synthesis turn then overflows and the provider returns an
// EMPTY completion (observed: euler/codex runs going silent after a heavy
// investigation). Sandbox/custom tools take the customTools path, so pi's
// built-in over-large-output promotion never sees them (mcp.ts already applies
// the same fix to MCP tools). We reuse that spill-to-file logic (tool-output.ts):
// oversized output is written to .context/tool-results/ and the model gets a
// preview + path, so NOTHING is lost — it reads/greps the file on demand.
/**
 * Wrap each custom tool's execute() so its returned text content is sanitized
 * (NUL/control stripped) and, when oversized, spilled to a file with a preview
 * + path left inline. Image blocks pass through untouched. Single choke point:
 * sandbox tools are parent-direct hoisted into customTools (run.ts), so this
 * catches the heavy-investigation bloat path.
 */
export function capCustomToolOutput(tools: ToolDefinition[], outputBaseDir: string): ToolDefinition[] {
  return tools.map((tool) => {
    const orig = tool.execute.bind(tool);
    const wrapped: ToolDefinition["execute"] = async (...args) => {
      const result = await orig(...args);
      const content = (result as { content?: unknown })?.content;
      if (Array.isArray(content)) {
        const mapped = await Promise.all(content.map(async (block) => {
          const b = block as { type?: string; text?: string };
          if (b && b.type === "text" && typeof b.text === "string") {
            return { ...b, text: await promoteIfOversized(outputBaseDir, "custom", tool.name, b.text) };
          }
          return block;
        }));
        (result as { content: unknown[] }).content = mapped;
      }
      return result;
    };
    return { ...tool, execute: wrapped };
  });
}

/**
 * Wrap each tool's execute() so its text result is chunked and prefixed with
 * inline `[clf-<toolCallId>#n]` citation tokens (and a generic citation per
 * chunk) — gated on the agent's `autoToolCitations` flag. This is the OUTERMOST
 * wrap (applied to the fully-assembled customTools list AFTER capCustomToolOutput),
 * so it sees each tool's final text and skips any result that already self-cites
 * (spaces/google tools), leaving the existing citation system untouched. pi's
 * uniform `execute(toolCallId, …)` contract gives us the toolCallId as the first
 * arg, so one wrapper covers every tool (scoped file, MCP, sandbox).
 */
export function wrapAutoCitations(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map((tool) => {
    const orig = tool.execute.bind(tool);
    const wrapped: ToolDefinition["execute"] = async (...args) => {
      const result = await orig(...args);
      const toolCallId = typeof args[0] === "string" ? args[0] : undefined;
      if (!toolCallId) return result;
      const content = (result as { content?: unknown })?.content;
      if (!Array.isArray(content)) return result;
      let changed = false;
      const mapped = content.map((block) => {
        const b = block as { type?: string; text?: string };
        if (b && b.type === "text" && typeof b.text === "string") {
          const next = applyAutoCitations(b.text, toolCallId, tool.name);
          if (next !== b.text) {
            changed = true;
            return { ...b, text: next };
          }
        }
        return block;
      });
      if (changed) (result as { content: unknown[] }).content = mapped;
      return result;
    };
    return { ...tool, execute: wrapped };
  });
}

// Library-maintained model → contextWindow table (pi-ai ships real values for
// every known model). Built once from getBuiltinProviders()/getBuiltinModels()
// (pi-ai's static generated catalog — no auth/network needed) so we don't
// hand-maintain windows. Setting a window HIGHER than the model's true limit is
// what causes empty completions — compaction fires at ~85% of the configured
// window, so a too-high value lets the synthesis turn overflow and the provider
// returns nothing. Unknown/custom models fall back to a conservative default
// (early compaction is cheap; overflow is a silent failure).
const MODEL_CONTEXT_WINDOWS: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  try {
    for (const provider of getBuiltinProviders()) {
      for (const model of getBuiltinModels(provider)) {
        const m = model as { id?: string; contextWindow?: number };
        if (m.id && typeof m.contextWindow === "number" && m.contextWindow > 0) {
          map.set(m.id.toLowerCase(), m.contextWindow);
        }
      }
    }
  } catch { /* registry unavailable — every lookup uses the default */ }
  return map;
})();

export function contextWindowFor(modelId: string | undefined): number {
  const id = (modelId ?? "").toLowerCase();
  return MODEL_CONTEXT_WINDOWS.get(id)
    ?? Number(process.env["XYNE_CLAW_DEFAULT_CONTEXT_WINDOW"] ?? 128_000);
}

export function resolveModel(
  modelRegistry: ModelRegistry,
  provider?: string,
  providerConfig?: CopilotConfig | ClaudeConfig | CodexConfig,
  // Per-agent overrides (agentConfig.modelSettings). `model` only applies to
  // the default LiteLLM branch — provider branches already receive an
  // overridden providerConfig.model from runTask. `maxTokens` applies to all.
  // `litellmApiKey` swaps the platform key on the default LiteLLM branch only
  // (automation/scheduled runs use the low-priority automation key).
  overrides?: { model?: string | undefined; maxTokens?: number | undefined; litellmApiKey?: string | undefined },
) {
  const maxTokens = overrides?.maxTokens ?? 16384;
  if (provider === "copilot" && providerConfig?.apiKey) {
    // Copilot mode: use user's own API key.
    //
    // Copilot exposes THREE endpoints; the right one depends on the model:
    //
    //   /v1/messages        — Anthropic-native shim (Claude family)
    //                         Full thinking-block support. Opencode uses this
    //                         path for all claude-* models. Targeted via
    //                         pi-ai's "anthropic-messages" adapter.
    //
    //   /v1/responses       — OpenAI reasoning (gpt-5.x, o-series, codex)
    //                         Required for tools+reasoning_effort. Targeted
    //                         via pi-ai's "openai-responses" adapter.
    //
    //   /v1/chat/completions — OpenAI-compat fallback (gpt-4*, others)
    //                         Targeted via "openai-completions" adapter.
    //
    // Why each model needs a specific endpoint:
    //   - Claude on /chat/completions: Copilot translates OpenAI→Anthropic
    //     and breaks on thinking, returning a fabricated "Invalid signature
    //     in thinking block" 400.
    //   - Claude on /responses: rejected outright ("model does not support
    //     Responses API").
    //   - gpt-5.x on /chat/completions: rejected when tools+reasoning
    //     ("Please use /v1/responses instead").
    const isClaudeViaCopilot = /^claude-/i.test(providerConfig.model);
    const isOpenAiReasoning = /^(o\d|gpt-5|codex)/i.test(providerConfig.model);
    const isReasoning = isClaudeViaCopilot || isOpenAiReasoning;
    const apiAdapter: "openai-completions" | "openai-responses" | "anthropic-messages" =
      isClaudeViaCopilot ? "anthropic-messages"
      : isOpenAiReasoning ? "openai-responses"
      : "openai-completions";

    const providerName = "copilot-user";
    modelRegistry.registerProvider(providerName, {
      baseUrl: providerConfig.baseUrl || "https://api.openai.com/v1",
      apiKey: providerConfig.apiKey,
      api: apiAdapter,
      authHeader: true,
      models: [
        {
          id: providerConfig.model,
          name: providerConfig.model,
          reasoning: isReasoning,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: contextWindowFor(providerConfig.model),
          maxTokens,
        },
      ],
    });

    const model = modelRegistry.find(providerName, providerConfig.model);
    if (!model) {
      throw new Error(`Failed to register copilot model "${providerConfig.model}" at ${providerConfig.baseUrl ?? "openai"}`);
    }
    log.info(`[agent] Using copilot model: ${providerConfig.model} (api=${apiAdapter}${isReasoning ? ", reasoning" : ""})`);
    return model;
  }

  if (provider === "codex" && providerConfig?.apiKey) {
    const codexCfg = providerConfig as CodexConfig;
    const isOauth = codexCfg.authType === "oauth_token";
    const isReasoning = /^(o\d|gpt-5|codex)/i.test(codexCfg.model);
    // OAuth tokens are scoped to chatgpt.com/backend-api/codex/* — they CAN'T
    // call Platform's /v1/chat/completions. Route them through pi-ai's
    // openai-codex-responses provider, which targets /backend-api/codex/responses
    // with the same headers the Codex CLI sends (originator, ChatGPT-Account-Id,
    // OpenAI-Beta=responses=experimental).
    const providerName = isOauth ? "openai-codex-user" : "openai-user";
    if (isOauth) {
      // OAuth tokens are only valid on the ChatGPT backend — ignore any
      // baseUrl carried over from a previous API-key setup (e.g. /v1 default).
      modelRegistry.registerProvider(providerName, {
        baseUrl: "https://chatgpt.com/backend-api",
        apiKey: codexCfg.apiKey,
        api: "openai-codex-responses",
        authHeader: true,
        models: [
          {
            id: codexCfg.model,
            name: codexCfg.model,
            reasoning: isReasoning,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: contextWindowFor(codexCfg.model),
            maxTokens,
          },
        ],
      });
    } else {
      modelRegistry.registerProvider(providerName, {
        baseUrl: codexCfg.baseUrl || "https://api.openai.com/v1",
        apiKey: codexCfg.apiKey,
        api: "openai-completions",
        authHeader: true,
        models: [
          {
            id: codexCfg.model,
            name: codexCfg.model,
            reasoning: isReasoning,
            input: ["text", "image"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: contextWindowFor(codexCfg.model),
            maxTokens,
          },
        ],
      });
    }
    const model = modelRegistry.find(providerName, codexCfg.model);
    if (!model) throw new Error(`Failed to register OpenAI model "${codexCfg.model}" at ${codexCfg.baseUrl ?? (isOauth ? "chatgpt.com/backend-api" : "openai")}`);
    log.info(`[agent] Using OpenAI (codex${isOauth ? " oauth" : ""}) model: ${codexCfg.model}${isReasoning ? " (reasoning)" : ""}`);
    return model;
  }

  if (provider === "claude" && providerConfig?.apiKey) {
    const isOauthToken = (providerConfig as ClaudeConfig).authType === "oauth_token";
    const providerName = "anthropic-user";
    modelRegistry.registerProvider(providerName, {
      baseUrl: providerConfig.baseUrl || "https://api.anthropic.com",
      apiKey: providerConfig.apiKey,
      api: "anthropic-messages",
      // api_key → x-api-key (authHeader: false). oauth_token → Authorization: Bearer (authHeader: true).
      authHeader: isOauthToken,
      models: [
        {
          id: providerConfig.model,
          name: providerConfig.model,
          reasoning: true,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: contextWindowFor(providerConfig.model),
          maxTokens,
        },
      ],
    });
    const model = modelRegistry.find(providerName, providerConfig.model);
    if (!model) {
      throw new Error(`Failed to register Claude model "${providerConfig.model}" at ${providerConfig.baseUrl ?? "anthropic"}`);
    }
    log.info(`[agent] Using Claude model: ${providerConfig.model} (${isOauthToken ? "oauth_token" : "api_key"}, reasoning)`);
    return model;
  }

  if (provider === "litellm" && providerConfig?.apiKey) {
    // User-supplied LiteLLM key + model (agent-level "litellm" credential). The
    // model was chosen from a dropdown populated by THIS key's /v1/models, so
    // it's guaranteed accessible on whatever proxy the credential targets.
    // Registered under its own provider name so it never collides with the
    // platform-key "litellm" terminal fallback below (different key/baseUrl/
    // model). baseUrl falls back to the platform proxy when the credential
    // omits it (i.e. the user's key lives on the platform proxy). LiteLLM is
    // OpenAI-compatible → openai-completions adapter, Bearer auth.
    const providerName = "litellm-user";
    const baseUrl = providerConfig.baseUrl || LITELLM.url;
    modelRegistry.registerProvider(providerName, {
      baseUrl,
      apiKey: providerConfig.apiKey,
      api: "openai-completions",
      authHeader: true,
      models: [
        {
          id: providerConfig.model,
          name: providerConfig.model,
          reasoning: false,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: contextWindowFor(providerConfig.model),
          maxTokens,
        },
      ],
    });
    const model = modelRegistry.find(providerName, providerConfig.model);
    if (!model) {
      throw new Error(`Failed to register LiteLLM model "${providerConfig.model}" at ${baseUrl}`);
    }
    log.info(`[agent] Using user LiteLLM model: ${providerConfig.model} at ${baseUrl}`);
    return model;
  }

  // Default: shared LiteLLM proxy
  const litellmModel = overrides?.model ?? LITELLM.model;
  modelRegistry.registerProvider("litellm", {
    baseUrl: LITELLM.url,
    apiKey: overrides?.litellmApiKey || LITELLM.apiKey,
    api: "openai-completions",
    authHeader: true,
    models: [
      {
        id: litellmModel,
        name: litellmModel,
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: contextWindowFor(litellmModel),
        maxTokens,
      },
    ],
  });

  const model = modelRegistry.find("litellm", litellmModel);
  if (!model) {
    throw new Error(`Failed to register LiteLLM model "${litellmModel}" at ${LITELLM.url}`);
  }
  if (overrides?.model) {
    log.info(`[agent] Using per-agent model override on LiteLLM: ${litellmModel}`);
  }
  return model;
}

// ── Progress reporter — throttled to one update per 10 seconds ─────────────

const PROGRESS_THROTTLE_MS = 10_000;

// Same-label keep-alive cadence, decoupled from the label-change throttle.
// Re-sending the identical label is pure heartbeat (it bumps Control Center's
// currentToolLabel timestamp and keeps the Spaces ephemeral spinner alive) —
// it carries no new information. At the old 10s cadence a single slow tool
// produced 60+ identical S2S POSTs per long run (prod 2026-06-11: top runs
// 67/63/61 sends, ~7.9k POSTs per 6h fleet-wide). 60s keeps the liveness
// semantics with ~6× less traffic. Env-tunable for rollback.
const PROGRESS_KEEPALIVE_MS = Number(process.env["PROGRESS_KEEPALIVE_MS"] ?? 60_000);

// ── Progress destination abstraction ────────────────────────────────────────
//
// The progressUrl parameter widens to `ProgressDest = string | ProgressEmitter`.
// When it's a string (the historical path), we still fire-and-forget HTTP POSTs
// per chunk — every webhook/agent-chat consumer of claw is unchanged. When it's
// an emitter, we hand the event off in-process; the route handler in run.ts
// uses this to write SSE frames into a long-lived response. The SSE path lives
// or dies with that single response stream, so order is preserved by TCP and
// the burst of N HTTP requests per chunk goes away for SSE consumers.
//
// Implementations live next to the route they belong to:
//   - HTTP POST → no implementation, the URL itself is the destination.
//   - SSE       → see makeSseProgressEmitter() in routes/run.ts.

export interface ProgressEmitter {
  invocation(sessionId: string, invocation: unknown): void;
  attachment(sessionId: string, attachment: ClawAttachmentPayload): void;
  sandboxPreview(sessionId: string, payload: ClawSandboxPreviewPayload, meta?: ClawStreamMeta): void;
  plan(sessionId: string, todos: Todo[]): void;
  /** A create/merge pull-request tool completed — carries the canonical PR fact
   *  for the Spaces PR card (mirrors `plan`; consumer bridges it to a kind:"pr"
   *  progress POST → renderPrCard). */
  pr(sessionId: string, pr: Record<string, unknown>): void;
  streamChunk(sessionId: string, payload: { reasoningDelta?: string; textDelta?: string }): void;
  debugProgress(sessionId: string, event: DebugEventRecord): void;
  progressLabel(sessionId: string, toolLabel: string, meta?: ClawStreamMeta): void;
  /** Final result frame. Returns once flushed so the route handler can close
   *  the response immediately after. SSE impl writes `event: done`; HTTP impl
   *  POSTs to callbackUrl. */
  done(sessionId: string, payload: Record<string, unknown>): Promise<void>;
}

export type ProgressDest = string | ProgressEmitter | undefined;

function isEmitter(dest: ProgressDest): dest is ProgressEmitter {
  return !!dest && typeof dest !== "string";
}

// ── PR card interception ────────────────────────────────────────────────────
// When a github/bitbucket/gitlab create/merge pull-request tool completes,
// normalize the provider-specific result into a canonical, provider-neutral PR
// fact and fire a kind:"pr" progress event so claw-auth renders (and later
// updates in place) the PR card in the Spaces thread. This lives in
// pushInvocation — the ONE choke point every tool_execution_end flows through,
// parent tools AND nested subagent child tools — so a PR card is emitted whether
// create_pull_request runs directly in the parent or inside the git-host
// subagent. Fire-and-forget: PR card rendering must NEVER block or fail a tool.
// Only the URL/webhook progress path carries the card; SSE (emitter) mode has no
// such surface, so we skip there (mirrors the plan card).

type PrProviderName = "github" | "bitbucket" | "gitlab" | "other";

// Inner tool name (after any `<server>__` prefix, hyphens→underscores) → status.
const PR_TOOL_STATUS: Record<string, "created" | "merged"> = {
  create_pull_request: "created",
  merge_pull_request: "merged",
};

function detectPrProvider(server: string): PrProviderName {
  const s = server.toLowerCase();
  if (s.includes("github")) return "github";
  if (s.includes("bitbucket")) return "bitbucket";
  if (s.includes("gitlab")) return "gitlab";
  return "other";
}

/** First non-empty trimmed string among the args. */
function firstPrStr(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/**
 * Unwrap a tool result into the object that actually holds PR fields. Handles:
 *   - the MCP envelope `{ content: [{ type:'text', text:'<json>' }] }` (parse the
 *     inner text as JSON), and
 *   - a nested `pull_request` / `pullRequest` / `pr` wrapper (Bitbucket's
 *     create_pull_request returns `{ message, pull_request: { id, web_url, … } }`).
 * Returns the innermost object to read url/number/title from, or undefined.
 */
function resolvePrPayload(text: string): Record<string, unknown> | undefined {
  const parse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      // Tolerate a leading token (e.g. a citation marker "[clf-…#1] {…}") by
      // reparsing from the first brace.
      const brace = s.indexOf("{");
      if (brace > 0) {
        try {
          return JSON.parse(s.slice(brace));
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
  };
  const obj = parse(text);
  if (!obj || typeof obj !== "object") return undefined;
  let rec = obj as Record<string, unknown>;
  // MCP text envelope → parse the inner JSON payload.
  const content = rec["content"];
  if (Array.isArray(content)) {
    const inner = content
      .filter((c): c is { text?: string } => !!c && typeof c === "object" && (c as { type?: string }).type === "text")
      .map((c) => c.text ?? "")
      .join("");
    if (inner) {
      try {
        const parsed = JSON.parse(inner);
        if (parsed && typeof parsed === "object") rec = parsed as Record<string, unknown>;
      } catch {
        /* inner wasn't JSON — keep the outer object */
      }
    }
  }
  // Descend into a nested PR wrapper when present.
  for (const key of ["pull_request", "pullRequest", "pullrequest", "pr"]) {
    const nested = rec[key];
    if (nested && typeof nested === "object") return nested as Record<string, unknown>;
  }
  return rec;
}

/** Pull the PR URL from the resolved payload, else scrape one from raw text. */
function extractPrUrl(obj: Record<string, unknown> | undefined, text: string): string | undefined {
  if (obj) {
    const links = obj["links"] as Record<string, unknown> | undefined;
    const self = links?.["self"];
    const selfHref = Array.isArray(self)
      ? (self[0] as Record<string, unknown> | undefined)?.["href"]
      : (self as Record<string, unknown> | undefined)?.["href"];
    const html = links?.["html"] as Record<string, unknown> | undefined;
    const u = firstPrStr(obj["web_url"], obj["html_url"], obj["url"], selfHref, html?.["href"]);
    if (u) return u;
  }
  // Prefer a PR-shaped URL (Bitbucket /pull-requests/N, GitHub /pull/N, GitLab
  // /merge_requests/N); fall back to any URL in the text.
  const pr = text.match(
    /https?:\/\/[^\s"')\]]*(?:pull-?requests?|\/pull\/|merge_requests)[^\s"')\]]*/i,
  );
  if (pr) return pr[0];
  return text.match(/https?:\/\/[^\s"')\]]+/i)?.[0];
}

function maybeEmitPrCard(progressUrl: ProgressDest, sessionId: string, invocation: unknown): void {
  try {
    const inv = (invocation ?? {}) as {
      toolName?: unknown;
      args?: unknown;
      result?: unknown;
      isError?: unknown;
    };
    const toolName = typeof inv.toolName === "string" ? inv.toolName : "";
    if (!toolName) return;

    // Strip any `<server>__` prefix; normalize hyphen/underscore naming variants.
    const bare = (toolName.includes("__") ? toolName.slice(toolName.indexOf("__") + 2) : toolName)
      .toLowerCase()
      .replace(/-/g, "_");
    const status = PR_TOOL_STATUS[bare];
    // Not a create/merge PR tool — stay silent (this runs for EVERY tool).
    if (!status) return;

    // From here we KNOW it's a PR tool → log every decision so a missing card is
    // traceable end-to-end.
    if (inv.isError === true) {
      log.info(`[pr-card] ${toolName} ended with isError=true — no card emitted`);
      return;
    }
    if (!progressUrl) {
      log.info(`[pr-card] ${toolName} detected but no progressUrl — skipping`);
      return;
    }

    const provider = detectPrProvider(toolName);
    const a = (inv.args ?? {}) as Record<string, unknown>;

    const text =
      typeof inv.result === "string"
        ? inv.result
        : (() => {
            try {
              return JSON.stringify(inv.result);
            } catch {
              return String(inv.result);
            }
          })();
    if (!text) {
      log.warn(`[pr-card] ${toolName} had empty result — skipping`);
      return;
    }
    const payload = resolvePrPayload(text);

    const url = extractPrUrl(payload, text);
    const number = firstPrStr(payload?.["id"], payload?.["number"], payload?.["iid"]);
    // Require evidence the op actually produced a PR before emitting a card.
    if (!url && !number) {
      log.warn(
        `[pr-card] ${toolName}: could not extract url/number from result — skipping. ` +
          `payloadKeys=[${payload ? Object.keys(payload).join(",") : "<unparsed>"}] preview=${text.slice(0, 300)}`,
      );
      return;
    }

    const title =
      firstPrStr(payload?.["title"], a["title"], a["ticketTitle"]) ?? "Pull request";
    const desc = firstPrStr(payload?.["description"], payload?.["body"], a["description"], a["ticketDescription"]);
    const ticketId = firstPrStr(a["xyneId"], a["ticketId"]);
    const repo = firstPrStr(
      a["workspace"] && a["repository"] ? `${String(a["workspace"])}/${String(a["repository"])}` : undefined,
      a["projectKey"] && a["repoSlug"] ? `${String(a["projectKey"])}/${String(a["repoSlug"])}` : undefined,
      a["owner"] && a["repo"] ? `${String(a["owner"])}/${String(a["repo"])}` : undefined,
      a["repoName"],
      a["repoSlug"],
      a["repository"],
      a["repo"],
    );

    const pr: Record<string, unknown> = {
      provider,
      status,
      title,
      ...(url ? { url } : {}),
      ...(desc ? { desc } : {}),
      ...(ticketId ? { ticketId } : {}),
      ...(number ? { number } : {}),
      ...(repo ? { repo } : {}),
    };

    // Dispatch on the progress channel type. SSE/streaming runs (spaces threads
    // go through claw-auth's SSE bridge, and the dashboard chat) carry an
    // EMITTER: hand the fact to `emitter.pr()`, which frames a `pr` SSE event
    // that the bridge translates into a kind:"pr" progress POST → renderPrCard.
    // Legacy HTTP runs carry a string webhook URL: POST kind:"pr" directly.
    if (typeof progressUrl !== "string") {
      log.info(
        `[pr-card] emitting kind:pr via emitter sessionId=${sessionId} ` +
          `provider=${provider} status=${status} number=${number ?? "?"} repo=${repo ?? "?"} url=${url ?? "?"}`,
      );
      try {
        progressUrl.pr(sessionId, pr);
      } catch (err) {
        log.warn(`[pr-card] emitter.pr failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    log.info(
      `[pr-card] emitting kind:pr → ${progressUrl} sessionId=${sessionId} ` +
        `provider=${provider} status=${status} number=${number ?? "?"} repo=${repo ?? "?"} url=${url ?? "?"}`,
    );
    void fetch(progressUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
      },
      body: JSON.stringify({ sessionId, kind: "pr", pr }),
      signal: AbortSignal.timeout(5_000),
    })
      .then((r) => {
        if (r.ok) log.info(`[pr-card] posted kind:pr OK (${r.status}) sessionId=${sessionId}`);
        else log.warn(`[pr-card] webhook responded ${r.status} for kind:pr sessionId=${sessionId}`);
      })
      .catch((err) => {
        log.warn(`[pr-card] push failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  } catch (err) {
    // Fire-and-forget: PR-card rendering must never affect tool execution.
    log.warn(`[pr-card] unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Send a single tool invocation to the progress endpoint — NOT throttled,
// fires on every tool_execution_end so the Control Center sees live tool streams.
export function pushInvocation(progressUrl: ProgressDest, sessionId: string, invocation: unknown): void {
  if (!progressUrl) return;
  // Emit a PR card when this invocation is a completed create/merge PR (guards
  // internally; no-op for every other tool). Runs for parent + nested tools.
  maybeEmitPrCard(progressUrl, sessionId, invocation);
  if (isEmitter(progressUrl)) {
    try { progressUrl.invocation(sessionId, invocation); } catch (err) {
      log.warn(`[agent] Tool invocation emit failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  // Capture identifying fields up-front so the failure log below can name
  // which tool's push dropped, not just "something".
  const inv = invocation as { toolCallId?: string; toolName?: string };
  fetch(progressUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
    },
    body: JSON.stringify({ sessionId, toolInvocation: invocation }),
    signal: AbortSignal.timeout(5_000),
  }).catch((err) => {
    log.warn(
      `[agent] Tool invocation push failed: toolCallId=${inv.toolCallId ?? "?"} ` +
      `tool=${inv.toolName ?? "?"} err=${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

// Stream a single attachment (e.g. a PPTX produced by create-ppt) to the progress endpoint
// the moment it's captured — so the UI can render it mid-session instead of waiting for finalize.
export function pushAttachment(
  progressUrl: ProgressDest,
  sessionId: string,
  attachment: { fileName: string; mimeType: string; data: string; metadata?: Record<string, unknown> },
): void {
  if (!progressUrl) return;
  if (isEmitter(progressUrl)) {
    try { progressUrl.attachment(sessionId, attachment); } catch (err) {
      log.warn(`[agent] Attachment emit failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  fetch(progressUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
    },
    body: JSON.stringify({ sessionId, attachment }),
    signal: AbortSignal.timeout(15_000),
  }).catch((err) => {
    log.warn(`[agent] Attachment push failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

// One-shot announce of the noVNC preview URL the first time a sandbox session
// is acquired in this run. claw-auth posts it as a clickable link into the
// originating Spaces channel so the user can watch chromium-B live.
export function pushSandboxPreview(
  progressUrl: ProgressDest,
  sessionId: string,
  payload: { sandboxId: string; sandboxPreviewUrl: string; sandboxCodePreviewUrl: string },
  progressMeta?: { conversationId?: string | null; agentSlug?: string | null },
): void {
  if (!progressUrl) return;
  if (isEmitter(progressUrl)) {
    const meta: ClawStreamMeta = {};
    if (progressMeta?.conversationId !== undefined) meta.conversationId = progressMeta.conversationId;
    if (progressMeta?.agentSlug !== undefined) meta.agentSlug = progressMeta.agentSlug;
    try { progressUrl.sandboxPreview(sessionId, { ...payload, ...meta }, meta); } catch (err) {
      log.warn(`[agent] Sandbox preview emit failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  fetch(progressUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
    },
    body: JSON.stringify({
      sessionId,
      ...payload,
      ...(progressMeta?.conversationId ? { conversationId: progressMeta.conversationId } : {}),
      ...(progressMeta?.agentSlug ? { agentSlug: progressMeta.agentSlug } : {}),
    }),
    signal: AbortSignal.timeout(5_000),
  }).catch((err) => {
    log.warn(`[agent] Sandbox preview push failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

// Stream raw text fragments (reasoning deltas, assistant text deltas) to the progress endpoint.
// These are fired on every pi-ai text_delta / thinking_delta event — high-frequency, keep it lean.
function pushStreamChunk(
  progressUrl: ProgressDest,
  sessionId: string,
  payload: { reasoningDelta?: string; textDelta?: string },
): void {
  if (!progressUrl) return;
  if (isEmitter(progressUrl)) {
    try { progressUrl.streamChunk(sessionId, payload); } catch {
      // Best-effort — don't spam logs on every chunk
    }
    return;
  }
  fetch(progressUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
    },
    body: JSON.stringify({ sessionId, ...payload }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {
    // Best-effort — don't spam logs on every chunk
  });
}

export function pushDebugProgress(
  progressUrl: ProgressDest,
  sessionId: string,
  event: DebugEventRecord,
): void {
  if (!progressUrl) return;
  if (isEmitter(progressUrl)) {
    try { progressUrl.debugProgress(sessionId, event); } catch {
      // best-effort live debug
    }
    return;
  }
  fetch(progressUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
    },
    body: JSON.stringify({ sessionId, debugEvent: event }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {
    // best-effort live debug
  });
}

interface ProgressReporter {
  (toolLabel: string): void;
  stop: () => void;
}

function createProgressReporter(
  progressUrl: ProgressDest,
  sessionId: string,
  progressMeta?: { conversationId?: string | null; agentSlug?: string | null },
): ProgressReporter {
  if (!progressUrl) {
    log.info(`[agent] Progress reporter: no progressUrl, skipping`);
    const noop = ((_: string) => {}) as ProgressReporter;
    noop.stop = () => {};
    return noop;
  }
  const dest = progressUrl;
  log.info(`[agent] Progress reporter: enabled → ${isEmitter(dest) ? "in-process emitter" : dest} (sessionId=${sessionId})`);

  let lastSentAt = 0;
  let lastLabel = "";
  let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  // Keep-alive: while a long-running tool hasn't emitted a new start event,
  // re-fire the last label every PROGRESS_THROTTLE_MS so the dashboard's stale
  // timer + Redis TTL stay fresh. Cleared on stop() or whenever a new label arrives.
  let keepAliveTimer: ReturnType<typeof setTimeout> | null = null;

  function send(toolLabel: string): void {
    if (isEmitter(dest)) {
      const meta: ClawStreamMeta = {};
      if (progressMeta?.conversationId !== undefined) meta.conversationId = progressMeta.conversationId;
      if (progressMeta?.agentSlug !== undefined) meta.agentSlug = progressMeta.agentSlug;
      try { dest.progressLabel(sessionId, toolLabel, meta); } catch (err) {
        log.warn(`[agent] Progress label emit failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    log.info(`[agent] Progress send: "${toolLabel}" → ${dest}`);
    fetch(dest, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
      },
      body: JSON.stringify({
        sessionId,
        toolLabel,
        ...(progressMeta?.conversationId ? { conversationId: progressMeta.conversationId } : {}),
        ...(progressMeta?.agentSlug ? { agentSlug: progressMeta.agentSlug } : {}),
      }),
      signal: AbortSignal.timeout(5_000),
    }).then((res) => {
      log.info(`[agent] Progress response: ${res.status}`);
    }).catch((err) => {
      log.warn(`[agent] Progress update failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  function scheduleKeepAlive(label: string): void {
    if (keepAliveTimer !== null) clearTimeout(keepAliveTimer);
    keepAliveTimer = setTimeout(() => {
      keepAliveTimer = null;
      // Re-send the same label — acts as a heartbeat. Updates lastSentAt and
      // chains the next keep-alive, so it keeps firing until a new label arrives
      // or stop() is called. Runs at the slower PROGRESS_KEEPALIVE_MS cadence:
      // identical-label re-sends are liveness only, not information.
      lastSentAt = Date.now();
      send(label);
      scheduleKeepAlive(label);
    }, PROGRESS_KEEPALIVE_MS);
  }

  const reporter = ((toolLabel: string): void => {
    const now = Date.now();
    // Skip same-label re-sends within the KEEP-ALIVE window (not the 10s label
    // throttle): an identical label carries no new information, and the chained
    // keep-alive below already provides the liveness bump. Only a label CHANGE
    // deserves the fast 10s path.
    if (toolLabel === lastLabel && now - lastSentAt < PROGRESS_KEEPALIVE_MS) return;
    if (now - lastSentAt >= PROGRESS_THROTTLE_MS) {
      // Send immediately — enough time has passed
      if (pendingTimeout !== null) {
        clearTimeout(pendingTimeout);
        pendingTimeout = null;
      }
      lastSentAt = now;
      lastLabel = toolLabel;
      send(toolLabel);
      scheduleKeepAlive(toolLabel);
    } else {
      // Schedule a deferred send so the last tool in a burst still fires
      if (pendingTimeout !== null) clearTimeout(pendingTimeout);
      const delay = PROGRESS_THROTTLE_MS - (now - lastSentAt);
      pendingTimeout = setTimeout(() => {
        pendingTimeout = null;
        lastSentAt = Date.now();
        lastLabel = toolLabel;
        send(toolLabel);
        scheduleKeepAlive(toolLabel);
      }, delay);
    }
  }) as ProgressReporter;

  reporter.stop = (): void => {
    if (pendingTimeout !== null) { clearTimeout(pendingTimeout); pendingTimeout = null; }
    if (keepAliveTimer !== null) { clearTimeout(keepAliveTimer); keepAliveTimer = null; }
  };

  return reporter;
}

export type ImageContent = { type: "image"; data: string; mimeType: string };
export type FileAttachmentContent = { fileName: string; mimeType: string; path: string };

export interface PromptInjection {
  id: string;
  label: string;
  content: string;
}

/**
 * Inputs to {@link runTask}. Single options object instead of ~20 positional
 * params — adding/reordering a field can no longer silently mis-thread a call.
 */
export interface RunTaskOptions {
  userId: string;
  task: string;
  /** Automation/scheduled run — the default LiteLLM branch uses the
   *  low-priority automation key so batch load never queues human mentions. */
  automationRun?: boolean | undefined;
  // Optional fields use `| undefined` (not bare `?`) so call sites can pass
  // through possibly-undefined values under exactOptionalPropertyTypes.
  context?: string | undefined;
  userName?: string | undefined;
  userEmail?: string | undefined;
  customTools?: ToolDefinition[] | undefined;
  systemPromptOverride?: string | undefined;
  cwd?: string | undefined;
  /** Session key — `${userId}_${rawConversationId}_${agentSlug}` (see progressMeta). */
  conversationId?: string | undefined;
  provider?: string | undefined;
  providerConfig?: CopilotConfig | ClaudeConfig | CodexConfig | undefined;
  /** Progress destination — either a URL (legacy HTTP-POST-per-chunk path) or
   *  an in-process emitter (SSE response stream owned by the route handler).
   *  Anything outside the route handler should remain unaware of the choice. */
  progressUrl?: ProgressDest;
  sessionId?: string | undefined;
  images?: ImageContent[] | undefined;
  fileAttachments?: FileAttachmentContent[] | undefined;
  skills?: { slug?: string; name: string; description?: string; content: string; files?: { relativePath: string; content: string; contentType?: string | null }[] }[] | undefined;
  /** Trusted, package-owned skill roots for a built-in run mode. Unlike
   * session skills these are not user supplied and are not deleted at exit. */
  extraSkillPaths?: string[] | undefined;
  skillTriggers?: import("./subagent-tools.js").SkillTrigger[] | undefined;
  promptInjections?: PromptInjection[] | undefined;
  /** Task-command contract (routes/run.ts parseTaskCommand): the run may not
   *  finish until this tool has run — enforced by a post-loop nudge pass. */
  requiredTool?: { name: string; nudge: string } | undefined;
  /** Digital Twin persona (soul.md, …) folded into the actual system prompt on
   *  both the override and buildSystemPrompt-fallback paths, so it reads as
   *  identity and shows in the debug panel. */
  twinPersona?: string | undefined;
  abortSignal?: AbortSignal | undefined;
  /** Wall-clock time when the route accepted the run. Debug artifacts use this
   *  so session restore/setup time remains visible in the timeline. */
  debugStartedAt?: string | undefined;
  /** Raw Spaces conversation identity for progress callbacks. NOT the same as
   *  `conversationId` (the session key) — claw-auth's conv-keyed index uses the
   *  RAW conversationId + agentSlug, threaded separately so /webhook/progress
   *  can fall back to it when a refired run minted a fresh sessionId. */
  progressMeta?: { conversationId?: string | null; agentSlug?: string | null } | undefined;
  /** Set on a fallback attempt following an EMPTY completion: compact the
   *  resumed session before prompting the next provider so it doesn't inherit
   *  the same over-window context that produced nothing (and overflow again). */
  forceCompactBeforeRun?: boolean | undefined;
  /** verifyResponses: shared ref whose `getDigest` runTask wires to the live
   *  session transcript, so the submit-response tool can verify drafts against
   *  gathered tool results. Presence implies the tool was injected (run.ts). */
  verifyResponsesRef?: import("./verified-response.js").EvidenceRef | undefined;
  /** Per-agent model settings (agentConfig.modelSettings) — model/maxTokens go
   *  through resolveModel, thinkingLevel feeds effectiveThinking, temperature
   *  wraps the session's streamFn. See agent-model-settings.ts. */
  modelSettings?: import("./agent-model-settings.js").AgentModelSettings | undefined;
  /** Structured JSON output: shared ref the submit-result tool (injected in
   *  run.ts) writes the accepted payload to. When present, runTask nudges the
   *  model if the loop ends without a submission and returns the JSON payload
   *  as the run's final text. */
  structuredOutputRef?: import("./agent-model-settings.js").StructuredOutputRef | undefined;
  /** Digital Twin mention flow: shared ref the mandatory twin_deliver tool
   *  (injected in run.ts) writes its structured delivery into. Presence makes
   *  delivery MANDATORY — runTask runs a hardcoded reflection stage that nudges
   *  the model to call the tool and, if it never does, leaves this undefined so
   *  the caller stays silent (fail-closed) instead of posting raw assistant text. */
  twinDeliverRef?: import("./twin-deliver.js").TwinDeliverRef | undefined;
  /** Pipeline mode of this run (plan / daily_brief / auto). Debug-telemetry only —
   *  emitted in the session_tools event so the pipeline UI shows which mode a run
   *  executed in. Behavior is driven by the tool palette / prompt assembled in
   *  run.ts, not by this field. */
  mode?: "plan" | "auto" | "daily_brief" | undefined;
  /** True when this is the auto-mode execution turn dispatched right after a plan
   *  was approved (or a trivial plan auto-continued). Debug-telemetry only —
   *  emits a mode_switch (plan→auto) event at session start. */
  planContinuation?: boolean | undefined;
  /** Opt-in citation reflection (agentConfig.citationReflection). When true and
   *  the run pulled citeable sources (a tool result carried [clf-…#n] tokens)
   *  yet the final prose cites none, runTask nudges the model once to rewrite
   *  the answer with inline citations. See the post-loop block. */
  citationReflection?: boolean | undefined;
  /** Opt-in generic auto-citations (agentConfig.autoToolCitations). When true,
   *  EVERY tool result that doesn't already self-cite is chunked and prefixed
   *  with inline [clf-<toolCallId>#n] tokens (plus one generic citation per
   *  chunk), so the model can cite ANY tool's output — every MCP, sandbox, and
   *  scoped file tool. Tools that emit their own [clf-…] tokens are detected and
   *  left untouched, so the existing citation system is unaffected. */
  autoToolCitations?: boolean | undefined;
  /** Caps how many trailing non-empty assistant turns `extractFinalAnswerText`
   *  stitches into the run's final answer. Thread invocations (Spaces/Slack
   *  replies — channelId present) pass 2 to keep the posted reply a clean
   *  answer + wrap-up; ask-ai and everything else leave it undefined = keep all
   *  turns (so the stored answer matches the streamed transcript). */
  finalAnswerMaxTurns?: number | undefined;
  /** Branching: when true, the persistent session is branched from its last
   *  user entry before the run starts. Lets a regenerate replay the same user
   *  turn as a sibling assistant instead of appending after the original. The
   *  caller (claw-auth) is responsible for cloning the source session into the
   *  target session dir BEFORE /run; this flag only re-anchors the in-memory
   *  branch pointer when PI loaded a sibling-rich JSONL. */
  isRegenerate?: boolean | undefined;
  /** Per-run registry for background (run_in_background) subagents, shared with
   *  the subagent tools via SubagentProgressCtx. After the model loop settles,
   *  runTask drains it, injecting each completed subagent result back into the
   *  session so the model can incorporate it before finishing. */
  backgroundRegistry?: import("./subagent-tools.js").BackgroundSubagentRegistry | undefined;
  fastMode?: boolean | undefined;
  fastToolCatalogNames?: string[] | undefined;
  fastToolController?: FastToolRuntimeController | undefined;
  fastMaxActiveTools?: number | undefined;
  resumedFromHandoff?: boolean | undefined;
  handoff?: {
    isRequested: () => boolean;
    isCapAborted: () => boolean;
    isUserCancelled: () => boolean;
    onTurnBoundary: (lastTurn: number) => void;
  } | undefined;
}

const FAST_MODE_ACTIVE_TOOLS_CUSTOM_TYPE = "xyne.fastMode.activeToolSet";

const LOCAL_FILE_TOOL_NAMES = ["read", "write", "grep", "find", "ls"] as const;

/** Pi's global tool allowlist for the path-scoped local Claw workspace. */
export function localFileToolNames(): string[] {
  return [...LOCAL_FILE_TOOL_NAMES];
}

function latestFastModeActiveToolSet(sessionManager: SessionManager): string[] {
  const entries = sessionManager.getEntries() as SessionEntry[];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i] as SessionEntry & { customType?: string; data?: unknown };
    if (entry.type !== "custom" || entry.customType !== FAST_MODE_ACTIVE_TOOLS_CUSTOM_TYPE) continue;
    const activeToolSet = (entry.data as { activeToolSet?: unknown } | undefined)?.activeToolSet;
    if (!Array.isArray(activeToolSet)) return [];
    return activeToolSet.filter((name): name is string => typeof name === "string" && name.length > 0);
  }
  return [];
}

export async function runTask(opts: RunTaskOptions): Promise<RunResult> {
  const {
    userId,
    task,
    context,
    userName,
    userEmail,
    customTools,
    systemPromptOverride,
    cwd,
    conversationId,
    provider,
    providerConfig,
    progressUrl,
    sessionId,
    images,
    fileAttachments,
    skills,
    extraSkillPaths,
    skillTriggers,
    promptInjections,
    requiredTool,
    twinPersona,
    abortSignal,
    debugStartedAt,
    progressMeta,
    forceCompactBeforeRun,
    verifyResponsesRef,
    modelSettings,
    structuredOutputRef,
    twinDeliverRef,
    mode,
    planContinuation,
    citationReflection,
    autoToolCitations,
    isRegenerate,
    backgroundRegistry,
    fastMode,
    fastToolCatalogNames,
    fastToolController,
    fastMaxActiveTools,
    resumedFromHandoff,
    handoff,
  } = opts;
  let lastHandoffTurn = 0;
  const recordHandoffBoundary = (turn: number): void => {
    lastHandoffTurn = Math.max(lastHandoffTurn, turn);
    handoff?.onTurnBoundary(lastHandoffTurn);
  };
  const buildHandoffError = (): RunHandoffError =>
    new RunHandoffError({ lastTurn: lastHandoffTurn, aborted: handoff?.isCapAborted() === true });
  let waitForCapAbortIdle: (() => Promise<void>) | undefined;
  let sessionReadyForFinalArchive = false;
  // HA: acquire the per-conversation lock BEFORE touching the session, so two
  // pods can't restore + run the same session concurrently and corrupt the
  // JSONL. A conflict (another pod owns it) throws SessionLockedError, which
  // run.ts skips without a failure callback so the owning pod's result stands.
  // Fail-open: acquireSessionLock returns true if the lock service is down.
  if (conversationId) {
    const acquired = await acquireSessionLock(conversationId);
    if (!acquired) throw new SessionLockedError(conversationId);
    markSessionActive(conversationId);
  }
  try {
  // Freshness-aware restore (runs AFTER the conversation lock is acquired,
  // so the previous pod's flush-before-unlock is already visible in GCS):
  // pulls the session from GCS when local is missing (TTL-archived / pod
  // restart / other pod's history) OR stale (last turn ran on another pod).
  // Stale-local restore failures reject the run loudly; silently using an old
  // JSONL would fork the conversation.
  if (conversationId) {
    await ensureFreshSession(conversationId);
    sessionReadyForFinalArchive = true;
  }
  const isResume = conversationId && hasSession(conversationId);
  log.info(`[agent] ${isResume ? "Resuming" : "Starting"} task for user ${userId} (${userName ?? "unknown"}): ${task.slice(0, 100)}`);
  const workingDir = cwd ?? PATHS.dataDir;

  // Get (or start) the persistent local proxy for GitHub Copilot
  let effectiveProviderConfig = providerConfig;
  // NOTE: modelSettings.model is the Spaces/platform-default model override.
  // It deliberately does NOT touch provider credentials — premium providers
  // (claude/codex/copilot) pick their model on the credential itself. It only
  // applies when the run is served by the default LiteLLM branch, via the
  // resolveModel overrides below.
  if (provider === "copilot" && providerConfig?.apiKey) {
    try {
      const { getOrCreateCopilotProxy } = await import("./copilot-proxy.js");
      const proxyUrl = await getOrCreateCopilotProxy(providerConfig.apiKey);
      effectiveProviderConfig = { ...(effectiveProviderConfig ?? providerConfig), apiKey: "none", baseUrl: proxyUrl };
    } catch (err) {
      log.error("[agent] Failed to start copilot proxy, falling back to direct:", err instanceof Error ? err.message : err);
    }
  }

  const authStorage = AuthStorage.create();
  // Pi v0.75 made the ModelRegistry constructor private — must use the
  // static factory. `.create(authStorage)` uses the default models.json path
  // (~/.pi/agent/models.json); for in-memory use ModelRegistry.inMemory().
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = resolveModel(modelRegistry, provider, effectiveProviderConfig, {
    // Spaces default-model override — only the LiteLLM branch reads it;
    // provider-credential runs keep the model configured on the credential.
    // Precedence on the platform branch: per-agent modelSettings.model, then
    // the automation default model (batch runs), then LITELLM.model.
    model: effectiveProviderConfig
      ? undefined
      : modelSettings?.model ?? (opts.automationRun ? LITELLM.automationModel : undefined),
    maxTokens: modelSettings?.maxTokens,
    litellmApiKey: opts.automationRun ? LITELLM.automationApiKey : undefined,
  });

  // Use persistent session if conversationId provided, otherwise in-memory
  let sessionManager: SessionManager;
  if (conversationId) {
    try {
      const sessionDirPath = await ensureSessionDir(conversationId);
      if (isResume) {
        sessionManager = SessionManager.continueRecent(workingDir, sessionDirPath);
        // continueRecent NEVER fails loudly: when it finds no match it returns a
        // valid, EMPTY SessionManager, so "resuming" and "silently started over"
        // look identical from here. That cost a day of debugging when a per-run
        // cwd made its internal cwd filter miss every time (see the workspace
        // key note in routes/run.ts). Assert we actually got history back.
        const resumedEntries = sessionManager.getEntries().length;
        if (resumedEntries === 0) {
          log.error(
            `[agent] RESUME FOUND NO HISTORY for ${sessionDirPath} (cwd=${workingDir}) — ` +
              `the session dir exists but pi matched no prior session, so this turn starts ` +
              `with no context. Usually means cwd differs from the turn that created it.`,
          );
          metric.count("session_resume_empty", {});
        } else {
          log.info(
            `[agent] Resuming session in ${sessionDirPath} (cwd=${workingDir}, ${resumedEntries} entries)`,
          );
        }
      } else {
        sessionManager = SessionManager.create(workingDir, sessionDirPath);
        log.info(`[agent] Created persistent session in ${sessionDirPath} (cwd=${workingDir})`);
      }
    } catch (err) {
      // Some environments disallow writes to the underlying default PI session path.
      // Fall back to in-memory sessions so requests still complete.
      log.warn(`[agent] Persistent session setup failed, using in-memory session: ${err instanceof Error ? err.message : String(err)}`);
      sessionManager = SessionManager.inMemory(workingDir);
    }
  } else {
    sessionManager = SessionManager.inMemory(workingDir);
  }

  // NOTE: regenerate is now handled entirely by claw-auth's /clone-session
  // call with mode="beforeLastUser" BEFORE this run dispatches. The cloned
  // JSONL ends just before the user message being replayed, so PI's normal
  // appendUserMessage(task) on the next turn lands the replayed user entry
  // in the right place — no second append, no re-anchoring needed.
  //
  // Earlier versions tried to re-anchor PI's branch head here using
  // sessionManager.branch(lastUserEntryId), but with the new clone mode
  // that entry is no longer present in the JSONL; the search would slide
  // to an earlier user message and corrupt the branch tree. The isRegenerate
  // flag is still threaded through the API for back-compat, but the runtime
  // doesn't act on it — the clone step is authoritative.
  void isRegenerate;

  // If skills provided, materialize them to disk and add their directory as
  // an additional skill path so pi's DefaultResourceLoader picks them up.
  const additionalSkillPaths: string[] = [...(extraSkillPaths ?? [])];
  if (skills && skills.length > 0 && sessionId) {
    const skillsDir = await writeSessionSkills(sessionId, skills);
    if (skillsDir) {
      additionalSkillPaths.push(skillsDir);
      log.info(`[agent] Wrote ${skills.length} skill(s) to session-scoped ${skillsDir}`);
    }
  }

  // Build skill trigger + prompt injection extensions if configured
  const extensions: import("@earendil-works/pi-coding-agent").ExtensionFactory[] = [compactionExtension];

  if (promptInjections && promptInjections.length > 0) {
    const injections = promptInjections;
    extensions.push((pi) => {
      pi.on("context", (event) => {
        const body = injections
          .map((p) => `### ${p.label}\n${p.content}`)
          .join("\n\n");
        const reminder = {
          role: "user" as const,
          content: [{ type: "text" as const, text: `[System Reminder]\n${body}` }],
          timestamp: Date.now(),
        };
        log.info(`[agent] Prompt injections: ${injections.length} applied (turn with ${event.messages.length} prior messages)`);
        return { messages: [...event.messages, reminder] };
      });
    });
  }

  if (skillTriggers && skillTriggers.length > 0) {
    const triggers = skillTriggers;
    extensions.push((pi) => {
      pi.on("tool_result", (event) => {
        const afterTriggers = triggers.filter((t) => t.when === "after" && event.toolName.endsWith(t.toolName));
        for (const trigger of afterTriggers) {
          log.info(`[agent] Skill trigger: ${trigger.skillSlug} fired after ${event.toolName}`);
          const injectedContent = [
            `\n\n---`,
            `**[Skill Injected: ${trigger.skillSlug}]** _(configured by user in agent settings)_`,
            trigger.prompt ? `\nInstruction: ${trigger.prompt}` : "",
            `\n${trigger.skillContent}`,
            `---`,
          ].join("\n");
          return {
            content: [
              ...event.content,
              { type: "text" as const, text: injectedContent },
            ],
          };
        }
        return undefined;
      });
    });
  }

  const fastCatalogNameSet = new Set(fastToolCatalogNames ?? []);
  const fastActiveToolBudget = Math.max(0, fastMaxActiveTools ?? fastCatalogNameSet.size);
  const restoredFastActiveToolSet =
    fastMode && fastCatalogNameSet.size > 0
      ? latestFastModeActiveToolSet(sessionManager)
          .filter((name) => fastCatalogNameSet.has(name))
      : [];
  if (fastMode && restoredFastActiveToolSet.length > fastActiveToolBudget) {
    log.warn(`[agent] fast mode restored activeToolSet=${restoredFastActiveToolSet.length} exceeds current budget=${fastActiveToolBudget}; grandfathering restored tools and capping only new loads`);
  }

  // When the caller supplies a persona prompt, hand it to pi as `systemPrompt`
  // so it becomes the SDK's actual system prompt. pi will then append
  // formatSkillsForPrompt(skills) to it (XML <available_skills> with absolute
  // <location> paths) — the agent gets one coherent system prompt that
  // includes both the persona and skill awareness.
  //
  // (B) PARENT_PARALLELISM_PREAMBLE is prepended to every agent's persona —
  // system-level, not per-agent. The intent is to push the LLM toward
  // emitting multiple tool_use blocks in a single assistant turn when its
  // next moves are independent. Without this, Claude defaults to one
  // tool_use per turn, and 4 sequential subagent calls cost 4× wall-clock.
  const personaSuffix = twinPersona ? `\n\n${twinPersona}` : "";
  const personaSystemPrompt = systemPromptOverride
    ? `${PARENT_PARALLELISM_PREAMBLE}${systemPromptOverride}${personaSuffix}\n\n${buildUserDetails(userId, userName, userEmail)}`
    : undefined;

  // Pi v0.75: DefaultResourceLoaderOptions.agentDir is now REQUIRED (with
  // exactOptionalPropertyTypes). Default to ~/.pi/agent when caller didn't
  // configure one — same path the SDK uses when AuthStorage.create() runs.
  const resourceLoader = new DefaultResourceLoader({
    cwd: workingDir,
    agentDir: PATHS.agentDir ?? `${process.env["HOME"] ?? "."}/.pi/agent`,
    extensionFactories: extensions,
    ...(additionalSkillPaths.length > 0 ? { additionalSkillPaths } : {}),
    ...(personaSystemPrompt ? { systemPrompt: personaSystemPrompt } : {}),
  });
  await resourceLoader.reload();

  // The read/grep/find/ls gate (createScopedToolMap below) confines the agent to
  // workingDir. Skills, however, live OUTSIDE workingDir — bundled skills under
  // the repo `skills/` dir and session skills under <dataDir>/session-skills/<id>
  // — and pi advertises them to the model with ABSOLUTE <location> paths. Without
  // an exception, the model's read of any SKILL.md is denied ("outside the session
  // working directory") and every skill is unreadable. Allow each LOADED skill's
  // directory (+ the session-skills roots) as READ-ONLY roots; write stays gated
  // to workingDir.
  const skillReadRoots = Array.from(
    new Set<string>([
      ...additionalSkillPaths,
      ...resourceLoader
        .getSkills()
        .skills.map((s) => (s as { filePath?: string }).filePath)
        .filter((p): p is string => typeof p === "string" && isAbsolute(p))
        .map((p) => dirname(p)),
    ]),
  );
  if (skillReadRoots.length > 0) {
    log.info(`[agent] Skill read roots (read-only, outside cwd): ${skillReadRoots.join(", ")}`);
  }

  // Over-large MCP/custom tool output is offloaded to `<outputBaseDir>/.context/`
  // (the persistent session dir when a conversation is active — see
  // toolOutputBaseDir). The scoped read tool gates to workingDir, but that dir is
  // NOT under workingDir for a persistent session, so a spilled result was
  // unreadable ("<path> is outside the session working directory"). Allow ONLY the
  // `.context` subdir as a read-only root so the agent can read back its own
  // spilled tool results + fetched attachments — the rest of the session dir
  // (transcript / debug-session.json) stays out of reach.
  const outputBaseDir = toolOutputBaseDir(conversationId, workingDir);
  // `conversationId` here is the store/session KEY (`<cid>_<agentSlug>`, or a
  // branched piSessionConversationId), so `outputBaseDir` = sessions/<key>.
  // Custom (sandbox) tools spill there (capCustomToolOutput below), but MCP
  // tools spill to sessions/<RAW conversationId>/.context — run.ts froze
  // mcpOutputDir with the raw id (progressMeta.conversationId, threaded
  // separately) before the key existed. Add BOTH `.context` dirs as READ-ONLY
  // roots so a slugged/branched agent can read either spill.
  const rawMcpBaseDir = progressMeta?.conversationId
    ? toolOutputBaseDir(progressMeta.conversationId, workingDir)
    : outputBaseDir;
  const fileToolReadRoots = [
    ...skillReadRoots,
    // THIS session's own materialized skills always live here. Add it
    // UNCONDITIONALLY — not just when `skills` are re-passed this turn. On a
    // RESUME turn `additionalSkillPaths` is empty (skills weren't re-sent), but
    // the skill's SKILL.md + its `scripts/`/asset files are still on disk AND
    // still advertised to the model with absolute paths — so a read of e.g.
    // session-skills/<id>/<slug>/scripts/foo.py was denied ("outside the session
    // working directory") on those turns even though the file exists. Scoped to
    // THIS sessionId only (guarded against empty id → never the shared parent),
    // so no cross-session exposure.
    ...(sessionId ? [join(PATHS.dataDir, "session-skills", sessionId)] : []),
    join(outputBaseDir, ".context"),
    ...(rawMcpBaseDir !== outputBaseDir ? [join(rawMcpBaseDir, ".context")] : []),
  ];

  // Reasoning effort selection — precedence:
  //   1. per-agent modelSettings.thinkingLevel (agent owner, Dashboard)
  //   2. per-credential reasoningEffort from providerConfig (user / agent UI)
  //   3. codex hard-default: "medium" (high added 5-15s per tool call;
  //      at the 70-130 tool counts we see in long sandbox sessions that
  //      snowballed into 10+ minutes of latent reasoning — prod analysis
  //      2026-05-27)
  //   4. env-configured fallback (AGENT.thinkingLevel, defaults to "medium")
  // A per-agent temperature forces thinking OFF regardless: Anthropic rejects
  // temperature != 1 when extended thinking is enabled, and a fixed
  // temperature only means anything on a non-thinking call anyway.
  // pi-agent-core's ThinkingLevel (the session option type) includes "off";
  // pi-ai's narrower one (imported as ThinkingLevel above) does not.
  type SessionThinkingLevel = import("@earendil-works/pi-agent-core").ThinkingLevel;
  const credEffort = effectiveProviderConfig?.reasoningEffort;
  const credEffortValid =
    credEffort === "low" || credEffort === "medium" || credEffort === "high";
  let effectiveThinking: SessionThinkingLevel = modelSettings?.thinkingLevel
    ? (modelSettings.thinkingLevel as SessionThinkingLevel)
    : credEffortValid
      ? (credEffort as SessionThinkingLevel)
      : provider === "codex"
        ? "medium"
        : (AGENT.thinkingLevel as SessionThinkingLevel);
  if (modelSettings?.temperature !== undefined && effectiveThinking !== "off") {
    log.info(`[agent] modelSettings.temperature=${modelSettings.temperature} set — forcing thinkingLevel off (was ${effectiveThinking})`);
    effectiveThinking = "off";
  }
  // SECURITY (cross-session read): pi's built-in read/write/grep/find/ls are
  // NOT confined to cwd. `createReadTool(cwd)` uses cwd only as the default base
  // for RELATIVE paths — an absolute path or a `..` traversal escapes freely
  // (no containment check; verified in pi's path-utils.resolveToCwd). With pi's
  // raw built-ins an agent could read another session's files
  // (`data/sessions/<other>/debug/debug-session.json` = another user's history)
  // or host secrets. An earlier comment here wrongly assumed the v0.75 factories
  // were self-confining and dropped createScopedTools() — that opened the hole.
  //
  // Fix: do NOT use pi's built-ins. Register cwd-GATED versions
  // (createScopedToolMap → the denyOutside/isWithin guard in scoped-tools.ts,
  // which rejects absolute + `..` escapes) as customTools. They reuse the
  // built-in names, so they OVERRIDE pi's unscoped built-ins in the session's
  // tool registry (agent-session.js:1844-1847 — customTools win on name
  // collision at execution time). The names stay in the allowlist below so they
  // remain active.
  const scopedFileTools = Object.values(createScopedToolMap(workingDir, fileToolReadRoots));
  //
  // "bash" is EXCLUDED from the allowlist (and we never register a scoped bash)
  // — preserves the pre-migration security model. Pi would otherwise enable it.
  //
  // SUBTLE: in v0.75 the `tools` field is a GLOBAL allowlist that pi applies
  // to EVERY registered tool, including customTools. If we list only the 5
  // built-ins here, pi silently drops memory-search, the copilot
  // respond-to-user tool, AND every MCP tool we register via customTools —
  // because their names aren't in the list. So the allowlist MUST also
  // include every customTool name. We enumerate them right before building
  // the options.
  // (Ref: pi-coding-agent/dist/core/sdk.js:157 — `allowedToolNames = options.tools`)
  const builtinAllow = localFileToolNames();
  const customToolNames = (customTools ?? []).map((t) => t.name);
  // Proof that the mandatory twin_deliver tool is actually in the pi payload
  // (allowlist + registered customTools) — logged for the Twin mention flow so a
  // "did it even get the tool?" question is answerable from the run logs.
  if (twinDeliverRef) {
    log.info(
      `[agent] TWIN flow — twin_deliver in pi payload: ${customToolNames.includes("twin_deliver")} ` +
      `(allowlist=${builtinAllow.length + customToolNames.length}); customTools=[${customToolNames.join(", ")}]`,
    );
  }
  const options: CreateAgentSessionOptions = {
    model,
    thinkingLevel: effectiveThinking,
    tools: [...builtinAllow, ...customToolNames],
    sessionManager,
    authStorage,
    modelRegistry,
    cwd: workingDir,
    resourceLoader,
  };
  if (PATHS.agentDir) {
    options.agentDir = PATHS.agentDir;
  }
  // customTools = cwd-scoped file tools (override pi's unscoped read/write/grep/
  // find/ls built-ins, see above) FIRST, then the agent's custom/MCP tools with
  // oversized-output capping. The scoped file tools are the primitives and must
  // NOT be wrapped by capCustomToolOutput. Always set — the scoped file tools
  // are present even when the agent has no other custom tools.
  // Offload over-large custom-tool output under the persistent session dir
  // (survives the ephemeral workspace teardown + resume) when a conversation is
  // in play; fall back to the working dir for in-memory runs. See toolOutputBaseDir.
  const cappedCustomTools = customTools
    ? capCustomToolOutput(customTools, outputBaseDir)
    : [];
  const allCustomTools = [...scopedFileTools, ...cappedCustomTools] as ToolDefinition[];
  // Opt-in: chunk + inline-tokenize every tool's result so the model can cite
  // any tool's output. Outermost wrap — runs after capCustomToolOutput and
  // skips tools that already self-cite. See wrapAutoCitations.
  options.customTools = autoToolCitations
    ? wrapAutoCitations(allCustomTools)
    : allCustomTools;

  const { session } = await createAgentSession(options);

  if (fastMode && fastToolController && fastCatalogNameSet.size > 0) {
    const activeSet = new Set(restoredFastActiveToolSet);
    const baseActiveToolNames = [
      ...builtinAllow,
      ...customToolNames.filter((name) => !fastCatalogNameSet.has(name)),
      ...activeSet,
    ];
    session.setActiveToolsByName([...new Set(baseActiveToolNames)]);
    fastToolController.getActiveToolSet = () => [...activeSet];
    fastToolController.loadTools = async (names: string[]) => {
      const maxActiveTools = fastActiveToolBudget;
      const unknown: string[] = [];
      const alreadyLoaded: string[] = [];
      const loaded: string[] = [];
      for (const name of [...new Set(names)]) {
        if (!fastCatalogNameSet.has(name)) {
          unknown.push(name);
          continue;
        }
        if (activeSet.has(name)) {
          alreadyLoaded.push(name);
          continue;
        }
        if (activeSet.size >= maxActiveTools) {
          unknown.push(`${name} (palette budget exceeded: ${activeSet.size}/${maxActiveTools})`);
          continue;
        }
        activeSet.add(name);
        loaded.push(name);
      }
      session.sessionManager.appendCustomEntry(FAST_MODE_ACTIVE_TOOLS_CUSTOM_TYPE, {
        activeToolSet: [...activeSet],
      });
      session.setActiveToolsByName([
        ...builtinAllow,
        ...customToolNames.filter((name) => !fastCatalogNameSet.has(name)),
        ...activeSet,
      ]);
      return {
        loaded,
        alreadyLoaded,
        unknown,
        activeToolSet: [...activeSet],
        maxActiveTools,
      };
    };
    log.info(`[agent] fast mode activeToolSet restored=${activeSet.size} catalog=${fastCatalogNameSet.size}`);
  }

  // Per-agent temperature: CreateAgentSessionOptions has no temperature knob,
  // but the agent's streamFn receives pi-ai SimpleStreamOptions — wrap it so
  // every LLM call this session carries the configured value.
  if (modelSettings?.temperature !== undefined) {
    const temperature = modelSettings.temperature;
    const baseStreamFn = session.agent.streamFn;
    session.agent.streamFn = (streamModel, streamContext, streamOptions) =>
      baseStreamFn(streamModel, streamContext, { ...(streamOptions ?? {}), temperature });
    log.info(`[agent] Applying per-agent temperature: ${temperature}`);
  }
  installLlmCallMetrics(session.agent, sessionId ?? conversationId ?? "unknown", { fastMode: fastMode === true });

  // Mid-turn compaction: pi compacts AFTER an assistant message but doesn't
  // check the tool_result that just landed and goes into the NEXT prompt. The
  // adapter that adds this (and the codex usage-estimate fallback) lives in
  // mid-turn-compaction.ts, where the pi-internals coupling is contained and
  // version-guarded — see that file's header.
  installMidTurnCompaction(session);
  // Pi v0.75 dropped the `setBeforeToolCall(fn)` method in favour of a
  // directly-assignable property of the same name on the Agent. Semantics
  // unchanged — the hook still runs before each tool call.
  session.agent.beforeToolCall = createCommandGuard();
  const toolBudget = installToolBudget(session.agent, {
    sessionId: sessionId ?? conversationId ?? "unknown",
  });

  // verifyResponses: wire the submit-response tool's evidence accessor to the
  // live transcript. Set BEFORE any prompt so the tool — which verifies inside
  // its execute, mid-loop — sees the tool results gathered so far. Lazy: reads
  // the latest messages each time the tool fires, not a stale snapshot.
  if (verifyResponsesRef) {
    const { extractEvidenceDigest } = await import("./verify-response.js");
    verifyResponsesRef.getDigest = () =>
      extractEvidenceDigest(
        (session as unknown as { messages?: Array<Record<string, unknown>> }).messages,
      );
  }

  // Compact-before-fallback: if the previous provider returned empty (likely a
  // context overflow), shrink the resumed session before this provider's first
  // prompt so it gets a summarized context instead of overflowing again.
  if (forceCompactBeforeRun && isResume) {
    await forceCompaction(session, "manual");
  }

  const toolsUsed: string[] = [];
  // Expose the live tools-used list to the submit-result gate so a
  // `requireToolsBeforeSubmit` config can block an empty/short-circuited
  // structured delivery until the mandated data-gathering tools have run.
  if (structuredOutputRef) structuredOutputRef.toolsUsed = () => toolsUsed;
  let sandboxPreviewEmitted = false;
  const toolInvocations: ToolInvocation[] = [];
  const tokenUsage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let streamedText = "";
  let streamedReasoning = "";
  const debugEvents: DebugEventRecord[] = [];
  let debugSeq = 0;
  // Set once the success-path debug write (near the end of the agent loop) has
  // run. The inner finally below uses this as a guard so it only fires the
  // fallback partial-state debug write when the success path didn't get there
  // — i.e. the loop threw (RunCancelledError, ProviderStallError, etc.). The
  // success path keeps producing the full snapshot exactly as it did before.
  let debugWritten = false;
  let llmCallSeq = 0;
  let currentPromptText = "";
  let currentPromptKind: "fresh" | "resume" = "fresh";
  let currentPromptImagesCount = 0;
  // Track in-flight tool calls so we can pair start → end
  const inflightCalls = new Map<string, { toolName: string; args: unknown; startedAt: number }>();

  // ── Latency instrumentation ──────────────────────────────────────────
  // Why: the only existing log between tool_done and the next tool_call is the
  // 3-second "Executing tools..." heartbeat. When kimi spends 60-90s decoding
  // a single fill-pdf-form call with 100+ field-value JSON, all you see is
  // 20+ heartbeats and (often) one "Auto-retry: terminated". This block
  // accounts for *where* the wall clock actually went so the run-completion
  // log can show llm=Xms tools=Yms retries=N tps=Z.
  const runStartedAt = Date.now();
  const runStartedIso = new Date(runStartedAt).toISOString();
  const parsedDebugStartedAt = debugStartedAt ? Date.parse(debugStartedAt) : Number.NaN;
  const debugStartedIso = Number.isFinite(parsedDebugStartedAt)
    ? new Date(parsedDebugStartedAt).toISOString()
    : runStartedIso;
  const latency = {
    llmDecodeMs: 0,
    llmWaitMs: 0,
    llmTurns: 0,
    llmRetries: 0,
    streamChars: 0,
    streamThinkingChars: 0,
    streamTextChars: 0,
    streamCharsPerSec: undefined as number | undefined,
    firstTurnTtftMs: undefined as number | undefined,
    lastRetryReason: undefined as string | undefined,
  };
  // turnStartedAt is set the moment we expect the model to start producing —
  // i.e. after the last tool_execution_end (or at run start before any tool).
  // firstDeltaAt is the first text_delta / thinking_delta of that turn, which
  // is our TTFT signal. message_end closes the turn.
  let turnStartedAt: number | null = runStartedAt;
  let firstDeltaAt: number | null = null;
  // LLM stall watchdog: fall back instead of hanging forever when a provider
  // call makes no progress (the silent-drop failure mode). `modelActive` is true
  // only while we're awaiting/receiving model output (NOT during tool execution,
  // which can legitimately run for minutes) — set from turn_start / message_end /
  // tool_execution_start in the subscribe handler below. lastActivityAt is bumped
  // on every session event. When idle past the threshold while modelActive, we
  // abort via stallController, which makes withAbort reject with ProviderStallError
  // (a transient error → the fallback chain advances to the next provider).
  let lastActivityAt = Date.now();
  let modelActive = false;
  const stallController = new AbortController();
  const STALL_TIMEOUT_MS = Number(process.env["AGENT_STALL_TIMEOUT_MS"] ?? 120_000);
  let stallWatchdog: ReturnType<typeof setInterval> | null = null;
  let turnStreamChars = 0;
  let turnStreamThinkingChars = 0;
  let turnStreamTextChars = 0;
  // Per-turn thinking text (reasoning deltas). Captured so the debugger can show
  // the thinking block at each point the agent reasons — between tool calls and
  // between LLM calls within one user request. Reset at every assistant_turn_end.
  let turnReasoning = "";
  let turnStreamCount = 0;
  let streamWindowCount = 0;
  let streamWindowStartedAt: number | null = null;
  let streamRateTimer: ReturnType<typeof setInterval> | null = null;
  let turnStreamRateSamples: StreamRateSample[] = [];
  const MAX_RESULT_LEN = 50_000;

  const coerceResult = (result: unknown): string => {
    if (typeof result === "string") return result;
    if (result == null) return "";
    try { return JSON.stringify(result); } catch { return String(result); }
  };

  const pushDebugEvent = (kind: DebugEventKind, data: Record<string, unknown> = {}, extras?: Partial<DebugEventRecord>): void => {
    const event: DebugEventRecord = {
      seq: ++debugSeq,
      at: extras?.at ?? new Date().toISOString(),
      kind,
      ...(extras?.turn != null ? { turn: extras.turn } : {}),
      ...(extras?.llmCall != null ? { llmCall: extras.llmCall } : {}),
      ...(extras?.toolCallId ? { toolCallId: extras.toolCallId } : {}),
      ...(extras?.parentToolCallId ? { parentToolCallId: extras.parentToolCallId } : {}),
      ...(extras?.subagentName ? { subagentName: extras.subagentName } : {}),
      data,
    };
    debugEvents.push(event);
    pushDebugProgress(progressUrl, sessionId ?? conversationId ?? "unknown", event);
  };

  // Incremental debug snapshot — written at assistant turn boundaries and tool
  // lifecycle boundaries (NOT per token), so the debugger can serve a PARTIAL
  // bundle mid-run and does not leave a completed tool displayed as running.
  // Writes only debug-session.json + debug-events.json
  // (never the immutable debug-run-*.json). `messages` is intentionally omitted
  // (kept only in the final snapshot) to avoid O(turns) PVC growth — the drawer
  // renders off `events`/`toolInvocations`. Skipped once the completion write
  // has run (debugWritten). Best-effort: never throws into the run loop.
  let partialDebugFlushing = false;
  // Tracks the in-flight partial write so the completion/finally writers can
  // await it before writing their FULL snapshot — otherwise the two race on the
  // same debug-session.json path and can leave a torn/partial final trace.
  let partialFlushPromise: Promise<void> | null = null;
  const flushDebugPartial = async (): Promise<void> => {
    if (!conversationId || debugWritten || partialDebugFlushing) return;
    partialDebugFlushing = true;
    try {
      const debugDir = await ensureSessionDebugDir(conversationId);
      if (debugWritten) return; // completion writer won the race while we awaited
      const { writeFile } = await import("node:fs/promises");
      if (debugWritten) return;
      // Strip the per-event full-transcript `messages` embeds (session_prompt /
      // assistant_turn_end each carry a deep clone of the WHOLE session for that
      // turn) — keeping them would make each partial file O(turns) and the
      // rewrite-every-turn cadence O(turns²) bytes to the PVC. The drawer renders
      // off event metadata + toolInvocations, not these mid-run message embeds.
      const leanEvents = debugEvents.map((e) =>
        e.data && (e.data as Record<string, unknown>)["messages"] !== undefined
          ? { ...e, data: { ...(e.data as Record<string, unknown>), messages: undefined } }
          : e,
      );
      const snapshot: DebugSessionSnapshot = {
        schemaVersion: 1,
        conversationId,
        ...(sessionId ? { sessionId } : {}),
        ...(progressMeta?.agentSlug ? { agentSlug: progressMeta.agentSlug } : {}),
        userId,
        ...(userName ? { userName } : {}),
        ...(userEmail ? { userEmail } : {}),
        ...(provider ? { provider } : {}),
        inProgress: true,
        startedAt: debugStartedIso,
        finishedAt: new Date().toISOString(),
        task,
        ...(context ? { context } : {}),
        ...(systemPromptOverride ? { systemPromptOverride: true } : {}),
        messages: [],
        toolInvocations: cloneForDebug(toolInvocations),
        tokenUsage: { ...tokenUsage },
        latency: {
          totalMs: Date.now() - runStartedAt,
          llmDecodeMs: latency.llmDecodeMs,
          llmWaitMs: latency.llmWaitMs,
          llmTotalMs: latency.llmWaitMs + latency.llmDecodeMs,
          llmTurns: latency.llmTurns,
          llmRetries: latency.llmRetries,
          toolMs: toolInvocations.reduce((sum, inv) => sum + (inv.durationMs ?? 0), 0),
        },
        lastAssistantText: streamedText,
        events: leanEvents,
      };
      await writeFile(`${debugDir}/debug-session.json`, JSON.stringify(snapshot), "utf8");
      await writeFile(`${debugDir}/debug-events.json`, JSON.stringify(leanEvents), "utf8");
    } catch (err) {
      log.warn(`[agent] partial debug flush failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      partialDebugFlushing = false;
    }
  };

  // Serialize partial snapshots. A plain `void flushDebugPartial()` can lose a
  // tool-end update when a turn-boundary write is already in flight because
  // flushDebugPartial deliberately skips concurrent writes. Chaining preserves
  // every requested boundary and gives the final writer one promise to await.
  const queueDebugPartialFlush = (): void => {
    const previous = partialFlushPromise ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => flushDebugPartial());
    partialFlushPromise = next;
    void next.finally(() => {
      if (partialFlushPromise === next) partialFlushPromise = null;
    });
  };

  const pushLiveStreamRate = (streamsPerSec: number, active: boolean): void => {
    const event: DebugEventRecord = {
      seq: ++debugSeq,
      at: new Date().toISOString(),
      kind: "stream_rate",
      turn: latency.llmTurns + 1,
      ...(llmCallSeq ? { llmCall: llmCallSeq } : {}),
      data: { streamsPerSec, streamsCollected: turnStreamCount, active },
    };
    pushDebugProgress(progressUrl, sessionId ?? conversationId ?? "unknown", event);
  };

  const flushStreamRate = (active: boolean): void => {
    if (streamWindowStartedAt == null || firstDeltaAt == null) return;
    const now = Date.now();
    const elapsedMs = Math.max(1, now - streamWindowStartedAt);
    const streamsPerSec = Math.round((streamWindowCount / (elapsedMs / 1000)) * 10) / 10;
    const sample = { offsetMs: now - firstDeltaAt, streamsPerSec, streamsCollected: turnStreamCount };
    if (streamWindowCount > 0) turnStreamRateSamples.push(sample);
    pushLiveStreamRate(streamsPerSec, active);
    streamWindowCount = 0;
    streamWindowStartedAt = now;
  };

  const startStreamRateTimer = (): void => {
    if (streamRateTimer) return;
    streamWindowStartedAt = Date.now();
    streamRateTimer = setInterval(() => flushStreamRate(true), 1_000);
  };

  const stopStreamRateTimer = (): void => {
    if (streamRateTimer) clearInterval(streamRateTimer);
    streamRateTimer = null;
    flushStreamRate(false);
    streamWindowStartedAt = null;
  };

  const snapshotMessages = (): unknown[] => {
    const messages = (session as unknown as { messages?: unknown[] }).messages ?? [];
    return cloneForDebug(messages);
  };

  const repairDanglingToolUses = (reason: string): number => {
    const messages = (session as unknown as { messages?: Array<Record<string, unknown>> }).messages;
    if (!Array.isArray(messages) || messages.length === 0) return 0;
    const satisfied = new Set<string>();
    for (const msg of messages) {
      const content = Array.isArray(msg["content"]) ? msg["content"] as Array<Record<string, unknown>> : [];
      for (const block of content) {
        if (block["type"] === "tool_result" && typeof block["tool_use_id"] === "string") {
          satisfied.add(block["tool_use_id"]);
        }
      }
    }

    const dangling: string[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.["role"] !== "assistant") continue;
      const content = Array.isArray(msg["content"]) ? msg["content"] as Array<Record<string, unknown>> : [];
      for (const block of content) {
        if (block["type"] === "tool_use" && typeof block["id"] === "string" && !satisfied.has(block["id"])) {
          dangling.push(block["id"]);
        }
      }
      break;
    }
    if (dangling.length === 0) return 0;
    messages.push({
      role: "user",
      content: dangling.reverse().map((id) => ({
        type: "tool_result",
        tool_use_id: id,
        content: reason,
      })),
    });
    return dangling.length;
  };

  const recordPrompt = (prompt: string, kind: "fresh" | "resume", imagesCount = 0): void => {
    currentPromptText = prompt;
    currentPromptKind = kind;
    currentPromptImagesCount = imagesCount;
  };

  pushDebugEvent("session_start", {
    conversationId,
    sessionId,
    ...(progressMeta?.agentSlug ? { agentSlug: progressMeta.agentSlug } : {}),
    userId,
    provider,
    task,
    context: context ?? null,
    systemPromptOverride: Boolean(systemPromptOverride),
    mode: mode ?? "auto",
  }, { at: debugStartedIso });

  // Debug telemetry: the tool palette this run actually got, plus the mode. Lets
  // the pipeline UI show, at a glance, which tools were available (and, in plan
  // mode, that it's the read-only propose-plan palette).
  pushDebugEvent("session_tools", {
    mode: mode ?? "auto",
    toolCount: customToolNames.length,
    tools: customToolNames,
  });

  // Debug telemetry: this run is the auto-mode execution turn that followed a
  // plan approval (or a trivial plan's auto-continue) — record the plan→auto
  // transition explicitly so the two turns read as one flow in the UI.
  if (planContinuation) {
    pushDebugEvent("mode_switch", { from: "plan", to: "auto", reason: "plan_approved" });
  }

  const reportProgress = createProgressReporter(progressUrl, sessionId ?? conversationId ?? "unknown", progressMeta);

  try {
  // Build a lookup of toolName → progressLabels[] from subagent tools.
  // Each invocation picks one at random so long-running tools cycle labels
  // instead of staying on a single string.
  const progressLabels = new Map<string, string[]>();
  if (customTools) {
    for (const t of customTools) {
      const labels = (t as unknown as { progressLabels?: string[] }).progressLabels;
      if (labels?.length) progressLabels.set(t.name, labels);
    }
  }
  const pickLabel = (toolName: string, fallback: string): string => {
    const arr = progressLabels.get(toolName);
    if (!arr?.length) return fallback;
    return arr[Math.floor(Math.random() * arr.length)]!;
  };

  session.subscribe((event) => {
    // Liveness for the stall watchdog — any event counts as progress.
    lastActivityAt = Date.now();
    if (event.type === "turn_start") {
      modelActive = true; // awaiting/receiving model output until message_end
      llmCallSeq += 1;
      pushDebugEvent("session_prompt", {
        kind: currentPromptKind,
        prompt: currentPromptText,
        imagesCount: currentPromptImagesCount,
        messageCount: snapshotMessages().length,
        messages: snapshotMessages(),
        ...(personaSystemPrompt ? { systemPrompt: personaSystemPrompt } : {}),
        turnIndex: (event as { turnIndex?: number }).turnIndex,
        timestamp: (event as { timestamp?: string }).timestamp,
      }, { llmCall: llmCallSeq });
    }
    if (event.type === "tool_execution_start") {
      // A tool call means the model has stopped decoding for this turn.
      // Don't carry turnStartedAt forward — the next turn begins on tool_end.
      turnStartedAt = null;
      firstDeltaAt = null;
      // Tools can legitimately run for minutes — pause the stall watchdog so a
      // slow tool isn't mistaken for a hung model.
      modelActive = false;
      log.info(`[agent] Tool call: ${event.toolName} args=${JSON.stringify(event.args ?? {}).slice(0, 200)}`);
      inflightCalls.set(event.toolCallId, { toolName: event.toolName, args: event.args, startedAt: Date.now() });
      pushDebugEvent("tool_execution_start", {
        toolName: event.toolName,
        args: cloneForDebug(event.args),
      }, {
        toolCallId: event.toolCallId,
        turn: latency.llmTurns + 1,
        ...((event as { subagentName?: string }).subagentName ? { subagentName: (event as { subagentName?: string }).subagentName } : {}),
        ...((event as { parentToolCallId?: string }).parentToolCallId ? { parentToolCallId: (event as { parentToolCallId?: string }).parentToolCallId } : {}),
      });
      reportProgress(pickLabel(event.toolName, "Executing tools..."));
      // Emit a "running" placeholder so the UI can show the row with a spinner
      // before the tool finishes. Subagent wrappers get the placeholder too so
      // their children (pushed with parentToolCallId) nest under a single
      // collapsible parent row instead of appearing flat at the top level
      // while the parent is still in flight.
      pushInvocation(progressUrl, sessionId ?? conversationId ?? "unknown", {
        toolName: event.toolName,
        args: event.args,
        result: "",
        isError: false,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        status: "running",
        toolCallId: event.toolCallId,
      } satisfies ToolInvocation);
      queueDebugPartialFlush();
    }
    if (event.type === "tool_execution_end") {
      toolsUsed.push(event.toolName);
      // Tool just finished — the model is about to start its next turn.
      // Stamp now so the next text_delta gives us a clean TTFT.
      turnStartedAt = Date.now();
      firstDeltaAt = null;
      log.info(`[agent] Tool done: ${event.toolName}`);
      const started = inflightCalls.get(event.toolCallId);
      if (!started) {
        log.warn(`[agent] tool_execution_end without matching start: ${event.toolCallId} (${event.toolName}) isError=${event.isError} — push skipped`);
      }
      if (started) {
        // Persist EXACTLY what the model saw — no second, persist-only cut.
        // The model-visible result is already bounded in-execute: custom / MCP /
        // subagent tools go through promoteIfOversized (tool-output.ts — 32KB
        // bulk / 128KB retrieval, spilling the tail to a file with a preview +
        // path), and pi's built-in bash/read/grep cap at 50KB. event.result is
        // that already-capped result. The earlier MAX_RESULT_LEN (50K) slice
        // re-truncated it a SECOND time for the DB/UI copy only, which (a) made
        // the persisted copy smaller than what the model actually reasoned over
        // and (b) cut the MCP `{"content":[…]}` JSON envelope mid-string, so the
        // frontend's JSON.parse failed and citation-chunk parsing broke. Storing
        // the coerced result verbatim keeps DB == model and the JSON valid.
        //
        // There is deliberately NO cumulative byte cap on this persist path: a
        // run-wide cap silently dropped the DB + debug copies of every tool
        // AFTER the threshold while the model still had them, breaking the
        // DB == debug == model parity above and surfacing as the finalize sweep
        // label "(no result — tool end event was not received)". Each result is
        // already bounded by the in-execute spill (32KB bulk / 128KB retrieval),
        // and MAX_TOOL_INVOCATIONS in agentRunRepository bounds the row count, so
        // the full invocation set is persisted verbatim.
        const fullResult = coerceResult(event.result);
        const citations = takeCitations(event.toolCallId);
        const debug = takeDebug(event.toolCallId);
        // A subagent spawned with run_in_background returned its "started" ack
        // synchronously; mark the wrapper row so the UI shows a non-blocking chip
        // (running) instead of a finished tool. The drain loop below flips
        // backgroundState → completed/error when the detached child lands.
        const bgTask = backgroundRegistry?.get(event.toolCallId);
        const inv: ToolInvocation = {
          toolName: event.toolName,
          args: started.args,
          result: fullResult,
          isError: event.isError,
          startedAt: new Date(started.startedAt).toISOString(),
          durationMs: Date.now() - started.startedAt,
          status: "completed",
          toolCallId: event.toolCallId,
          ...(citations ? { citations } : {}),
          ...(debug ? { debug } : {}),
          ...(bgTask ? { background: true, backgroundState: "running" as const, backgroundTaskId: bgTask.taskId } : {}),
        };
        toolInvocations.push(inv);
        // Stream the invocation to xyne-claw-auth so Control Center watchers see tools populate live
        pushInvocation(progressUrl, sessionId ?? conversationId ?? "unknown", inv);
        pushDebugEvent("tool_execution_end", {
          toolName: event.toolName,
          args: cloneForDebug(started.args),
          result: fullResult,
          isError: event.isError,
          durationMs: inv.durationMs,
          // Out-of-band debug payload (currently kb-search / spaces-search YQL).
          // Included here so the live debugger panel renders it alongside
          // args/result without waiting for the persisted ToolInvocation row.
          ...(debug ? { debug } : {}),
        }, {
          toolCallId: event.toolCallId,
          turn: latency.llmTurns + 1,
          ...((event as { subagentName?: string }).subagentName ? { subagentName: (event as { subagentName?: string }).subagentName } : {}),
          ...((event as { parentToolCallId?: string }).parentToolCallId ? { parentToolCallId: (event as { parentToolCallId?: string }).parentToolCallId } : {}),
        });
        queueDebugPartialFlush();

        // First time a sandbox-* tool succeeds, the kata session is live.
        // Emit the noVNC preview URL once so claw-auth can drop a clickable
        // "Open sandbox" link into the channel.
        if (!sandboxPreviewEmitted && !event.isError && /sandbox/i.test(event.toolName) && SANDBOX_PREVIEW.baseUrl) {
          // routes/run.ts passes the caller-scoped sandbox store key as the
          // `conversationId` argument, so for our hook here `conversationId` IS
          // the sandbox storeKey. Falling back to the run's
          // sessionId (a UUID per-run) would never match anything in
          // SESSION_STORE — that was the bug that left the preview URL
          // unposted in prod sessions where the agent reused a kata session
          // from a prior run.
          const storeKey = conversationId ?? sessionId ?? "unknown";
          const sbx = getSandboxSession(storeKey);
          if (sbx?.id) {
            const previewBase = SANDBOX_PREVIEW.baseUrl.replace(/\/+$/, "");
            const sandboxPreviewUrl = `${previewBase}/claw-preview/${sbx.id}/`;
            const sandboxCodePreviewUrl = `${previewBase}/claw-code/${sbx.id}`;
            sandboxPreviewEmitted = true;
            log.info(`[agent] Sandbox preview ready: ${sandboxPreviewUrl} | code: ${sandboxCodePreviewUrl} (storeKey=${storeKey})`);
            // pushSandboxPreview goes to /webhook/progress which is keyed by
            // the run sessionId (the UUID), NOT the storeKey — claw-auth
            // looks the run session up. Use sessionId here.
            pushSandboxPreview(progressUrl, sessionId ?? conversationId ?? "unknown", { sandboxId: sbx.id, sandboxPreviewUrl, sandboxCodePreviewUrl }, progressMeta);
          } else {
            log.info(`[agent] Sandbox preview skipped: no SESSION_STORE entry for storeKey=${storeKey} (tool=${event.toolName})`);
          }
        }
      }
      inflightCalls.delete(event.toolCallId);
      if (inflightCalls.size === 0) {
        recordHandoffBoundary(latency.llmTurns);
        if (handoff?.isRequested() === true) {
          stopForHandoff();
        }
      }
    }
    // Tier 3: stream reasoning tokens + partial assistant text to the progress endpoint.
    // We no longer persist the raw deltas in debug artifacts. Instead we only
    // accumulate stream-rate summaries for the current turn.
    if (event.type === "message_update") {
      const ame = (event as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
      if (ame && typeof ame.delta === "string" && ame.delta.length > 0) {
        if (firstDeltaAt == null && turnStartedAt != null) {
          firstDeltaAt = Date.now();
          const wait = firstDeltaAt - turnStartedAt;
          latency.llmWaitMs += wait;
          if (latency.firstTurnTtftMs == null) latency.firstTurnTtftMs = wait;
        }
        if (ame.type === "thinking_delta") {
          streamedReasoning += ame.delta;
          // Accumulate the turn's thinking text (capped) so assistant_turn_end
          // can emit a "thinking" debug event for this turn.
          if (turnReasoning.length < MAX_RESULT_LEN) turnReasoning += ame.delta;
          turnStreamCount += 1;
          streamWindowCount += 1;
          startStreamRateTimer();
          turnStreamThinkingChars += ame.delta.length;
          turnStreamChars += ame.delta.length;
          pushStreamChunk(progressUrl, sessionId ?? conversationId ?? "unknown", { reasoningDelta: ame.delta });
        } else if (ame.type === "text_delta") {
          turnStreamCount += 1;
          streamWindowCount += 1;
          startStreamRateTimer();
          streamedText += ame.delta;
          turnStreamTextChars += ame.delta.length;
          turnStreamChars += ame.delta.length;
          pushStreamChunk(progressUrl, sessionId ?? conversationId ?? "unknown", { textDelta: ame.delta });
        }
      }
    }
    if (event.type === "message_end") {
      modelActive = false; // turn finished — next turn_start re-arms the watchdog
      const msg = (event as { message?: { role?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } } }).message;
      if (msg?.role === "assistant" && msg.usage) {
        tokenUsage.input += msg.usage.input ?? 0;
        tokenUsage.output += msg.usage.output ?? 0;
        tokenUsage.cacheRead += msg.usage.cacheRead ?? 0;
        tokenUsage.cacheWrite += msg.usage.cacheWrite ?? 0;
      }
      // Close decode window for this turn. If we never saw a delta (rare —
      // some providers stream usage but no content), fall back to attributing
      // the whole turn to wait so we don't lose the time entirely.
      if (msg?.role === "assistant") {
        const now = Date.now();
        stopStreamRateTimer();
        if (firstDeltaAt != null) {
          latency.llmDecodeMs += now - firstDeltaAt;
        } else if (turnStartedAt != null) {
          latency.llmWaitMs += now - turnStartedAt;
        }
        if (firstDeltaAt != null && turnStreamChars > 0) {
          const decodeSeconds = Math.max(0.001, (now - firstDeltaAt) / 1000);
          latency.streamChars += turnStreamChars;
          latency.streamThinkingChars += turnStreamThinkingChars;
          latency.streamTextChars += turnStreamTextChars;
          latency.streamCharsPerSec = Math.round(turnStreamChars / decodeSeconds);
        }
        latency.llmTurns += 1;
        turnStartedAt = null;
        firstDeltaAt = null;
        // HA: checkpoint the session to GCS after each assistant turn (debounced
        // + single-flight) and keep the conversation lock alive, so a pod death
        // mid-run loses ≈one turn, not the whole conversation.
        const stopReason = (msg as { stopReason?: string }).stopReason;
        if (conversationId) {
          scheduleSessionCheckpoint(conversationId);
          void refreshSessionLock(conversationId);
          // Refresh the incremental debug snapshot so the debugger shows this
          // turn's trace mid-run (piggybacks the per-turn checkpoint cadence).
          // Tracked so the completion writer can await it (avoids a torn write).
          queueDebugPartialFlush();
        }
        if (stopReason !== "tool_use" && stopReason !== "aborted" && stopReason !== "error") {
          recordHandoffBoundary(latency.llmTurns);
        }
        // Emit the turn's thinking as its OWN timeline event, before
        // assistant_turn_end, so the debugger shows the reasoning block exactly
        // where it happened — before this turn's tool calls, and between LLM
        // calls within one user request. Only when the turn actually reasoned.
        const turnThinking = turnReasoning.trim();
        if (turnThinking.length > 0) {
          const cappedThinking = turnReasoning.length >= MAX_RESULT_LEN
            ? `${turnReasoning.slice(0, MAX_RESULT_LEN)}\n…[truncated]`
            : turnReasoning;
          pushDebugEvent("thinking", {
            text: cappedThinking,
            chars: turnStreamThinkingChars,
          }, {
            turn: latency.llmTurns,
            ...(llmCallSeq ? { llmCall: llmCallSeq } : {}),
          });
        }
        pushDebugEvent("assistant_turn_end", {
          message: cloneForDebug(msg),
          assistantText: session.getLastAssistantText() ?? "",
          usage: cloneForDebug(msg.usage),
          stopReason,
          errorMessage: (msg as { errorMessage?: string }).errorMessage,
          streamChars: turnStreamChars,
          streamThinkingChars: turnStreamThinkingChars,
          streamTextChars: turnStreamTextChars,
          streamCharsPerSec: latency.streamCharsPerSec,
          streamsCollected: turnStreamCount,
          streamRateSamples: turnStreamRateSamples,
          messages: snapshotMessages(),
        }, {
          turn: latency.llmTurns,
          ...(llmCallSeq ? { llmCall: llmCallSeq } : {}),
        });
        turnStreamChars = 0;
        turnStreamThinkingChars = 0;
        turnStreamTextChars = 0;
        turnReasoning = "";
        turnStreamCount = 0;
        streamWindowCount = 0;
        turnStreamRateSamples = [];
      }
    }
    // Pi v0.75 renamed the session-level compaction events:
    //   auto_compaction_start → compaction_start
    //   auto_compaction_end   → compaction_end
    // Other than the name, payload shape is unchanged for the fields we log.
    if (event.type === "compaction_start") {
      log.info(`[agent] Auto-compaction started: reason=${(event as { reason?: string }).reason}`);
      pushDebugEvent("compaction_start", {
        reason: (event as { reason?: string }).reason,
        tokensBefore: (event as { tokensBefore?: number }).tokensBefore,
      }, { turn: latency.llmTurns + 1 });
    }
    if (event.type === "compaction_end") {
      const e = event as {
        aborted?: boolean;
        willRetry?: boolean;
        errorMessage?: string;
        reason?: string;
        // pi's compaction result: the generated summary + bookkeeping. Undefined
        // when the compaction was a no-op/aborted/failed (result never produced).
        result?: { summary?: string; tokensBefore?: number; firstKeptEntryId?: string };
      };
      log.info(`[agent] Auto-compaction ended: aborted=${e.aborted} willRetry=${e.willRetry}${e.errorMessage ? ` error=${e.errorMessage}` : ""}`);
      // Surface the compacted summary (the "response") so the debugger renders it
      // instead of "(empty)". Carried verbatim — it's the condensed-context
      // checkpoint the next LLM call actually sees as the compactionSummary message.
      pushDebugEvent("compaction_end", {
        reason: e.reason,
        aborted: e.aborted,
        willRetry: e.willRetry,
        errorMessage: e.errorMessage,
        summary: e.result?.summary,
        tokensBefore: e.result?.tokensBefore,
      }, { turn: latency.llmTurns + 1 });
    }
    if (event.type === "auto_retry_start") {
      const e = event as { attempt?: number; maxAttempts?: number; errorMessage?: string };
      latency.llmRetries += 1;
      if (e.errorMessage) latency.lastRetryReason = e.errorMessage.slice(0, 200);
      // A retry restarts the current turn — re-arm the wait window so the
      // next first-delta gets attributed to this retry's wait, not the one
      // before it. Don't lose the time already spent on the failed attempt:
      // attribute it to wait since no decode produced output.
      if (turnStartedAt != null && firstDeltaAt == null) {
        latency.llmWaitMs += Date.now() - turnStartedAt;
      } else if (firstDeltaAt != null) {
        // Partial decode dropped mid-stream — count what we got before drop.
        latency.llmDecodeMs += Date.now() - firstDeltaAt;
      }
      turnStartedAt = Date.now();
      firstDeltaAt = null;
      log.info(`[agent] Auto-retry: attempt=${e.attempt}/${e.maxAttempts} error=${e.errorMessage?.slice(0, 200)}`);
      pushDebugEvent("auto_retry_start", {
        attempt: e.attempt,
        maxAttempts: e.maxAttempts,
        errorMessage: e.errorMessage,
      }, { turn: latency.llmTurns + 1 });
    }
  });

  const buildCancelledError = (): RunCancelledError => new RunCancelledError("Run cancelled by user", {
    toolsUsed: [...toolsUsed],
    toolInvocations: [...toolInvocations],
    tokenUsage: { ...tokenUsage },
    partialText: streamedText,
  });
  const buildProviderStallError = (): ProviderStallError => new ProviderStallError(
    provider ?? "spaces",
    Date.now() - lastActivityAt,
    {
      toolsUsed: [...toolsUsed],
      toolInvocations: [...toolInvocations],
      tokenUsage: { ...tokenUsage },
      partialText: streamedText,
    },
  );

  // On cancel we must call session.abort() — it stops the agent loop and
  // in-flight tools. dispose() alone only disconnects event listeners, leaving
  // the loop running detached (burning tokens and appending to the session
  // JSONL after the lock is released). abort() first, then dispose.
  let stopSessionPromise: Promise<void> | null = null;
  const stopSession = () => {
    if (stopSessionPromise) return;
    try {
      stopSessionPromise = session.abort().catch(() => {}).finally(() => {
        try { session.dispose(); } catch {}
      });
    } catch {
      try { session.dispose(); } catch {}
      stopSessionPromise = Promise.resolve();
    }
  };
  waitForCapAbortIdle = async () => {
    const queue = (session as unknown as { _agentEventQueue?: Promise<void> })._agentEventQueue;
    const waits: Promise<unknown>[] = [];
    if (stopSessionPromise) waits.push(stopSessionPromise);
    if (queue) waits.push(queue);
    if (waits.length === 0) return;
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    await Promise.race([
      Promise.allSettled(waits).then(() => undefined),
      timeout,
    ]);
  };

  // Push the session_cancelled debug event exactly once per run, regardless of
  // which abort path tripped. Without the guard, a withAbort that's already
  // past the prelude check then sees the signal fire would emit twice. Used
  // by the debug panel to show "Cancelled" alongside session_start/session_end.
  let cancelDebugEmitted = false;
  const emitCancelDebugOnce = (reason: string) => {
    if (cancelDebugEmitted) return;
    cancelDebugEmitted = true;
    pushDebugEvent("session_cancelled", {
      reason,
      partialTextLength: streamedText.length,
      toolCount: toolInvocations.length,
      tokenUsage: { ...tokenUsage },
      atMs: Date.now() - runStartedAt,
    });
  };

  // Races `promise` against BOTH the run-level abort (user cancel →
  // RunCancelledError) and the stall watchdog (no model progress →
  // ProviderStallError, transient → fallback). On either, stopSession() halts
  // pi's loop so the hung call doesn't keep burning tokens.
  let handoffStopIssued = false;
  const stopForHandoff = () => {
    handoffStopIssued = true;
    void session.abort().catch(() => {});
  };
  const withAbort = async <T>(promise: Promise<T>): Promise<T> => {
    const userSig = abortSignal;
    const stallSig = stallController.signal;
    if (userSig?.aborted) {
      stopSession();
      if (handoff?.isRequested() === true && handoff?.isUserCancelled() !== true) throw buildHandoffError();
      emitCancelDebugOnce("signal-already-aborted");
      throw buildCancelledError();
    }
    if (stallSig.aborted) { stopSession(); throw buildProviderStallError(); }

    return await new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        userSig?.removeEventListener("abort", onUserAbort);
        stallSig.removeEventListener("abort", onStallAbort);
      };
      const onUserAbort = () => {
        cleanup();
        stopSession();
        if (handoff?.isRequested() === true && handoff?.isUserCancelled() !== true) {
          reject(buildHandoffError());
          return;
        }
        emitCancelDebugOnce("user-cancel");
        reject(buildCancelledError());
      };
      const onStallAbort = () => { cleanup(); stopSession(); reject(buildProviderStallError()); };
      userSig?.addEventListener("abort", onUserAbort, { once: true });
      stallSig.addEventListener("abort", onStallAbort, { once: true });
      promise.then(
        (value) => { cleanup(); resolve(value); },
        (error) => {
          cleanup();
          if (handoffStopIssued) {
            reject(buildHandoffError());
            return;
          }
          reject(error);
        },
      );
    });
  };
  const promptWithAbort = async (makePrompt: () => Promise<unknown>): Promise<void> => {
    if (abortSignal?.aborted) {
      if (handoff?.isRequested() === true && handoff?.isUserCancelled() !== true) throw buildHandoffError();
      emitCancelDebugOnce("signal-already-aborted");
      throw buildCancelledError();
    }
    if (handoff?.isRequested() === true && handoff?.isUserCancelled() !== true) throw buildHandoffError();
    await withAbort(makePrompt());
  };

  // Start the stall watchdog (cleared in the finally at runTask's end). Fires
  // only while awaiting/receiving model output (modelActive) so slow tools and
  // idle turn-boundaries don't trip it. STALL_TIMEOUT_MS=0 disables it.
  if (STALL_TIMEOUT_MS > 0) {
    stallWatchdog = setInterval(() => {
      if (stallController.signal.aborted || abortSignal?.aborted || !modelActive) return;
      const idle = Date.now() - lastActivityAt;
      if (idle > STALL_TIMEOUT_MS) {
        log.warn(`[agent] LLM stall (provider=${provider ?? "spaces"}): no model activity for ${Math.round(idle / 1000)}s — aborting attempt so the fallback chain can advance`);
        metric.count("agent_llm_stall", { provider: provider ?? "spaces" });
        stallController.abort();
      }
    }, Math.min(15_000, STALL_TIMEOUT_MS));
  }

  const attachmentContext = fileAttachments?.length
    ? [
        "## Attached Files",
        ...fileAttachments.map((f) => `- ${f.fileName} (${f.mimeType}) at ${f.path}`),
        "Read these files from disk before answering.",
      ].join("\n")
    : "";
  const mergedContext = [context, attachmentContext].filter(Boolean).join("\n\n");
  const contextBlock = mergedContext ? `\n\n## Additional Context\n${mergedContext}` : "";

  if (isResume) {
    if (resumedFromHandoff) {
      metric.count("handoff_resume_ok", { provider: provider ?? "spaces", agentSlug: progressMeta?.agentSlug ?? "unknown" });
      const repairedToolUses = repairDanglingToolUses("interrupted mid-execution by a deployment — result unknown; re-verify the effect before assuming it ran");
      if (repairedToolUses > 0) {
        log.info(`[agent] Handoff resume repaired ${repairedToolUses} dangling tool_use block(s) before prompting`);
      }
      const resumeNote = [
        "This run was interrupted by a deployment and resumed on a new instance.",
        "Continue from where the transcript leaves off; do not restart the task.",
        "Re-verify the effect of your last tool call before repeating it.",
        "",
        `Original task: ${task}`,
      ].join("\n");
      recordPrompt(resumeNote, "resume", images?.length ?? 0);
      await promptWithAbort(() => session.prompt(`<system>${resumeNote}</system>`, images?.length ? { images } : undefined));
    } else {
      // Normal resume — send the new user message as a follow-up.
      //
      // Copilot delivers every message through the respond-to-user tool, which
      // aborts the run the instant it fires — so the persisted history can end
      // with a dangling respond-to-user tool_use (no tool_result). Anthropic/
      // Copilot message APIs reject a tool_use that has no matching tool_result,
      // so satisfy it with a synthetic tool_result before prompting, reusing the
      // same repair the handoff path relies on. Non-copilot histories are already
      // well-formed, so this is a no-op for them.
      if (provider === "copilot") {
        const repaired = repairDanglingToolUses("Response delivered to the user.");
        if (repaired > 0) {
          log.info(`[agent] Copilot resume repaired ${repaired} dangling respond-to-user tool_use block(s) before prompting`);
        }
      }
      const userDetails = buildUserDetails(userId, userName, userEmail);
      const followUp = `${userDetails}${contextBlock}\n\n## User Reply\n${task}`;
      recordPrompt(followUp, "resume", images?.length ?? 0);
      await promptWithAbort(() => session.prompt(followUp, images?.length ? { images } : undefined));
    }
  } else {
    // Fresh session.
    //
    // - If systemPromptOverride was provided: pi already has it as its actual
    //   system prompt (via DefaultResourceLoader.systemPrompt above) and has
    //   appended the <available_skills> XML block to it. We only send the
    //   query as the first user message.
    // - Otherwise: pi uses its default system prompt; we prepend our local
    //   buildSystemPrompt scaffold to the user message so the agent gets
    //   userId/email context.
    if (systemPromptOverride) {
      const prompt = `${contextBlock}\n\n## Query\n${task}`;
      recordPrompt(prompt, "fresh", images?.length ?? 0);
      await promptWithAbort(() => session.prompt(prompt, images?.length ? { images } : undefined));
    } else {
      // Mention-flow twin has no systemPromptOverride — its persona is prepended
      // to the first user message. Fold the twin persona files in here too so a
      // mention-driven reply speaks as the user.
      const basePrompt = `${buildSystemPrompt(userId, userName, userEmail, !!twinDeliverRef)}${personaSuffix}`;
      const prompt = `${basePrompt}${contextBlock}\n\n## Query\n${task}`;
      recordPrompt(prompt, "fresh", images?.length ?? 0);
      await promptWithAbort(() => session.prompt(prompt, images?.length ? { images } : undefined));
    }
  }

  // Wait for pi-coding-agent's event queue to drain before reading results.
  // prompt() resolves before _agentEventQueue finishes processing events,
  // which causes toolsUsed to be empty even though tools ran.
  let sq = session as unknown as { _agentEventQueue?: Promise<void> };
  if (sq._agentEventQueue) {
    await withAbort(sq._agentEventQueue);
  }
  if (handoff?.isRequested() === true) {
    throw buildHandoffError();
  }

  // ── Background subagents (run_in_background). The parent's model loop has
  // settled; deliver any subagents the model spawned in the background back into
  // the SAME session so it can incorporate them before finishing — the
  // non-blocking analog of a normal subagent call. Same primitive as the
  // reflection nudges below (prompt + drain the event queue), looped until no
  // task remains undelivered (an injected turn may spawn MORE). The stall
  // watchdog is inert here (modelActive is false between turns), so a long child
  // won't trip it; a wall-clock deadline caps how long we hold the run open and
  // a round cap bounds re-spawning. NOTE (Phase-1 limitation): a task that hits
  // the deadline is delivered as "timed out" but its detached child keeps
  // running to completion (own in-memory session, disposed in doExecute) — no
  // parent-JSONL corruption, just some wasted tokens. Design B fixes detached
  // lifetimes.
  if (backgroundRegistry && backgroundRegistry.size > 0) {
    const BACKGROUND_SUBAGENT_MAX_WAIT_MS = Number(process.env["BACKGROUND_SUBAGENT_MAX_WAIT_MS"] ?? 600_000);
    const deadline = Date.now() + BACKGROUND_SUBAGENT_MAX_WAIT_MS;
    for (let round = 0; round < 4; round++) {
      if (abortSignal?.aborted) break;
      const pending = [...backgroundRegistry.values()].filter((t) => !t.delivered);
      if (pending.length === 0) break;

      // Hold the run open until these settle (or the deadline).
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        const timeout = new Promise<void>((res) => {
          const h = setTimeout(res, remaining);
          (h as unknown as { unref?: () => void }).unref?.();
        });
        try {
          await withAbort(Promise.race([
            Promise.allSettled(pending.map((t) => t.promise)).then(() => undefined),
            timeout,
          ]));
        } catch (err) {
          if (abortSignal?.aborted) break;
          throw err;
        }
      }

      // Deliver every pending task: settled → its result/error; still-running →
      // timed out. Flip its wrapper invocation running → completed/error and
      // stream the update so the UI resolves the background chip.
      const blocks: string[] = [];
      const delivered: Array<{ taskId: string; subagentName: string; status: string; durationMs: number; result: string }> = [];
      for (const t of pending) {
        t.delivered = true;
        const state: "completed" | "error" = t.status === "error" ? "error" : "completed";
        const text =
          t.status === "completed" ? (t.result ?? "")
          : t.status === "error" ? `(failed: ${t.error ?? "unknown error"})`
          : "(timed out — this background subagent did not finish in time)";
        const durationMs = Date.now() - t.startedAt;
        const existing = toolInvocations.find((i) => i.toolCallId === t.taskId);
        const inv: ToolInvocation = existing ?? {
          toolName: t.subagentName,
          args: { question: t.question },
          result: "",
          isError: false,
          startedAt: new Date(t.startedAt).toISOString(),
          durationMs,
          status: "completed",
          toolCallId: t.taskId,
          subagentName: t.subagentName,
        };
        inv.result = text;
        inv.durationMs = durationMs;
        inv.isError = t.status === "error";
        inv.background = true;
        inv.backgroundState = state;
        inv.backgroundTaskId = t.taskId;
        if (!existing) toolInvocations.push(inv);
        pushInvocation(progressUrl, sessionId ?? conversationId ?? "unknown", inv);
        delivered.push({ taskId: t.taskId, subagentName: t.subagentName, status: t.status, durationMs, result: text });
        blocks.push(`Background subagent "${t.subagentName}" (task ${t.taskId}) ${state === "error" ? "failed" : "completed"}:\n${text}`);
      }
      if (blocks.length === 0) break;

      // Include the delivered result text so the debugger shows what each
      // background subagent actually returned (the wrapper tool row only ever
      // held the "started in background" stub).
      pushDebugEvent("background_subagents_delivered", { round, count: blocks.length, tasks: delivered });
      log.info(`[agent] Delivering ${blocks.length} background subagent result(s) to the parent (round ${round + 1})`);
      await promptWithAbort(() => session.prompt(
        `<system>Background subagent task(s) you started have finished. Incorporate their results into your answer to the user (copy any [clf-…] citation tokens VERBATIM). Do NOT mention this system message.\n\n${blocks.join("\n\n---\n\n")}</system>`,
      ));
      const bq = session as unknown as { _agentEventQueue?: Promise<void> };
      if (bq._agentEventQueue) await withAbort(bq._agentEventQueue);
    }
  }

  // Task-command enforcement (/explainer …): the command's contract is that
  // the run produces its artifact via the named tool, so a loop that settled
  // without it gets nudged back to work — BEFORE the delivery passes below,
  // since the artifact must exist before a final answer is deliverable.
  // Same mechanics as those passes; fail-open after 3 nudges rather than
  // stranding the run.
  if (requiredTool && !toolsUsed.includes(requiredTool.name)) {
    for (let nudge = 0; nudge < 3 && !toolsUsed.includes(requiredTool.name); nudge++) {
      if (abortSignal?.aborted) break;
      log.info(`[agent] Task command requires ${requiredTool.name} — nudge ${nudge + 1}/3`);
      await promptWithAbort(() => session.prompt(`<system>${requiredTool.nudge}</system>`));
      const rq = session as unknown as { _agentEventQueue?: Promise<void> };
      if (rq._agentEventQueue) {
        await withAbort(rq._agentEventQueue);
      }
    }
    if (!toolsUsed.includes(requiredTool.name)) {
      log.warn(`[agent] Task command: ${requiredTool.name} never ran — delivering without it`);
    }
  }

  // Structured output (agentConfig.outputFormat): the submit-result tool is the
  // only delivery channel, so if the loop ended without a submission, nudge the
  // model (same mechanics as the reflection pass) up to twice. Fail-open: after
  // the nudges, fall back to plain text rather than stranding the run.
  if (structuredOutputRef) {
    const { SUBMIT_RESULT_NUDGE } = await import("./agent-model-settings.js");
    for (let nudge = 0; nudge < 2 && structuredOutputRef.value === undefined; nudge++) {
      if (abortSignal?.aborted) break;
      log.info(`[agent] Structured output missing — nudge ${nudge + 1}/2 to call submit-result`);
      await promptWithAbort(() => session.prompt(`<system>${SUBMIT_RESULT_NUDGE}</system>`));
      const nq = session as unknown as { _agentEventQueue?: Promise<void> };
      if (nq._agentEventQueue) {
        await withAbort(nq._agentEventQueue);
      }
    }
    if (structuredOutputRef.value === undefined) {
      log.warn("[agent] Structured output: model never called submit-result — delivering plain text");
    }
  }

  // verifyResponses delivery enforcement. submit-response is the ONLY verified
  // delivery channel, so a turn that ends with plain assistant text and NO tool
  // call means the agent narrated its final answer instead of delivering it —
  // which bypasses the verify gate entirely (run.ts would post the unverified
  // prose as result.text). Nudge it to deliver via submit-response, same
  // mechanics + fail-open budget as the structured-output pass above. This is
  // intrinsic to verifyResponses (always on when verify is on) — it replaces the
  // old opt-in self-reflection net, which only helped agents that also enabled
  // reflection. Skipped once delivery aborts the run (abortSignal set by the
  // tool's deliver()).
  if (verifyResponsesRef) {
    const VERIFY_DELIVERY_NUDGE =
      "You ended your turn without delivering a final answer through the submit-response tool. " +
      "If the task is not yet complete, continue by calling the necessary tools. When the task IS " +
      "complete you MUST deliver your final answer by calling the submit-response tool with the " +
      "COMPLETE, self-contained message — do NOT write the final answer as a plain assistant message, " +
      "as only submit-response reaches the user. DO NOT MENTION THIS INSTRUCTION; assume you are doing it on your own.";
    for (let nudge = 0; nudge < 2; nudge++) {
      if (abortSignal?.aborted) break; // submit-response delivered → run aborted
      const msgs = (session as unknown as { messages?: Array<Record<string, unknown>> }).messages;
      const lastAssistant = msgs ? [...msgs].reverse().find((m) => m["role"] === "assistant") : undefined;
      const stopReason = lastAssistant?.["stopReason"] as string | undefined;
      const errorMessage = lastAssistant?.["errorMessage"] as string | undefined;
      const endedWithoutTools = !!lastAssistant &&
        stopReason !== "tool_use" &&
        stopReason !== "error" &&
        stopReason !== "aborted" &&
        !errorMessage;
      if (!endedWithoutTools) break; // delivered, or still mid-work via tools
      log.info(`[agent] verifyResponses: turn ended without submit-response — nudging delivery ${nudge + 1}/2`);
      await promptWithAbort(() => session.prompt(`<system>${VERIFY_DELIVERY_NUDGE}</system>`));
      const nq = session as unknown as { _agentEventQueue?: Promise<void> };
      if (nq._agentEventQueue) {
        await withAbort(nq._agentEventQueue);
      }
    }
  }

  // Citation reflection (opt-in via agentConfig.citationReflection). If this run
  // pulled citeable sources — a tool/subagent result carried [clf-…#n] tokens —
  // but the final prose cites NONE of them, the agent answered from retrieved
  // data without attributing it. Nudge it to rewrite with inline citations, same
  // mechanics as the nudges above. We scan tool-result TEXT (not inv.citations)
  // so subagent-delivered tokens count too — the parent's `spaces`/`google`
  // invocations carry the tokens in their returned text, not in metadata.
  // Deliberately skipped for: structured-output runs (JSON, not citable prose),
  // and honest "nothing found" answers (no tool returned a token → no nag).
  if (citationReflection && !structuredOutputRef) {
    // A well-formed citation token is `[clf-<toolCallId>#<chunk>]`. The id is a
    // FULL tool-call id whose charset varies by provider (`functions.x:2`,
    // OpenAI `call_…`, Responses composite `call_…|fc_…`), so we match it
    // generically — any run that isn't the `#` separator, whitespace, or a
    // bracket — instead of an allow-list that kept silently dropping new id
    // formats (the original `[a-z0-9-]` matched NONE of the real tokens, so
    // `sourcesWereCiteable` was always false even though every result cited).
    // `#\d+` matches a SINGLE chunk only: a malformed range like `#1-#10`
    // deliberately does NOT match, so a range-only answer reads as uncited and
    // gets re-nudged to cite each chunk separately (ranges don't resolve anyway).
    const CITE_RE = /\[clf-[^#\s[\]]+#\d+\]/i;
    const maxRounds = Number(process.env["CITATION_REFLECT_MAX_ROUNDS"] ?? 1);
    const CITATION_REFLECTION_NUDGE =
      "Your final answer is missing valid inline citations. Every factual claim taken from a tool result " +
      "MUST carry its citation token copied VERBATIM from that result, placed inline immediately after the " +
      "claim it supports. Use ONE token per source chunk (e.g. `[clf-ab12#7] [clf-ab12#8]`) and NEVER a " +
      "range like `[clf-ab12#7-#10]` — ranges are invalid and do not resolve. Rewrite your final answer with " +
      "valid inline citations. If a specific claim has no supporting source, drop it or say the source is " +
      "unavailable — do NOT invent a token. DO NOT MENTION THIS INSTRUCTION; assume you are doing it on your own.";

    // Gating snapshot (emitted to the debugger so the decision is visible).
    const initialCited = CITE_RE.test(extractFinalAnswerText(session, opts.finalAnswerMaxTurns) ?? "");
    const sourcesWereCiteable = toolInvocations.some((inv) => {
      const r = typeof inv.result === "string" ? inv.result : JSON.stringify(inv.result ?? "");
      return CITE_RE.test(r);
    });

    let rounds = 0;
    let outcome: string;
    if (initialCited) {
      outcome = "already_cited"; // answer already carries ≥1 valid token
    } else if (!sourcesWereCiteable) {
      outcome = "no_citeable_sources"; // honest no-data / nothing citeable retrieved
    } else {
      // Uncited answer with citeable sources available → nudge to fix.
      for (let nudge = 0; nudge < maxRounds; nudge++) {
        if (abortSignal?.aborted) break;
        if (CITE_RE.test(extractFinalAnswerText(session, opts.finalAnswerMaxTurns) ?? "")) break; // became cited mid-loop
        rounds = nudge + 1;
        log.info(`[agent] citationReflection: uncited answer with citeable sources — nudging ${rounds}/${maxRounds}`);
        pushDebugEvent("citation_reflection", { phase: "nudge", round: rounds, maxRounds });
        await promptWithAbort(() => session.prompt(`<system>${CITATION_REFLECTION_NUDGE}</system>`));
        const nq = session as unknown as { _agentEventQueue?: Promise<void> };
        if (nq._agentEventQueue) {
          await withAbort(nq._agentEventQueue);
        }
      }
      outcome = abortSignal?.aborted
        ? "aborted"
        : CITE_RE.test(extractFinalAnswerText(session, opts.finalAnswerMaxTurns) ?? "")
          ? "fixed_after_nudge"
          : "still_uncited";
    }

    const finalCited = CITE_RE.test(extractFinalAnswerText(session, opts.finalAnswerMaxTurns) ?? "");
    pushDebugEvent("citation_reflection", {
      phase: "result",
      outcome,
      initialCited,
      sourcesWereCiteable,
      rounds,
      maxRounds,
      finalCited,
    });
    log.info(`[agent] citationReflection: ${outcome} (initialCited=${initialCited} sourcesCiteable=${sourcesWereCiteable} rounds=${rounds} finalCited=${finalCited})`);
  }

  // Digital Twin delivery enforcement (mention/approval flow). twin_deliver is
  // the ONLY channel to the user, so a turn that ends without it means the model
  // narrated instead of delivering. Nudge it up to twice (same mechanics as the
  // structured-output / verify passes). Fail CLOSED: if it still never delivers,
  // leave twinDeliverRef.value undefined so claw-auth stays silent rather than
  // posting the raw assistant text (chatter). This is the hardcoded reflection
  // stage the Twin always runs.
  if (twinDeliverRef) {
    const { TWIN_DELIVER_NUDGE, recoverTwinDeliveryFromText } = await import("./twin-deliver.js");
    for (let nudge = 0; nudge < 2 && twinDeliverRef.value === undefined; nudge++) {
      if (abortSignal?.aborted) break;
      log.info(`[agent] twin_deliver missing — nudge ${nudge + 1}/2 to deliver via twin_deliver`);
      pushDebugEvent("twin_deliver_reflection", { phase: "nudge", round: nudge + 1 });
      await promptWithAbort(() => session.prompt(`<system>${TWIN_DELIVER_NUDGE}</system>`));
      const nq = session as unknown as { _agentEventQueue?: Promise<void> };
      if (nq._agentEventQueue) await withAbort(nq._agentEventQueue);
    }
    // glm-via-LiteLLM intermittently LEAKS the tool call as text (native
    // <arg_key>/<arg_value> markup / JSON / call syntax) instead of a proper
    // tool_call, so pi never executes it. Recover the leaked call from the last
    // assistant turn before fail-closing — this is what makes delivery reliable
    // on a model that doesn't honour tool_calls.
    if (twinDeliverRef.value === undefined) {
      const lastText = extractFinalAnswerText(session, opts.finalAnswerMaxTurns) ?? "";
      const recovered = recoverTwinDeliveryFromText(lastText);
      if (recovered) {
        twinDeliverRef.value = recovered;
        log.info(`[agent] twin_deliver recovered from leaked tool markup (action=${recovered.action})`);
        pushDebugEvent("twin_deliver_reflection", { phase: "recovered", action: recovered.action });
      }
    }
    const delivered = twinDeliverRef.value !== undefined;
    pushDebugEvent("twin_deliver_reflection", { phase: "result", delivered, action: twinDeliverRef.value?.action ?? null });
    if (!delivered) {
      log.warn("[agent] twin_deliver: model never delivered (no tool_call, nothing to recover) — staying silent (fail-closed)");
    }
  }

  // NOTE: there used to be a raw `debug-session-<conv>.json` dump of these
  // messages at the dataDir ROOT here. It was write-only, duplicated the
  // debug snapshot below, and — living outside sessions/ — was invisible to
  // the TTL sweep, so it accumulated one ever-growing file per conversation.
  const sessionMessages = (session as unknown as { messages: Array<Record<string, unknown>> }).messages;

  // Structured output replaces the assistant's prose as the run's final text.
  // For type "markdown" the captured value is already a string; for type
  // "json" it's the payload (run.ts may re-render it through a template before
  // posting to Spaces — this is the safe default / fallback).
  const text = structuredOutputRef?.value !== undefined
    ? (typeof structuredOutputRef.value === "string"
        ? structuredOutputRef.value
        : JSON.stringify(structuredOutputRef.value, null, 2))
    : extractFinalAnswerText(session, opts.finalAnswerMaxTurns) ?? "";
  pushDebugEvent("session_end", {
    textLength: text.length,
    toolCount: toolInvocations.length,
    tokenUsage: { ...tokenUsage },
    latency: {
      totalMs: Date.now() - runStartedAt,
      llmDecodeMs: latency.llmDecodeMs,
      llmWaitMs: latency.llmWaitMs,
      llmTotalMs: latency.llmWaitMs + latency.llmDecodeMs,
      llmTurns: latency.llmTurns,
      llmRetries: latency.llmRetries,
      ...(latency.lastRetryReason ? { lastRetryReason: latency.lastRetryReason } : {}),
      ...(latency.firstTurnTtftMs != null ? { firstTurnTtftMs: latency.firstTurnTtftMs } : {}),
      ...(latency.llmDecodeMs > 0 && tokenUsage.output > 0 ? { tokensPerSec: Math.round(tokenUsage.output / (latency.llmDecodeMs / 1000)) } : {}),
      ...(latency.streamCharsPerSec != null ? { streamCharsPerSec: latency.streamCharsPerSec } : {}),
      ...(latency.streamChars ? { streamChars: latency.streamChars } : {}),
      ...(latency.streamThinkingChars ? { streamThinkingChars: latency.streamThinkingChars } : {}),
      ...(latency.streamTextChars ? { streamTextChars: latency.streamTextChars } : {}),
      toolMs: toolInvocations.reduce((sum, inv) => sum + (inv.durationMs ?? 0), 0),
    },
  });

  if (conversationId) {
    try {
      // Let any in-flight incremental partial write finish before the full
      // completion snapshot overwrites the same debug-session.json (no torn write).
      await (partialFlushPromise ?? Promise.resolve()).catch(() => {});
      const debugDir = await ensureSessionDebugDir(conversationId);
      const { writeFile } = await import("node:fs/promises");
      const debugSnapshot: DebugSessionSnapshot = {
        schemaVersion: 1,
        conversationId,
        ...(sessionId ? { sessionId } : {}),
        ...(progressMeta?.agentSlug ? { agentSlug: progressMeta.agentSlug } : {}),
        userId,
        ...(userName ? { userName } : {}),
        ...(userEmail ? { userEmail } : {}),
        ...(provider ? { provider } : {}),
        startedAt: debugStartedIso,
        finishedAt: new Date().toISOString(),
        task,
        ...(context ? { context } : {}),
        ...(systemPromptOverride ? { systemPromptOverride: true } : {}),
        messages: cloneForDebug(sessionMessages ?? []),
        toolInvocations: cloneForDebug(toolInvocations),
        tokenUsage: { ...tokenUsage },
        latency: {
          totalMs: Date.now() - runStartedAt,
          llmDecodeMs: latency.llmDecodeMs,
          llmWaitMs: latency.llmWaitMs,
          llmTotalMs: latency.llmWaitMs + latency.llmDecodeMs,
          llmTurns: latency.llmTurns,
          llmRetries: latency.llmRetries,
          ...(latency.lastRetryReason ? { lastRetryReason: latency.lastRetryReason } : {}),
          ...(latency.firstTurnTtftMs != null ? { firstTurnTtftMs: latency.firstTurnTtftMs } : {}),
          ...(latency.llmDecodeMs > 0 && tokenUsage.output > 0 ? { tokensPerSec: Math.round(tokenUsage.output / (latency.llmDecodeMs / 1000)) } : {}),
          ...(latency.streamCharsPerSec != null ? { streamCharsPerSec: latency.streamCharsPerSec } : {}),
          ...(latency.streamChars ? { streamChars: latency.streamChars } : {}),
          ...(latency.streamThinkingChars ? { streamThinkingChars: latency.streamThinkingChars } : {}),
          ...(latency.streamTextChars ? { streamTextChars: latency.streamTextChars } : {}),
          toolMs: toolInvocations.reduce((sum, inv) => sum + (inv.durationMs ?? 0), 0),
        },
        lastAssistantText: text,
        events: cloneForDebug(debugEvents),
      };
      await writeFile(`${debugDir}/debug-session.json`, JSON.stringify(debugSnapshot, null, 2), "utf8");
      await writeFile(`${debugDir}/debug-events.json`, JSON.stringify(debugEvents, null, 2), "utf8");
      // Per-run snapshots go straight to GCS, NOT the PVC: each one embeds the
      // full conversation so far, so keeping them on disk grows O(turns²) per
      // conversation and the TTL sweep never reclaims an active thread (prod
      // ENOSPC, 2026-06-12). The debug route reads them back from GCS. Local
      // write only as a fallback (local dev / GCS down) so debugging still works.
      const safeSessionId = (sessionId ?? "local").replace(/[^a-zA-Z0-9_-]/g, "-");
      const runFile = `debug-run-${runStartedAt}-${safeSessionId}.json`;
      const runSnapshot = Buffer.from(JSON.stringify(debugSnapshot), "utf8");
      if (await gcsUploadDebugRun(conversationId, runFile, runSnapshot)) {
        log.info(`[agent] Debug artifacts written: ${debugDir}/debug-session.json, gcs:${runFile}`);
      } else {
        await writeFile(`${debugDir}/${runFile}`, runSnapshot);
        log.info(`[agent] Debug artifacts written: ${debugDir}/debug-session.json, ${debugDir}/${runFile} (GCS unavailable)`);
      }
      debugWritten = true;
    } catch (err) {
      log.warn(`[agent] Failed to write debug artifacts: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Log context usage for monitoring
  const contextUsage = session.getContextUsage?.();
  if (contextUsage) {
    log.info(`[agent] Context usage: ${contextUsage.tokens ?? "?"}/${contextUsage.contextWindow} tokens (${contextUsage.percent ?? "?"}%)`);
  }

  // Check if the agent ended with an error (framework swallows errors into the assistant message)
  const lastMsg = (session as unknown as { messages: Array<{ role: string; stopReason?: string; errorMessage?: string; usage?: { input?: number; output?: number } }> }).messages
    ?.slice()
    .reverse()
    .find((m) => m.role === "assistant");
  if (lastMsg?.stopReason === "error" || lastMsg?.errorMessage) {
    metric.count("agent_stop_error", { provider: provider ?? "spaces", stopReason: lastMsg.stopReason });
    log.error(`[agent] Session ended with error: ${lastMsg.errorMessage ?? "unknown"} (stopReason: ${lastMsg.stopReason})`);
  }
  if (lastMsg && !text) {
    // Empty text at the source (before run.ts's fallback decision) — labelled
    // by stopReason so we can tell overflow-empty from quota-empty from clean-stop.
    metric.count("agent_empty_text", { provider: provider ?? "spaces", stopReason: lastMsg.stopReason });
    log.warn(`[agent] Empty text but stopReason=${lastMsg.stopReason}, usage=${JSON.stringify(lastMsg.usage ?? {})}`);
  }
  if (!text) {
    log.warn(`[agent] Session produced empty response for user ${userId}`);
  }

  // Don't dispose persistent sessions — just let them persist on disk
  if (!conversationId) {
    session.dispose();
  }

  // ── Finalize latency ────────────────────────────────────────────────
  const totalMs = Date.now() - runStartedAt;
  const toolMs = toolInvocations.reduce((sum, inv) => sum + (inv.durationMs ?? 0), 0);
  const llmTotalMs = latency.llmWaitMs + latency.llmDecodeMs;
  const tokensPerSec = latency.llmDecodeMs > 0 && tokenUsage.output > 0
    ? Math.round(tokenUsage.output / (latency.llmDecodeMs / 1000))
    : undefined;
  const latencyMetrics: LatencyMetrics = {
    totalMs,
    llmDecodeMs: latency.llmDecodeMs,
    llmWaitMs: latency.llmWaitMs,
    llmTotalMs,
    llmTurns: latency.llmTurns,
    llmRetries: latency.llmRetries,
    ...(latency.lastRetryReason ? { lastRetryReason: latency.lastRetryReason } : {}),
    ...(latency.firstTurnTtftMs != null ? { firstTurnTtftMs: latency.firstTurnTtftMs } : {}),
    ...(tokensPerSec != null ? { tokensPerSec } : {}),
    toolMs,
  };
  // Run-level summary line — pairs with the existing `[run] Completed:` line
  // in routes/run.ts but lives here too so persistent-session resumes (which
  // skip some of the run.ts wrapping) still emit it.
  log.info(
    `[agent] Latency: total=${totalMs}ms llm=${llmTotalMs}ms (wait=${latency.llmWaitMs}ms decode=${latency.llmDecodeMs}ms) ` +
    `tools=${toolMs}ms turns=${latency.llmTurns} retries=${latency.llmRetries}` +
    (latencyMetrics.firstTurnTtftMs != null ? ` ttft=${latencyMetrics.firstTurnTtftMs}ms` : "") +
    (tokensPerSec != null ? ` tps=${tokensPerSec}` : "") +
    (latency.lastRetryReason ? ` lastRetry="${latency.lastRetryReason}"` : ""),
  );

  // Session-wide valid citation tokens (all turns' tool outputs in the resumed
  // transcript) so run.ts can sanitize WITHOUT stripping legitimate cross-turn
  // re-citations of an earlier turn's tool chunk.
  const sessionClfTokens = extractSessionClfTokens(
    (session as unknown as { messages?: unknown }).messages,
  );
  return { text, toolsUsed, toolInvocations, tokenUsage, latency: latencyMetrics, sessionClfTokens, ...(streamedReasoning ? { reasoning: streamedReasoning } : {}), ...(twinDeliverRef?.value !== undefined ? { twinDelivery: twinDeliverRef.value } : {}) };
  } finally {
    // Always stop the progress reporter's keep-alive timer so it doesn't keep
    // pinging after the agent finishes — including on thrown errors.
    stopStreamRateTimer();
    reportProgress.stop();
    if (stallWatchdog) clearInterval(stallWatchdog);
    metric.observe("tool_calls_per_run", toolBudget.calls, {
      session: sessionId ?? conversationId ?? "unknown",
      agent: progressMeta?.agentSlug ?? "unknown",
    });

    // Fallback debug write — fires when the success-path block didn't run
    // because the agent loop threw (cancel / transient provider error / any
    // other error). Without this the debugger UI shows nothing for the run
    // after a Stop click, even though we already have all session events,
    // tool invocations, and partial assistant text in memory. The success
    // path sets debugWritten=true above so we don't double-write.
    if (!debugWritten && conversationId) {
      try {
        // Let any in-flight incremental partial write finish before the fallback
        // snapshot overwrites the same debug-session.json (no torn write).
        await (partialFlushPromise ?? Promise.resolve()).catch(() => {});
        const debugDir = await ensureSessionDebugDir(conversationId);
        const { writeFile } = await import("node:fs/promises");
        let partialSessionMessages: Array<Record<string, unknown>> = [];
        try {
          partialSessionMessages = (session as unknown as { messages: Array<Record<string, unknown>> }).messages ?? [];
        } catch { /* session may not be initialised yet */ }
        const partialText = streamedText || (() => {
          try { return session.getLastAssistantText() ?? ""; } catch { return ""; }
        })();
        const debugSnapshot: DebugSessionSnapshot = {
          schemaVersion: 1,
          conversationId,
          ...(sessionId ? { sessionId } : {}),
          ...(progressMeta?.agentSlug ? { agentSlug: progressMeta.agentSlug } : {}),
          userId,
          ...(userName ? { userName } : {}),
          ...(userEmail ? { userEmail } : {}),
          ...(provider ? { provider } : {}),
          cancelled: true,
          startedAt: debugStartedIso,
          finishedAt: new Date().toISOString(),
          task,
          ...(context ? { context } : {}),
          ...(systemPromptOverride ? { systemPromptOverride: true } : {}),
          messages: cloneForDebug(partialSessionMessages),
          toolInvocations: cloneForDebug(toolInvocations),
          tokenUsage: { ...tokenUsage },
          latency: {
            totalMs: Date.now() - runStartedAt,
            llmDecodeMs: latency.llmDecodeMs,
            llmWaitMs: latency.llmWaitMs,
            llmTotalMs: latency.llmWaitMs + latency.llmDecodeMs,
            llmTurns: latency.llmTurns,
            llmRetries: latency.llmRetries,
            ...(latency.lastRetryReason ? { lastRetryReason: latency.lastRetryReason } : {}),
            ...(latency.firstTurnTtftMs != null ? { firstTurnTtftMs: latency.firstTurnTtftMs } : {}),
            ...(latency.streamCharsPerSec != null ? { streamCharsPerSec: latency.streamCharsPerSec } : {}),
            ...(latency.streamChars ? { streamChars: latency.streamChars } : {}),
            ...(latency.streamThinkingChars ? { streamThinkingChars: latency.streamThinkingChars } : {}),
            ...(latency.streamTextChars ? { streamTextChars: latency.streamTextChars } : {}),
            toolMs: toolInvocations.reduce((sum, inv) => sum + (inv.durationMs ?? 0), 0),
          },
          lastAssistantText: partialText,
          events: cloneForDebug(debugEvents),
        };
        await writeFile(`${debugDir}/debug-session.json`, JSON.stringify(debugSnapshot, null, 2), "utf8");
        await writeFile(`${debugDir}/debug-events.json`, JSON.stringify(debugEvents, null, 2), "utf8");
        const safeSessionId = (sessionId ?? "local").replace(/[^a-zA-Z0-9_-]/g, "-");
        const runFile = `debug-run-${runStartedAt}-${safeSessionId}.json`;
        const runSnapshot = Buffer.from(JSON.stringify(debugSnapshot), "utf8");
        if (await gcsUploadDebugRun(conversationId, runFile, runSnapshot)) {
          log.info(`[agent] Debug artifacts written (cancelled): ${debugDir}/debug-session.json, gcs:${runFile}`);
        } else {
          await writeFile(`${debugDir}/${runFile}`, runSnapshot);
          log.info(`[agent] Debug artifacts written (cancelled): ${debugDir}/debug-session.json, ${debugDir}/${runFile} (GCS unavailable)`);
        }
        debugWritten = true;
      } catch (err) {
        log.warn(`[agent] Failed to write partial debug artifacts: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  } finally {
    // HA cleanup: final checkpoint of the last turn to GCS, drop from the
    // active set, and release the conversation lock so another pod can take
    // over. All best-effort — never mask the run's own result/error.
    if (conversationId) {
      if (handoff?.isCapAborted() === true) {
        await waitForCapAbortIdle?.();
      }
      if (sessionReadyForFinalArchive) {
        const archived = await flushSessionNow(conversationId);
        if (!archived) {
          log.error(`[agent] Final session archive failed for ${conversationId}; local session retained`);
        }
      } else {
        log.error(`[agent] Skipping final archive for ${conversationId}; session freshness was not established`);
      }
      markSessionIdle(conversationId);
      await releaseSessionLock(conversationId);
    }
    // Skills are materialized under session-skills/<sessionId> at the top of
    // each run and re-written on resume — delete them so they don't accumulate
    // on disk forever. (Re-created next turn; safe to remove here.)
    if (sessionId && skills && skills.length > 0) {
      await deleteSessionSkills(sessionId);
    }
  }
}
