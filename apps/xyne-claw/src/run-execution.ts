import {
  ensureActiveRun,
  finishActiveRun,
  normalizeExperimentContext,
  processTask,
} from "./routes/run.js";
import { resolveTaskCommandMode } from "./task-commands.js";
import type {
  CallableAgentLightSpec,
  CallableAgentSpec,
} from "./agent-delegation.js";
import { createLogger } from "./logger.js";

const clog = createLogger("run-execution");

export interface InternalRunPayload {
  userId?: string;
  userName?: string;
  userEmail?: string;
  task?: string;
  context?: string;
  conversationId?: string;
  /** When set, this OVERRIDES conversationId for the persistent-session
   *  lookup (the PI session JSONL filename). Used by chat branching: the
   *  conversation row stays the same so the UI keeps one thread, but the
   *  underlying PI session lives at a branched id like
   *  `${conversationId}__branch__${assistantMessageId}` so context from the
   *  selected branch doesn't leak across siblings. */
  piSessionConversationId?: string;
  // Optional upstream-provided Spaces thread/conversation ID. Surfaced to
  // the agent's system metadata so it can construct thread-link citations
  // even when the agent session's own conversationId is a synthetic one
  // (e.g. scheduled job IDs). Caller-side wiring: webhook.ts / agent-chat.ts
  // forward this field when they have a Spaces conversation context.
  spacesConversationId?: string;
  callbackUrl?: string;
  systemPrompt?: string;
  agentConfig?: Record<string, unknown>;
  agentSlug?: string;
  channelId?: string;
  cwd?: string;
  eventType?: string;
  scheduledJobId?: string;
  traceId?: string;
  skills?: {
    slug?: string;
    name: string;
    description?: string;
    content: string;
    // Bundled skill files (scripts/, assets, …) materialized alongside
    // SKILL.md by writeSessionSkills. Omitting this here silently dropped a
    // skill's script folder on the top-level run path.
    files?: { relativePath: string; content: string; contentType?: string | null }[];
  }[];
  provider?: string;
  // Ordered fallback chain set by the agent owner via the Provider tab.
  // First entry is the primary parent; subsequent entries are walked on
  // quota exhaustion before dropping to "spaces" (LiteLLM/Kimi).
  providerOrder?: string[];
  subagentProviders?: Record<string, string>;
  subagentProviderMode?: "parent" | "spaces" | "fast-model";
  providerConfigs?: Record<
    string,
    {
      apiKey: string;
      model: string;
      baseUrl?: string;
      authType?: string;
      reasoningEffort?: string;
    }
  >;
  progressUrl?: string;
  attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
  recordingRefs?: Array<{ attachmentId: string; fileName: string; mimeType: string; fileSize: number }>;
  contextFiles?: Array<{ path: string; content: string }>;
  /** Set by claw-auth's awakening dispatcher for an unattended run. */
  awakening?: {
    kind: string;
    writePolicy: string;
    shadow: boolean;
    injectEnabled?: boolean;
    windowStartMs?: number;
    windowEndMs?: number;
    entryPath?: string;
  };
  additionalInstructions?: string;
  researchContext?: {
    type: string;
    id?: string;
    name: string;
    repositoryId?: string;
    productId?: string;
  };
  customSubagents?: import("./subagent-tools.js").CustomSubagentSpec[];
  callableAgents?: Array<CallableAgentSpec | CallableAgentLightSpec>;
  delegationMode?: "orchestrator";
  // claw-auth-issued per-run identifiers. sessionId is the URL-bound run id;
  // sessionToken is an HMAC bearer used on every outbound /sessions/:sessionId/mcp/*
  // call back to claw-auth. Both REQUIRED in production — required check below.
  sessionId?: string;
  sessionToken?: string;
  ticketIds?: string[];
  canvasIds?: string[];
  callIds?: string[];
  // Stable per-unit-of-work key for run idempotency. Set by the recovery
  // worker to the rootSessionId so a re-dispatch of an already-completed run
  // is detected (via the GCS result marker) and NOT re-executed. Absent on
  // first dispatch (the marker is then keyed by sessionId).
  idempotencyKey?: string;
  // `/compact`: force a one-shot compaction of the resumed session before the
  // first turn runs (only fires when resuming an existing session). Plumbed
  // into the initial runAttempt below.
  compactBeforeRun?: boolean;
  /** Branching: when true, runTask branches the PI session at the last user
   *  entry so the new assistant turn becomes a sibling of the previous one. */
  isRegenerate?: boolean;
  detached?: boolean;
  fastMode?: boolean;
  resumedFromHandoff?: boolean;
  memoryBankId?: string;
  /** Digital Twin mention flow: real reply destinations the user can post in
   *  (their accessible channels/threads), built by claw-auth from Spaces
   *  memberships. Injected into the mandatory twin_deliver tool as a
   *  provider-constrained enum so the model can't invent a channel id. */
  twinDestinations?: import("xyne-claw-shared").TwinDestinationCandidate[];
  /** Digital Twin mention flow: who @mentioned the user, and the channel name.
   *  Fed into the twin_deliver mandate's who/where line in the SYSTEM prompt so
   *  the model knows who's asking and where — the thread history only carries a
   *  raw sender id. Set by claw-auth webhook.ts on USER_MENTIONED dispatches. */
  senderName?: string;
  channelName?: string;
  /** Pipeline mode gate. 'plan' (agent.config.planMode) ⇒ read-only palette +
   *  terminal propose-plan tool; the agent proposes a plan and STOPS.
   *  'daily_brief' (agent.config.dailyBriefMode) ⇒ read-only palette + subagents
   *  + terminal emit_brief tool; the agent gathers, emits the structured brief,
   *  and STOPS. 'auto' (or absent) ⇒ today's behavior, unchanged. Set by
   *  claw-auth, trust-gated on the matching agent config flag. */
  mode?: "plan" | "auto" | "daily_brief";
  /** /experiment autonomous exploration mode context, forwarded by claw-auth. */
  experiment?: {
    id?: string;
    epoch?: number;
    deadlineAt?: string;
    focus?: string;
    /** "understanding" = coverage-gated variant: exit on an exhausted
     *  code-path frontier instead of the deadline. Set by claw-auth. */
    kind?: "understanding" | "framework" | "security" | "repo-history";
  };
  /** True when this run is Turn 2 (auto) dispatched right after a plan was
   *  approved (or a trivial plan auto-continued). Used only to emit a
   *  mode_switch debug event; behavior is identical to any other auto run. */
  planContinuation?: boolean;
  generateFollowUpSuggestions?: boolean;
}

export type RunOutcome = "completed" | "failed" | "cancelled" | "rescheduled";

export interface RunExecutionHooks {
  onDrainRequested?: () => Promise<"reschedule" | "continue">;
  /** Run-queue ownership fencing: true once this pod has lost the run-owner
   *  key to a stalled-job takeover. Output channels enforce it via the fenced
   *  session set in run-ownership.ts. */
  isFencedOut?: () => boolean;
}

export interface RunExecutionState {
  hooks?: RunExecutionHooks;
  outcome?: RunOutcome;
}

export async function executeRunFromPayload(
  payload: InternalRunPayload,
  hooks?: RunExecutionHooks,
): Promise<RunOutcome> {
  const {
    userId,
    userName,
    userEmail,
    task,
    context,
    conversationId,
    piSessionConversationId,
    spacesConversationId,
    callbackUrl,
    systemPrompt,
    agentConfig,
    agentSlug,
    channelId,
    cwd: requestCwd,
    eventType,
    scheduledJobId,
    traceId,
    skills,
    provider,
    providerOrder,
    subagentProviders,
    subagentProviderMode,
    providerConfigs,
    progressUrl,
    attachments,
    recordingRefs,
    contextFiles,
    additionalInstructions,
    researchContext,
    customSubagents,
    callableAgents,
    delegationMode,
    sessionId: providedSessionId,
    sessionToken,
    ticketIds,
    canvasIds,
    callIds,
    idempotencyKey,
    compactBeforeRun,
    isRegenerate,
    fastMode,
    resumedFromHandoff,
    memoryBankId,
    twinDestinations,
    senderName,
    channelName,
    mode,
    experiment: rawExperiment,
    planContinuation,
    awakening,
    generateFollowUpSuggestions: shouldGenerateFollowUpSuggestions,
  } = payload;

  const sessionId = (providedSessionId ?? "").trim();
  const trimmedSessionToken = (sessionToken ?? "").trim();
  if (!sessionId || !trimmedSessionToken) {
    clog.error(`[run-execution] refusing run without sessionId/sessionToken (sessionId=${sessionId || "(empty)"})`);
    return "failed";
  }
  const effectiveMode = resolveTaskCommandMode(task ?? "", mode);
  const experiment = normalizeExperimentContext(rawExperiment);
  const activeRun = ensureActiveRun(sessionId, payload);
  const state: RunExecutionState = hooks ? { hooks } : {};

  try {
    // Process in background
    await processTask(
      sessionId,
      trimmedSessionToken,
      (userId ?? "").trim(),
      (task ?? "").trim(),
      context,
      userName,
      userEmail,
      conversationId,
      piSessionConversationId,
      spacesConversationId,
      callbackUrl,
      systemPrompt,
      agentConfig,
      agentSlug,
      channelId,
      requestCwd,
      eventType,
      scheduledJobId,
      traceId,
      skills,
      provider,
      providerOrder,
      subagentProviders,
      subagentProviderMode,
      providerConfigs,
      progressUrl,
      attachments,
      recordingRefs,
      contextFiles,
      additionalInstructions,
      researchContext,
      customSubagents,
      callableAgents,
      delegationMode,
      ticketIds,
      canvasIds,
      callIds,
      idempotencyKey,
      isRegenerate,
      activeRun.abortController.signal,
      () => activeRun.abortController.abort(),
      compactBeforeRun,
      fastMode,
      resumedFromHandoff,
      memoryBankId,
      twinDestinations,
      senderName,
      channelName,
      effectiveMode,
      experiment,
      planContinuation,
      shouldGenerateFollowUpSuggestions,
      typeof callbackUrl === "string" ? callbackUrl : undefined,
      awakening,
      state,
    );
  } catch (err) {
    clog.error(
      `[run-execution] run threw (sessionId=${sessionId}): ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
    );
    return "failed";
  } finally {
    finishActiveRun(sessionId, activeRun);
  }

  if (state.outcome) return state.outcome;
  if (activeRun.userCancelled === true || activeRun.abortController.signal.aborted) return "cancelled";
  return "completed";
}
