import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type Response } from "express";
import { isFencedSession } from "../run-ownership.js";
import { buildPublishReviewRoomTool } from "../pr-review-room.js";
import {
  runTask,
  pushAttachment,
  pushInvocation,
  pushDebugProgress,
  applyCopilotProxyIfNeeded,
  ProviderStallError,
  RunHandoffError,
  RunCancelledError,
  QuotaExhaustedError,
  isProviderAuthError,
  isQuotaExhaustedError,
  isTransientProviderError,
  type ImageContent,
  type ProgressDest,
  type ProgressEmitter,
  type Attachment,
} from "../agent.js";
import {
  frameSseEvent,
  KEEPALIVE_FRAME,
  type ClawStreamEvent,
  type ClawAttachmentPayload,
  type ClawSandboxPreviewPayload,
  type ClawStreamMeta,
  type ClawDoneStatus,
  type Todo,
  type UiWidget,
  type ToolExecutionContext,
  cleanupSdlcSandboxCredentialsForContext,
} from "xyne-claw-shared";
import { SessionLockedError } from "../session-lock.js";
import { SandboxUnavailableError } from "../sandbox-unavailable.js";
import { isSafeId } from "../safe-id.js";
import { sanitizeCitations } from "../citation-sanitizer.js";
import { validateS2SKey } from "../middleware/auth.js";
import { transientProviderCallback } from "../transient-provider-callback.js";
import { loadMcpToolsForUser } from "../mcp.js";
import { trustedSdlcToolBindings } from "../sdlc-wiki-tool-bindings.js";
import { loadCustomTools } from "../custom-tools.js";
import { buildCopilotTool } from "../copilot.js";
import { buildExperimentTools, buildExperimentReviewTools, type ExperimentContext } from "../experiment.js";
import {
  executeRunFromPayload,
  type InternalRunPayload,
  type RunExecutionState,
} from "../run-execution.js";
import {
  buildVerifiedResponseTool,
  SUBMIT_RESPONSE_SYSTEM_INSTRUCTION,
  type EvidenceRef,
} from "../verified-response.js";
import {
  parseModelSettings,
  parseOutputFormat,
  buildSubmitResultTool,
  buildSubmitResultInstruction,
  renderTemplate,
  type StructuredOutputRef,
} from "../agent-model-settings.js";
import { fetchLiteLLMWithRetry } from "@xyne/litellm-client";
import {
  asFollowUpPendingQuestion,
  buildFollowUpGenerationEndEvent,
  buildFollowUpGenerationStartEvent,
  generateFollowUpSuggestions,
  normalizeFollowUpAgentContext,
  normalizeFollowUpConversationHistory,
  shouldGenerateFollowUpsForRun,
  type FollowUpGenerationResult,
} from "../follow-up-generator.js";
import {
  buildSubagentTools,
  loadDeepwikiTools,
  loadContext7Tools,
  loadPlaywrightTools,
  type SkillTrigger,
} from "../subagent-tools.js";
import {
  buildFastModeDirectTools,
  buildFastModeMetaTools,
  buildToolCatalog,
  renderToolCatalogForPrompt,
  type FastToolRuntimeController,
  type ToolCatalogItem,
} from "../tool-catalog.js";
import {
  AgentDelegationGovernor,
  buildCallableAgentTools,
  buildOrchestratorCallableAgentTool,
  clampMaxDelegationsPerRun,
  type CallableAgentLightSpec,
  type CallableAgentSpec,
  type NestedAgentRunner,
} from "../agent-delegation.js";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  parseToolsConfig,
  COPILOT_SYSTEM_INSTRUCTION,
  REPO_CONFIGS,
  getSandboxSession,
  probeSession,
  buildSandboxStoreKey,
  clearPlan,
  isPlanToolSlug,
  // Aliased: run.ts declares a local `isReadOnlyJob` const later in the same
  // scope; this shared util is the single-source scheduled/automation check.
  isReadOnlyJob as isScheduledOrAutomationRun,
  type SetupStep,
} from "xyne-claw-shared";
import { SERVER, PATHS, LITELLM, isAllowedCallbackUrl } from "../config.js";
import { judgeChainContinuation } from "../chain-judge.js";
import { isDigitalTwinAgent, listSubsystemTaxonomy, fetchAgentPromptFiles } from "../memory.js";
import { buildMemorySearchTool } from "../memory-search.js";
import { buildMemoryWriteTool } from "../memory-write.js";
import { buildMemoryFileTools } from "../memory-file-tools.js";
import { buildTwinDeliverTool, buildTwinDeliverMandate, type TwinDeliverRef } from "../twin-deliver.js";
import { buildProposePlanTool, PROPOSE_PLAN_TOOL_NAME, type ProposePlanRef } from "../propose-plan.js";
import { presentationCatalogDefaultOn, isFreePresentationTool, buildPresentationPrimer } from "../presentation-catalog.js";
import { buildProposeAgentTool, type ProposeAgentRef } from "../propose-agent.js";
import { buildDescribeAgentTool, type DescribeAgentRef } from "../describe-agent.js";
import { buildSuggestConnectorsTool, type SuggestConnectorsRef } from "../suggest-connectors.js";
import { filterScheduledRunTools } from "../scheduled-run-tool-policy.js";
import { buildEmitBriefTool, EMIT_BRIEF_TOOL_NAME, type EmitBriefRef } from "../daily-brief.js";
import {
  buildSuggestGoalTool,
  type PendingGoalSuggestion,
} from "../suggest-goal-tool.js";
import {
  createWorkspace,
  deleteWorkspace,
  isAllowedCwd,
  writeWorkspaceTextFiles,
  writeWorkspaceBinaryFiles,
} from "../workspace.js";
import { toolOutputBaseDir, deleteSession, branchSession } from "../session-store.js";
import { gcsUploadResultMarker, gcsDownloadResultMarker } from "../storage.js";
import { takeLlmCitations } from "xyne-claw-shared";
import { ingestAttachments } from "../attachment-ingest.js";
import { metric } from "../metrics.js";
import { runWithProviderFallback } from "../provider-fallback.js";
import { isDraining } from "../drain.js";
import {
  buildDesignSystemPromptInjection,
  parseTaskCommand,
  resolveTaskCommandMode,
} from "../task-commands.js";
import { createLogger } from "../logger.js";
import {
  buildPrefetchBlock,
  prefetchEnabled,
  startPrefetchExtraction,
  type ExecutableTool,
} from "../prefetch.js";

const clog = createLogger("run");
const XYNE_CLAW_PACKAGE_DIR = fileURLToPath(new URL("../../", import.meta.url));
/** Built-in skill bundle for coverage-gated understanding runs. */
const UNDERSTANDING_SKILL_PATH = "understanding-skills";

const router = Router();

export interface ActiveRunControl {
  abortController: AbortController;
  /** Owner of the run. Used to reject cross-user cancellation. */
  userId: string;
  /** For inflight-kill forensics: who/what this run is + when it began. */
  agentSlug?: string;
  startedAtMs?: number;
  /** True when the abort was triggered by an explicit user cancel (the
   *  /run/:sessionId/cancel endpoint), as opposed to the agent's own
   *  respond-to-user termination (which also aborts the controller). Lets the
   *  catch block honor a user stop instead of posting a just-generated answer. */
  userCancelled?: boolean;
  /** Same-user follow-up requested an early, user-visible reply for the current
   *  run before the queued follow-up is dispatched. Unlike /cancel, this must
   *  complete with a posted result so the transcript remains linear. */
  gracefulInterruptRequested?: boolean;
  gracefulInterruptSummaryTimer?: ReturnType<typeof setTimeout>;
  requestGracefulInterruptSummary?: () => Promise<boolean>;
  hasCallbackUrl?: boolean;
  sseClientAttached?: boolean;
  sseReconnectGraceTimer?: ReturnType<typeof setTimeout>;
  sseEmitter?: SseProgressEmitter;
  handoffRequested?: boolean;
  handoffCapFired?: boolean;
  handoffLastTurn?: number;
  handoffCapTimer?: ReturnType<typeof setTimeout>;
  /** True when the abort came from the SIGTERM drain deadline (pod shutdown),
   *  not from anything the run did. The failure callback prefixes its error
   *  with SHUTDOWN_DRAIN so claw-auth suppresses the user-facing "internal
   *  error" notice — recovery/handoff refires these, and announcing an infra
   *  restart as an agent failure was a recurring deploy-day false alarm. */
  drainCancelled?: boolean;
}

const activeRuns = new Map<string, ActiveRunControl>();

export function ensureActiveRun(
  sessionId: string,
  payload: { userId?: string; agentSlug?: string; callbackUrl?: string },
): ActiveRunControl {
  const existing = activeRuns.get(sessionId);
  if (existing) return existing;
  const activeRun: ActiveRunControl = {
    abortController: new AbortController(),
    userId: (payload.userId ?? "").trim(),
    agentSlug: payload.agentSlug ?? "unknown",
    startedAtMs: Date.now(),
    hasCallbackUrl: typeof payload.callbackUrl === "string" && !!payload.callbackUrl.trim(),
  };
  activeRuns.set(sessionId, activeRun);
  return activeRun;
}

export function finishActiveRun(sessionId: string, activeRun: ActiveRunControl): void {
  if (activeRun.handoffCapTimer) clearTimeout(activeRun.handoffCapTimer);
  if (activeRun.gracefulInterruptSummaryTimer) clearTimeout(activeRun.gracefulInterruptSummaryTimer);
  activeRuns.delete(sessionId);
}
const configuredSseReconnectGraceMs = Number(process.env["SSE_RECONNECT_GRACE_MS"] ?? 180_000);
const SSE_RECONNECT_GRACE_MS = Number.isFinite(configuredSseReconnectGraceMs) && configuredSseReconnectGraceMs >= 0
  ? configuredSseReconnectGraceMs
  : 180_000;

function providerToolRequestCap(provider: string | undefined): number {
  const envKey = provider ? `XYNE_TOOL_REQUEST_CAP_${provider.toUpperCase()}` : "";
  const raw = (envKey ? process.env[envKey] : undefined) ?? process.env["XYNE_TOOL_REQUEST_CAP"] ?? "128";
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 128;
}

function configFastModeEnabled(agentConfig: Record<string, unknown> | undefined): boolean {
  return agentConfig?.["fastMode"] === true || agentConfig?.["fastMode"] === "true";
}

function effectiveFastMode(fastMode: boolean | undefined, agentConfig: Record<string, unknown> | undefined): boolean {
  return typeof fastMode === "boolean" ? fastMode : configFastModeEnabled(agentConfig);
}

export function normalizeExperimentContext(raw: unknown): ExperimentContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj["id"] === "string" ? obj["id"].trim() : "";
  const deadlineAt = typeof obj["deadlineAt"] === "string" ? obj["deadlineAt"].trim() : "";
  if (!id || !deadlineAt) return undefined;
  const epochValue = obj["epoch"];
  const epoch = typeof epochValue === "number" && Number.isFinite(epochValue)
    ? epochValue
    : typeof epochValue === "string" && epochValue.trim()
      ? Number(epochValue)
      : 0;
  const focus = typeof obj["focus"] === "string" && obj["focus"].trim()
    ? obj["focus"].trim()
    : undefined;
  return {
    id,
    epoch: Number.isFinite(epoch) ? epoch : 0,
    deadlineAt,
    ...(focus ? { focus } : {}),
    ...(obj["mode"] === "review" ? { mode: "review" as const } : {}),
    ...(obj["kind"] === "understanding" || obj["kind"] === "framework" || obj["kind"] === "security" || obj["kind"] === "repo-history"
      ? { kind: obj["kind"] as "understanding" | "framework" | "security" | "repo-history" }
      : {}),
  };
}

function experimentRemaining(deadlineAt: string): string {
  const deadlineMs = Date.parse(deadlineAt);
  if (!Number.isFinite(deadlineMs)) return "unknown";
  const totalMinutes = Math.max(0, Math.ceil((deadlineMs - Date.now()) / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function dedupeToolsByName(tools: ToolDefinition[]): ToolDefinition[] {
  const seen = new Set<string>();
  const out: ToolDefinition[] = [];
  for (const tool of tools) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    out.push(tool);
  }
  return out;
}

/** Snapshot for shutdown/drain forensics — one line per still-active run. */
/**
 * `read-app-file` rides on `create-app` selection.
 *
 * The two are one feature. `create-app` writes a project but hands back only a
 * manifest — file paths, never contents — so without the read half an
 * incremental update is authored from memory, which is how earlier features get
 * silently dropped. Registering a new tool does NOT add it to agents that
 * already have a saved `tools.custom` list, so fractal-agent held `create-app`
 * while never being offered its reader (observed 2026-09-02: an explicit "read
 * the code and tell me…" turn made zero tool calls and answered from context).
 *
 * Pairing at resolution time rather than per-agent means no saved selection has
 * to be migrated and no new agent can be configured into the same half-state.
 * Mirrors the sandbox → playwright hoist below.
 */
function expandCustomSelection(custom: string[] | undefined): Set<string> {
  const selected = new Set(custom ?? []);
  if (selected.has("create-app")) selected.add("read-app-file");
  return selected;
}

export function describeActiveRuns(): Array<{ sessionId: string; agentSlug: string; userId: string; ageS: number }> {
  const now = Date.now();
  return [...activeRuns.entries()].map(([sessionId, a]) => ({
    sessionId,
    agentSlug: a.agentSlug ?? "unknown",
    userId: a.userId,
    ageS: a.startedAtMs ? Math.round((now - a.startedAtMs) / 1000) : -1,
  }));
}

export function getActiveRunCount(): number {
  return activeRuns.size;
}

export function getActiveSessionIds(): string[] {
  return [...activeRuns.keys()];
}

/** Ownership fencing (run-queue path only): this pod lost the run-owner key to
 *  a stalled-job takeover, so its in-flight copy must stop producing output. */
export function abortRunForOwnershipLoss(sessionId: string): boolean {
  const active = activeRuns.get(sessionId);
  if (!active || active.abortController.signal.aborted) return false;
  clog.warn(`[run] ownership lost — aborting superseded run sessionId=${sessionId} agent=${active.agentSlug ?? "unknown"}`);
  active.drainCancelled = true;
  active.abortController.abort();
  return true;
}

export function cancelActiveRunsForDrain(reason = "server draining"): number {
  let cancelled = 0;
  for (const [sessionId, active] of activeRuns.entries()) {
    if (active.abortController.signal.aborted) continue;
    const ageS = active.startedAtMs ? Math.round((Date.now() - active.startedAtMs) / 1000) : -1;
    clog.warn(`[run] drain deadline reached — cancelling active run sessionId=${sessionId} agent=${active.agentSlug ?? "unknown"} user=${active.userId} ageS=${ageS} reason=${reason}`);
    clog.warn(`[metric] name=inflight_killed kind=count value=1 cause=drain_deadline agent=${active.agentSlug ?? "unknown"} session=${sessionId}`);
    active.drainCancelled = true;
    active.abortController.abort();
    cancelled++;
  }
  return cancelled;
}

export function requestActiveRunHandoffs(capMs: number): number {
  let requested = 0;
  const boundedCapMs = Number.isFinite(capMs) && capMs > 0 ? Math.floor(capMs) : 120_000;
  for (const [sessionId, active] of activeRuns.entries()) {
    if (active.handoffRequested) continue;
    if (!active.hasCallbackUrl) {
      clog.warn(`[run] handoff skipped for active run without callback/recovery path sessionId=${sessionId} agent=${active.agentSlug ?? "unknown"} user=${active.userId}`);
      continue;
    }
    active.handoffRequested = true;
    active.handoffLastTurn ??= 0;
    requested++;
    const ageS = active.startedAtMs ? Math.round((Date.now() - active.startedAtMs) / 1000) : -1;
    clog.warn(`[run] handoff requested for active run sessionId=${sessionId} agent=${active.agentSlug ?? "unknown"} user=${active.userId} ageS=${ageS} capMs=${boundedCapMs}`);
    active.handoffCapTimer = setTimeout(() => {
      const current = activeRuns.get(sessionId);
      if (current !== active || !current.handoffRequested || current.abortController.signal.aborted) return;
      current.handoffCapFired = true;
      clog.warn(`[run] handoff cap fired — aborting in-flight turn sessionId=${sessionId} agent=${current.agentSlug ?? "unknown"} user=${current.userId} capMs=${boundedCapMs}`);
      metric.count("handoff_turn_aborted", { agent: current.agentSlug ?? "unknown", session: sessionId });
      current.abortController.abort();
    }, boundedCapMs);
    active.handoffCapTimer.unref?.();
  }
  return requested;
}

// Appended to the agent's systemPrompt at runTime when channelId is present
// (i.e. the agent is replying in a Spaces chat thread). Lives in the system
// role — pi-coding-agent treats it as background context, not a user message,
// so the model accepts it silently instead of replying "Noted — will use the
// inline span format" every turn (which is what happened when this lived in
// the per-turn promptInjections path).
// Appended to the system prompt for agents in CITATION_GUIDE_AGENT_SLUGS only.
// Lives in the system role so the model accepts it silently.
const CITATION_GUIDE_AGENT_SLUGS = new Set<string>(["ask-ai"]);
const CITATION_GUIDE = `

## Citation System

You MUST cite factual claims inline in the response text itself.

Tool outputs may already contain exact citation tokens like \`[clf-abc123#14]\`.
Copy those tokens verbatim. Do NOT invent new refs, do NOT change the tool call id, and do NOT create ranges like \`#14-#18\`.

Rules:
- Every factual claim backed by a tool result must carry at least one citation token.
- Place the token immediately after the sentence or clause it supports.
- Keep punctuation outside the token.
- One citation token = one chunk. If two separate chunks support two separate claims, cite them separately.
- If a claim is supported by multiple chunks, cite each relevant chunk inline.
- Do not append a separate citations section at the end.

Examples:

Correct:
The minimum unit size for InvIT private placements is ₹1 crore [clf-agzja79pabewihgzkfe9pa97#14]. SEBI raised this from ₹10 lakh in the 2019 amendment [clf-agzja79pabewihgzkfe9pa97#22].
Sponsor holding lock-in remains 15% for three years [clf-mn0k9pxd2vrwxa7sjqf7lq3p#88].

Incorrect:
The minimum unit size is ₹1 crore.
The minimum unit size is ₹1 crore. [1.1](cite:clf-chatcmpl-tool-9a01ab9ff7b89df8#1)
The minimum unit size is ₹1 crore [clf-agzja79pabewihgzkfe9pa97#14-#22].

The inline citation tokens are the only citation mechanism for Claw v3. Never use the legacy add-citations flow.`;

const SPACES_MENTION_GUIDE = `

## Mentioning people
To notify or tag someone in this conversation, write their name with an @ in front, as plain text — e.g. \`@Amrit Raj\`. Use their real display name as it appears in the conversation. Do NOT add IDs, brackets, or look anything up — the system turns \`@Name\` into a real, clickable mention automatically. If you just want to refer to someone without notifying them, write their name with no @.

CRITICAL — mention the RIGHT person, never a guessed one:
- Do NOT append a raw user ID or random token to a name (e.g. \`@Tushar n9mvl...\`) — appending an ID you don't actually know produces a broken, wrong-person tag.
- Tag a thread participant by their display name: \`@Display Name\` (as it appears in the conversation). To tag someone who is NOT in this thread (e.g. to notify them for FYI, or to ask them to raise/own a ticket), use their FULL EMAIL: \`@john.doe@gmail.com\` — an email resolves to exactly one person, so it is safe even for a non-participant and the system turns it into a real, notifying mention. "They are not a participant" is NOT a reason to refuse if you know their email.
- Only refer to someone by plain name with NO @ when you have NEITHER a participant display name NOR a known email — i.e. you genuinely cannot identify the exact person. Never invent or guess an email; if you're unsure of the exact address, ask the user for it rather than guessing.`;

/**
 * Best-effort decode of the claw-auth session token payload (`payloadB64.sig`).
 * We do NOT hold the signing key, so this is a consistency check only — the
 * cryptographic verification happens on claw-auth for every call that presents
 * the token (MCP, OAuth token retrieval). Rejecting uid/sid mismatches here
 * gives callers a fast 400 instead of a half-run that fails on the first
 * authenticated outbound call.
 */
function decodeSessionTokenPayload(
  raw: string,
): { sid?: string; uid?: string; aslug?: string } | null {
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = raw.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/");
  try {
    const parsed = JSON.parse(
      Buffer.from(payloadB64, "base64").toString("utf8"),
    ) as Record<string, unknown>;
    return {
      ...(typeof parsed["sid"] === "string" ? { sid: parsed["sid"] } : {}),
      ...(typeof parsed["uid"] === "string" ? { uid: parsed["uid"] } : {}),
      ...(typeof parsed["aslug"] === "string"
        ? { aslug: parsed["aslug"] }
        : {}),
    };
  } catch {
    return null;
  }
}

function toWorkspaceContextPath(input: string): string {
  const rawSegments = input.split(/[/\\]+/);
  const cleaned = rawSegments
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, "_"))
    .filter(Boolean);
  if (cleaned.length === 0) return ".context/attached-context.md";
  if (cleaned[0] !== ".context") cleaned.unshift(".context");
  return cleaned.join("/");
}

router.post("/run", validateS2SKey, async (req, res: Response) => {
  if (isDraining()) {
    res.status(503).json({ success: false, error: "xyne-claw is draining" });
    return;
  }

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
    detached,
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
  } = req.body as InternalRunPayload;

  const experiment = normalizeExperimentContext(rawExperiment);

  // [AUTODBG] claw-side receipt of every /run forward (esp. automations). Confirms
  // the request crossed claw-auth → claw and which session id it arrived under
  // (claw-auth mints a fresh UUID, so this won't be the `<exec>:step_0` id).
  clog.info(`[run] AUTODBG /run received: eventType=${eventType} sessionId=${providedSessionId} agent=${agentSlug} hasCallbackUrl=${!!callbackUrl} hasProviderConfigs=${!!providerConfigs} conv=${conversationId ?? ""}`);

  if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
    res.status(400).json({ success: false, error: "userId is required" });
    return;
  }

  if (!task || typeof task !== "string" || task.trim().length === 0) {
    res
      .status(400)
      .json({
        success: false,
        error: "task is required and must be a non-empty string",
      });
    return;
  }

  // A task command is already an explicit execution contract. Do not route it
  // through the generic plan-mode approval turn, which would replace the
  // original `/command ...` task with an "Execute this approved plan" prompt.
  const effectiveMode = resolveTaskCommandMode(task, mode);

  if (
    !providedSessionId ||
    typeof providedSessionId !== "string" ||
    providedSessionId.trim().length === 0
  ) {
    res
      .status(400)
      .json({
        success: false,
        error: "sessionId is required (must be minted by claw-auth)",
      });
    return;
  }
  if (
    !sessionToken ||
    typeof sessionToken !== "string" ||
    sessionToken.trim().length === 0
  ) {
    res
      .status(400)
      .json({
        success: false,
        error: "sessionToken is required (must be minted by claw-auth)",
      });
    return;
  }

  const sessionId = providedSessionId.trim();

  // These three flow into path.join(...) for workspaces/sessions (and rm -rf
  // on cleanup) plus the result-callback URL path — reject anything that
  // isn't a plain opaque id before any of that machinery sees it.
  if (!isSafeId(sessionId)) {
    res
      .status(400)
      .json({ success: false, error: "sessionId has invalid format" });
    return;
  }
  if (
    conversationId !== undefined &&
    (typeof conversationId !== "string" || !isSafeId(conversationId))
  ) {
    res
      .status(400)
      .json({ success: false, error: "conversationId has invalid format" });
    return;
  }
  if (
    agentSlug !== undefined &&
    (typeof agentSlug !== "string" || !isSafeId(agentSlug))
  ) {
    res
      .status(400)
      .json({ success: false, error: "agentSlug has invalid format" });
    return;
  }
  // idempotencyKey becomes a GCS object name (claw-results/<key>.json) — same
  // charset guard as the other ids.
  if (
    idempotencyKey !== undefined &&
    (typeof idempotencyKey !== "string" || !isSafeId(idempotencyKey))
  ) {
    res
      .status(400)
      .json({ success: false, error: "idempotencyKey has invalid format" });
    return;
  }
  // cwd becomes the agent working dir and the attachment write root — never
  // accept a path outside the workspaces root / configured allowlist
  // (XYNE_CLAW_ALLOWED_CWD_ROOTS). See isAllowedCwd in workspace.ts.
  if (
    requestCwd !== undefined &&
    (typeof requestCwd !== "string" || !isAllowedCwd(requestCwd))
  ) {
    res
      .status(400)
      .json({ success: false, error: "cwd is not under an allowed root" });
    return;
  }
  // The sessionToken claw-auth minted binds {sid, uid}. Reject runs where the
  // body's userId/sessionId disagree with the token — a leaked S2S key can't
  // mint a token for a victim, so this (with claw-auth's signature check on
  // every outbound call) stops body-userId impersonation at the front door.
  const tokenPayload = decodeSessionTokenPayload(sessionToken.trim());
  if (
    !tokenPayload ||
    tokenPayload.uid !== userId.trim() ||
    tokenPayload.sid !== sessionId
  ) {
    res
      .status(400)
      .json({
        success: false,
        error: "sessionToken does not match userId/sessionId",
      });
    return;
  }

  // Transport selector: SSE if the caller asked for it, else legacy JSON+POSTs.
  // Logged unconditionally so prod incidents like "claw-auth thinks it's SSE but
  // claw answered in JSON" are diagnosable from a single line per request.
  const accept = (req.headers["accept"] as string | undefined) ?? "";
  const sseRequested = accept.includes("text/event-stream");
  clog.info(`[run] transport: ${sseRequested ? "sse" : "legacy"} (accept=${JSON.stringify(accept)}, sessionId=${sessionId})`);

  const existingActive = activeRuns.get(sessionId);
  if (sseRequested && existingActive?.sseEmitter && !existingActive.abortController.signal.aborted) {
    // Reject cross-user reattach outright — the sessionToken sid/uid binding
    // upstream should already guarantee this; defense-in-depth.
    if (existingActive.userId !== userId.trim()) {
      res.status(403).json({ success: false, error: "session belongs to another user" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (existingActive.sseReconnectGraceTimer) {
      clearTimeout(existingActive.sseReconnectGraceTimer);
      delete existingActive.sseReconnectGraceTimer;
    }
    existingActive.sseClientAttached = true;
    existingActive.sseEmitter.attachResponse(res);
    // Run finished during the disconnect gap (done written to the dead socket,
    // activeRuns entry not yet cleaned): replay the terminal frame instead of
    // streaming `started` and hanging forever — done() refuses to re-emit via
    // its doneWritten guard, so without this replay the reattached client
    // never receives a terminal event.
    if (existingActive.sseEmitter.wroteDone()) {
      const terminal = existingActive.sseEmitter.terminalPayload();
      clog.info(`[run/sse] reattach after completion — replaying terminal frame (sessionId=${sessionId})`);
      try {
        // Same frame shape the live done uses: consumers read `event.result`.
        res.write(frameSseEvent({
          event: "done",
          seq: Number.MAX_SAFE_INTEGER,
          sessionId,
          result: (terminal?.payload ?? { status: "completed" }),
        } as unknown as ClawStreamEvent));
      } catch { /* socket already gone */ }
      res.end();
      return;
    }
    existingActive.sseEmitter.writeStarted();
    const keepaliveTimer = setInterval(() => {
      try { res.write(KEEPALIVE_FRAME); } catch { /* response already closed */ }
    }, 25_000);
    attachSseCloseHandler({
      res,
      keepaliveTimer,
      activeRun: existingActive,
      sessionId,
      emitter: existingActive.sseEmitter,
    });
    return;
  }

  const abortController = new AbortController();
  const activeRun: ActiveRunControl = {
    abortController,
    userId: userId.trim(),
    agentSlug: agentSlug ?? "unknown",
    startedAtMs: Date.now(),
    hasCallbackUrl: typeof callbackUrl === "string" && !!callbackUrl.trim(),
  };
  activeRuns.set(sessionId, activeRun);

  if (detached === true) {
    clog.info(`[run] detached dispatch accepted (sessionId=${sessionId}, eventType=${eventType ?? ""})`);
    res.status(202).json({ success: true, sessionId });

    processTask(
      sessionId,
      sessionToken.trim(),
      userId.trim(),
      task.trim(),
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
      abortController.signal,
      () => abortController.abort(),
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
    ).finally(() => {
      if (activeRun.handoffCapTimer) clearTimeout(activeRun.handoffCapTimer);
      if (activeRun.gracefulInterruptSummaryTimer) clearTimeout(activeRun.gracefulInterruptSummaryTimer);
      activeRuns.delete(sessionId);
    });
    return;
  }

  // SSE mode: caller (e.g. claw-auth's run-stream proxy) opted in by sending
  // Accept: text/event-stream. We hold the response open, write every progress
  // event as an SSE frame to a single TCP connection — order is preserved by
  // construction — and write `event: done` with the final result before
  // closing. callbackUrl / progressUrl from the body are ignored in this mode
  // since the response stream IS the channel.
  if (sseRequested) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const emitter = makeSseProgressEmitter(res, sessionId);
    activeRun.sseEmitter = emitter;
    activeRun.sseClientAttached = true;
    emitter.writeStarted();

    // Periodic keepalive comment so middleboxes/HTTP-keep-alives don't idle
    // the connection during long stretches of no agent output (e.g. a slow
    // tool execution). Comments are ignored by the spec-compliant parser.
    const keepaliveTimer = setInterval(() => {
      try { res.write(KEEPALIVE_FRAME); } catch { /* response already closed */ }
    }, 25_000);

    // If the consumer disconnects mid-run, callback-backed runs keep going
    // headless so the terminal callback can finalize the caller. Pure-SSE
    // runs get a reconnect grace before we abort to avoid burning tokens
    // forever.
    //
    // Use res.on("close"), NOT req.on("close"): IncomingMessage emits 'close'
    // as soon as the request body is fully consumed by Express's body parser,
    // which happens before the route handler even starts running anything
    // meaningful. That would abort the agent before it produced a single
    // token. res.on("close") fires only when the response socket actually
    // closes — when the client (the proxy in our case) hangs up — so it
    // distinguishes "we finished and called res.end()" (writableEnded=true)
    // from "client went away" (writableEnded=false).
    attachSseCloseHandler({
      res,
      keepaliveTimer,
      activeRun,
      sessionId,
      emitter,
    });

    // Also catch the explicit Stop-button path: claw-auth's /cancel hits
    // /run/:sessionId/cancel which calls activeRuns.get(sid).abortController
    // .abort(). That fires the signal directly — without this listener we'd
    // only emit `cancelled` on a raw socket disconnect, not on the well-
    // behaved /cancel POST. Idempotent: writeCancelled() short-circuits on
    // its own guard.
    const onAbortSignal = () => {
      if (!res.writableEnded) {
        emitter.writeCancelled(sessionId, "cancel requested");
      }
    };
    abortController.signal.addEventListener("abort", onAbortSignal, { once: true });

    let processTaskError: unknown = undefined;
    try {
      await processTask(
        sessionId,
        sessionToken.trim(),
        userId.trim(),
        task.trim(),
        context,
        userName,
        userEmail,
        conversationId,
        piSessionConversationId,
        spacesConversationId,
        emitter,
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
        emitter,
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
        abortController.signal,
        () => abortController.abort(),
        compactBeforeRun,
        // fastMode was silently dropped on THIS branch only (detached + legacy
        // JSON forwarded it) — Spaces mentions ride the SSE pass-through, so
        // /fast acked but never applied to mention threads (2026-07-15).
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
      );
    } catch (err) {
      processTaskError = err;
    } finally {
      clearInterval(keepaliveTimer);
      if (activeRun.sseReconnectGraceTimer) {
        clearTimeout(activeRun.sseReconnectGraceTimer);
      }
      if (activeRun.handoffCapTimer) clearTimeout(activeRun.handoffCapTimer);
      if (activeRun.gracefulInterruptSummaryTimer) clearTimeout(activeRun.gracefulInterruptSummaryTimer);
      activeRuns.delete(sessionId);
      // Backstop: processTask has several silent-return paths (most notably
      // SessionLockedError — another pod owns this run and suppresses the
      // callback) and any future throw outside its try/catch around
      // sendCallback. In legacy HTTP mode that's fine because the owning pod
      // will POST the result. In SSE mode the consumer is waiting on a `done`
      // frame on THIS connection — without it, the stream hangs and the
      // consumer raises "ended without a done frame". So if the emitter
      // hasn't written done by the time we get here, write one now.
      if (!emitter.wroteDone()) {
        const reason = processTaskError instanceof Error
          ? processTaskError.message
          : processTaskError !== undefined
            ? String(processTaskError)
            : "Run ended without emitting a result (likely session-locked or silent early-return — check claw logs for this sessionId)";
        // Reaching here means the emitter never wrote a done frame — the run
        // produced NO result. That is a failure whether or not something was
        // thrown: a loop that gives up after every LLM turn 429s throws
        // nothing, yet used to finalize as "completed" with a zero-length
        // answer. Eight consecutive runs reported success that way on
        // 2026-09-02 while the LiteLLM key was rate-limited, which is why the
        // outage read as "the agent silently does nothing" for hours. The
        // `reason` string above already describes a failure; the status now
        // agrees with it.
        emitter.forceDone(sessionId, "failed", reason);
      }
      const terminal = emitter.terminalPayload();
      if (terminal && emitter.deliveryFailed() && typeof callbackUrl === "string" && callbackUrl.trim()) {
        clog.warn(`[run/sse] terminal frame was not delivered over SSE; posting fallback callback (sessionId=${sessionId})`);
        await sendCallback(callbackUrl, sessionToken.trim(), terminal.payload).catch((err) =>
          clog.error(`[run/sse] fallback callback failed (session=${sessionId}): ${err instanceof Error ? err.message : String(err)}`),
        );
      }
      if (!res.writableEnded) {
        try { res.end(); } catch { /* ignore */ }
      }
    }
    return;
  }

  // Legacy JSON mode: return sessionId immediately, run agent in background,
  // POST chunks to progressUrl and the final result to callbackUrl. This is
  // the path every non-migrated caller still uses (webhook flows, agent-chat,
  // scheduled jobs, etc.). It must stay byte-identical until they migrate.
  res.json({ success: true, sessionId });

  void executeRunFromPayload({ ...(req.body as InternalRunPayload), sessionId });
});

// ── SSE producer: in-process emitter that writes ClawStreamEvent frames into
// a live HTTP response. Replaces N HTTP POSTs per chunk with N writes into
// one TCP connection. seq is monotonic per session so the consumer can
// detect drops (today we don't replay; that's the next hardening layer).
interface SseProgressEmitter extends ProgressEmitter {
  attachResponse: (res: Response) => void;
  writeStarted: () => void;
  /** Distinct cancel signal — emitted as soon as the route handler observes
   *  an aborted run, BEFORE forceDone / the cancelled done payload. Gives the
   *  consumer an early "stop the typing indicator" hook without waiting on the
   *  partial-state collection that gates `done`. Idempotent. */
  writeCancelled: (sessionId: string, reason?: string) => void;
  /** True once done() has been called. The route handler reads this in its
   *  finally so it can write a fallback done frame if processTask returned
   *  through one of the silent paths (SessionLockedError, etc.) — without
   *  this the consumer's parser hangs waiting on a done that never arrives. */
  wroteDone: () => boolean;
  /** Write a synthetic done frame on behalf of the route handler. Used as a
   *  backstop in finally so an emitter that never got done() called still
   *  emits ONE final frame before res.end() — keeps the wire contract intact. */
  forceDone: (sessionId: string, status: "completed" | "failed" | "cancelled", reason: string) => void;
  markDeliveryFailed: () => void;
  deliveryFailed: () => boolean;
  terminalPayload: () => { sessionId: string; payload: Record<string, unknown> } | null;
}

function attachSseCloseHandler(opts: {
  res: Response;
  keepaliveTimer: ReturnType<typeof setInterval>;
  activeRun: ActiveRunControl;
  sessionId: string;
  emitter: SseProgressEmitter;
}): void {
  const { res, keepaliveTimer, activeRun, sessionId, emitter } = opts;
  res.on("close", () => {
    clearInterval(keepaliveTimer);
    if (res.writableEnded || activeRun.abortController.signal.aborted) return;
    activeRun.sseClientAttached = false;
    emitter.markDeliveryFailed();
    if (activeRun.hasCallbackUrl) {
      clog.info(`[run/sse] client disconnected before done — continuing headless (sessionId=${sessionId})`);
      return;
    }
    if (activeRun.sseReconnectGraceTimer) {
      clearTimeout(activeRun.sseReconnectGraceTimer);
    }
    clog.info(`[run/sse] client disconnected before done — waiting ${SSE_RECONNECT_GRACE_MS}ms before abort (sessionId=${sessionId})`);
    activeRun.sseReconnectGraceTimer = setTimeout(() => {
      if (activeRuns.get(sessionId) !== activeRun) return;
      if (activeRun.sseClientAttached || activeRun.abortController.signal.aborted) return;
      clog.info(`[run/sse] reconnect grace expired — aborting agent (sessionId=${sessionId})`);
      emitter.writeCancelled(sessionId, "client disconnected");
      activeRun.abortController.abort();
    }, SSE_RECONNECT_GRACE_MS);
  });
}

function makeSseProgressEmitter(initialRes: Response, sessionId: string): SseProgressEmitter {
  let res = initialRes;
  let seq = 0;
  const next = () => seq++;
  let closed = false;
  let doneWritten = false;
  let cancelEmitted = false;
  let deliveryFailed = false;
  let terminalPayload: { sessionId: string; payload: Record<string, unknown> } | null = null;
  const write = (event: ClawStreamEvent): void => {
    if (closed) return;
    if (res.destroyed || res.writableEnded) {
      deliveryFailed = true;
      closed = true;
      return;
    }
    try {
      res.write(frameSseEvent(event));
    } catch (err) {
      closed = true;
      deliveryFailed = true;
      clog.warn(`[run/sse] write failed (session=${sessionId}): ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const endResponse = (): void => {
    if (!res.writableEnded) {
      try { res.end(); } catch { /* ignore */ }
    }
  };
  return {
    attachResponse: (nextRes) => {
      res = nextRes;
      closed = false;
      deliveryFailed = false;
    },
    writeStarted: () => write({ event: "started", seq: next(), sessionId }),
    markDeliveryFailed: () => {
      deliveryFailed = true;
      closed = true;
    },
    deliveryFailed: () => deliveryFailed,
    terminalPayload: () => terminalPayload,
    writeCancelled: (sid, reason) => {
      if (cancelEmitted) return;
      cancelEmitted = true;
      write({ event: "cancelled", seq: next(), sessionId: sid, ...(reason ? { reason } : {}) });
    },
    wroteDone: () => doneWritten,
    forceDone: (sid, status, reason) => {
      if (doneWritten) return;
      terminalPayload = { sessionId: sid, payload: { sessionId: sid, status, error: reason } };
      write({ event: "done", seq: next(), sessionId: sid, result: { status, error: reason } });
      doneWritten = true;
      closed = true;
      endResponse();
    },
    invocation: (sid, invocation) => write({ event: "invocation", seq: next(), sessionId: sid, toolInvocation: invocation }),
    attachment: (sid, attachment: ClawAttachmentPayload) => write({ event: "attachment", seq: next(), sessionId: sid, attachment }),
    sandboxPreview: (sid, payload: ClawSandboxPreviewPayload) => write({ event: "sandbox-preview", seq: next(), sessionId: sid, payload }),
    plan: (sid, todos: Todo[]) => write({ event: "plan", seq: next(), sessionId: sid, todos }),
    pr: (sid, pr: Record<string, unknown>) => write({ event: "pr", seq: next(), sessionId: sid, pr }),
    uiWidget: (sid, widget: UiWidget) => write({ event: "ui-widget", seq: next(), sessionId: sid, widget }),
    streamChunk: (sid, payload) => {
      if (payload.reasoningDelta !== undefined) {
        write({ event: "reasoning", seq: next(), sessionId: sid, reasoningDelta: payload.reasoningDelta });
      }
      if (payload.textDelta !== undefined) {
        write({ event: "delta", seq: next(), sessionId: sid, textDelta: payload.textDelta });
      }
    },
    debugProgress: (sid, event) => write({ event: "debug", seq: next(), sessionId: sid, debugEvent: event }),
    progressLabel: (sid, toolLabel, meta?: ClawStreamMeta) => write({
      event: "progress-label",
      seq: next(),
      sessionId: sid,
      payload: { toolLabel, ...(meta ?? {}) },
    }),
    done: async (sid, payload) => {
      if (doneWritten) return;
      // Pass the entire sendCallback payload through verbatim. /webhook/result,
      // /agent-chat/callback, and other consumers depend on fields well beyond
      // the obvious subset (userId / conversationId / agentSlug / toolsUsed /
      // tokenUsage / provider / model / reasoning / latency / pendingResponses
      // / pendingGoalSuggestion). Filtering here was the proximate cause of
      // Spaces @mention summarize losing its final reply: /webhook/result
      // needs conversationId + agentSlug to resolve session context when the
      // sessionId-based lookup races against setSession() or run-recovery.
      const status = (payload["status"] as "completed" | "failed" | "cancelled" | undefined) ?? "completed";
      const result: ClawDoneStatus = { ...payload, status };
      terminalPayload = { sessionId: sid, payload: { ...payload, status, sessionId: sid } };
      write({ event: "done", seq: next(), sessionId: sid, result });
      doneWritten = true;
      closed = true;
      endResponse();
    },
  };
}

// `/clear` — delete a thread's persisted agent session so the next message
// starts fresh (the agent forgets all prior context). Keyed the same way runs
// resume: `buildSandboxStoreKey(userId, conversationId, agentSlug)` →
// `<conversationId>_<agentSlug>`. S2S-only; claw-auth calls this when a user
// types `/clear`. Idempotent — deleting a non-existent session is a no-op.
router.post("/clear-session", validateS2SKey, async (req, res: Response) => {
  const { userId, conversationId, agentSlug } = (req.body ?? {}) as {
    userId?: string;
    conversationId?: string;
    agentSlug?: string;
  };
  if (!conversationId || typeof conversationId !== "string") {
    res.status(400).json({ success: false, error: "conversationId is required" });
    return;
  }
  const sessionKey = buildSandboxStoreKey(userId, conversationId, agentSlug) ?? conversationId;
  if (!isSafeId(sessionKey)) {
    res.status(400).json({ success: false, error: "resolved session key has invalid format" });
    return;
  }
  try {
    await deleteSession(sessionKey);
    clog.info(`[run] /clear-session: deleted session ${sessionKey}`);
    res.json({ success: true });
  } catch (err) {
    clog.error(`[run] /clear-session failed for ${sessionKey}: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ success: false, error: "failed to clear session" });
  }
});

router.post("/run/:sessionId/interrupt-with-reply", validateS2SKey, (req, res: Response) => {
  const { sessionId } = req.params as { sessionId?: string };
  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  const active = activeRuns.get(sessionId);
  if (!active) {
    res.json({ success: true, sessionId, status: "not_running" });
    return;
  }

  const callerUserId = req.headers["x-user-id"];
  if (typeof callerUserId !== "string" || !callerUserId) {
    res
      .status(403)
      .json({ success: false, error: "Not authorized to interrupt this run" });
    return;
  }
  if (callerUserId !== active.userId) {
    clog.info(
      `[run] cross-user interrupt session=${sessionId} owner=${active.userId} by=${callerUserId}`,
    );
  }

  // This is intentionally NOT userCancelled. /cancel suppresses output; a
  // follow-up in the thread wants the active turn to summarize/post what it has,
  // then let claw-auth drain the queued follow-up as the next user turn. The
  // follow-up may come from ANY user in the conversation, not just the run's
  // owner — claw-auth decides who may interrupt; this endpoint is S2S-only and
  // just needs a caller identity for the audit line above. Prefer a
  // model-generated summary via steering, but keep a bounded hard-abort fallback
  // so a stuck tool/provider cannot block the new prompt forever.
  active.gracefulInterruptRequested = true;
  if (!active.gracefulInterruptSummaryTimer) {
    const timeoutMs = Number(process.env["CLAW_INTERRUPT_SUMMARY_TIMEOUT_MS"] ?? 15_000);
    const delay = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 15_000;
    active.gracefulInterruptSummaryTimer = setTimeout(() => {
      if (!active.abortController.signal.aborted) {
        clog.warn(`[run] interrupt-with-reply summary timed out; aborting session=${sessionId}`);
        active.abortController.abort();
      }
    }, delay);
    active.gracefulInterruptSummaryTimer.unref?.();
  }
  void active.requestGracefulInterruptSummary?.().then((queued) => {
    if (!queued && !active.abortController.signal.aborted) {
      active.abortController.abort();
    }
  });
  res.json({ success: true, sessionId, status: "interrupt_requested" });
});

router.post("/run/:sessionId/cancel", validateS2SKey, (req, res: Response) => {
  const { sessionId } = req.params as { sessionId?: string };
  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  const active = activeRuns.get(sessionId);
  if (!active) {
    res.json({ success: true, sessionId, status: "not_running" });
    return;
  }

  // Object-level authz: a cancel must come from the run's owner. claw-auth
  // verifies ownership before forwarding and always sends x-user-id (the only
  // caller of this endpoint — agent-chat.ts cancel forwarder). Fail closed:
  // a leaked S2S key alone can't abort an arbitrary user's run without also
  // knowing the owner's id.
  const callerUserId = req.headers["x-user-id"];
  if (
    typeof callerUserId !== "string" ||
    !callerUserId ||
    callerUserId !== active.userId
  ) {
    res
      .status(403)
      .json({ success: false, error: "Not authorized to cancel this run" });
    return;
  }

  // Mark this as a USER-initiated cancel BEFORE aborting, so the run's catch
  // block can distinguish it from the agent's own respond-to-user abort and
  // emit status="cancelled" (not "completed") even if a response was already
  // generated — otherwise a just-finished answer overwrites the user's stop.
  active.userCancelled = true;
  active.abortController.abort();
  res.json({ success: true, sessionId, status: "cancelled" });
});

// POST /clone-session — branch a persistent session to a new conversationId
// using PI's native createBranchedSession. Used by claw-auth to set up a
// branched session BEFORE /run dispatches so the regenerate / edit-user turn
// runs on a sibling subtree rather than appending to the original history.
//
// Body: { sourceConversationId, targetConversationId, branchMode? }
//   branchMode = "lastUser"       → regenerate (default)
//   branchMode = "beforeLastUser" → edit-user
router.post("/clone-session", validateS2SKey, async (req, res: Response) => {
  const { sourceConversationId, targetConversationId } = req.body as {
    sourceConversationId?: string;
    targetConversationId?: string;
    branchMode?: "lastUser" | "beforeLastUser" | "full";
  };
  const branchMode = (req.body as { branchMode?: "lastUser" | "beforeLastUser" | "full" }).branchMode ?? "lastUser";

  if (!sourceConversationId || typeof sourceConversationId !== "string") {
    res.status(400).json({ success: false, error: "sourceConversationId is required" });
    return;
  }
  if (!targetConversationId || typeof targetConversationId !== "string") {
    res.status(400).json({ success: false, error: "targetConversationId is required" });
    return;
  }
  if (!isSafeId(sourceConversationId)) {
    res.status(400).json({ success: false, error: "sourceConversationId has invalid format" });
    return;
  }
  if (!isSafeId(targetConversationId)) {
    res.status(400).json({ success: false, error: "targetConversationId has invalid format" });
    return;
  }

  try {
    const success = await branchSession(sourceConversationId, targetConversationId, branchMode);
    res.json({ success });
  } catch (err) {
    clog.error(
      `[clone-session] ${sourceConversationId} → ${targetConversationId}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
    );
    res.status(500).json({ success: false, error: "Failed to clone session" });
  }
});

function buildInterruptSummary(partialResult: string, fallback?: { toolsUsed?: string[]; toolInvocations?: Array<{ toolName?: string; isError?: boolean }> }): string {
  const trimmed = partialResult.trim();
  const details: string[] = [];
  const tools = [...new Set(fallback?.toolsUsed ?? [])].slice(0, 8);
  if (tools.length > 0) details.push(`Tools used so far: ${tools.join(", ")}.`);
  const invocations = fallback?.toolInvocations ?? [];
  if (invocations.length > 0) {
    const lastTool = [...invocations].reverse().find((inv) => typeof inv.toolName === "string" && inv.toolName.trim().length > 0);
    details.push(`Tool calls completed so far: ${invocations.length}${lastTool?.toolName ? `; latest: ${lastTool.toolName}${lastTool.isError ? " (failed)" : ""}.` : "."}`);
  }
  const fallbackText = details.length > 0
    ? details.join("\n")
    : "I had not produced a stable partial result yet.";
  return trimmed
    ? `✅ Picked up your new message and I’m switching to it now.\n\n**Summary of the work so far:**\n\n${trimmed}`
    : `✅ Picked up your new message and I’m switching to it now.\n\n**Summary of the work so far:** ${fallbackText}`;
}

export async function processTask(
  sessionId: string,
  sessionToken: string,
  userId: string,
  task: string,
  context: string | undefined,
  userName: string | undefined,
  userEmail: string | undefined,
  conversationId: string | undefined,
  piSessionConversationId: string | undefined,
  spacesConversationId: string | undefined,
  callbackUrl: ProgressDest,
  systemPrompt: string | undefined,
  agentConfig: Record<string, unknown> | undefined,
  agentSlug: string | undefined,
  channelId: string | undefined,
  requestCwd: string | undefined,
  eventType: string | undefined,
  scheduledJobId: string | undefined,
  traceId: string | undefined,
  skills:
    | { slug?: string; name: string; description?: string; content: string }[]
    | undefined,
  provider: string | undefined,
  providerOrder: string[] | undefined,
  subagentProviders: Record<string, string> | undefined,
  subagentProviderMode: "parent" | "spaces" | "fast-model" | undefined,
  providerConfigs:
    | Record<
        string,
        {
          apiKey: string;
          model: string;
          baseUrl?: string;
          authType?: string;
          reasoningEffort?: string;
        }
      >
    | undefined,
  progressUrl: ProgressDest,
  attachments:
    | Array<{ fileName: string; mimeType: string; data: string }>
    | undefined,
  recordingRefs:
    | Array<{ attachmentId: string; fileName: string; mimeType: string; fileSize: number }>
    | undefined,
  contextFiles: Array<{ path: string; content: string }> | undefined,
  additionalInstructions: string | undefined,
  researchContext:
    | {
        type: string;
        id?: string;
        name: string;
        repositoryId?: string;
        productId?: string;
      }
    | undefined,
  customSubagents:
    | import("../subagent-tools.js").CustomSubagentSpec[]
    | undefined,
  callableAgents: Array<CallableAgentSpec | CallableAgentLightSpec> | undefined,
  delegationMode: "orchestrator" | undefined,
  ticketIds: string[] | undefined,
  canvasIds: string[] | undefined,
  callIds: string[] | undefined,
  idempotencyKey: string | undefined,
  isRegenerate: boolean | undefined,
  abortSignal?: AbortSignal,
  abortRun?: () => void,
  compactBeforeRun?: boolean,
  fastMode?: boolean,
  resumedFromHandoff?: boolean,
  memoryBankId?: string,
  twinDestinations?: import("xyne-claw-shared").TwinDestinationCandidate[],
  senderName?: string,
  channelName?: string,
  mode?: "plan" | "auto" | "daily_brief",
  experiment?: ExperimentContext,
  planContinuation?: boolean,
  shouldGenerateFollowUpSuggestions?: boolean,
  lateFollowUpCallbackUrl?: string,
  /** Present when claw-auth woke this agent on its own (heartbeat / reflex). */
  awakening?: {
    kind: string;
    writePolicy: string;
    shadow: boolean;
    injectEnabled?: boolean;
    windowStartMs?: number;
    windowEndMs?: number;
    entryPath?: string;
  },
  execution?: RunExecutionState,
): Promise<void> {
  // Started here so the extractor overlaps session restore + MCP listing;
  // awaited once the tool palette exists. Never rejects (see prefetch.ts).
  const prefetchSpecPromise = prefetchEnabled(agentConfig)
    ? startPrefetchExtraction(task)
    : null;
  let mcpCleanup: (() => Promise<void>) | undefined;
  // Absolute paths of raw recordings staged into a CALLER-OWNED cwd. Ephemeral
  // workspaces are deleted whole in the finally, but a persistent cwd survives
  // the run — without explicit cleanup, up-to-1GB screen captures accumulate
  // under <cwd>/.context/recordings/ forever.
  const stagedRecordingAbsPaths: string[] = [];
  let sdlcSandboxCleanupContext: ToolExecutionContext | undefined;
  const tid = traceId ?? sessionId.slice(0, 8);
  const log = (msg: string) => clog.info(`[run] [${tid}] ${msg}`);
  const logErr = (msg: string, err?: unknown) =>
    clog.error(`[run] [${tid}] ${msg}`, err ?? "");
  const fastModeForCallback = effectiveFastMode(fastMode, agentConfig);
  const handoffControl = {
    isRequested: () => activeRuns.get(sessionId)?.handoffRequested === true,
    isCapAborted: () => activeRuns.get(sessionId)?.handoffCapFired === true,
    isUserCancelled: () => activeRuns.get(sessionId)?.userCancelled === true,
    onTurnBoundary: (lastTurn: number) => {
      const active = activeRuns.get(sessionId);
      if (active) active.handoffLastTurn = Math.max(active.handoffLastTurn ?? 0, lastTurn);
    },
  };
  // Idempotency backstop: only re-dispatches carry idempotencyKey (the recovery
  // rootSessionId). If a terminal-result marker for it already exists in GCS,
  // this run already finished and its completion callback was lost — replay the
  // cached result instead of re-executing, so finished side-effecting work
  // (PRs, sandboxes) is never re-run. (The recovery worker also checks this
  // before dispatch; this covers any path that still reaches /run.)
  if (idempotencyKey) {
    try {
      const markerBuf = await gcsDownloadResultMarker(idempotencyKey);
      if (markerBuf) {
        const marker = JSON.parse(markerBuf.toString("utf8")) as {
          status?: string;
          result?: string;
          toolsUsed?: string[];
        };
        log(
          `Idempotency hit for ${idempotencyKey}: run already completed — replaying result, skipping execution`,
        );
        await sendCallback(callbackUrl, sessionToken, {
          sessionId,
          userId,
          conversationId: conversationId ?? null,
          agentSlug: agentSlug ?? null,
          fastMode: fastModeForCallback,
          status: marker.status === "failed" ? "failed" : "completed",
          ...(marker.result !== undefined ? { result: marker.result } : {}),
          ...(marker.toolsUsed ? { toolsUsed: marker.toolsUsed } : {}),
        });
        return;
      }
    } catch (err) {
      // Unreadable/parse error → fall through and run normally (safe default).
      logErr(`Idempotency check failed for ${idempotencyKey}, running normally:`, err);
    }
  }

  // Terminal tools (respond-to-user, propose-plan, propose-agent, emit_brief)
  // end the turn via abortRun, so the run lands in the CATCH handler — these
  // are hoisted so the catch can still recover and forward their results
  // (signed pendingActions, plans, cards, briefs would otherwise drop silently).
  let customToolsResult: ReturnType<typeof loadCustomTools> | undefined;
  let mcpGetPendingActions: (() => Array<Record<string, unknown>>) | undefined;
  let mcpGetAttachments: (() => Attachment[]) | undefined;
  let pendingGoalSuggestion: PendingGoalSuggestion | null = null;
  const proposePlanRef: ProposePlanRef = {};
  const proposeAgentRef: ProposeAgentRef = {};
  const describeAgentRef: DescribeAgentRef = {};
  const suggestConnectorsRef: SuggestConnectorsRef = {};
  const emitBriefRef: EmitBriefRef = {};
  let callbackProvider = provider ?? "spaces";
  // Seed from THIS run's provider — a hardcoded default made every early
  // failure report the wrong model (740 codex / 461 claude rows, 2026-08-29).
  let callbackModel: string | undefined =
    provider && provider !== "spaces" ? providerConfigs?.[provider]?.model : LITELLM.model;
  let requiresStructuredDelivery = false;
  const followUpsEnabledByFlag = shouldGenerateFollowUpSuggestions === true;
  const followUpsEnabled = followUpsEnabledByFlag;
  const followUpAgentContext = normalizeFollowUpAgentContext(
    agentConfig?.["followUpAgentContext"],
  );
  const followUpConversationHistory = normalizeFollowUpConversationHistory(
    agentConfig?.["followUpConversationHistory"],
  );
  const followUpGenerationInput = followUpConversationHistory.length > 0
    ? "conversation_history_and_prompt"
    : "prompt_only";
  const parallelFollowUpStartedAt = new Date().toISOString();
  const parallelFollowUpDebugSeq = Date.now();
  let parallelFollowUpResult:
    | { generation: FollowUpGenerationResult; completedAt: string }
    | undefined;
  let parallelFollowUpPromise:
    | Promise<{ generation: FollowUpGenerationResult; completedAt: string }>
    | undefined;

  try {
    // SSRF guard: progressUrl is caller-supplied and gets POSTed to on every
    // tool/attachment/stream event. Drop it unless it targets the trusted
    // claw-auth origin, so a leaked S2S key can't redirect progress traffic to
    // an attacker / cloud-metadata endpoint. Run still proceeds without it.
    // In-process emitters (SSE mode) bypass the URL check — the destination is
    // a Response object owned by this process, not a network address.
    if (typeof progressUrl === "string" && !isAllowedCallbackUrl(progressUrl)) {
      log(`Ignoring non-allowlisted progressUrl: ${progressUrl}`);
      progressUrl = undefined;
    }
    const progressUrlLabel = !progressUrl ? "none" : (typeof progressUrl === "string" ? progressUrl : "sse-emitter");
    log(
      `Session ${sessionId}: starting for user ${userId}, progressUrl=${progressUrlLabel}`,
    );
    if (followUpsEnabled) {
      // Follow-ups use prior conversation plus the current user prompt, but
      // never wait for the current assistant response. This fast-model request
      // overlaps the main agent run and stays off the answer's critical path.
      pushDebugProgress(
        progressUrl,
        sessionId,
        buildFollowUpGenerationStartEvent({
          seq: parallelFollowUpDebugSeq,
          at: parallelFollowUpStartedAt,
          sessionId,
          model: LITELLM.fastModel,
          generationInput: followUpGenerationInput,
          conversationMessageCount: followUpConversationHistory.length,
          ...(followUpAgentContext ? { agentContext: followUpAgentContext } : {}),
        }),
      );
      parallelFollowUpPromise = generateFollowUpSuggestions(
        task,
        followUpAgentContext,
        followUpConversationHistory,
        abortSignal,
      ).then((generation) => {
        const settled = { generation, completedAt: new Date().toISOString() };
        pushDebugProgress(
          progressUrl,
          sessionId,
          buildFollowUpGenerationEndEvent({
            seq: parallelFollowUpDebugSeq + 1,
            at: settled.completedAt,
            startedAt: parallelFollowUpStartedAt,
            sessionId,
            model: LITELLM.fastModel,
            generationInput: followUpGenerationInput,
            conversationMessageCount: followUpConversationHistory.length,
            ...(followUpAgentContext ? { agentContext: followUpAgentContext } : {}),
            generation,
          }),
        );
        parallelFollowUpResult = settled;
        return settled;
      });
    }

    // All per-type attachment ingestion (filter → decode → convert to a
    // `.context/` markdown sibling, plus the pdf/video/zip side effects) lives
    // in attachment-ingest.ts. derivedContextFiles ordering is significant —
    // see that module's header.
    // Parse command contracts before attachment ingestion. /record-skill keeps
    // the raw recording for a fixed-command sandbox analyzer rather than
    // spending ffmpeg CPU in the long-lived claw pod.
    const taskCommand = parseTaskCommand(task);
    const recordSkillCommand = taskCommand?.command === "/record-skill";
    const {
      derivedContextFiles,
      pdfBuffers: pdfBuffersByName,
      videoKeyframes,
      videoBuffers: videoBuffersByName,
      imageAttachments,
      textAttachments,
      xlsxAttachments,
      pdfAttachments,
      docxAttachments,
      pptxAttachments,
      htmlAttachments,
      videoAttachments,
    } = await ingestAttachments(attachments, log, { deferVideoProcessing: recordSkillCommand });

    const mergedContextFiles = [
      ...(contextFiles ?? []),
      ...derivedContextFiles,
      ...(recordSkillCommand
        ? (recordingRefs ?? []).map((recording) => ({
            path: `${recording.fileName}.video.md`,
            content:
              `# Recording: ${recording.fileName}\n\n` +
              `This ${recording.fileSize}-byte recording is registered for the sandbox-backed ` +
              `\`analyze-skill-recording\` tool.\n`,
          }))
        : []),
    ];

    // Key the workspace by the CONVERSATION, not the run.
    //
    // pi resolves a resumable session with SessionManager.continueRecent(cwd,
    // sessionDir), and when an explicit sessionDir is passed it ALSO filters
    // candidates by cwd. Naming the workspace after `sessionId` gave every turn
    // a brand-new cwd, so that filter never matched: the session directory was
    // correct and shared, `hasSession()` was true, we logged "Resuming" — and pi
    // silently handed back an empty session. Every turn started from zero, and
    // the agent would answer follow-ups with "I don't have any record of that in
    // this conversation" (2026-08-30).
    //
    // Same identifier as the session store below, so cwd is stable exactly when
    // the session is. Runs with no conversation (one-shots, automations) keep a
    // per-run ephemeral workspace.
    const workspaceStoreKey =
      buildSandboxStoreKey(userId, piSessionConversationId ?? conversationId, agentSlug) ??
      (piSessionConversationId ?? conversationId);
    const workspaceDir =
      requestCwd ?? (await createWorkspace(workspaceStoreKey ?? sessionId));
    if (mergedContextFiles.length > 0) {
      const written = await writeWorkspaceTextFiles(
        workspaceDir,
        mergedContextFiles,
      );
      log(`Attached context files written: ${written.length}`);
    }
    // Drop the raw PDF bytes next to the extracted markdown — keeps
    // fill-pdf-form / inspect-pdf-form able to open the actual PDF off disk.
    // Path mirrors the markdown: `.context/<originalFileName>` (no extra suffix).
    if (pdfBuffersByName.length > 0) {
      const writtenBin = await writeWorkspaceBinaryFiles(
        workspaceDir,
        pdfBuffersByName.map((p) => ({ path: p.fileName, data: p.buf })),
      );
      log(`Raw PDF originals kept: ${writtenBin.length}`);
    }
    // /record-skill only: retain the raw recording in the ephemeral run
    // workspace until analyze-skill-recording copies it into this
    // conversation's sandbox. The workspace is deleted by normal run cleanup.
    const recordingFiles: Array<{
      fileName: string;
      mimeType: string;
      fileSize?: number;
      relPath?: string;
      attachmentId?: string;
    }> = (recordingRefs ?? []).map((recording) => ({ ...recording }));
    if (videoBuffersByName.length > 0) {
      for (const video of videoBuffersByName) {
        const requestedPath = `recordings/${video.fileName}`;
        const [writtenPath] = await writeWorkspaceBinaryFiles(workspaceDir, [
          { path: requestedPath, data: video.buf },
        ]);
        if (writtenPath) {
          recordingFiles.push({ fileName: video.fileName, mimeType: video.mimeType, relPath: writtenPath });
          if (requestCwd) stagedRecordingAbsPaths.push(join(workspaceDir, writtenPath));
        }
      }
      log(`Record-skill originals staged: ${recordingFiles.length}`);
    }

    const toolPermissions =
      (agentConfig?.["toolPermissions"] as
        | Record<string, string>
        | undefined) ?? {};
    // Over-large MCP results spill to the persistent session dir (survives the
    // ephemeral workspace teardown + resume) when a conversation is in play;
    // the workspace is still used for binary attachments. See toolOutputBaseDir.
    const mcpOutputDir = toolOutputBaseDir(conversationId, workspaceDir);
    const trustedSdlcBindings = trustedSdlcToolBindings(agentConfig?.["sdlcContext"]);
    const {
      groups: mcpGroups,
      cleanup,
      getPendingActions,
      getAttachments: getMcpAttachments,
    } = await loadMcpToolsForUser(
      sessionId,
      sessionToken,
      workspaceDir,
      toolPermissions,
      agentSlug,
      mcpOutputDir,
      (att) => pushAttachment(progressUrl, sessionId, att),
      trustedSdlcBindings,
    );
    mcpGetAttachments = getMcpAttachments;
    // Expose the MCP-layer pendingActions getter to the catch handler so
    // copilot-mode respond-to-user terminations can still recover signed
    // write-tool actions. See the hoisted `mcpGetPendingActions` declaration
    // near the top of this function for the full bug context.
    mcpGetPendingActions = getPendingActions;
    mcpCleanup = cleanup;

    // Task commands are parsed before custom-tool loading so command-owned
    // tools can be force-mounted for this run without mutating Agent.config.
    const forcedTaskCommandTools = new Set(taskCommand?.autoTools ?? []);

    const meta: Record<string, string> = { userId };
    if (userName) meta["userName"] = userName;
    if (userEmail) meta["userEmail"] = userEmail;
    if (agentSlug) meta["agentSlug"] = agentSlug;
    if (channelId) meta["channelId"] = channelId;
    if (conversationId) meta["conversationId"] = conversationId;
    if (taskCommand) meta["taskCommand"] = taskCommand.command;
    if (recordingFiles.length > 0) {
      // Server-authored metadata consumed only by analyze-skill-recording. The
      // tool validates containment under workspaceDir before reading anything.
      meta["recordingWorkspaceDir"] = workspaceDir;
      meta["recordingFiles"] = JSON.stringify(recordingFiles);
    }
    if (experiment) {
      meta["experimentId"] = experiment.id;
      meta["experimentEpoch"] = String(experiment.epoch);
      meta["experimentDeadlineAt"] = experiment.deadlineAt;
    }
    // Surface the run's trigger type so the sandbox tools can route scheduled /
    // automation runs to the shared read-only sbx-git sandbox instead of cloning
    // a per-project golden snapshot (see sandboxRepoSetup → resolveSbxGit).
    if (eventType) meta["eventType"] = eventType;
    // Surface the originating scheduled-job row id so the scheduledJobControl
    // tool can resolve jobId:"current" (worker forwards it in the run body).
    if (scheduledJobId) meta["scheduledJobId"] = scheduledJobId;
    // Sandbox repo pin (agent.config.sandboxRepo). Propagating it into meta is what
    // lets pinnedTemplateForContext (tools.ts) route bare `sandbox-create` and
    // one-shot `sandbox-run` onto the pinned repo's template — not just
    // `sandbox-repo-setup`. Without this the pin was invisible to those tools, so a
    // pinned agent's bare create silently fell back to the Kata default template.
    if (agentConfig?.["sandboxRepo"]) meta["sandboxRepo"] = String(agentConfig["sandboxRepo"]);
    // Task-command sandbox profile (e.g. /design → "browser"): a DEFAULT, so an
    // agent's explicit pin above always wins. Routes bare sandbox-create onto a
    // warm-pooled template instead of the cold kata default.
    else if (taskCommand?.sandboxProfile) meta["sandboxRepo"] = taskCommand.sandboxProfile;
    // Per-agent opt-in (e.g. reviewer agents): ALWAYS use the shared read-only
    // sbx-git sandbox, even for interactive runs. The sandbox tool ORs this with
    // isReadOnlyJob (see sandboxRepoSetup → resolveSbxGit). Reviewers only
    // grep/read across all repos, so they never need a per-project clone.
    if (agentConfig?.["forceReadOnlySandbox"] === true) meta["forceReadOnlySandbox"] = "true";
    // Per-agent opt-in (e.g. the error-pipeline doctor): allow this agent's
    // automation/scheduled runs to escalate to a WRITABLE sandbox (via
    // sandbox-repo-setup write:true) so it can implement a fix, push, and open a
    // PR unattended. This is the SAME flag the tool-palette gate below reads
    // (agentConfig.allowWriteInReadOnlyJob); propagate it into meta so the
    // sandbox-routing gate in claw-shared honors it too — otherwise the tools
    // stay but the sandbox is still routed read-only. Default-off.
    if (agentConfig?.["allowWriteInReadOnlyJob"] === true) meta["allowWriteInReadOnlyJob"] = "true";
    if (agentConfig?.["requireSdlcRepository"] === true) meta["requireSdlcRepository"] = "true";
    const sdlcContext = agentConfig?.["sdlcContext"];
    const trustedSdlcContext =
      sdlcContext && typeof sdlcContext === "object" && !Array.isArray(sdlcContext)
        ? (sdlcContext as Record<string, unknown>)
        : undefined;
    const trustedSdlcRepository =
      trustedSdlcContext?.["repository"] &&
      typeof trustedSdlcContext["repository"] === "object" &&
      !Array.isArray(trustedSdlcContext["repository"])
        ? (trustedSdlcContext["repository"] as Record<string, unknown>)
        : undefined;
    const trustedSdlcExecution =
      trustedSdlcContext?.["execution"] &&
      typeof trustedSdlcContext["execution"] === "object" &&
      !Array.isArray(trustedSdlcContext["execution"])
        ? (trustedSdlcContext["execution"] as Record<string, unknown>)
        : undefined;
    const trustedSdlcWiki =
      trustedSdlcContext?.["wiki"] &&
      typeof trustedSdlcContext["wiki"] === "object" &&
      !Array.isArray(trustedSdlcContext["wiki"])
        ? (trustedSdlcContext["wiki"] as Record<string, unknown>)
        : undefined;
    const isTrustedSdlcWikiRun =
      trustedSdlcContext?.["operation"] === "wiki" && trustedSdlcWiki !== undefined;
    if (trustedSdlcRepository) {
      if (typeof trustedSdlcRepository["id"] === "string") meta["sdlcRepositoryId"] = trustedSdlcRepository["id"];
      if (typeof trustedSdlcRepository["name"] === "string") meta["sdlcRepositoryName"] = trustedSdlcRepository["name"];
      if (typeof trustedSdlcRepository["url"] === "string") meta["sdlcRepositoryUrl"] = trustedSdlcRepository["url"];
      if (typeof trustedSdlcRepository["baseBranch"] === "string") meta["sdlcRepositoryBaseBranch"] = trustedSdlcRepository["baseBranch"];
      if (typeof trustedSdlcExecution?.["workflowExecutionId"] === "string") {
        meta["sdlcExecutionId"] = trustedSdlcExecution["workflowExecutionId"];
      }
      if (typeof trustedSdlcExecution?.["sessionId"] === "string") {
        meta["sdlcSessionId"] = trustedSdlcExecution["sessionId"];
      }
      if (typeof trustedSdlcExecution?.["conversationId"] === "string") {
        meta["sdlcConversationId"] = trustedSdlcExecution["conversationId"];
      }
      // Runtime credentials are issued per dispatched execution (setup/
      // artifact/work). Chat-surface runs carry repository context but no
      // execution, so setting the operation flag without the ids would only
      // trip the incomplete-binding guard in sandbox-repo-setup. Gate on both
      // execution identifiers so chat runs degrade to baseline-canvas access.
      if (
        typeof trustedSdlcExecution?.["workflowExecutionId"] === "string" &&
        typeof trustedSdlcExecution?.["sessionId"] === "string"
      ) {
        meta["sdlcRuntimeCredentialOperation"] =
          trustedSdlcContext?.["operation"] === "work" ? "PUSH" : "CLONE";
      } else if (
        trustedSdlcContext?.["operation"] === "interactive" &&
        typeof trustedSdlcContext["interactiveGrant"] === "string"
      ) {
        meta["sdlcRuntimeCredentialOperation"] = "INTERACTIVE";
        meta["sdlcInteractiveGrant"] = trustedSdlcContext["interactiveGrant"];
      }
    }
    if (trustedSdlcContext?.["operation"] === "wiki" && trustedSdlcWiki) {
      meta["sdlcWikiRun"] = "true";
      if (typeof trustedSdlcWiki["role"] === "string") {
        meta["sdlcWikiRole"] = trustedSdlcWiki["role"];
      }
      if (Array.isArray(trustedSdlcWiki["assignedCommitShas"])) {
        meta["sdlcWikiAssignedCommitShas"] = JSON.stringify(
          trustedSdlcWiki["assignedCommitShas"].filter(value => typeof value === "string"),
        );
      }
      if (typeof trustedSdlcWiki["bootstrapRef"] === "string") {
        meta["sdlcWikiBootstrapRef"] = trustedSdlcWiki["bootstrapRef"];
      }
      if (typeof trustedSdlcWiki["targetHeadSha"] === "string") {
        meta["sdlcWikiTargetHeadSha"] = trustedSdlcWiki["targetHeadSha"];
      }
    }
    // Operator-selected sbx-git repo context (agent.config.sbxGitRepos: string[]).
    // Surfaced to the read-only sandbox message so the agent focuses on these repos.
    const sbxGitRepos = agentConfig?.["sbxGitRepos"];
    if (Array.isArray(sbxGitRepos) && sbxGitRepos.length > 0) {
      meta["sbxGitRepos"] = JSON.stringify(sbxGitRepos.filter((r) => typeof r === "string"));
    }
    if (trustedSdlcContext) {
      sdlcSandboxCleanupContext = { config: {}, meta };
    }
    const spacesConversationId = agentConfig?.["SPACES_CONVERSATION_ID"];
    if (spacesConversationId && typeof spacesConversationId === "string")
      meta["spacesConversationId"] = spacesConversationId;

    // For google-agent: fetch the user's Google OAuth token from xyne-claw-auth
    const effectiveConfig = { ...(agentConfig ?? {}) };

    // Surface-default tool injection, per run only. Slack already injects its
    // subagent in claw-auth before dispatch; Spaces runs arrive directly from
    // the Spaces webhook and need the same default here so mention/automation/
    // scheduled runs can read the room without mutating the stored agent config.
    // Scheduled jobs post into a Spaces channel too, so they get the same spaces
    // default as an interactive mention. A missing tools object means the agent
    // is unrestricted, so do not create one.
    const effectiveTools = effectiveConfig["tools"];
    const isSpacesSurfaceEvent =
      eventType === "APP_MENTIONED" ||
      eventType === "DIRECT_MESSAGE" ||
      eventType === "USER_MENTIONED" ||
      eventType === "automation" ||
      eventType === "scheduled_job" ||
      eventType === "scheduled" ||
      (conversationId?.startsWith("scheduled_") ?? false);
    if (
      isSpacesSurfaceEvent &&
      effectiveTools &&
      typeof effectiveTools === "object" &&
      !Array.isArray(effectiveTools)
    ) {
      const toolsObj = effectiveTools as Record<string, unknown>;
      const subagents = Array.isArray(toolsObj["subagents"])
        ? (toolsObj["subagents"] as unknown[]).filter((value): value is string => typeof value === "string")
        : [];
      if (!subagents.includes("spaces")) {
        effectiveConfig["tools"] = { ...toolsObj, subagents: [...subagents, "spaces"] };
      }
    }

    // Parent agent's provider config — looked up from user's provider credentials.
    // We also reuse it to drive custom:create-ppt so PPT generation uses the
    // same user credential/model instead of shared env keys.
    const parentProviderConfig =
      provider === "copilot" || provider === "claude" || provider === "codex" || provider === "litellm"
        ? providerConfigs?.[provider]
        : undefined;

    // Resolve the run's provider ONCE (copilot proxy + base-URL defaulting) so
    // tools that make their own LLM call (create-ppt's slide-JSON generation)
    // inherit the agent's configured model via context.providerConfig instead
    // of a hardcoded fallback. Passed to loadCustomTools below.
    let runtimeProviderConfig:
      | { provider: string; baseUrl?: string; apiKey: string; model: string; authType?: string }
      | undefined;
    if (provider && parentProviderConfig?.apiKey) {
      const resolved =
        provider === "copilot"
          ? await applyCopilotProxyIfNeeded(provider, parentProviderConfig)
          : parentProviderConfig;
      runtimeProviderConfig = {
        provider,
        baseUrl:
          resolved?.baseUrl ??
          (provider === "claude" ? "https://api.anthropic.com" : "https://api.openai.com/v1"),
        apiKey: resolved?.apiKey ?? parentProviderConfig.apiKey,
        model: resolved?.model ?? parentProviderConfig.model,
        ...(provider === "claude"
          ? { authType: resolved?.authType ?? parentProviderConfig.authType ?? "api_key" }
          : {}),
      };
      log(`Tool provider resolved: provider=${provider} model=${runtimeProviderConfig.model}`);
    }

    // NOTE: Google + Microsoft no longer fetch/inject an OAuth token here. They
    // run as claw-auth-hosted stdio MCP connectors (type "google"/"microsoft"),
    // so their access token is resolved + refreshed by claw-auth's credential
    // loader when the MCP server is spawned — same lazy path as every other
    // connector. The old wantsGoogle/wantsMicrosoft pre-fetch was removed.

    // Custom tools still use the URL-based progress channel internally for
    // their own inline progress posts. In SSE mode that channel is bypassed —
    // we pass undefined so they no-op, and attachment events still surface via
    // the onAttachment callback above, which dispatches through pushAttachment
    // (URL or emitter, whichever is plumbed).
    const progressEmitter = progressUrl && typeof progressUrl !== "string" ? progressUrl : undefined;
    const progressUrlForCustom = typeof progressUrl === "string" ? progressUrl : undefined;
    const emitUiWidgetForCustom =
      progressEmitter
        ? async (widget: UiWidget) => progressEmitter.uiWidget(sessionId, widget)
        : undefined;
    customToolsResult = loadCustomTools(
      effectiveConfig,
      meta,
      (att) => pushAttachment(progressUrl, sessionId, att),
      researchContext,
      progressUrlForCustom,
      sessionId,
      SERVER.s2sKey,
      sessionToken,
      undefined,
      runtimeProviderConfig,
      emitUiWidgetForCustom,
      taskCommand?.autoTools ?? [],
    );
    const {
      tools: customToolDefs,
      getAttachments,
      getPendingQuestions,
      getPendingActions: getCustomPendingActions,
      getPendingResponses,
    } = customToolsResult;

    // Load deepwiki/context7/playwright MCP tool groups (stdio transport, cached).
    // Playwright doesn't get its own subagent — its tools are spliced into the
    // sandbox subagent's palette via bonusToolsBySubagent below.
    const [deepwikiGroup, context7Group, playwrightGroup] = await Promise.all([
      loadDeepwikiTools(),
      loadContext7Tools(),
      loadPlaywrightTools(),
    ]);

    // Extract skill triggers from agent config (needed by both subagent tools and runTask)
    const rawTriggers =
      (agentConfig?.["skillTriggers"] as Array<{
        toolName: string;
        skillSlug: string;
        when: string;
        prompt?: string;
      }>) ?? [];
    const resolvedTriggers = rawTriggers
      .filter((t) => t.toolName && t.skillSlug)
      .map((t) => {
        const skill = skills?.find((s) => s.name === t.skillSlug);
        return skill
          ? {
              toolName: t.toolName,
              skillSlug: t.skillSlug,
              skillContent: skill.content,
              when: t.when as "before" | "after",
              prompt: t.prompt,
            }
          : null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    // Extract prompt injections (per-turn system reminders)
    const rawInjections =
      (agentConfig?.["promptInjections"] as Array<{
        id: string;
        label: string;
        content: string;
        enabled: boolean;
      }>) ?? [];
    const activeInjections = rawInjections
      .filter(
        (p) =>
          p.enabled &&
          typeof p.content === "string" &&
          p.content.trim().length > 0,
      )
      .map((p) => ({
        id: p.id,
        label: p.label || "Reminder",
        content: p.content,
      }));

    // Digital Twin persona files — folded into the ACTUAL system prompt (via
    // runTask's twinPersona) rather than a per-turn reminder, so they read as
    // identity and are visible in the debug panel's LLM → system prompt.
    let twinPersonaBlock = "";

    // Memory — opt-in per agent via agentConfig.memoryEnabled=true.
    // No more inject-all-recalled-facts. Shared memory-enabled agents get the
    // memory-search tool only; we intentionally do not inject a per-turn system
    // reminder because that biases source-of-truth-first workflows (RCA,
    // metrics, reports, code review) toward stale memory. Digital Twin remains
    // separate: it receives a personal-memory hint because its product contract
    // is to answer as the user.
    const memoryEnabled =
      agentConfig?.["memoryEnabled"] === true ||
      agentConfig?.["memoryEnabled"] === "true";
    if (agentSlug && memoryEnabled) {
      // Bank-id comparison, not raw slug — see isDigitalTwinAgent in memory.ts.
      const isDigitalTwin = isDigitalTwinAgent(agentSlug);
      const taxonomy = await listSubsystemTaxonomy(
        agentSlug,
        isDigitalTwin ? { userTag: `user:${userId}` } : undefined,
        memoryBankId,
      ).catch(() => []);
      if (isDigitalTwin && taxonomy.length > 0) {
        const lines = taxonomy
          .slice(0, 12)
          .map(
            (s) =>
              `- ${s.name} (${s.memoryCount} ${s.memoryCount === 1 ? "memory" : "memories"})`,
          )
          .join("\n");
        activeInjections.push({
          id: "__memory-taxonomy",
          label: "Your Personal Memory",
          content: [
            "You have a personal memory bank — facts about THIS user that they",
            "themselves approved. Currently you have memories under these clusters:",
            "",
            lines,
            "",
            "When you need to know how the user works, who they collaborate with,",
            "what they prefer, or what they own, call `memory-search` FIRST with a",
            "specific natural-language query. Never invent facts about the user —",
            "only use what the tool returns.",
          ].join("\n"),
        });
      }

      // Digital Twin: inject the always-loaded persona files (soul.md, …) so the
      // twin speaks AS the user with ZERO tool calls. Injected via
      // activeInjections (not systemPrompt) so it applies on BOTH the @mention
      // flow (which sends no systemPrompt) and interactive chat. Files are the
      // user's own, ≤3, each ≤20k chars — enforced in claw-auth.
      if (isDigitalTwin) {
        const promptFiles = await fetchAgentPromptFiles(agentSlug, userId).catch(() => []);
        if (promptFiles.length > 0) {
          const body = promptFiles
            .map((f) => `=== ${f.name} ===\n${f.content.trim()}`)
            .join("\n\n");
          // Folded into the system prompt inside runTask (both the override and
          // the buildSystemPrompt-fallback paths), so it shows under LLM →
          // system prompt in the debug panel.
          twinPersonaBlock = [
            "# Speaking as you",
            "This is your persona — who you are and how you sound — drawn from the user's own",
            "approved memory files. Speak AS this person by default; you do not need to call any",
            "tool to use what's below. Prefer this voice over generic phrasing.",
            "",
            body,
          ].join("\n");
        }
      }
    }

    // Resolve subagent-level skills: NONE by default — users opt skills in
    // per-subagent via agent.config.subagentSkills. Rationale: a parent
    // agent's skills are often tuned for the parent's context (e.g. release
    // notes templates) and become noise/cost when injected into every child
    // (spaces, bitbucket, deepwiki, ...) without the user asking for it.
    //
    // Resolution:
    //   subagentSkills.spaces = ["skill-a"]   → only skill-a goes to spaces
    //   subagentSkills.spaces = []            → no skills (same as absent)
    //   subagentSkills.spaces is not set      → no skills (DEFAULT)
    //
    // Previous behavior was "inherit ALL parent skills by default" — flipped
    // here. Agents that depended on the old default need to explicitly list
    // the skills they want propagated per subagent.
    const allSkills = skills ?? [];
    const rawSubagentSkills = agentConfig?.["subagentSkills"] as
      | Record<string, string[]>
      | undefined;

    let resolvedSubagentSkills:
      | Record<
          string,
          Array<{
            slug?: string;
            name: string;
            description?: string;
            content: string;
          }>
        >
      | undefined;
    if (rawSubagentSkills) {
      resolvedSubagentSkills = {};
      for (const [subagentName, skillNames] of Object.entries(
        rawSubagentSkills,
      )) {
        const resolved = skillNames
          .map((name) => allSkills.find((s) => s.name === name))
          .filter((s): s is NonNullable<typeof s> => s != null);
        if (resolved.length > 0) {
          resolvedSubagentSkills[subagentName] = resolved;
        }
        // empty array → omit; the subagent gets no skills
      }
      if (Object.keys(resolvedSubagentSkills).length === 0) {
        resolvedSubagentSkills = undefined;
      }
    }

    // Pull the virtual `knowledge-base` group out of mcpGroups BEFORE the
    // subagent-builder sees it. KB tools are mounted directly on the parent
    // agent (Option B / parent-hoist) — the user already gated access via
    // their KB picker; we don't want the spaces subagent to absorb these,
    // nor do we want them filtered by tools.subagents / tools.direct /
    // tools.custom (KB has its own per-agent allowlist on the claw-auth side).
    // If left in allGroups, buildSubagentTools's else-branch would route them
    // into `directTools`, which would then be filtered out by the run.ts
    // tools.direct gate further down.
    const kbGroup = mcpGroups.find((g) => g.serverType === "knowledge-base");
    const mcpGroupsWithoutKb = kbGroup ? mcpGroups.filter((g) => g !== kbGroup) : mcpGroups;
    const kbHoistedTools = kbGroup ? kbGroup.tools : [];

    // Combine all MCP groups and build subagent wrappers (also wraps matching custom tools like sandbox)
    const allGroups = [
      ...mcpGroupsWithoutKb,
      ...(deepwikiGroup ? [deepwikiGroup] : []),
      ...(context7Group ? [context7Group] : []),
    ];
    // Parent agent's provider — used as default for subagents that don't have an override
    const subagentsFollowParent = subagentProviderMode === "parent";
    const parentProvider =
      subagentsFollowParent && provider && (["copilot", "claude", "codex"] as readonly string[]).includes(provider)
        ? provider
        : "spaces";
    // Shared ref: subagents append their inner MCP tool names here so chain
    // `toolsMustInclude`/`toolsMustExclude` conditions can target specific
    // nested tools (e.g. Bitbucket__create_pull_request), not just the
    // subagent wrapper names returned by the parent agent.
    const subagentInnerTools: string[] = [];
    // NOTE: the "sandbox" subagent was removed (2026-06-14). Sandbox tools now
    // mount directly on the parent (see parentHoistedTools below); playwright
    // browser tools are hoisted alongside them for sandbox-capable agents. The
    // old bonusToolsBySubagent splices (playwright + bitbucket upload) targeted
    // the sandbox subagent's palette and are gone with it.

    // Parse agent-level tool config up-front. Used both for the post-build
    // filter (further down) AND for the directPickSuffixes hoist below — when
    // a user ticks a single tool (e.g. bitbucket.get_pull_request) in the
    // agent UI without picking the whole bitbucket subagent, the runtime
    // should still expose that one tool to the parent. Without this, picking
    // individual tools from a subagent-backed connector was a silent no-op.
    const toolsConfigEarly = parseToolsConfig(effectiveConfig);
    const directPickSuffixes = toolsConfigEarly?.direct ?? [];

    // Per-run registry for background (run_in_background) subagents. Shared by
    // reference with the subagent tools (via the progressCtx below) and with
    // runTask (opts), so a detached spawn registered inside a tool's execute()
    // is drained by runTask after the model loop settles. See agent.ts.
    const backgroundSubagentRegistry: import("../subagent-tools.js").BackgroundSubagentRegistry = new Map();

    const fastModeEnabled = effectiveFastMode(fastMode, agentConfig);
    const fastToolController: FastToolRuntimeController = {};
    // The catalog is built for EVERY run, not just fast-mode ones. Its CONTENT
    // is what differs: with subagent delegation on, the wrappers already carry
    // their read tools, so only presentation (response-only) tools are lazy.
    // With delegation off (fast mode) the catalog stands in for the wrappers
    // and carries their read tools too — identical to before.
    const fastCatalogCandidateItems = buildToolCatalog({
      groups: allGroups,
      customTools: customToolDefs,
      ...(customSubagents ? { customSubagents } : {}),
      includeSubagentTools: fastModeEnabled,
    });
    const fastCatalogCandidateByName = new Map(fastCatalogCandidateItems.map((item) => [item.entry.name, item]));
    let fastCatalogItems: ToolCatalogItem[] = [];
    let fastCatalogNames: string[] = [];

    const { subagentTools, directTools, remainingCustomTools } = fastModeEnabled
      ? {
          subagentTools: [] as ToolDefinition[],
          ...buildFastModeDirectTools({
            groups: allGroups,
            customTools: customToolDefs,
            directPickSuffixes,
          }),
        }
      : buildSubagentTools(
          allGroups,
          customToolDefs,
          resolvedTriggers.length > 0 ? resolvedTriggers : undefined,
          resolvedSubagentSkills,
          { parentProvider, subagentProviderMode, subagentProviders, providerConfigs },
          {
            ...(progressUrl ? { progressUrl } : {}),
            parentSessionId: sessionId,
            ...(conversationId
              ? {
                  parentDebugSessionId:
                    buildSandboxStoreKey(userId, conversationId, agentSlug) ??
                    conversationId,
                }
              : {}),
            parentToolsUsed: subagentInnerTools,
            parentMeta: {
              ...(conversationId ? { conversationId } : {}),
              ...(agentSlug ? { agentSlug } : {}),
              ...(userId ? { userId } : {}),
            },
            // Propagate the cancel signal so any in-flight subagent session
            // (sandbox, spaces, bitbucket, ...) disposes itself when the user
            // hits Stop, instead of running for its full duration and orphaning
            // the result back to a parent that's already thrown RunCancelledError.
            ...(abortSignal ? { abortSignal } : {}),
            backgroundRegistry: backgroundSubagentRegistry,
          },
          undefined, // bonusToolsBySubagent — removed with the sandbox subagent
          customSubagents,
          directPickSuffixes,
        );

    directTools.push(buildPublishReviewRoomTool(sessionId));

    let fastMetaTools: ToolDefinition[] = [];

    // Parent-direct mount for ALL sandbox tools (source = "custom:sandbox",
    // covers compute/file tools in xyne-claw-shared/src/tools/sandbox/ and
    // browser tools in xyne-claw-shared/src/tools/sandbox-pw/). The sandbox
    // subagent was removed (2026-06-14) — sandbox is now a flat set of
    // parent tools, gated per-agent by the agent.config.tools filter below
    // (the slug must be in tools.custom). `sandbox-destroy` is excluded: it
    // reaps live sessions and caused pod-churn when exposed to an LLM.
    const parentHoistedTools = customToolDefs.filter((t) => {
      const src = (t as { source?: string }).source ?? "";
      return src === "custom:sandbox" && t.name !== "sandbox-destroy";
    });

    // Playwright browser tools (@playwright/mcp) ride on sandbox selection —
    // they were previously only in the sandbox subagent palette. An agent that
    // selects any sandbox tool gets the browser tools on the parent too. They
    // bypass the tools.custom gate (not custom-sourced), so only add them when
    // sandbox is actually selected.
    const sandboxSelected = (toolsConfigEarly?.custom ?? []).some((s) => s.startsWith("sandbox-"));
    const playwrightHoistedTools =
      sandboxSelected && playwrightGroup ? playwrightGroup.tools : [];

    const emitDelegationProgress = (label: string): void => {
      if (!progressUrl) return;
      if (typeof progressUrl !== "string") {
        try {
          progressUrl.progressLabel(sessionId, label, {
            ...(conversationId ? { conversationId } : {}),
            ...(agentSlug ? { agentSlug } : {}),
          });
        } catch (err) {
          logErr(`Delegation progress emit failed:`, err);
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
          toolLabel: label,
          ...(conversationId ? { conversationId } : {}),
          ...(agentSlug ? { agentSlug } : {}),
        }),
        signal: AbortSignal.timeout(5_000),
      }).catch((err) => logErr(`Delegation progress POST failed:`, err));
    };

    const extractRuntimeToolName = (name: string): string => {
      const idx = name.lastIndexOf("__");
      return idx >= 0 ? name.slice(idx + 2) : name;
    };
    const isWriteTool = (tool: ToolDefinition, groups: typeof allGroups): boolean => {
      if ((tool as { isWriteTool?: boolean }).isWriteTool === true) return true;
      const rawName = extractRuntimeToolName(tool.name);
      return groups.some((group) => group.writeTools.map(String).includes(rawName));
    };
    const selectedAsDirect = (tool: ToolDefinition, allowedDirect: string[]): boolean => {
      const norm = (s: string): string => s.toLowerCase().replace(/_/g, "-");
      const toolSelectionKey = (tool as { selectionKey?: string }).selectionKey;
      return allowedDirect.some((d) =>
        tool.name === d ||
        tool.name.endsWith(d) ||
        d.endsWith(`__${tool.name}`) ||
        norm(tool.name) === norm(d) ||
        (toolSelectionKey ? d === toolSelectionKey : false),
      );
    };
    const applyAgentToolFilter = (
      tools: ToolDefinition[],
      cfg: ReturnType<typeof parseToolsConfig>,
      sets: {
        subagentTools: ToolDefinition[];
        directTools: ToolDefinition[];
        customTools: ToolDefinition[];
      },
    ): ToolDefinition[] => {
      if (!cfg) return tools;
      const allowedSubagents = new Set(cfg.subagents ?? []);
      const allowedDirect = cfg.direct ?? [];
      const allowedCustom = expandCustomSelection(cfg.custom);
      const allowedGatewayServices = new Set(cfg.gateway ?? []);
      return tools.filter((t) => {
        if (sets.subagentTools.some((s) => s.name === t.name)) {
          return allowedSubagents.has(t.name);
        }
        if (sets.directTools.some((d) => d.name === t.name)) {
          const serviceName = (t as { serviceName?: string }).serviceName;
          const selectionKey = (t as { selectionKey?: string }).selectionKey;
          return selectedAsDirect(t, allowedDirect) ||
            (serviceName ? allowedGatewayServices.has(serviceName) : false) ||
            (selectionKey ? allowedCustom.has(selectionKey) : false);
        }
        if (sets.customTools.some((c) => c.name === t.name)) {
          return allowedCustom.has(t.name);
        }
        return true;
      });
    };

    const buildNestedRunner = (): NestedAgentRunner => async ({ spec, question, childGovernor, signal, onProgress }) => {
      const calleeSessionToken = spec.sessionToken ?? sessionToken;
      const label = spec.progressLabels?.[0] ?? `Delegating to ${spec.name}...`;
      onProgress?.(label);
      const calleeConfig = spec.agentConfig ?? {};
      const calleeToolsConfig = parseToolsConfig(calleeConfig);
      const calleeMeta: Record<string, string> = { userId };
      if (userName) calleeMeta["userName"] = userName;
      if (userEmail) calleeMeta["userEmail"] = userEmail;
      calleeMeta["agentSlug"] = spec.slug;
      if (channelId) calleeMeta["channelId"] = channelId;
      if (conversationId) calleeMeta["conversationId"] = conversationId;
      if (eventType) calleeMeta["eventType"] = eventType;
      if (scheduledJobId) calleeMeta["scheduledJobId"] = scheduledJobId;
      const calleeToolProvider = spec.provider;
      const calleeToolProviderConfig = calleeToolProvider ? spec.providerConfigs?.[calleeToolProvider] : undefined;
      const calleeProviderConfigForTools =
        calleeToolProvider && calleeToolProviderConfig
          ? {
              provider: calleeToolProvider,
              apiKey: calleeToolProviderConfig.apiKey,
              model: calleeToolProviderConfig.model,
              ...(calleeToolProviderConfig.baseUrl ? { baseUrl: calleeToolProviderConfig.baseUrl } : {}),
              ...(calleeToolProviderConfig.authType ? { authType: calleeToolProviderConfig.authType } : {}),
            }
          : runtimeProviderConfig;

      const calleeMcp = await loadMcpToolsForUser(
        sessionId,
        calleeSessionToken,
        workspaceDir,
        {},
        spec.slug,
        mcpOutputDir,
        (att) => pushAttachment(progressUrl, sessionId, att),
      );
      try {
        const calleeCustom = loadCustomTools(
          calleeConfig,
          calleeMeta,
          (att) => pushAttachment(progressUrl, sessionId, att),
          researchContext,
          progressUrlForCustom,
          sessionId,
          SERVER.s2sKey,
          calleeSessionToken,
          undefined,
          calleeProviderConfigForTools,
          emitUiWidgetForCustom,
        );
        const calleeGroupsWithoutKb = calleeMcp.groups.filter((g) => g.serverType !== "knowledge-base");
        const calleeKbTools = calleeMcp.groups.find((g) => g.serverType === "knowledge-base")?.tools ?? [];
        const calleeGroups = [
          ...calleeGroupsWithoutKb,
          ...(deepwikiGroup ? [deepwikiGroup] : []),
          ...(context7Group ? [context7Group] : []),
        ];
        const calleeProvider =
          spec.provider && (["copilot", "claude", "codex"] as readonly string[]).includes(spec.provider)
            ? spec.provider
            : "spaces";
        const calleeDirectPickSuffixes = calleeToolsConfig?.direct ?? [];
        const calleeInnerTools: string[] = [];
        const calleeSubagents = buildSubagentTools(
          calleeGroups,
          calleeCustom.tools,
          undefined,
          undefined,
          {
            parentProvider: calleeProvider,
            subagentProviders: spec.subagentProviders,
            providerConfigs: spec.providerConfigs,
          },
          {
            ...(progressUrl ? { progressUrl } : {}),
            parentSessionId: sessionId,
            ...(conversationId
              ? {
                  parentDebugSessionId:
                    buildSandboxStoreKey(userId, conversationId, spec.slug) ??
                    conversationId,
                }
              : {}),
            parentToolsUsed: calleeInnerTools,
            parentMeta: {
              ...(conversationId ? { conversationId } : {}),
              agentSlug: spec.slug,
              userId,
            },
            ...(signal ? { abortSignal: signal } : {}),
          },
          undefined,
          spec.customSubagents as import("../subagent-tools.js").CustomSubagentSpec[] | undefined,
          calleeDirectPickSuffixes,
        );
        const calleeSandboxSelected = (calleeToolsConfig?.custom ?? []).some((s) => s.startsWith("sandbox-"));
        const calleeParentHoistedTools = calleeCustom.tools.filter((t) => {
          const src = (t as { source?: string }).source ?? "";
          return src === "custom:sandbox" && t.name !== "sandbox-destroy";
        });
        const calleePlaywrightTools =
          calleeSandboxSelected && playwrightGroup ? playwrightGroup.tools : [];
        let calleePalette = [
          ...calleeSubagents.subagentTools,
          ...calleeSubagents.directTools,
          ...calleeSubagents.remainingCustomTools,
          ...calleeParentHoistedTools,
          ...calleePlaywrightTools,
          ...calleeKbTools,
        ];
        calleePalette = applyAgentToolFilter(calleePalette, calleeToolsConfig, {
          subagentTools: calleeSubagents.subagentTools,
          directTools: calleeSubagents.directTools,
          customTools: calleeCustom.tools,
        });
        const beforeReadOnly = calleePalette.length;
        calleePalette = calleePalette.filter((tool) => !isWriteTool(tool, calleeGroups));
        if (beforeReadOnly !== calleePalette.length) {
          log(`A2A callee ${spec.slug}: removed ${beforeReadOnly - calleePalette.length} write tool(s) from delegated palette`);
        }

        const providerConfig = spec.provider ? spec.providerConfigs?.[spec.provider] : undefined;
        const result = await runTask({
          userId,
          task: question,
          userName,
          userEmail,
          customTools: calleePalette,
          systemPromptOverride: spec.systemPrompt,
          cwd: workspaceDir,
          provider: spec.provider,
          providerConfig,
          progressUrl: undefined,
          sessionId: `${sessionId}-a2a-${spec.slug}`,
          skills: spec.skills,
          abortSignal: signal,
          progressMeta: {
            ...(conversationId ? { conversationId } : {}),
            agentSlug: spec.slug,
          },
        });
        if (calleeInnerTools.length > 0) {
          subagentInnerTools.push(...calleeInnerTools.map((toolName) => `${spec.slug}.${toolName}`));
        }
        return { text: result.text, toolsUsed: result.toolsUsed };
      } finally {
        await calleeMcp.cleanup().catch(() => {});
      }
    };

    // Per-agent, per-run delegation budget. Read from the parent agent's
    // free-form config bag (set in the Behaviour screen) and clamped to a safe
    // range; falls back to A2A_DEFAULTS.MAX_DELEGATIONS_PER_RUN when unset.
    const maxDelegationsPerRun = clampMaxDelegationsPerRun(
      agentConfig?.["maxDelegationsPerRun"],
    );
    if (agentConfig?.["maxDelegationsPerRun"] !== undefined) {
      log(
        `A2A delegation budget: agent=${agentSlug ?? "root"} configured=${String(agentConfig["maxDelegationsPerRun"])} effective=${maxDelegationsPerRun}`,
      );
    }
    const delegationGovernor = new AgentDelegationGovernor({
      ownerSlug: agentSlug ?? "root",
      maxDelegationsPerRun,
      onEvent: (ev) => {
        log(`A2A ${ev.kind}: ${ev.caller} -> ${ev.callee}${ev.reason ? ` (${ev.reason})` : ""}`);
        if (ev.kind === "requested" || ev.kind === "queued" || ev.kind === "started") {
          const spec = callableAgents?.find((candidate) => candidate.slug === ev.callee);
          emitDelegationProgress(spec?.progressLabels?.[0] ?? `Delegating to ${ev.callee}...`);
        }
      },
    });
    const hydrateOrchestratorCallee = async (calleeSlug: string): Promise<CallableAgentSpec> => {
      const caller = agentSlug?.trim();
      if (!caller) throw new Error("caller agent slug is required for orchestrator delegation");
      const qs = new URLSearchParams({
        caller,
        callee: calleeSlug,
        userId,
        sessionId,
      });
      const res = await fetch(`${SERVER.authServiceUrl.replace(/\/+$/, "")}/claw/api/v1/internal/callable-agent-spec?${qs.toString()}`, {
        method: "GET",
        headers: {
          ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: CallableAgentSpec; error?: string };
      if (!res.ok || body.success !== true || !body.data) {
        throw new Error(body.error ?? `callable-agent-spec failed with HTTP ${res.status}`);
      }
      return body.data;
    };
    const callableAgentTools = callableAgents && callableAgents.length > 0
      ? delegationMode === "orchestrator"
        ? buildOrchestratorCallableAgentTool(
            callableAgents as CallableAgentLightSpec[],
            delegationGovernor,
            hydrateOrchestratorCallee,
            buildNestedRunner(),
            { ...(abortSignal ? { signal: abortSignal } : {}), onProgress: emitDelegationProgress },
          ) as unknown as ToolDefinition[]
        : buildCallableAgentTools(
            callableAgents as CallableAgentSpec[],
            delegationGovernor,
            buildNestedRunner(),
            { ...(abortSignal ? { signal: abortSignal } : {}), onProgress: emitDelegationProgress },
          ) as unknown as ToolDefinition[]
      : [];

    const fastAlwaysActiveToolNames = new Set([
      ...directTools,
      ...remainingCustomTools,
      ...parentHoistedTools,
      ...playwrightHoistedTools,
      ...kbHoistedTools,
      ...callableAgentTools,
    ].map((tool) => tool.name));

    let allTools = [
      ...subagentTools, // spaces, bitbucket, grafana, deepwiki, context7
      ...fastMetaTools, // search-tools/load-tools in fast mode only
      ...fastCatalogCandidateItems.map((item) => item.tool), // narrowed after all standard filters, dormant until load-tools activates them
      ...callableAgentTools, // A2A governed full-agent delegation tools
      ...directTools, // write tools (create-ticket, send-message)
      ...remainingCustomTools, // custom tools not wrapped in a subagent
      ...parentHoistedTools, // sandbox tools mounted directly on the parent
      ...playwrightHoistedTools, // browser tools, for sandbox-selected agents
      ...kbHoistedTools, // kb-* tools when the agent has ≥1 AgentCollection grant
    ];

    log(
      `Tools: ${subagentTools.length} subagents, ${directTools.length} direct, ${customToolDefs.length} custom, ${parentHoistedTools.length} parent-hoisted, ${kbHoistedTools.length} kb-hoisted${fastModeEnabled ? `, [fast] catalogCandidates=${fastCatalogCandidateItems.length}` : ""}`,
    );

    // Presentation tools (post-code-block / post-diff / post-chart / visualize)
    // render as cards in the Spaces thread, so a thread run gets them in the
    // CATALOG regardless of the agent's tools.custom selection. Framework
    // default, not per-agent config — same rationale as the plan tools below,
    // but lazy (one index line each) instead of always-active. See
    // ../presentation-catalog.ts for why these three conditions and no others.
    const presentationDefaultOn = presentationCatalogDefaultOn({
      channelId,
      eventType,
      conversationId,
      isScheduledOrAutomationRun,
    });

    // Apply agent-level tool config from DB (agent.config.tools). Reuses the
    // toolsConfigEarly parse we did above for the directPickSuffixes hoist.
    if (toolsConfigEarly) {
      const allowedSubagents = new Set(toolsConfigEarly.subagents ?? []);
      const allowedDirect = toolsConfigEarly.direct ?? [];
      const allowedCustom = expandCustomSelection(toolsConfigEarly.custom);
      const allowedGatewayServices = new Set(toolsConfigEarly.gateway ?? []);

      allTools = allTools.filter((t) => {
        if (subagentTools.some((s) => s.name === t.name))
          return allowedSubagents.has(t.name);
        if (directTools.some((d) => d.name === t.name)) {
          // Live tool names (t.name) and config entries (d) can disagree on
          // case and on separator convention:
          //   • bare                — "user-send-message"
          //   • slug-cased prefix   — "xyne-spaces-app-tools__apps-send-message"   (synced `tools.slug`)
          //   • human-cased prefix  — "Xyne_Spaces_App_Tools__apps-send-message"   (decorated at runtime)
          // Existing branches handle the bare/prefixed pairing. The new
          // normalized-full match (lowercase + _→-) catches the slug-vs-
          // decorated case (same server, different casing convention) WITHOUT
          // matching across different servers — we compare the whole string,
          // not just the bare suffix, so a config entry from server A can't
          // accidentally grant tools from server B that share a bare name.
          const norm = (s: string): string =>
            s.toLowerCase().replace(/_/g, "-");
          const tNorm = norm(t.name);
          const toolSelectionKey = (t as { selectionKey?: string }).selectionKey;
          const isDirectPick = allowedDirect.some((d: string) =>
            t.name === d ||
            t.name.endsWith(d) ||
            d.endsWith(`__${t.name}`) ||
            tNorm === norm(d) ||
            (toolSelectionKey ? d === toolSelectionKey : false),
          );
          // Gateway tools are exposed as direct tools; keep them when their
          // service name (e.g. "mettle") is selected in tools.gateway.
          // Use stable serviceName metadata instead of mutable display label.
          const toolServiceName = (t as { serviceName?: string }).serviceName;
          const isGatewayPick = toolServiceName ? allowedGatewayServices.has(toolServiceName) : false;
          // Some claw-auth-executed direct tools are catalogued under "System
          // Tools" (source custom:*), so the user selects them by slug into
          // tools.custom rather than by name into tools.direct (e.g. webfetch).
          // Honour that selection here via the tool's selectionKey so execution
          // can stay in claw-auth (/mcp/call) while the picker shows it as a
          // System Tool. See mcp/adapters/webfetch.ts in xyne-claw-auth.
          const isCustomPick = toolSelectionKey ? allowedCustom.has(toolSelectionKey) : false;
          return isDirectPick || isGatewayPick || isCustomPick;
        }
        if (customToolDefs.some((c) => c.name === t.name)) {
          // Slash-command contracts own their minimum palette. Keep these
          // per-run tools even when the stored Agent.config did not select them.
          if (forcedTaskCommandTools.has(t.name)) return true;
          // Thread runs get the presentation tools for free. Surviving this
          // gate is exactly what lets them reach fastCatalogItems below —
          // they still can't become always-active, because both catalog
          // builders keep them out of fastAlwaysActiveToolNames.
          if (isFreePresentationTool(t as { source?: string }, presentationDefaultOn)) return true;
          const toolSelectionKey = (t as { selectionKey?: string }).selectionKey;
          const isAllowedCustom = allowedCustom.has(t.name) || (toolSelectionKey ? allowedCustom.has(toolSelectionKey) : false);
          if (isAllowedCustom) return true;
          const fastCatalogItem = fastCatalogCandidateByName.get(t.name);
          if (fastCatalogItem?.entry.source.startsWith("subagent:")) {
            return allowedSubagents.has(fastCatalogItem.entry.source.slice("subagent:".length));
          }
          if (fastCatalogItem?.entry.source.startsWith("custom-subagent:")) {
            return allowedSubagents.has(fastCatalogItem.entry.source.slice("custom-subagent:".length));
          }
          return false;
        }
        const fastCatalogItem = fastCatalogCandidateByName.get(t.name);
        if (fastCatalogItem) {
          const source = fastCatalogItem.entry.source;
          if (source.startsWith("subagent:")) {
            return allowedSubagents.has(source.slice("subagent:".length));
          }
          if (source.startsWith("custom-subagent:")) {
            return allowedSubagents.has(source.slice("custom-subagent:".length));
          }
          return false;
        }
        return true;
      });

      log(
        `Agent tools config applied: ${allTools.length} tools after filtering`,
      );
    }

    // ── Plan tools: framework default, not per-agent config ──────────────────
    // todo-write / todo-read give the user live visibility into what the agent
    // is doing, so they are DEFAULT-ON for every DIRECT interactive run (a user
    // is watching a channel/thread) and OFF for scheduled/automation runs (no
    // interactive surface, and the plan card has nowhere to render). This
    // overrides the per-agent `tools.custom` gate above: any agent gets them on
    // a direct run without needing config, and no agent gets them on a
    // scheduled/automation run. Uses the tool objects from remainingCustomTools
    // (already ctx-threaded by loadCustomTools). Mirrors the isScheduledRun /
    // isReadOnlyJob logic computed later — inlined here because tool assembly
    // runs before it.
    // Digital Twin mention/approval flow: it delivers ONLY via the mandatory
    // twin_deliver tool and NEVER posts to the thread, so the plan tools + primer
    // (which post todo cards to the thread and instruct "write your final answer
    // as plain text with NO trailing tool call") are both inapplicable AND
    // actively conflict with twin_deliver — the model followed the primer and
    // never called the delivery tool, fail-closing to silence. Exclude the twin
    // mention flow from plan tools/primer entirely.
    const isTwinMentionFlow = !!agentSlug && isDigitalTwinAgent(agentSlug) && eventType === "USER_MENTIONED";
    // Plan mode (agent.config.planMode → dispatched with mode='plan' for non-twin
    // thread mentions): the agent gets a READ-ONLY palette + the terminal
    // propose-plan tool, proposes a plan, and STOPS for approval. The
    // `&& !isTwinMentionFlow` is a belt-and-suspenders safety net — claw-auth
    // already never sets mode='plan' for USER_MENTIONED (INVARIANT B). When mode
    // is 'auto'/undefined this is false and every branch below is the existing
    // path, so auto-mode behavior is unchanged (INVARIANT A).
    const isPlanMode = mode === "plan" && !isTwinMentionFlow;
    // Daily brief (agent.config.dailyBriefMode → dispatched with mode='daily_brief'):
    // the agent gets the FULL read-only palette + subagents + the terminal
    // emit_brief tool, gathers the user's tickets/activity/calendar, emits the
    // structured brief, and STOPS. Like plan mode, the palette + primer are
    // server-owned here and cannot be changed from the dashboard. Excluded from the
    // twin flow (belt-and-suspenders; claw-auth never sets it for USER_MENTIONED).
    const isDailyBrief = mode === "daily_brief" && !isTwinMentionFlow;
    // Per-agent opt-OUT (`agentConfig.planTracking`, default ON). Distinct from
    // `postTodos`, which only hides the Spaces card while the agent still keeps
    // the list: this removes the todo tools AND the primer, so no turn is spent
    // on plan bookkeeping at all.
    //
    // Why an agent would turn it off: `todo-write` ends the assistant turn like
    // any tool call, and the primer below mandates a todo-only turn at BOTH ends
    // of a run ("before your first tool call", and again immediately before the
    // final answer). On a slow model that is two full round trips of pure
    // bookkeeping — measured at ~50% of wall-clock on ask-ai runs. Search-style
    // agents that answer in one message get no value from the checklist card and
    // pay the whole cost.
    const planTrackingEnabled =
      agentConfig?.["planTracking"] !== false && agentConfig?.["planTracking"] !== "false";
    const planToolsDefaultOn =
      planTrackingEnabled &&
      (!!channelId || (progressUrl && typeof progressUrl !== "string")) &&
      !isScheduledOrAutomationRun(eventType, conversationId) &&
      !isTwinMentionFlow &&
      !isPlanMode &&
      !isDailyBrief;
    if (!planTrackingEnabled) log("[plan] planTracking=false — todo tools and primer suppressed");
    const planTools = remainingCustomTools.filter((t) => isPlanToolSlug(t.name));
    allTools = allTools.filter((t) => !isPlanToolSlug(t.name));
    if (planToolsDefaultOn) allTools.push(...planTools);
    // Plan mode swaps the live todo-write/todo-read tools OUT (they're already
    // filtered above; planToolsDefaultOn is false here) and the terminal
    // propose-plan tool IN — the ONLY exit in plan mode. It captures the plan
    // into proposePlanRef and fires abortRun to end the turn.
    if (isPlanMode) {
      allTools.push(buildProposePlanTool(proposePlanRef, abortRun));
      log("Plan mode — injected terminal propose-plan tool (todo-write/todo-read off)");
    }
    // Daily brief: inject the terminal emit_brief tool — the ONLY exit in
    // daily-brief mode. It captures the structured brief into emitBriefRef and
    // fires abortRun to end the turn (recovered in the catch block, shipped as
    // `dailyBrief`). The read-only strip below whitelists it like propose-plan.
    if (isDailyBrief) {
      allTools.push(buildEmitBriefTool(emitBriefRef, abortRun));
      log("Daily brief mode — injected terminal emit_brief tool");
    }
    if (experiment) {
      // CHECKER (mode:"review") and PARTICIPANT are DIFFERENT toolsets. The
      // checker gets read-only ledger + experiment-review (and must NOT have
      // end-experiment / ledger-write — the prompt says so). Previously this
      // always injected the participant tools, so the checker was told to call
      // experiment-review but never had it ("experiment-review unavailable,
      // verdicts not recorded") while wrongly holding end-experiment.
      allTools.push(
        ...(experiment.mode === "review"
          ? buildExperimentReviewTools(experiment)
          : buildExperimentTools(experiment, abortRun)),
      );
      log(
        experiment.mode === "review"
          ? `Experiment CHECKER mode — injected review tools (verifying epoch ${experiment.epoch})`
          : experiment.kind === "security"
          ? `Security mode — injected experiment tools (epoch ${experiment.epoch}, observation-gated closes)`
          : experiment.kind === "framework"
          ? `Framework mode — injected experiment tools (epoch ${experiment.epoch}, candidate-gated exit)`
          : experiment.kind === "understanding"
          ? `Understanding mode — injected experiment tools (epoch ${experiment.epoch}, coverage-gated exit)`
          : experiment.kind === "repo-history"
          ? `Repo-history mode — injected experiment tools (epoch ${experiment.epoch}, progress-gated exit at HEAD)`
          : `Experiment mode — injected experiment tools (epoch ${experiment.epoch}, remaining ${experimentRemaining(experiment.deadlineAt)})`,
      );
    }

    // Agent authoring (agent.config.agentAuthoring): inject the terminal
    // propose-agent tool so this agent can DRAFT another agent. Gated on the same
    // interactive-surface conditions as the plan tools — a draft is worthless
    // without a human to approve its card, so a scheduled/automation run (no one
    // watching) must never get the tool. Never alongside the other terminal tools
    // (plan / daily brief own turn termination in their modes).
    const agentAuthoringEnabled =
      agentConfig?.["agentAuthoring"] === true &&
      (!!channelId || (progressUrl && typeof progressUrl !== "string")) &&
      !isScheduledOrAutomationRun(eventType, conversationId) &&
      !isTwinMentionFlow &&
      !isPlanMode &&
      !isDailyBrief;
    if (agentAuthoringEnabled) {
      allTools.push(buildProposeAgentTool(proposeAgentRef, abortRun));
      log("Agent authoring enabled — injected terminal propose-agent tool");
    }

    // describe-agent: EVERY agent gets this, no config. "What can you do?" is a
    // question any agent should answer from its real configuration rather than
    // from prose the model invents. Gated only on there being somewhere to post
    // the card — a scheduled/automation run has no one to show it to.
    //
    // Deliberately NOT excluded in plan mode: the tool writes nothing (plan
    // mode's read-only filter passes it through untouched), and an agent
    // configured to plan first should still be able to say what it is. Twin is
    // excluded because that flow delivers through its own approval surface.
    const describeAgentAvailable =
      (!!channelId || (progressUrl && typeof progressUrl !== "string")) &&
      !isScheduledOrAutomationRun(eventType, conversationId) &&
      !isTwinMentionFlow &&
      !isDailyBrief;
    if (describeAgentAvailable) {
      allTools.push(buildDescribeAgentTool(describeAgentRef));
      // Same gate as describe-agent: a connector card is only worth posting
      // where a human is watching and can press Connect.
      allTools.push(buildSuggestConnectorsTool(suggestConnectorsRef));
    }


    // Inject copilot respond-to-user tool if provider is copilot.
    // Defence-in-depth: also require an actual copilot config. Without this
    // guard, a caller dispatching `provider="copilot"` without copilot creds
    // (the historical webhook resolver bug — see claw-auth/routes/webhook.ts)
    // would land in copilot mode while the LLM actually fell through to
    // LiteLLM. That mismatch forced thinking on a Claude Sonnet that
    // doesn't separate thinking blocks, leaking visible reasoning to users.
    // `&& !isPlanMode`: plan mode owns turn termination via propose-plan, so it
    // is mutually exclusive with the other terminal-delivery channels. Gating at
    // the definition keeps tools, prompt notes, and callbacks all consistent.
    // When auto (isPlanMode false) this is a no-op — behavior is unchanged.
    const isCopilot = provider === "copilot" && !!parentProviderConfig?.apiKey && !isPlanMode && !isDailyBrief;
    const effectiveModel = parentProviderConfig?.model ?? LITELLM.model;
    log(
      `provider=${provider ?? "spaces"} isCopilot=${isCopilot} model=${effectiveModel}`,
    );
    if (isCopilot) {
      const copilotTool = buildCopilotTool(getPendingResponses, abortRun);
      allTools.push(copilotTool);
      log("Copilot mode — injected respond-to-user tool");
    }

    if (agentSlug && memoryEnabled) {
      allTools.push(buildMemorySearchTool(agentSlug, userId, sessionId, memoryBankId));
      log("Memory enabled — injected memory-search tool");
      // Deterministic file-memory tools (read/write named files) — twin only,
      // since the file store is per-user (agentSlug + userId).
      if (isDigitalTwinAgent(agentSlug)) {
        for (const t of buildMemoryFileTools(agentSlug, userId, sessionId)) allTools.push(t);
        allTools.push(buildMemoryWriteTool(agentSlug, userId, sessionId));
        log("Digital Twin — injected read/write memory-file tools + memory-write");
      }
    }

    // verifyResponses: opt-in per agent. The agent delivers its final answer
    // via the submit-response tool, which verifies the draft against gathered
    // evidence before posting (single-run equivalent of the /goal audit pass).
    // Scoped to non-copilot: copilot already owns delivery via respond-to-user,
    // and stacking two terminal delivery tools would confuse the model.
    // `evidenceRef.getDigest` is wired by agent.ts once the session exists.
    // Per-agent model settings + structured output (agentConfig.modelSettings /
    // agentConfig.outputFormat). Structured output is mutually exclusive with
    // the other terminal delivery channels: copilot owns delivery via
    // respond-to-user, and verifyResponses owns it via submit-response — when
    // outputFormat is set it wins over verifyResponses and is skipped in
    // copilot mode.
    const modelSettings = parseModelSettings(agentConfig);
    if (modelSettings) {
      log(`Per-agent modelSettings: ${JSON.stringify(modelSettings)}`);
    }
    // Command overlay wins for this run only — never written back to the agent.
    const outputFormat = parseOutputFormat(
      taskCommand?.agentConfigOverlay
        ? { ...(agentConfig ?? {}), ...taskCommand.agentConfigOverlay }
        : agentConfig,
    );
    const structuredOutputRef: StructuredOutputRef = {};
    const structuredOutputActive = !!outputFormat && !isCopilot && !isPlanMode && !isDailyBrief;
    requiresStructuredDelivery = structuredOutputActive;
    if (outputFormat && isCopilot) {
      log(
        "outputFormat configured but provider is copilot — structured output skipped (respond-to-user owns delivery)",
      );
    }
    if (structuredOutputActive && outputFormat) {
      allTools.push(buildSubmitResultTool(outputFormat, structuredOutputRef));
      log(
        "outputFormat enabled — injected submit-result tool (JSON schema-constrained final answer)",
      );
    }

    // verifyResponses resolution:
    //   1. Per-agent config flag (explicit true/false) always wins.
    //   2. Else the global env default RESPONSE_VERIFY_ALL=on.
    // Replay over real sessions (2026-06: 60 sessions, 18% rejected, ~73% of
    // those genuine — fabricated counts/timestamps/IDs, false /goal completion)
    // backed enabling globally. False positives clustered in Digital Twin
    // casual chat (rhetorical questions, no verifiable deliverable), so the
    // GLOBAL default skips Twin agents; an explicit per-agent `true` still
    // honors them. Always yields to structured output (it owns delivery).
    const verifyAllDefault =
      (process.env["RESPONSE_VERIFY_ALL"] ?? "off").toLowerCase() === "on";
    const verifyCfg = agentConfig?.["verifyResponses"] as boolean | undefined;
    const isTwinAgent = agentSlug ? isDigitalTwinAgent(agentSlug) : false;

    // Digital Twin mention/approval flow: the twin_deliver tool is the single,
    // MANDATORY delivery channel (react and/or reply, and where). It replaces the
    // old "post the raw last-assistant text" path, so process narration can never
    // leak. Scoped to USER_MENTIONED — the ask-ai / DM twin surfaces answer
    // normally and are untouched. verifyResponses is forced off here so we never
    // stack two terminal delivery tools. (isTwinMentionFlow is computed with the
    // plan-tools gate above.)
    const twinDeliverRef: TwinDeliverRef = {};
    if (isTwinMentionFlow && agentSlug) {
      // No candidate list injected: the Twin discovers channel/thread/user ids
      // itself via its Spaces tools (Vespa search + psql) and passes them to
      // twin_deliver's explicit id fields.
      allTools.push(buildTwinDeliverTool(agentSlug, twinDeliverRef));
      log(`Digital Twin mention flow — injected MANDATORY twin_deliver tool`);
    }

    const verifyResponses =
      (verifyCfg ?? (verifyAllDefault && !isTwinAgent)) &&
      !structuredOutputActive &&
      !isTwinMentionFlow &&
      !isPlanMode &&
      !isDailyBrief;
    const evidenceRef: EvidenceRef = {};
    if (verifyResponses && !isCopilot) {
      const rawCriteria = agentConfig?.["verifyResponseCriteria"];
      const verifyResponseCriteria =
        typeof rawCriteria === "string" && rawCriteria.trim() ? rawCriteria.trim() : undefined;
      allTools.push(
        buildVerifiedResponseTool({
          getPendingResponses,
          abortRun,
          task,
          evidenceRef,
          agentSlug,
          ...(verifyResponseCriteria ? { criteria: verifyResponseCriteria } : {}),
        }),
      );
      log(
        `verifyResponses enabled — injected submit-response tool${verifyResponseCriteria ? " (with per-agent criteria)" : ""}`,
      );
    }

    // Citation reflection: opt-in per agent (agentConfig.citationReflection).
    // Post-response, agent.ts nudges the model to add inline [clf-…] citations
    // when it answered from citeable sources but cited none. Cheap (regex +
    // ≤1 re-prompt), independent of verifyResponses. Accepts boolean or "true"
    // string (the dashboard free-form config editor stores scalars as strings).
    const citationReflection =
      agentConfig?.["citationReflection"] === true ||
      agentConfig?.["citationReflection"] === "true";
    if (citationReflection) log("citationReflection enabled — post-response citation nudge active");

    // Generic auto-citations: opt-in per agent (agentConfig.autoToolCitations).
    // When on, every tool result that doesn't already self-cite is chunked and
    // prefixed with inline [clf-…] tokens so the model can cite any tool's
    // output. Accepts boolean or "true" (free-form config editor stores strings).
    const autoToolCitations =
      agentConfig?.["autoToolCitations"] === true ||
      agentConfig?.["autoToolCitations"] === "true" ||
      // Daily brief always needs [clf-…] tokens on tool results so the brief's
      // prose can cite them, regardless of which agent executes it.
      isDailyBrief;
    if (autoToolCitations) log("autoToolCitations enabled — generic [clf-…] tokens on all tool results");

    // suggest-goal tool: opt-in per agent. When the agent's config has
    // `suggestGoal: true`, the worker can call this tool to propose a /goal
    // loop. The suggestion is surfaced as a one-click button in the Spaces
    // thread (rendered by claw-auth webhook.ts based on pendingGoalSuggestion
    // on the result payload). Only the latest call wins. The collector
    // variable is hoisted at the top of the handler so the copilot-mode
    // catch branch can also forward it.
    const suggestGoalEnabled = agentConfig?.["suggestGoal"] === true;
    if (suggestGoalEnabled) {
      allTools.push(
        buildSuggestGoalTool((s) => {
          pendingGoalSuggestion = s;
        }),
      );
      log("suggestGoal enabled — injected suggest-goal tool");
    }

    // Scheduled runs are unattended. They must not see tools whose contract
    // requires a live Spaces thread or a user click:
    //   • schedule-task can recursively re-arm the job;
    //   • propose-agent-call posts an approval card to the current thread.
    // Keep direct A2A tools (`call-agent` / `ask_<slug>`) so an authorised
    // Orchestrator can execute a callee and receive its result in the same run.
    const isScheduledRun =
      eventType === "scheduled_job" ||
      (conversationId?.startsWith("scheduled_") ?? false);
    if (isScheduledRun) {
      const before = allTools.length;
      allTools = filterScheduledRunTools(allTools);
      if (allTools.length !== before) {
        log(`Scheduled run — removed ${before - allTools.length} interactive-only tool(s)`);
      }
    }

    // An artifact app must NEVER be able to build another artifact app. Left
    // alone, an app that asks its agent to "make me a dashboard for this" gets
    // one, whose agent can be asked again — the same unbounded self-replication
    // the schedule-task ban above exists to stop, with the same inability to
    // kill it from the outside once a chain is in flight. Apps also lose
    // schedule-task, so one cannot arm a cron that keeps invoking agents after
    // the user has closed and forgotten it.
    //
    // This filter is the AUTHORITATIVE half of the guard. claw-auth also strips
    // both slugs from tools.custom at dispatch, but that alone is not enough:
    // an agent with no tools config gets every tool by default, so there would
    // be nothing there to filter.
    const isArtifactAppRun =
      eventType === "artifact_app" || (conversationId?.startsWith("app_") ?? false);
    if (isArtifactAppRun) {
      const before = allTools.length;
      // read-app-file goes with create-app: it is keyed by conversation, and an
      // app-invoked run carries the `app_` conversation of the app itself, so
      // leaving it in would let an app read its own source back.
      allTools = allTools.filter(
        (t) =>
          t.name !== "create-app" && t.name !== "read-app-file" && t.name !== "schedule-task",
      );
      if (allTools.length !== before) {
        log(
          "Artifact-app run — create-app + read-app-file + schedule-task removed (self-replication ban)",
        );
      }
    }

    // Read-only routing (sbx-git): scheduled / automation runs are diverted to
    // the SHARED read-only sbx-git sandbox (see sandboxRepoSetup → resolveSbxGit),
    // so they must not carry mutating sandbox tools. Strip them here as the
    // tool-level half of read-only enforcement (the sbx-git pod also mounts
    // repos read-only). A rare automation that genuinely needs to write/run can
    // opt out with agentConfig.allowWriteInReadOnlyJob.
    const isReadOnlyJob = eventType === "automation" || eventType === "scheduled" || isScheduledRun;
    const allowWriteInReadOnlyJob = agentConfig?.["allowWriteInReadOnlyJob"] === true;
    // forceReadOnlySandbox: per-agent opt-in to the read-only sbx-git path for ALL
    // runs (reviewer agents). It wins over allowWriteInReadOnlyJob — explicit
    // read-only intent — and applies even to interactive (non-job) runs.
    const forceReadOnlySandbox = agentConfig?.["forceReadOnlySandbox"] === true;
    if (forceReadOnlySandbox || (isReadOnlyJob && !allowWriteInReadOnlyJob)) {
      // Keep in sync with SBX_GIT.disabledTools (xyne-claw-shared/.../repo-configs.ts).
      const RO_DISABLED = new Set([
        "sandbox-run", "sandbox-run-detached", "sandbox-write-file",
        "sandbox-create", "sandbox-destroy", "write",
      ]);
      const before = allTools.length;
      allTools = allTools.filter((t) => !RO_DISABLED.has(t.name));
      if (allTools.length !== before) {
        log(`Read-only ${eventType ?? "scheduled"} run — stripped ${before - allTools.length} mutating sandbox tool(s) (sbx-git read-only)`);
      }
    }

    // Plan mode is read-only: the agent must PROPOSE, not execute. Strip every
    // write-flagged tool (MCP writes, memory-create, ticket/message creators, …)
    // AND the mutating sandbox tools, so nothing can act before the user
    // approves. The terminal propose-plan tool (not a write tool) always
    // survives. Applies ONLY when isPlanMode — auto runs are untouched.
    if (isPlanMode) {
      const RO_PLAN = new Set([
        "sandbox-run", "sandbox-run-detached", "sandbox-write-file",
        "sandbox-create", "sandbox-destroy", "write",
      ]);
      const beforePlan = allTools.length;
      allTools = allTools.filter(
        (t) =>
          t.name === PROPOSE_PLAN_TOOL_NAME ||
          (!isWriteTool(t, allGroups) && !RO_PLAN.has(t.name)),
      );
      if (allTools.length !== beforePlan) {
        log(`Plan mode read-only — stripped ${beforePlan - allTools.length} write/mutating tool(s)`);
      }
    }

    // Daily brief is read-only: the agent GATHERS and EMITS, it must never mutate
    // (post a message, create a ticket, write a doc). Strip every write-flagged
    // tool + mutating sandbox tool, but KEEP all read tools and subagents so the
    // agent can freely decide how to gather. The terminal emit_brief tool (not a
    // write tool) is explicitly whitelisted so it always survives. This also
    // covers the interactive regenerate path, which is NOT a scheduled read-only
    // run and so wouldn't otherwise be stripped. Applies ONLY when isDailyBrief.
    if (isDailyBrief) {
      const RO_BRIEF = new Set([
        "sandbox-run", "sandbox-run-detached", "sandbox-write-file",
        "sandbox-create", "sandbox-destroy", "write",
      ]);
      const beforeBrief = allTools.length;
      allTools = allTools.filter(
        (t) =>
          t.name === EMIT_BRIEF_TOOL_NAME ||
          (!isWriteTool(t, allGroups) && !RO_BRIEF.has(t.name)),
      );
      if (allTools.length !== beforeBrief) {
        log(`Daily brief read-only — stripped ${beforeBrief - allTools.length} write/mutating tool(s) (read tools + subagents kept)`);
      }
    }

    allTools = dedupeToolsByName(allTools);
    // Derived predicate, not a new config knob: the catalog machinery runs when
    // there is something to catalogue. `fastModeEnabled ||` keeps fast mode
    // byte-identical — a fast-mode run with an EMPTY catalog still gets its
    // (empty) meta-tools exactly as it did before, rather than silently losing
    // search-tools/load-tools.
    const catalogActive = fastModeEnabled || fastCatalogCandidateItems.length > 0;
    if (catalogActive) {
      const registeredToolNames = new Set(allTools.map((tool) => tool.name));
      fastCatalogItems = fastCatalogCandidateItems.filter((item) =>
        registeredToolNames.has(item.entry.name) &&
        !fastAlwaysActiveToolNames.has(item.entry.name),
      );
      fastCatalogNames = fastCatalogItems.map((item) => item.entry.name);
      const finalFastCatalogNameSet = new Set(fastCatalogNames);
      allTools = dedupeToolsByName([
        ...buildFastModeMetaTools({
          catalog: fastCatalogItems.map((item) => item.entry),
          controller: fastToolController,
        }),
        ...allTools.filter((tool) => {
          if (!fastCatalogCandidateByName.has(tool.name)) return true;
          return finalFastCatalogNameSet.has(tool.name) || fastAlwaysActiveToolNames.has(tool.name);
        }),
      ]);
      fastMetaTools = allTools.filter((tool) => tool.name === "search-tools" || tool.name === "load-tools");
    }

    const fastModeLoadedToolBudget = catalogActive
      ? Math.max(
          0,
          providerToolRequestCap(provider) -
            5 - // scoped read/write/grep/find/ls built-ins registered in runTask
            allTools.filter((tool) => !fastCatalogNames.includes(tool.name)).length,
        )
      : undefined;
    if (catalogActive) {
      log(`[catalog] entries=${fastCatalogItems.length} active=0 budget=${fastModeLoadedToolBudget ?? 0} totalCap=${providerToolRequestCap(provider)} fastMode=${fastModeEnabled} presentationDefault=${presentationDefaultOn}`);
    }

    const tools = allTools.length > 0 ? allTools : undefined;

    // Task commands (/explainer …): a leading command binds the run to a
    // required tool — instruction injected here, exit gated in runTask.
    const taskCommandToolAvailable =
      taskCommand !== null &&
      (taskCommand.requiredTool === undefined ||
        allTools.some((t) => t.name === taskCommand.requiredTool));
    if (taskCommand) {
      // The fenced-```html contract exists for Design Studio's live preview,
      // where the chat UI hides the block. Webhook-originated runs (Spaces
      // threads) have no such surface — a 30k-token source dump would land
      // verbatim in the thread above the delivered file. Same command, per-
      // surface artifact contract.
      // Studio dispatches (agent-chat) send NO eventType; every webhook/
      // automation surface sends one and posts results into a thread.
      const isStudioSurface = !eventType;
      const surfaceSuffix = taskCommand.command === "/design" && !isStudioSurface
        ? "\n\nSURFACE OVERRIDE: this run was invoked from a Spaces thread, not Design Studio. Do NOT include the fenced ```html block in your response — the delivered .html file attachment is the artifact. Keep the final message to a 1-2 sentence summary of the design."
        : "";
      activeInjections.push({
        id: `__task-command-${taskCommand.command.slice(1)}`,
        label: `Command: ${taskCommand.command}`,
        content:
          (taskCommandToolAvailable
            ? taskCommand.instruction
            : (taskCommand.missingToolInstruction ?? taskCommand.instruction)) + surfaceSuffix,
      });
      log(
        `[task-command] ${taskCommand.command} → requires ${taskCommand.requiredTool ?? "(delivery contract)"} (available=${taskCommandToolAvailable})`,
      );
    }
    const designSystemInjection = buildDesignSystemPromptInjection(taskCommand, agentConfig);
    if (designSystemInjection.status === "injected") {
      activeInjections.push(designSystemInjection.injection);
      log(`[task-command] ${taskCommand?.command ?? "artifact"} designSystem prompt injection applied`);
    } else if (designSystemInjection.status === "oversized") {
      log(
        `[task-command] ${taskCommand?.command ?? "artifact"} designSystem ignored: ${designSystemInjection.length} chars exceeds 32000 char cap`,
      );
    }

    // Inject event type into context so the agent knows how it was invoked
    let fullContext = context;
    if (eventType) {
      const eventNote = `## Event Type: ${eventType}`;
      fullContext = fullContext ? `${eventNote}\n\n${fullContext}` : eventNote;
    }
    if (eventType === "automation") {
      const automationLines = [
        "## Automation Run",
        "This run was started by a Xyne Spaces automation, not a direct human mention.",
        "The task is the workflow's RUN_AGENT prompt. If it says to handle an event but does not include enough detail, inspect the Spaces thread before answering.",
        ...(conversationId
          ? [
              `- Use \`spaces-messages\` with conversationId \`${conversationId}\` to read the triggering thread.`,
            ]
          : []),
        ...(channelId ? [`- channelId: ${channelId}`] : []),
        "Return the workflow step result as the final answer.",
      ];
      const automationNote = automationLines.join("\n");
      fullContext = fullContext
        ? `${fullContext}\n\n${automationNote}`
        : automationNote;
    }
    // Inject metadata so agents can reference channelId/conversationId in tool calls
    const metaLines = [
      "## Session Metadata",
      ...(channelId ? [`- channelId: ${channelId}`] : []),
      ...(conversationId
        ? [`- agent session/conversationId: ${conversationId}`]
        : []),
      ...(spacesConversationId && typeof spacesConversationId === "string"
        ? [
            `- spacesConversationId/threadId: ${spacesConversationId} \n This conversation/thread id is attached by the user as context for this claw agent session`,
          ]
        : []),
    ];
    if (metaLines.length > 1) {
      fullContext = fullContext
        ? `${fullContext}\n\n${metaLines.join("\n")}`
        : metaLines.join("\n");
    }

    // /goal-awareness primer. Injected only when suggest-goal is registered
    // for this run. Without this, the agent learns about the loop feature
    // only by reading the tool's description mid-decision — too late if it
    // already finished planning in plain prose. The primer surfaces the
    // option up-front so the model considers it during planning, not after.
    // Kept short on purpose: full mechanics live in the tool description.
    if (suggestGoalEnabled) {
      const goalPrimer = [
        "## Autonomous /goal loop available",
        "This product supports `/goal` — a mode where you keep getting re-invoked turn after turn until a separate boss judge decides an exit condition is met (no human reply between turns; turn cap ~20; an audit pass runs once before termination).",
        "When you finish planning a task that (a) needs ≥3 independent iterations, (b) has a clear observable exit condition, and (c) doesn't need further user input, end your turn by calling the `suggest-goal` tool. The user sees a one-click button to promote the work to a /goal loop. The tool's full description has the criteria and exit-condition writing rules — read it before calling.",
        "If the task is single-turn or open-ended, just answer normally and do NOT call `suggest-goal`.",
      ].join("\n");
      fullContext = fullContext
        ? `${fullContext}\n\n${goalPrimer}`
        : goalPrimer;
    }

    // ── Plan tracking primer ───────────────────────────────────────────────
    // Surfaces the todo-write/todo-read plan tools up front so the agent
    // maintains a live, in-place-updating checklist card in the thread instead
    // of narrating steps in prose. Gated on BOTH (a) a channel surface to
    // render the card onto and (b) todo-write being in the agent's tool config,
    // so we never instruct an agent to use a tool it doesn't have.
    // Same gate as tool availability (planToolsDefaultOn): a direct interactive
    // run with a channel surface. Keeps the primer and the tools in lockstep —
    // the agent is told to plan exactly when it has the tools + a place to render.
    if (planToolsDefaultOn) {
      const planPrimer = [
        "## Plan tracking — REQUIRED for any real work",
        "The user cannot see your reasoning or tool calls — only a small activity spinner. So WHENEVER a request requires you to DO something (search, read, call ANY tool, or take more than one step), you MUST post a plan with the `todo-write` tool BEFORE you start. It renders as a live, in-place-updating checklist card in this thread, and it's the ONLY way the user knows what you're doing.",
        "- Post the FULL todo list up front, before your first tool call. Each todo is `{ id, title, status }` with a stable `id`, a short user-facing `title`, and `status` in `pending | in_progress | completed | failed`.",
        "- Even a single-tool task gets a short 1–2 item plan (e.g. `Search #general`, then `Summarize findings`).",
        "- Keep EXACTLY ONE todo `in_progress` at a time. Call `todo-write` again with the FULL list the moment a status changes — mark a todo `completed` immediately when it's done (don't batch), or `failed` if it can't complete.",
        "- Use `todo-read` to re-check your current plan instead of re-deriving it.",
        "- Titles are shown to the user — keep them clear and concise.",
        "- Your final user-facing answer MUST be the LAST thing you output. Send your final `todo-write` (marking the closing step `completed`) BEFORE you write that answer, then write the answer with NO tool call after it. NEVER call `todo-write` (or any other tool) once your final answer is written — a trailing tool call starts a new message and the user then sees only that fragment instead of your answer.",
        "The ONLY time to skip a plan is a pure conversational reply you answer directly with NO tool calls (e.g. a greeting, or a question you can answer from what's already in context).",
      ].join("\n");
      fullContext = fullContext
        ? `${fullContext}\n\n${planPrimer}`
        : planPrimer;
    } else if (isPlanMode) {
      // Plan mode: the agent has a READ-ONLY palette + the terminal propose-plan
      // tool. It investigates just enough, then proposes a plan and STOPS for the
      // user's approval. Execution happens in a separate auto-mode turn.
      // The default primer below can be OVERRIDDEN per-agent via
      // agent.config.planModePrompt (edited from the dashboard). Keep this text in
      // sync with DEFAULT_PLAN_MODE_PROMPT in the dashboard behaviour editor, which
      // pre-fills the textarea with the same default. The propose-plan gate is
      // enforced by the TOOL PALETTE (read-only + terminal propose-plan), not this
      // prose, so a custom prompt can only change guidance — it can never disable
      // the gate or let the agent execute before approval.
      const defaultPlanModePrimer = [
        "## Plan mode — propose first, do NOT execute",
        "You are in PLAN MODE. You have READ-ONLY tools (search / read) and ONE terminal tool: `propose-plan`. You CANNOT edit, run commands, send messages, or otherwise take action yet — those tools are intentionally unavailable until the user approves.",
        "Do this, in order:",
        "1. Investigate ONLY as much as you need to write a concrete, correct plan (search / read the relevant context). Keep it lightweight — you are scoping, not solving.",
        "2. Call `propose-plan` ONCE with: the full ordered todo list (`{ id, title }` each — stable ids and CRISP titles: imperative, max 6–8 words, NO 'Step 1'/'Stage 2'/number prefixes; the UI numbers them), and a `document` — the full plan written out in GitHub-flavored MARKDOWN (context, approach, what each step does and why, risks, expected outcome). The todos are the checklist; the document is the detailed brief shown when the user expands the plan. Also pass a `trivial` judgment. This call ENDS your turn immediately.",
        "3. Do NOT do the work, do NOT write a final answer, do NOT call any tool after propose-plan. The user reviews your plan, picks the steps to keep, and approves — only then does execution begin (in a fresh turn where you'll have your full tools back).",
        "Set `trivial: true` ONLY for a genuinely simple, low-risk ask where an approval prompt would just be noise; then it starts immediately. When unsure, use `trivial: false`.",
      ].join("\n");
      const customPlanModePrompt = agentConfig?.["planModePrompt"];
      const planModePrimer =
        typeof customPlanModePrompt === "string" && customPlanModePrompt.trim()
          ? customPlanModePrompt.trim()
          : defaultPlanModePrimer;
      fullContext = fullContext ? `${fullContext}\n\n${planModePrimer}` : planModePrimer;
    } else if (isDailyBrief) {
      // Daily brief: SERVER-OWNED primer (not dashboard-overridable) describing the
      // brief the agent must produce. It has the full read-only palette + subagents
      // and decides HOW to gather; this only defines WHAT the brief must contain and
      // that emit_brief is the single exit. Any per-user custom instructions arrive
      // separately, appended as "## Additional Instructions" below, and may tune tone
      // and emphasis — but cannot change the required structure or remove emit_brief.
      const briefPrimer = [
        "## Daily brief — gather, then write ONE elegant brief",
        "You are writing this person's Daily Brief: the morning read that tells them, in under a minute, what actually deserves their attention today. You have READ-ONLY tools and subagents (tickets, activity/mentions, approvals, calendar, search). You CANNOT act — no posting, no ticket edits. Your ONE terminal tool is `emit_brief`.",
        "",
        "### Step 1 — gather (quietly)",
        "First find out who the user is (id/email) so every query is scoped to them. Then pull what you need: what most needs them today (critical/overdue tickets, pending approvals, direct @mentions, ETA breaches); truly overdue items; work they're blocked on / waiting on others for (they own it but it's stuck on a review/someone else); their own open tickets; and today's calendar. Use whatever read tools and subagents you judge relevant — you decide.",
        "",
        "### Step 2 — write it like a sharp chief of staff",
        "The brief is EDITORIAL PROSE, not a data dump. This is the single most important instruction. Do NOT list rows. SYNTHESIZE: find the story across the items and say it plainly.",
        "- Voice: crisp, brief, elegant, human. Full sentences. Calm and direct. No filler, no hedging, no emoji, no headers inside the text.",
        "- Lead each section with the insight, then only the specifics that earn their place. 2–4 short lines per section is plenty; one sharp line beats five dull ones.",
        "- Prefer the pattern over the pile. 'Ten tickets sit in PR Review, not one with a reviewer assigned — naming reviewers is a two-minute job that unblocks a month of work' is worth more than ten separate rows.",
        "- Be specific where it matters: ticket ids, real ages ('untouched since 3 June'), real counts. Name the one thing worth doing first.",
        "- `what_needs_you`: open with a 1–2 sentence read of the whole day (this replaces any separate summary), then the 1–3 items that genuinely need them. `overdue`: only what's truly late; if nothing is, say so in one honest line. `waiting_on_others`: name the bottleneck. `assigned_to_you`: their open work, grouped and synthesized. `todays_schedule`: the meetings with times, or one line if the day is clear.",
        "",
        "### Step 3 — cite with clf tokens",
        "Your tool results contain inline citation tokens like `[clf-abc123#14]`. After any factual claim you draw from a tool result, append the EXACT token(s) that appeared in that tool's output, verbatim — e.g. `... no reviewer has been assigned to any of them [clf-abc123#14].` Never invent a token; only use ones you actually saw. If a claim rests on several sources, include several tokens. These are the brief's only citation mechanism.",
        "",
        "### Step 4 — mention people and channels by id",
        "When you name a person whose id appears in a tool result, write them as `<@userId>` with the id copied EXACTLY. Ticket results render people as `Name <email> (id: cm…)`; activity rows carry `actorId:`; message lines carry the sender's id.",
        "When you name a channel whose id appears in a tool result, write it as `<#channelId>` the same way. Channel listings render as `#name (id: …)`; activity rows carry `channelId:`.",
        "Same discipline as citations — copy, never invent, never infer an id from a name, never reuse one id for another thing. If you have no id, write the plain name or `#channel-name` as text: an unlinked name is correct, a wrong id is a lie. Only people and channels take this form — never tickets or PRs.",
        "",
        "### Step 5 — emit",
        "Call `emit_brief` EXACTLY ONCE with each section as an array of your written lines. This ENDS your turn. Do NOT narrate, do NOT write a chat answer, do NOT call any tool after it. If a data source is unavailable, skip it gracefully rather than failing the whole brief.",
      ].join("\n");
      fullContext = fullContext ? `${fullContext}\n\n${briefPrimer}` : briefPrimer;
    }

    // ── Sandbox primer ─────────────────────────────────────────────────────
    // Replaces what the sandbox subagent used to inject into its own session.
    // The subagent was removed (2026-06-09) because it slowed every read/write
    // by a full LLM round-trip and crashed on context overflow. Now that
    // sandbox-* tools mount directly on the parent, we surface the same
    // session-reuse + delivery rules in the parent's context — same content,
    // no extra hop. Sandbox is parent-direct (subagent removed) — gated by a
    // sandbox-* slug in tools.custom, matching custom-tools.ts.
    const sandboxEnabledForPrompt = (() => {
      const toolsObj = (agentConfig?.["tools"] ?? {}) as Record<
        string,
        unknown
      >;
      const customList = Array.isArray(toolsObj["custom"])
        ? (toolsObj["custom"] as string[])
        : [];
      // Sandbox is parent-direct now (subagent removed) — selection == any
      // sandbox-* slug in tools.custom.
      return customList.some((s) => s.startsWith("sandbox-"));
    })();
    if (sandboxEnabledForPrompt) {
      const isSdlcRepositoryContext = Boolean(meta["sdlcRepositoryId"]);
      const sandboxLines: string[] = [
        "## Sandbox usage",
        isSdlcRepositoryContext
          ? "This SDLC repository uses one write-capable workspace. Capability is not authorization: inspect only unless the task explicitly requires implementation. Follow the repository's declared package manager and setup instructions. If a required package-manager command is unavailable, make one bounded attempt to install/enable it; use npm as a fallback only when the repository's scripts and lockfiles support npm. Do not loop on environment repair. If setup or verification still fails, stop cleanly and report the exact command/error, changes already completed, checks not run, and branch/commit/PR state."
          : "READ vs WRITE — this matters. For read-first repos (e.g. xyne-spaces) `sandbox-repo-setup` DEFAULTS to an instant READ-ONLY git sandbox (no wait): use it for reading, grepping, and inspecting code / PR review — which is almost everything. Only call `sandbox-repo-setup` with `write:true` when you must actually EDIT files, build, run tests, or commit — that claims a short-lived, auto-expiring writable dev sandbox. Do NOT request write just to look at code; default to read and escalate to write only when you're about to change something.",
        "Sandbox tools (sandbox-create, sandbox-run, sandbox-write-file, sandbox-read-file, sandbox-deliver-files, sandbox-pw-*) run code/commands in an isolated VM. Use them whenever you need execution, file generation, screenshots, or browser automation.",
        "- To send a file BACK to the user, you MUST call `sandbox-deliver-files` with the path(s). Returning file contents as text in your reply is NOT delivery — Spaces won't render it as an attachment.",
        "- Reuse a single sandbox session across many commands when possible. Avoid one-shot `sandbox-run` calls if you need to keep state.",
        "- For URLs of the form `http://localhost:<port>` (dashboard :5173, backend :3001) use `sandbox-pw-*` tools, NOT `sandbox-run` with inline Playwright. The browser inside the sandbox can reach those addresses.",
        "- Opening PRs (any git host): make + commit your changes in the sandbox and `git push` the branch from there (the sandbox has push credentials). There is NO `gh`/`glab`/host CLI — do NOT try `gh pr create`. The push only creates the branch; to OPEN the PR, hand it to the subagent that MATCHES the repo's host: for a **GitHub** repo use the **github** subagent's `create_pull_request` (`head`=<your branch>, `base`=<default branch>); for a **Bitbucket** repo use the **bitbucket** subagent's `create_pull_request` (`workspace`=<project key, e.g. XYNE>, `repository`=<repo slug>, `source_branch`=<your branch>, `destination_branch`=<default branch>). Do NOT use the github subagent for a Bitbucket repo (or vice-versa) — it hits the wrong API and fails. Only fall back to giving the user a compare URL if `create_pull_request` actually returns an error — and report that real error.",
        "- NEVER claim a branch was pushed or a PR was opened from memory. Verify first: a push is only real if `git ls-remote --heads origin <branch>` shows the ref (or `git push` printed the upstream-tracking/'new branch' line). State exactly what the command returned — do not narrate a success or a failure you did not observe.",
      ];
      // Surface an active session for this conversation so the agent reuses
      // it instead of cold-starting. Only repo-template sessions are worth
      // reusing — bare warmpool VMs have no creds baked in.
      if (conversationId) {
        const storeKey = buildSandboxStoreKey(
          userId,
          conversationId,
          agentSlug,
        );
        const existing = storeKey ? getSandboxSession(storeKey) : undefined;
        const isRepoTemplate =
          !!existing &&
          (existing.id.includes("agent-workspace") ||
            existing.id.includes("docker-dev"));
        if (existing && isRepoTemplate) {
          const alive = await probeSession(existing, storeKey).catch(
            () => false,
          );
          if (alive) {
            sandboxLines.push(
              `- Active sandbox session: \`${existing.id}\` (already provisioned for this conversation). Use it as \`sessionId\` for ALL sandbox-run calls. Do NOT call \`sandbox-repo-setup\` again unless the session has died.`,
            );
            log(`Sandbox primer: surfaced existing session ${existing.id}`);
          }
        }
      }
      // Pinned repo config (agent.config.sandboxRepo). When set, the runtime
      // forces sandbox-repo-setup onto this repo — the LLM gets workdir + port
      // map so it doesn't guess `/home/user/` paths.
      const pinnedRepoName =
        (agentConfig?.["sandboxRepo"] as string | undefined) ?? undefined;
      const pinnedRepo = pinnedRepoName
        ? REPO_CONFIGS[pinnedRepoName]
        : undefined;
      if (pinnedRepoName && pinnedRepo) {
        const installPkgs = pinnedRepo.steps
          .filter(
            (
              s: SetupStep,
            ): s is { type: "install"; packages: string[]; cmd?: string } =>
              s.type === "install",
          )
          .flatMap((s) => s.packages);
        const setupLines: string[] = [];
        if (installPkgs.length > 0)
          setupLines.push(
            `  - npm install in: ${installPkgs.map((p) => `\`${p}/\``).join(", ")}`,
          );
        if (pinnedRepo.steps.some((s: SetupStep) => s.type === "services")) {
          setupLines.push(
            `  - docker compose services up (\`npm run services\`)`,
          );
        }
        if (!pinnedRepo.repoUrl) {
          // No-repo profile (e.g. "Browser (no repo)") — no clone, no dev
          // servers. The sandbox is a browser-only environment.
          sandboxLines.push(
            `- Pinned sandbox: **${pinnedRepoName}** — a browser-only sandbox (headless chromium + CDP + noVNC), NO repository and NO dev servers. Use the \`sandbox-pw-*\` tools for web automation; do not expect a repo at \`${pinnedRepo.workDir}\`.`,
          );
        } else {
          sandboxLines.push(
            `- Pinned repo: **${pinnedRepoName}** — repo \`${pinnedRepo.repoUrl}\`, default branch \`${pinnedRepo.defaultBranch}\`, workdir in VM \`${pinnedRepo.workDir}\`.` +
              (setupLines.length > 0
                ? `\n  \`sandbox-repo-setup\` auto-runs:\n${setupLines.join("\n")}`
                : "") +
              (pinnedRepo.ports
                ? `\n  Ports: ${Object.entries(pinnedRepo.ports)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")}`
                : ""),
          );
        }
      }
      const sandboxPrimer = sandboxLines.join("\n");
      fullContext = fullContext
        ? `${fullContext}\n\n${sandboxPrimer}`
        : sandboxPrimer;
    }

    // Surface every derived context file to the agent — without this, files
    // written under .context/ (xlsx/pdf/docx/pptx → <name>.md, html in place)
    // are invisible: the LLM sees only the user's free-text turn and replies
    // "I don't see any attachment". Each entry shows the ORIGINAL filename
    // plus the path the agent's read tool should use. EVERY type that
    // ingestAttachments converts must be listed below — docx/pptx/html were
    // converted and written but never advertised here, which is how a working
    // .docx conversion still produced "I don't see any attachment".
    // Advertise the SAME sanitized path that writeWorkspaceTextFiles actually
    // wrote. sanitizeRelativePath replaces every char outside [a-zA-Z0-9._-]
    // with "_", so "Juspay ecomm Issues Log.xlsx" lands at
    // ".context/Juspay_ecomm_Issues_Log.xlsx.md". Previously we showed the agent
    // the RAW filename (spaces/specials intact), so its first read hit a
    // nonexistent path and it had to guess the sanitization — which fails
    // outright for names with parens/&/commas/etc. Run the same sanitizer here
    // (toWorkspaceContextPath, which also prepends ".context/") so the path the
    // agent is told matches the file on disk exactly.
    const attachmentEntries: Array<{ label: string; path: string }> = [
      ...textAttachments.map((a) => ({
        label: `${a.fileName} (${a.mimeType || "application/octet-stream"})`,
        path: toWorkspaceContextPath(a.fileName),
      })),
      ...xlsxAttachments.map((a) => ({
        label: `${a.fileName} (xlsx, extracted to markdown)`,
        path: toWorkspaceContextPath(`${a.fileName}.md`),
      })),
      ...pdfAttachments.map((a) => ({
        label: `${a.fileName} (pdf, text-extracted to markdown)`,
        path: toWorkspaceContextPath(`${a.fileName}.md`),
      })),
      ...docxAttachments.map((a) => ({
        label: `${a.fileName} (docx, extracted to markdown)`,
        path: toWorkspaceContextPath(`${a.fileName}.md`),
      })),
      ...pptxAttachments.map((a) => ({
        label: `${a.fileName} (pptx, extracted to markdown)`,
        path: toWorkspaceContextPath(`${a.fileName}.md`),
      })),
      // html converts in place — its MD_CONVERTERS suffix is "", so the derived
      // file keeps the original filename rather than gaining a ".md".
      ...htmlAttachments.map((a) => ({
        label: `${a.fileName} (html, converted to markdown)`,
        path: toWorkspaceContextPath(a.fileName),
      })),
      ...videoAttachments.map((a) => ({
        label: recordSkillCommand
          ? `${a.fileName} (screen recording; analyze with analyze-skill-recording)`
          : `${a.fileName} (video, sampled to a visual narrative)`,
        path: toWorkspaceContextPath(`${a.fileName}.video.md`),
      })),
      ...(recordSkillCommand ? (recordingRefs ?? []).map((recording) => ({
        label: `${recording.fileName} (screen recording, ${Math.ceil(recording.fileSize / 1024 / 1024)} MB; analyze with analyze-skill-recording)`,
        path: toWorkspaceContextPath(`${recording.fileName}.video.md`),
      })) : []),
    ];
    if (attachmentEntries.length > 0) {
      const attachmentContext = [
        "## Attached Files",
        // e.path already includes the ".context/" prefix — show it verbatim.
        ...attachmentEntries.map((e) => `- ${e.label} → \`${e.path}\``),
        "These files were uploaded with the user's message. Read them at the EXACT path shown (do not alter it) before responding.",
      ].join("\n");
      fullContext = fullContext
        ? `${fullContext}\n\n${attachmentContext}`
        : attachmentContext;
    }

    // Inject copilot system instructions
    if (isCopilot) {
      // COPILOT_SYSTEM_INSTRUCTION imported at top
      const copilotNote = `\n\n${COPILOT_SYSTEM_INSTRUCTION}`;
      fullContext = fullContext ? `${fullContext}${copilotNote}` : copilotNote;
    }
    // Tell verifyResponses agents to deliver via submit-response (the tool was
    // injected above). Mutually exclusive with copilot mode by construction.
    if (verifyResponses && !isCopilot) {
      const note = `\n\n${SUBMIT_RESPONSE_SYSTEM_INSTRUCTION}`;
      fullContext = fullContext ? `${fullContext}${note}` : note;
    }
    // Structured output: tell the agent up-front that the final answer must go
    // through submit-result (the tool description alone surfaces too late).
    // Instruction wording (and the markdown outline) depends on the type.
    if (structuredOutputActive && outputFormat) {
      const note = `\n\n${buildSubmitResultInstruction(outputFormat)}`;
      fullContext = fullContext ? `${fullContext}${note}` : note;
    }
    // Inject additional instructions if provided (backend-contextual guidance not shown in UI)
    if (additionalInstructions) {
      const instructionsNote = `\n\n## Additional Instructions\n${additionalInstructions}`;
      fullContext = fullContext
        ? `${fullContext}${instructionsNote}`
        : instructionsNote;
    }

    // Inject ticket/canvas/call IDs from the frontend into context metadata
    // so the agent knows which specific items the user is asking about
    clog.info(
      `[run] Injecting referenced items: ticketIds=${JSON.stringify(ticketIds)}, canvasIds=${JSON.stringify(canvasIds)}, callIds=${JSON.stringify(callIds)}`,
    );
    if (ticketIds?.length || canvasIds?.length || callIds?.length) {
      const idLines = [
        "## Referenced Items",
        ...(ticketIds?.length ? [`- Ticket IDs: ${ticketIds.join(", ")}`] : []),
        ...(canvasIds?.length ? [`- Canvas IDs: ${canvasIds.join(", ")}`] : []),
        ...(callIds?.length ? [`- Call IDs: ${callIds.join(", ")}`] : []),
      ];
      fullContext = fullContext
        ? `${fullContext}\n\n${idLines.join("\n")}`
        : idLines.join("\n");
    }

    // Resolve the prefetch spec now that the tool palette is final: the
    // resolvers ARE the agent's own Spaces tools, invoked through the same
    // `execute` closure the model would use, so ACL and permissions come along
    // for free and there is no second auth path to keep in sync.
    if (prefetchSpecPromise) {
      const prefetchStartedAt = Date.now();
      try {
        const block = await buildPrefetchBlock({
          spec: await prefetchSpecPromise,
          tools: allTools as unknown as ExecutableTool[],
          identity: {
            userId,
            ...(userName ? { userName } : {}),
            ...(userEmail ? { userEmail } : {}),
          },
        });
        if (block) {
          fullContext = fullContext ? `${fullContext}\n\n${block}` : block;
          log(`[prefetch] attached ${block.length} chars in ${Date.now() - prefetchStartedAt}ms`);
        }
      } catch (err) {
        // Belt-and-braces: prefetch.ts already swallows everything, but a
        // prefetch failure must never be the reason a run does not happen.
        log(`[prefetch] skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Key sessions by user + conversationId + agentSlug so each caller gets an isolated sandbox per thread.
    // Branching: when claw-auth has cloned the source session to a sibling
    // `piSessionConversationId`, use THAT as the storage key — the DB
    // `conversationId` stays the same (single logical chat) but the PI
    // session JSONL file lives at the branched dir.
    const sessionConversationId = piSessionConversationId ?? conversationId;
    const sessionKey =
      buildSandboxStoreKey(userId, sessionConversationId, agentSlug) ?? sessionConversationId;
    const runtimeProvider = parentProviderConfig ? provider : undefined;
    const providerConfig = parentProviderConfig;
    // Convert image attachments to ImageContent format for the LLM, then
    // append video keyframes extracted at ingest (see videoBufferToContext).
    // The narrative `.context/<name>.video.md` carries the full description;
    // these keyframes let the agent look at key moments directly.
    const imageContents: ImageContent[] | undefined = [
      ...imageAttachments.map((a) => ({
        type: "image" as const,
        data: a.data,
        mimeType: a.mimeType,
      })),
      ...videoKeyframes.map((f) => ({
        type: "image" as const,
        data: f.data,
        mimeType: f.mimeType,
      })),
    ];

    const fileAttachments = textAttachments.map((a) => ({
      fileName: a.fileName,
      mimeType: a.mimeType,
      path: toWorkspaceContextPath(a.fileName),
    }));

    // Mention handling: tell the agent ONLY the trigger (write plain `@Name`),
    // never IDs/brackets/lookups. The result-delivery path in claw-auth resolves
    // `@Name` → a real mention against the run's context people (sender + anyone
    // already mentioned in the thread) server-side. The old guide taught the
    // bracket+resolve-ID format, which confused agents into guessing IDs or, per
    // its own rule, refusing to emit `@Name` at all — starving the resolver.
    // Only relevant in a chat thread (channelId present).
    const basePrompt = (systemPrompt ?? "").trimEnd();
    const citationGuide =
      agentSlug && CITATION_GUIDE_AGENT_SLUGS.has(agentSlug)
        ? CITATION_GUIDE
        : "";
    // Digital Twin mention flow runs with the agent's CONFIGURED system prompt
    // (systemPromptOverride), so the twin_deliver mandate baked into
    // buildSystemPrompt's fallback never reaches it — the model was never told
    // the tool is its only output channel and just answered in text. Append the
    // mandate to the ACTUAL system prompt here so the model always sees it.
    const twinMandate = isTwinMentionFlow
      ? buildTwinDeliverMandate({
          ...(userName ? { userName } : {}),
          ...(senderName ? { senderName } : {}),
          ...(channelName ? { channelName } : {}),
        })
      : "";
    // Accounts the agent is configured to use but the user hasn't connected or
    // configured. Told to the model so it surfaces the gap instead of
    // fabricating results from a tool it never received.
    // Built-in skill bundles loaded for this run: whatever the task command
    // asks for, plus the understanding bundle whenever this is a coverage-gated
    // run. UNDERSTANDING_SKILL_PATH teaches the document structure, the inline
    // SVG diagram rules (no mermaid — the artifact must render with no network
    // and no JS) and the file:line citation discipline the ledger enforces.
    const extraSkillPathNames = [
      ...(taskCommand?.skillPaths ?? []),
      ...(experiment?.kind === "understanding" ? [UNDERSTANDING_SKILL_PATH] : []),
    ];

    const securityGuide = `\n\n## Security mode\nYou are in a security run (epoch ${experiment?.epoch ?? 0}; focus ${experiment?.focus ?? "unspecified"}). Keep TWO TIERS apart, because mixing them is what makes a security report untrustworthy.\n\nLEAD (status=conjecture) — you read the code and the defect looks real. Cite file:line. Most findings belong here, and there is no shame in it.\nCONFIRMED (status=proved) — you EXECUTED it and captured the result: the request you sent, the status or output you got back, and where you verified the effect. The ledger refuses a close without an observation, so do not try to word around it. A script that greps source and asserts a vulnerable pattern is present is not a confirmation — it re-proves what you already read.\n\nDEFENDED is a real result. If you try it and a guard stops you, close it refuted and name the guard. Also check whether a SAFE SIBLING already exists — the same operation done correctly elsewhere in the repo. That has been the single most common shape, and it is the cheapest fix to recommend.\n\nDo not promote a lead because it looks obvious. Confirming a wrong finding is expensive: it becomes a ticket someone has to disprove.\n\nThis run is TIME-BOXED: end-experiment refuses until the deadline, because attack surface cannot be exhausted — there is always one more endpoint. When a surface runs dry, move to a different one rather than restating closed findings.\n\nThe DELIVERABLE is ONE markdown report with a STABLE filename, extended EVERY epoch (so a run that ends at the deadline still delivers everything found), with the two tiers in separate sections and the exact reproduction for every CONFIRMED entry. The sandbox recycles — if the file is missing locally, recover it with spaces-thread-attachments + spaces-fetch-attachment and extend THAT.`;

    const frameworkGuide = `\n\n## Framework mode\nYou are in a framework run (epoch ${experiment?.epoch ?? 0}; focus ${experiment?.focus ?? "unspecified"}). You are NOT hunting bugs. You are looking for STRUCTURAL gaps — places where the codebase is harder to extend safely than it should be because a framework-level construct is missing or inconsistent. Duplication is only ONE shape of this; do not reduce framework mode to finding copy-paste.\n\nThe shapes worth finding include (not a fixed list — name what you actually see):\n- convention-drift: one concept implemented several inconsistent ways (auth checks, error mapping, pagination) — the sites VARY, and that variance is the problem.\n- missing-paved-path: a common need everyone solves ad-hoc because there is no blessed way to do it.\n- change-amplification: adding one feature keeps touching N unrelated files because there is no seam / extension point.\n- boilerplate: mechanical scaffolding a base class, codegen, or lint rule could erase.\n- duplication: literally the same logic repeated.\n\nTAG EVERY OPPORTUNITY. Each closed opportunity carries a Tag that is YOUR OWN word for its shape (kebab-case). Reuse a tag you can already see in the ledger below if it fits; coin a new one only if it genuinely does not. The ledger enforces, for every proved opportunity, a note containing:\n  Tag: <your tag>\n  <at least one file.ext:LINE where the gap lives>\n  Prevents: <the concrete bug, drift, or change-amplification the framework would have stopped>\nThe \`Prevents:\` line is the real bar — it is what separates an opportunity from taste, and it holds for any tag. If you cannot name what the framework prevents, it is taste: refute it and move on. Note that a VARYING pattern (five different auth checks) is a legitimate convention-drift opportunity even though the code is not identical — do NOT refute it just because the occurrences differ.\n\nRefuting is real progress: a wrong extraction costs more than the duplication it replaces, and a report full of speculative abstractions is worse than a short one.\n\nThe exit is exhaustion, not the clock: enumerate the candidate areas in scope as open conjectures first, then close each (proved or refuted). When open reaches 0 and the report is delivered, end.\n\nThe DELIVERABLE is ONE markdown report with a STABLE filename you reuse every epoch — never epoch1.md, epoch2.md. GROUP the opportunities BY TAG; each gets its file:line evidence, the proposed abstraction, its Prevents, and an honest migration cost. Also include a Tag Index table summarizing every tag used: tag name, finding count, affected areas, proposed paved path/framework abstraction, and migration cost. Extend the same file each epoch; the sandbox recycles, so if it is missing locally, recover it with spaces-thread-attachments + spaces-fetch-attachment and extend THAT.`;

    const repoHistoryGuide = `\n\n## Repo-history mode\nYou are in a PROGRESS-gated repo-history run (epoch ${experiment?.epoch ?? 0}; focus ${experiment?.focus ?? "whole repo"}). Your job is to reconstruct the coding SPEC of this repo — the rules and decisions someone would need to REBUILD it — by walking git history OLDEST→NEWEST. The exit is reaching HEAD, not the clock.\n\nCURSOR + BATCHING: the ledger records how far you have walked. Establish the frontier once with \`git log <initial-sha>..HEAD --reverse --oneline\` (oldest first; default initial-sha = the repo's first commit unless a sha was given in focus). Each epoch, take the NEXT BATCH after the cursor — a sensible chunk (~20-50 ordinary commits), but a SQUASH/MERGE commit is its own batch (it is one decision with one big diff and no granular commits, so read its PR discussion for the WHY instead of parsing the whole diff). Advance the cursor to the last sha you distilled and record it. Never re-read batches behind the cursor.\n\nEXTRACT DECISIONS, NOT DIFFS. For each batch, record the coding RULE it establishes — the convention, invariant, or always/never — not a changelog. TAG each by theme (kebab-case: error-handling, provider-fallback, security, naming, …), reusing an existing tag when it fits. The ledger enforces, for every proved entry, a note containing:\n  Rule: <the durable instruction someone rebuilding the repo would follow>\n  sha: <the commit it derives from>\n  Tag: <your theme tag>\n\nRECONCILE AGAINST HEAD — the correctness bar. History is full of dead ends: a rule set early is often REVERSED or REWRITTEN later, and here that usually arrives as a plain "fix" commit, NOT a git revert. So you cannot trust commit messages — when a later batch's code overturns a rule already in the ledger, AMEND that entry in place; never leave two contradictory rules. A rule HEAD no longer honours moves to the GRAVEYARD with a \`Supersedes:\` line and why it died. The final doc must not contain a single rule the current code contradicts — the running code is the spec; history only supplies the WHY.\n\nThe DELIVERABLE is ONE self-contained .html decision-log — no network requests, no JavaScript, so it renders offline — with a STABLE filename you reuse every epoch (never epoch1.html). Three sections: CURRENT RULES (reconciled to HEAD, grouped by tag) / LINEAGE (which sha introduced or changed each rule) / GRAVEYARD (tried-and-abandoned, with why); use plain HTML tables so the rules and their shas read cleanly. Author it in the sandbox and send it with sandbox-deliver-files. Extend the same file each epoch; the sandbox recycles, so if it is missing locally, recover it with spaces-thread-attachments + spaces-fetch-attachment and extend THAT. When the cursor reaches HEAD and the doc is delivered, end.`;

    const experimentGuide = experiment?.mode === "review"
      ? `\n\n## Experiment checker\nYou are the CHECKER for a running experiment, not a participant. Do NOT hunt for new findings, do not start a hypothesis, and do not try to end the experiment — you have neither tool. Verify each finding you were given against the current code and the delivered proof, then call experiment-review once per finding. Your verdict is advisory; it never changes a finding's status. When unsure, say contradicts or unverifiable — a false confirm becomes a ticket a human has to disprove. Finish with ONE short line of verdict counts.`
      : experiment?.kind === "security"
      ? securityGuide
      : experiment?.kind === "framework"
      ? frameworkGuide
      : experiment?.kind === "repo-history"
      ? repoHistoryGuide
      : experiment?.kind === "understanding"
      ? `\n\n## Understanding mode\nYou are in a coverage-gated understanding run (epoch ${experiment.epoch}; focus ${experiment.focus ?? "unspecified"}). Your job is to UNDERSTAND every reachable code path in scope, not to accumulate trivially-provable facts. The exit is exhaustion, not the clock: end-experiment unlocks only when the open-conjecture frontier reaches 0 (with at least one path closed). Loop: read the ledger -> if the frontier is empty, enumerate every entrypoint and branch in scope as an open conjecture (experiment-ledger action=record status=conjecture, one per path) -> pick ONE open path, trace it to real behavior, and ADD every new callee or branch you discover as a new open conjecture BEFORE you close the current one (proved/refuted) with file:line evidence and a description of what the code actually does and why. The frontier grows as you explore and shrinks only when a path is genuinely explained — never close a path with a shallow structural restatement. When open reaches 0 the scope is exhausted: deliver the artifact and end.\n\nThe DELIVERABLE is one self-contained .html explanation document, authored in the sandbox and sent with sandbox-deliver-files — not chat prose and not the ledger, which no reader will open. Follow the loaded understanding skills for its structure, its inline-SVG diagrams (no mermaid: the file must render with no network and no JavaScript) and the file:line citation discipline. Build it incrementally as paths close rather than all at once at the end, so a run that hits the safety cap still delivers a document covering what it did explain.\n\nONE CANONICAL DOCUMENT, NOT ONE PER EPOCH. The deliverable has a single STABLE filename you reuse every epoch (e.g. <topic>-explained.html) — never epoch1.html, epoch2.html. Each epoch EXTENDS the same document; do not start a new one. The sandbox is ephemeral and recycles across a long run, so at the START of each epoch, if that file is not on local disk, it means you are in a fresh sandbox: recover the latest version you already delivered — spaces-thread-attachments to find your canonical .html, spaces-fetch-attachment to pull it back — and extend THAT, rather than rebuilding from nothing or emitting a fragment. Re-deliver the same filename after each extension so the newest version always wins.\n\nAn incrementally-built document is in the order you EXPLORED, which is the wrong order to READ: before you deliver, do a consolidation pass that reorganises it into reading order — TL;DR and mental model first, then the end-to-end flows (each with its own diagram), then per-component detail grouped by role, then the exhaustive per-entity reference LAST, then the lookup table. Renumber sections contiguously, merge anything stated twice, and push deep detail down out of the overview. A document whose sections jump out of sequence or open with deep internals was never reorganised.`
      : experiment
      ? `\n\n## Experiment mode\nYou are in a time-boxed experiment (epoch ${experiment.epoch}; deadline ${experiment.deadlineAt}; focus ${experiment.focus ?? "unspecified"}). You cannot finish early — end-experiment refuses before the deadline. Loop: read the ledger → declare a hypothesis (experiment-ledger action=hypothesis) → gather PROOF in the sandbox (failing test, benchmark delta, profile) → record the finding with its proof path. Never re-test refuted hypotheses. If your current lead dies, pick a different subsystem. Prose without a recorded finding is wasted time.`
      : "";
    const authoritativeSdlcContext = trustedSdlcContext
      ? `\n\n## Authoritative SDLC Run Context\n\nThe platform verified this immutable run context. Use these exact IDs and repository coordinates; never infer or replace them. Runtime credentials are intentionally absent.\n\n\`\`\`json\n${JSON.stringify(trustedSdlcContext, null, 2)}\n\`\`\``
      : "";
    const effectiveSystemPrompt = ((channelId
      ? `${basePrompt}${citationGuide}${SPACES_MENTION_GUIDE}`
      : `${basePrompt}${citationGuide}`) + authoritativeSdlcContext) + twinMandate + experimentGuide;
    // Proof (twin mention flow only) that BOTH prompt changes actually reach the
    // model: the twin_deliver mandate + its who/where line in the SYSTEM prompt,
    // and the "@mentioned by" note in the USER-prompt context. Grep the run logs
    // for `[run] TWIN prompt proof` to confirm on any given run.
    if (isTwinMentionFlow) {
      log(
        `[run] TWIN prompt proof — SYSTEM: mandate=${effectiveSystemPrompt.includes("Delivering your response — REQUIRED")} whoWhere=${effectiveSystemPrompt.includes("You were mentioned by")} | ` +
          `CONTEXT: mentionNote=${(context ?? "").includes("You were @mentioned")} | sender=${senderName ?? "(none)"} channel=${channelName ?? "(none)"}`,
      );
    }
    const fastModeCatalogPrompt = catalogActive
      ? renderToolCatalogForPrompt(fastCatalogItems.map((item) => item.entry), {
          // Only fast mode actually turns delegation off; asserting it on a
          // normal run would be a lie the model acts on.
          subagentDelegationDisabled: fastModeEnabled,
        })
      : "";
    if (fastModeCatalogPrompt) {
      fullContext = fullContext
        ? `${fullContext}\n\n${fastModeCatalogPrompt}`
        : fastModeCatalogPrompt;
    }
    // Reads as an addendum to the catalog index above: WHY this run has the
    // presentation catalog (the surface, not the agent's tool config) and HOW
    // to answer on a chat surface. Empty unless presentation entries actually
    // survived into this run's catalog.
    const presentationPrimer = presentationDefaultOn
      ? buildPresentationPrimer(fastCatalogItems.map((item) => item.entry))
      : "";
    if (presentationPrimer) {
      fullContext = fullContext
        ? `${fullContext}\n\n${presentationPrimer}`
        : presentationPrimer;
      log(`[catalog] presentation primer injected (${presentationPrimer.length} chars)`);
    }
    const fastModeSubagentSkills =
      fastModeEnabled && customSubagents && customSubagents.length > 0
        ? customSubagents.map((spec) => ({
            slug: `fast-${spec.name}`,
            name: `fast-${spec.name}`,
            description: `Fast-mode guidance for ${spec.name}; read before using its referenced tools.`,
            content: [
              `# ${spec.name}`,
              "",
              `Trigger: read before using tools from custom subagent ${spec.name}.`,
              "",
              "## System Prompt",
              spec.systemPrompt,
              ...(spec.skills.length > 0
                ? [
                    "",
                    "## Skills",
                    ...spec.skills.map((skill) =>
                      [
                        `### ${skill.name}`,
                        skill.description ? `Description: ${skill.description}` : "",
                        skill.content,
                      ].filter(Boolean).join("\n"),
                    ),
                  ]
                : []),
            ].join("\n"),
          }))
        : [];
    const effectiveSkills =
      fastModeSubagentSkills.length > 0
        ? [...(skills ?? []), ...fastModeSubagentSkills]
        : skills;

    // Quota fallback wrapper: walks the agent owner's `providerOrder` on
    // 429 / insufficient_quota / out-of-credits, then drops to "spaces" (Kimi
    // via LiteLLM) as the terminal fallback. If providerOrder isn't set we
    // collapse to the previous behavior (single retry on Kimi).
    //
    // Build the attempt chain:
    //   - First entry = the current parent (runtimeProvider).
    //   - Subsequent entries = remaining providers from `providerOrder`
    //     for which we actually have credentials in `providerConfigs`.
    //   - Final entry = "spaces" (Kimi) unless the parent already was it and
    //     agentConfig.providerFallbackToSpaces has not been explicitly disabled.
    type Attempt = {
      provider: string | undefined;
      config: typeof providerConfig | undefined;
    };
    const attempts: Attempt[] = [
      { provider: runtimeProvider, config: providerConfig },
    ];
    if (providerOrder && providerOrder.length > 0) {
      for (const p of providerOrder) {
        if (p === runtimeProvider) continue;
        if (p === "spaces") continue; // appended last
        const cfg = providerConfigs?.[p];
        if (!cfg) continue;
        attempts.push({ provider: p, config: cfg });
      }
    }
    const providerFallbackToSpaces = agentConfig?.["providerFallbackToSpaces"] !== false;
    if (runtimeProvider && runtimeProvider !== "spaces" && providerFallbackToSpaces) {
      attempts.push({ provider: "spaces", config: undefined });
    } else if (runtimeProvider && runtimeProvider !== "spaces" && !providerFallbackToSpaces) {
      clog.info(`[agent] provider fallback to spaces disabled session=${sessionId} provider=${runtimeProvider}`);
    }
    const attemptByProvider = new Map(
      attempts
        .filter((a): a is Attempt & { provider: string } => typeof a.provider === "string")
        .map((a) => [a.provider, a]),
    );

    // Default the per-attempt compaction flag to the caller's `compactBeforeRun`
    // (set by `/compact`). The provider-fallback machine still passes `true`
    // explicitly on empty-completion retries; this just makes the FIRST attempt
    // compact too when the user asked for it.
    const runAttempt = (a: Attempt, forceCompactBeforeRun = compactBeforeRun === true) =>
      runTask({
        // Per-agent model settings. `model` is the Spaces/platform-default model
        // override — runTask only applies it on attempts with no provider
        // credential (the LiteLLM branch), so premium attempts keep the model
        // configured on their credential.
        modelSettings,
        ...(structuredOutputActive ? { structuredOutputRef } : {}),
        ...(isTwinMentionFlow ? { twinDeliverRef } : {}),
        // Debug telemetry only — agent.ts emits session_tools/mode_switch events.
        ...(isPlanMode ? { mode: "plan" as const } : mode ? { mode } : {}),
        ...(planContinuation ? { planContinuation: true } : {}),
        userId,
        task,
        context: fullContext,
        // Automation/scheduled runs draw from the low-priority LiteLLM key so
        // batch fleets can't queue interactive mentions (same predicate as the
        // read-only sandbox routing above).
        automationRun: isReadOnlyJob,
        userName,
        userEmail,
        customTools: tools,
        systemPromptOverride: effectiveSystemPrompt,
        cwd: workspaceDir,
        conversationId: sessionKey,
        provider: a.provider,
        providerConfig: a.config,
        progressUrl,
        sessionId,
        images: imageContents?.length ? imageContents : undefined,
        fileAttachments:
          fileAttachments.length > 0 ? fileAttachments : undefined,
        skills: effectiveSkills,
        // Built-in skill bundles: task commands name their own, and an
        // understanding run always loads the explanation bundle — its
        // deliverable is a document, and without the bundle the model defaults
        // to chat prose and a ledger nobody reads.
        ...(extraSkillPathNames.length > 0
          ? { extraSkillPaths: extraSkillPathNames.map((skillPath) => resolve(XYNE_CLAW_PACKAGE_DIR, skillPath)) }
          : {}),
        skillTriggers:
          resolvedTriggers.length > 0 ? resolvedTriggers : undefined,
        promptInjections:
          activeInjections.length > 0 ? activeInjections : undefined,
        ...(taskCommand?.requiredTool && taskCommandToolAvailable
          ? { requiredTool: { name: taskCommand.requiredTool, nudge: taskCommand.nudge } }
          : {}),
        ...(twinPersonaBlock ? { twinPersona: twinPersonaBlock } : {}),
        abortSignal,
        debugStartedAt: parallelFollowUpStartedAt,
        // Raw Spaces identity for progress callbacks → lets /webhook/progress fall
        // back to claw-auth's conv-keyed session index (mirrors the /result body).
        progressMeta: {
          conversationId: conversationId ?? null,
          agentSlug: agentSlug ?? null,
        },
        forceCompactBeforeRun,
        // submit-response verification: agent.ts wires the evidence accessor on
        // this ref so the tool can check drafts against gathered tool results.
        ...(verifyResponses && !isCopilot
          ? { verifyResponsesRef: evidenceRef }
          : {}),
        citationReflection,
        autoToolCitations,
        // Thread invocations (Spaces/Slack replies — channelId present) keep a
        // clean posted reply = the last 2 assistant turns; ask-ai and every other
        // surface keep ALL turns so the stored answer matches the streamed one.
        finalAnswerMaxTurns: channelId ? 2 : undefined,
        ...(isRegenerate ? { isRegenerate: true } : {}),
        backgroundRegistry: backgroundSubagentRegistry,
        fastMode: fastModeEnabled,
        ...(catalogActive ? { fastToolCatalogNames: fastCatalogNames } : {}),
        ...(catalogActive ? { fastToolController } : {}),
        ...(catalogActive ? { fastMaxActiveTools: fastModeLoadedToolBudget } : {}),
        ...(resumedFromHandoff === true ? { resumedFromHandoff: true } : {}),
        handoff: handoffControl,
        gracefulInterrupt: {
          isRequested: () => activeRuns.get(sessionId)?.gracefulInterruptRequested === true,
          registerSummaryRequest: (requestSummary) => {
            const active = activeRuns.get(sessionId);
            if (active) active.requestGracefulInterruptSummary = requestSummary;
          },
        },
        ...(awakening
          ? {
              awakening: {
                kind: awakening.kind,
                writePolicy: awakening.writePolicy,
                shadow: awakening.shadow,
                ...(awakening.injectEnabled !== undefined ? { injectEnabled: awakening.injectEnabled } : {}),
              },
            }
          : {}),
      });

    // Capture provider-fallback context so an empty FINAL result can tell the
    // user it was a provider/quota failure (e.g. 429) instead of a silent blank.
    // `lastFallbackUnderlying` holds the error that triggered the most recent
    // fallback (a 429/quota rate_limit_error, or "empty completion from <p>").
    let providerFellBack = false;
    let lastFallbackUnderlying: string | undefined;

    // Provider-fallback state machine (empty-completion + quota fallback,
    // compact-before-fallback). Decision logic extracted to provider-fallback.ts
    // so it's unit-tested; this call wires in the I/O (run, log, metrics).
    const {
      result: fbResult,
      completedAttempt,
      fellBackProvider,
    } = await runWithProviderFallback<
      Attempt,
      Awaited<ReturnType<typeof runTask>>
    >({
      attempts,
      providerLabel: (a) => a.provider ?? "spaces",
      runAttempt,
      // Nothing user-visible: no text, no attachments, no pending responses/actions.
      producedNothing: (r) =>
        !r.text.trim() &&
        getAttachments().length === 0 &&
        getPendingResponses().length === 0 &&
        getPendingActions().length === 0 &&
        getCustomPendingActions().length === 0,
      // Auth failures walk the fallback chain like quota: a PRESENT-but-bad
      // premium credential (expired OAuth, revoked key → 401/403) must fall
      // through to the next provider (→ spaces), not hard-fail the run. This
      // matters now that dispatchers thread the agent's premium provider as
      // the primary — before, bad creds simply never got selected as primary.
      isQuotaError: (err) =>
        err instanceof QuotaExhaustedError || isQuotaExhaustedError(err) || isProviderAuthError(err),
      // Transient provider/network failures + detected stalls fall back to the
      // next provider (→ spaces) instead of dropping the run. A genuine user
      // cancel is gated out by isCancelled below before this is consulted.
      isTransientError: (err) => isTransientProviderError(err),
      isCancelled: (err) =>
        err instanceof RunCancelledError || !!abortSignal?.aborted,
      hooks: {
        onFallback: (from, to, lastErr) => {
          providerFellBack = true;
          lastFallbackUnderlying =
            lastErr instanceof Error ? lastErr.message : String(lastErr);
          metric.count("agent_provider_fallback", { from, to, agentSlug });
          if (to === "spaces" && from !== "spaces") {
            const wantedAttempt = attemptByProvider.get(from);
            if (wantedAttempt?.config) {
              const usingModel = LITELLM.model;
              clog.warn(
                `[agent] provider-fallthrough session=${sessionId} wanted=${from}/${wantedAttempt.config.model} using=spaces/${usingModel} reason=${lastFallbackUnderlying}`,
              );
              metric.count("provider_fallthrough");
            }
          }
          log(
            `Provider fallback: ${from} → ${to}. Underlying: ${lastFallbackUnderlying}`,
          );
        },
        onEmpty: (provider, terminal) => {
          metric.count("agent_empty_completion", {
            provider,
            agentSlug,
            terminal,
          });
          if (!terminal)
            log(
              `Empty completion from ${provider} (no text/attachments/pending) — compacting + falling back to next provider.`,
            );
        },
        onRecovered: (provider) =>
          log(`Quota fallback succeeded on ${provider}.`),
      },
    });
    const result = fbResult;

    const resultAttachments = [...getAttachments(), ...(mcpGetAttachments?.() ?? [])];
    const pendingQuestions = getPendingQuestions();
    const hadFollowUpRecorder = pendingQuestions.some(
      (question) => question.purpose === "follow_up_suggestions",
    );
    const shouldAttachGeneratedFollowUps = shouldGenerateFollowUpsForRun(
      followUpsEnabled,
      result.text,
      pendingQuestions,
    );
    const inlineFollowUps = shouldAttachGeneratedFollowUps
      ? parallelFollowUpResult
      : undefined;
    const followUpOutcome:
      | "delivered_inline"
      | "parallel_pending"
      | "already_recorded"
      | "empty_answer"
      | "disabled" =
      !followUpsEnabled
        ? "disabled"
        : result.text.trim().length === 0
          ? "empty_answer"
          : hadFollowUpRecorder
            ? "already_recorded"
            : inlineFollowUps
              ? "delivered_inline"
              : "parallel_pending";
    let generatedFollowUpCount = 0;
    if (inlineFollowUps) {
      const { suggestions } = inlineFollowUps.generation;
      generatedFollowUpCount = suggestions.length;
      const followUpQuestion = asFollowUpPendingQuestion(suggestions);
      pendingQuestions.push(followUpQuestion);
      // Persist the deterministic post-response output in AgentRun's existing
      // toolInvocations JSON. History can then restore the chips without a DB
      // migration, while the API strips this internal recorder from activity UI.
      const followUpRecorder = {
        toolName: "ask-user-question",
        args: followUpQuestion,
        result: "Follow-up suggestions recorded.",
        isError: false,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        status: "completed" as const,
        toolCallId: `follow-up-${followUpQuestion.questionId}`,
      };
      result.toolInvocations.push(followUpRecorder);
      pushInvocation(progressUrl, sessionId, followUpRecorder);
      clog.info(
        `[follow-ups] delivered inline sessionId=${sessionId} agentSlug=${agentSlug ?? ""} count=${suggestions.length}`,
      );
    }
    if (followUpsEnabled) {
      const followUpDiagnostic = {
        toolName: "internal-follow-up-diagnostics",
        args: {
          purpose: "follow_up_debug",
          enabled: true,
          enabledByV2Flag: followUpsEnabledByFlag,
          answerLength: result.text.length,
          hadExistingRecorder: hadFollowUpRecorder,
          outcome: followUpOutcome,
          suggestionCount: generatedFollowUpCount,
          generationInput: followUpGenerationInput,
          conversationMessageCount: followUpConversationHistory.length,
          agentContextProvided: Boolean(followUpAgentContext),
          agentContextName: followUpAgentContext?.name,
          agentContextDescription: followUpAgentContext?.description,
          generationSource: inlineFollowUps?.generation.source,
          generationModel: inlineFollowUps?.generation.model,
          failureCode: inlineFollowUps?.generation.failureCode,
          failureMessage: inlineFollowUps?.generation.failureMessage,
          httpStatus: inlineFollowUps?.generation.httpStatus,
        },
        result: `Follow-up generation ${followUpOutcome}.`,
        isError: false,
        startedAt: parallelFollowUpStartedAt,
        durationMs: inlineFollowUps
          ? Math.max(
              0,
              new Date(inlineFollowUps.completedAt).getTime() -
                new Date(parallelFollowUpStartedAt).getTime(),
            )
          : 0,
        status: followUpOutcome === "parallel_pending" ? ("running" as const) : ("completed" as const),
        toolCallId: `follow-up-debug-${sessionId}`,
      };
      result.toolInvocations.push(followUpDiagnostic);
      pushInvocation(progressUrl, sessionId, followUpDiagnostic);
    }
    const pendingActions = [
      ...getPendingActions(),
      ...getCustomPendingActions(),
    ];
    const dedupedPendingActions = (() => {
      const seen = new Set<string>();
      const out: Array<Record<string, unknown>> = [];
      for (const action of pendingActions) {
        if (!action || typeof action !== "object") {
          out.push(action);
          continue;
        }
        const record = action as Record<string, unknown>;
        const signature = typeof record.signature === "string" ? record.signature : "";
        const key = signature.length > 0 ? `sig:${signature}` : `raw:${JSON.stringify(record)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(action);
      }
      return out;
    })();
    const pendingResponses = getPendingResponses();
    const completedProvider =
      completedAttempt?.provider ?? runtimeProvider ?? "spaces";
    // Report the model that the COMPLETED attempt actually used. The old
    // `?? effectiveModel` leaked one provider's model onto another: the
    // "spaces" attempt carries config: undefined by design, so a run that fell
    // back to spaces reported the parent's model (spaces/gpt-5.5), and a codex
    // run whose config had no model reported LITELLM.model
    // (codex/private-large-spaces). Both shapes are visible in agent_runs and
    // sent two prod diagnoses down the wrong path (2026-08-27/28). Only spaces
    // may default to the platform model; anything else reports undefined
    // (column left unset) rather than a model that never ran.
    const completedModel =
      completedAttempt?.config?.model ??
      (completedProvider === "spaces" ? LITELLM.model : undefined);
    callbackProvider = completedProvider;
    callbackModel = completedModel;

    // Flatten: parent's top-level tools + nested MCP tools run inside subagents.
    // Chain conditions evaluate against this combined list so users can match
    // on specific inner tools (Bitbucket__create_pull_request) in addition to
    // subagent wrappers (bitbucket).
    const combinedToolsUsed = [...result.toolsUsed, ...subagentInnerTools];

    const lat = result.latency;
    const latencyStr = lat
      ? ` | total=${lat.totalMs}ms llm=${lat.llmTotalMs}ms (wait=${lat.llmWaitMs}ms decode=${lat.llmDecodeMs}ms) tools=${lat.toolMs}ms turns=${lat.llmTurns} retries=${lat.llmRetries}` +
        (lat.firstTurnTtftMs != null ? ` ttft=${lat.firstTurnTtftMs}ms` : "") +
        (lat.tokensPerSec != null ? ` tps=${lat.tokensPerSec}` : "")
      : "";
    log(
      `Completed: ${combinedToolsUsed.length} tools used (${result.toolsUsed.length} top-level + ${subagentInnerTools.length} nested), ${resultAttachments.length} attachment(s), ${pendingQuestions.length} question(s), ${dedupedPendingActions.length} pending action(s), ${pendingResponses.length} copilot response(s), resultLength=${result.text.length}${latencyStr}`,
    );

    // Rescue empty-text runs that delivered an attachment. If the agent
    // called an attachment-emitting tool (e.g. create-html-report) and then
    // ended its turn with no chat-visible text, Spaces hides the message
    // entirely and shows "Sorry, I wasn't able to produce a response."
    // Promote the most recent attachment tool's summary (e.g. the agent's
    // own `summary` parameter to create-html-report) to result.text so the
    // user gets a real reply alongside the attachment.
    let finalResultText = result.text;

    // Structured output: derive the chat-visible text from the captured payload
    // and (for type "json") expose the raw JSON to machine consumers.
    //   - markdown      → the agent's markdown string, posted as-is.
    //   - json+template → render the template to markdown for the chat reply;
    //                     raw JSON still flows to workflow/trigger consumers.
    //   - json          → pretty-printed JSON in the chat (no template).
    let structuredOutputPayload: unknown;
    if (
      structuredOutputActive &&
      outputFormat &&
      structuredOutputRef.value !== undefined
    ) {
      const v = structuredOutputRef.value;
      if (outputFormat.type === "markdown") {
        finalResultText = typeof v === "string" ? v : String(v);
      } else {
        structuredOutputPayload = v;
        if (outputFormat.template) {
          try {
            finalResultText = renderTemplate(outputFormat.template, v);
            log(
              `Structured output rendered via template (length=${finalResultText.length})`,
            );
          } catch (e) {
            finalResultText = JSON.stringify(v, null, 2);
            log(
              `Template render failed, falling back to raw JSON: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        } else {
          finalResultText = JSON.stringify(v, null, 2);
        }
      }
    }

    if (
      (!finalResultText || !finalResultText.trim()) &&
      resultAttachments.length > 0 &&
      customToolsResult
    ) {
      const fallback = customToolsResult.getLastAttachmentSummary();
      if (fallback && fallback.trim()) {
        finalResultText = fallback.trim();
        log(
          `Rescued empty result.text from attachment summary (length=${finalResultText.length})`,
        );
      }
    }

    // submit-response / respond-to-user agents (verifyResponses, copilot, codex —
    // e.g. the doctor agents) deliver their answer as pendingResponses, which
    // leaves result.text EMPTY. The automation/scheduled executor reads the
    // `result` field, so without this the coerced result is `{"result":""}` and
    // REPLY_ON_MESSAGE (content: z.string().min(1)) silently drops it — every run.
    // Fold the pendingResponse message(s) into the result when result.text is
    // empty. Mention runs post pendingResponses directly, so this is a safe
    // fallback there too.
    if ((!finalResultText || !finalResultText.trim()) && pendingResponses.length > 0) {
      finalResultText = pendingResponses
        .map((r) => r.message)
        .filter((m) => typeof m === "string" && m.trim().length > 0)
        .join("\n\n")
        .trim();
      log(
        `Rescued empty result.text from ${pendingResponses.length} pending response(s) (length=${finalResultText.length})`,
      );
    }

    // Retrieve LLM-provided citations from add_citations tool
    const llmCitations = takeLlmCitations(sessionId);
    log(
      `llmCitations retrieved: ${llmCitations?.length ?? 0} keypoint(s) for session ${sessionId}`,
    );

    const automationStructuredResult =
      eventType === "automation"
        ? coerceAutomationResult(finalResultText)
        : undefined;
    // `result` is always the plain chat/markdown answer (the structured
    // `{result:...}` object travels separately in `automationResult` /
    // `structuredOutput` for machine consumers). We do NOT stringify the
    // wrapper into `result`: the Spaces RUN_AGENT executor posts the `result`
    // field verbatim, so a stringified `{"result":"…\n…"}` showed up in threads
    // as raw escaped JSON instead of the rendered answer. The executor still
    // gets the structured form via `automationResult`.
    // Sanitize citation tokens against the run's REAL tool citations before this
    // text is persisted / emitted (DB body, GCS marker, done frame all read this
    // one variable): drop hallucinated [clf-…] tokens the model invented, and
    // rewrite its malformed forms — legacy [n](cite:clf-…), ranges [clf-id#a-#b],
    // and label/ordinal [Image #1] — to valid [clf-…] tokens when a matching
    // citation actually exists. Skipped for structured JSON output (that text IS
    // the machine payload, not chat markdown).
    const rawCallbackText =
      structuredOutputPayload !== undefined
        ? finalResultText
        : sanitizeCitations(finalResultText, result.toolInvocations, result.sessionClfTokens);
    // Digital Twin mention flow: the ONLY user-visible reply is the structured
    // twin_deliver message (clean, first-person) — the raw assistant transcript
    // (with any process narration) never travels as `result`. A react-only or a
    // fail-closed no-delivery carries no message, so the text is empty and
    // claw-auth posts only the reaction / stays silent. The full structured
    // delivery (action, emoji, destination) rides on the `twinDelivery` field.
    const twinDelivery = isTwinMentionFlow ? result.twinDelivery : undefined;
    const defaultCallbackResultText = isTwinMentionFlow ? (twinDelivery?.message ?? "") : rawCallbackText;
    // `/explainer` is an artifact-only command: once the MP4 exists, send the
    // attachment without the model's storyboard/process narration or a generic
    // "rendered" caption. If rendering failed, retain the text error/fallback.
    const explainerVideoAttached =
      taskCommand?.command === "/explainer" &&
      resultAttachments.some((attachment) => attachment.mimeType === "video/mp4");
    const callbackResultText = explainerVideoAttached ? "" : defaultCallbackResultText;

    // Honor an explicit user stop even when generation FINISHED before the abort
    // could interrupt it. Non-copilot agents (codex/spaces) deliver their final
    // answer here on the success path — NOT via respond-to-user — so the catch
    // block's user-cancel guard never runs for them. Without this, a fast run
    // ("count to 100") posts status="completed" and the answer overwrites the
    // user's "Query aborted by user." in the UI. Emit "cancelled" and skip the
    // completed marker + callback so nothing is persisted/posted.
    if (activeRuns.get(sessionId)?.userCancelled === true) {
      log(`Session cancelled by user — suppressing completed result: ${sessionId}`);
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        fastMode: fastModeForCallback,
        status: "cancelled",
      });
      return;
    }

    if (activeRuns.get(sessionId)?.gracefulInterruptRequested === true) {
      log(`Session interrupted with model summary: ${sessionId}`);
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        fastMode: fastModeForCallback,
        status: "completed",
        result: buildInterruptSummary(callbackResultText, {
          toolsUsed: combinedToolsUsed,
          toolInvocations: result.toolInvocations,
        }),
        toolsUsed: combinedToolsUsed,
        tokenUsage: result.tokenUsage,
        ...(result.toolInvocations.length > 0 ? { toolInvocations: result.toolInvocations } : {}),
        provider: completedProvider,
        model: completedModel,
      });
      return;
    }

    // Durable terminal marker — the source of truth for "this run finished",
    // written to GCS BEFORE the result callback. A deploy/SIGTERM can drop the
    // callback (the 2026-06-11 incident), leaving recovery to re-dispatch; the
    // recovery worker + this run's own pre-check read this marker and replay
    // the result instead of re-executing side-effecting work. Keyed by
    // idempotencyKey (recovery rootSessionId) when present, else this run's
    // sessionId (= rootSessionId for the original dispatch). Best-effort: a
    // failed marker write just means a re-dispatch would re-run (current behavior).
    await gcsUploadResultMarker(
      idempotencyKey ?? sessionId,
      Buffer.from(
        JSON.stringify({
          idempotencyKey: idempotencyKey ?? sessionId,
          sessionId,
          status: "completed",
          completedAt: new Date().toISOString(),
          result: callbackResultText,
          toolsUsed: combinedToolsUsed,
          // Outbox-growth fields — not consumed yet; let this marker become the
          // reconciler's record for idempotent delivery/ack later.
          deliveredToUser: false,
          recoveryAcked: false,
        }),
        "utf8",
      ),
    ).catch(() => {});

    // If the run delivered nothing user-visible AND we fell back between
    // providers, the blank is a provider failure (429/quota, a transient
    // network error, or an empty completion), not the agent having nothing to
    // say. Tag the callback so claw-auth can tell the user it was a provider
    // issue instead of the generic "I wasn't able to produce a response", and
    // forward the underlying detail for ANY fallback (not just 429s). The
    // detail is sanitized — URLs and IP[:port]s stripped, whitespace collapsed,
    // length-clamped — so a transient/network fallback can't leak an internal
    // host or path to end users.
    const finalProducedNothing =
      !callbackResultText.trim() &&
      resultAttachments.length === 0 &&
      pendingResponses.length === 0 &&
      pendingActions.length === 0 &&
      pendingQuestions.length === 0;
    const emptyReason =
      finalProducedNothing && providerFellBack ? "provider_capacity" : undefined;
    const emptyReasonDetail =
      emptyReason && lastFallbackUnderlying
        ? lastFallbackUnderlying
            .replace(/https?:\/\/\S+/gi, "")
            .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 200) || undefined
        : undefined;

    // Consistency check: in plan mode propose-plan fires abortRun, so a proposed
    // plan should ALWAYS land in the catch branch, never here. Reaching the
    // success path with a proposed plan means abortRun didn't stop the loop — the
    // run kept going. The read-only plan-mode palette means it couldn't have
    // *acted*, and claw-auth prioritizes pendingPlan over the (ignored) result
    // text, so the plan still ships — but log it so broken abort wiring is visible.
    if (proposePlanRef.value) {
      logErr(
        `[plan-mode] propose-plan was called but the run reached the SUCCESS path (abortRun did not terminate the loop) — shipping the plan anyway; investigate abort wiring. session=${sessionId}`,
      );
    }
    if (emitBriefRef.value) {
      logErr(
        `[daily-brief] emit_brief was called but the run reached the SUCCESS path (abortRun did not terminate the loop) — shipping the brief anyway; investigate abort wiring. session=${sessionId}`,
      );
    }
    if (proposeAgentRef.value) {
      logErr(
        `[agent-authoring] propose-agent was called but the run reached the SUCCESS path (abortRun did not terminate the loop) — shipping the draft anyway; investigate abort wiring. session=${sessionId}`,
      );
    }

    clog.info(
      `[follow-ups] callback sessionId=${sessionId} pendingQuestions=${pendingQuestions.length} followUpCount=${pendingQuestions.find((question) => question.purpose === "follow_up_suggestions")?.options?.length ?? 0}`,
    );
    await sendCallback(callbackUrl, sessionToken, {
      sessionId,
      userId,
      conversationId: conversationId ?? null,
      agentSlug: agentSlug ?? null,
      fastMode: fastModeForCallback,
      status: "completed",
      result: callbackResultText,
      ...(emptyReason ? { emptyReason } : {}),
      ...(emptyReasonDetail ? { emptyReasonDetail } : {}),
      // Raw JSON for machine consumers (chain-workflows/triggers). Present only
      // for type "json" structured output; the chat `result` above may be the
      // template-rendered markdown instead.
      ...(structuredOutputPayload !== undefined
        ? { structuredOutput: structuredOutputPayload }
        : {}),
      ...(automationStructuredResult !== undefined
        ? { automationResult: automationStructuredResult }
        : {}),
      // Digital Twin mention flow: the structured delivery claw-auth executes
      // (react and/or reply, and where) on approve. Absent ⇒ fail-closed silence.
      ...(twinDelivery !== undefined ? { twinDelivery } : {}),
      toolsUsed: combinedToolsUsed,
      tokenUsage: result.tokenUsage,
      ...(result.reasoning && result.reasoning.trim()
        ? { reasoning: result.reasoning }
        : {}),
      ...(result.latency ? { latency: result.latency } : {}),
      ...(result.toolInvocations.length > 0
        ? { toolInvocations: result.toolInvocations }
        : {}),
      ...(resultAttachments.length > 0
        ? { attachments: resultAttachments }
        : {}),
      ...(pendingQuestions.length > 0 ? { pendingQuestions } : {}),
      ...(dedupedPendingActions.length > 0 ? { pendingActions: dedupedPendingActions } : {}),
      ...(pendingResponses.length > 0 ? { pendingResponses } : {}),
      ...(pendingGoalSuggestion ? { pendingGoalSuggestion } : {}),
      // Plan mode: propose-plan normally aborts (→ catch branch below), but if
      // the run finished cleanly with a plan proposed, carry it here too.
      // claw-auth's /webhook/result posts the plan card and (if trivial)
      // auto-continues into the auto-mode execution turn.
      ...(proposePlanRef.value ? { pendingPlan: proposePlanRef.value } : {}),
      // Agent authoring: propose-agent normally aborts (→ catch branch below),
      // but if the run finished cleanly with a draft proposed, carry it here too.
      // claw-auth validates it, persists the AgentRequest and posts the agent card.
      // A draft (terminal, normally recovered in the catch) wins over a profile
      // card if a turn somehow produced both — the decision surface matters more
      // than the description.
      ...(suggestConnectorsRef.value
        ? { pendingConnectorSuggestions: suggestConnectorsRef.value }
        : {}),
      ...(proposeAgentRef.value || describeAgentRef.value
        ? { pendingAgentCard: proposeAgentRef.value ?? describeAgentRef.value }
        : {}),
      // Daily brief: emit_brief normally aborts (→ catch branch below), but if the
      // run finished cleanly with a brief emitted, carry it here too. claw-auth
      // persists it to GeneratedContent and (on the SSE regenerate path) forwards
      // it to the dashboard on the terminal `done` frame.
      ...(emitBriefRef.value ? { dailyBrief: emitBriefRef.value } : {}),
      ...(llmCitations && llmCitations.length > 0 ? { llmCitations } : {}),
      followUpsPending: followUpOutcome === "parallel_pending",
      provider: completedProvider,
      model: completedModel,
    });
    if (
      followUpOutcome === "parallel_pending" &&
      parallelFollowUpPromise &&
      lateFollowUpCallbackUrl
    ) {
      const lateCallbackUrl = buildLateFollowUpCallbackUrl(lateFollowUpCallbackUrl);
      if (lateCallbackUrl) {
        void parallelFollowUpPromise.then(async ({ generation, completedAt }) => {
          const delivered = await sendCallback(lateCallbackUrl, sessionToken, {
            sessionId,
            suggestions: generation.suggestions,
            startedAt: parallelFollowUpStartedAt,
            completedAt,
            answerLength: result.text.length,
            enabledByV2Flag: followUpsEnabledByFlag,
            outcome: "delivered_late",
            generationInput: followUpGenerationInput,
            conversationMessageCount: followUpConversationHistory.length,
            agentContextProvided: Boolean(followUpAgentContext),
            agentContextName: followUpAgentContext?.name,
            agentContextDescription: followUpAgentContext?.description,
            generationSource: generation.source,
            generationModel: generation.model,
            failureCode: generation.failureCode,
            failureMessage: generation.failureMessage,
            httpStatus: generation.httpStatus,
          });
          if (!delivered) {
            clog.warn(`[follow-ups] late callback was not delivered sessionId=${sessionId}`);
          }
        });
      }
    }
  } catch (err) {
    if (err instanceof RunHandoffError) {
      if (execution?.hooks?.onDrainRequested) {
        const decision = await execution.hooks.onDrainRequested();
        if (decision === "reschedule") {
          execution.outcome = "rescheduled";
          log(`Run rescheduled for drain: ${sessionId} lastTurn=${err.lastTurn}`);
          return;
        }
      }
      log(`Run drain-signalled with no reschedule hook: ${sessionId} lastTurn=${err.lastTurn}`);
      return;
    }
    // HA: another pod already owns this conversation's lock. In callback mode
    // /run has already replied success, so claw-auth must receive a terminal
    // callback to release its busy slot and drain any queued messages.
    if (err instanceof SessionLockedError) {
      log(
        `Skipped: conversation locked by another worker (sessionId=${sessionId})`,
      );
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        fastMode: fastModeForCallback,
        status: "failed",
        error: "session_locked",
        provider: callbackProvider,
        model: callbackModel,
      });
      return;
    }
    // Write sandbox could not be provisioned (no warm capacity + node pool full).
    // End the run with a terminal signal claw-auth run-recovery recognizes, so it
    // defers and re-dispatches this same run until a SandboxClaim binds — the user
    // does NOT need to re-tag. Gated upstream by SANDBOX_UNAVAILABLE_DEFER
    // (default ON; set =false to restore the old read-only fallback).
    if (err instanceof SandboxUnavailableError) {
      log(`Sandbox unavailable — queuing run for auto-resume (sessionId=${sessionId})`);
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        fastMode: fastModeForCallback,
        status: "failed",
        error: "sandbox_unavailable",
        provider: callbackProvider,
        model: callbackModel,
      });
      return;
    }
    // If respond-to-user fired before the abort propagated, this is a
    // graceful copilot-mode termination — treat as completed so the response
    // actually posts to Spaces instead of being silently dropped as a cancel.
    const pendingResponsesAtError =
      customToolsResult?.getPendingResponses() ?? [];
    // Recover attachments collected during the run too. Without this, any
    // tool that pushed via `[ATTACHMENT:...]` (create-html-report,
    // create-ppt, sandbox-deliver-files, etc.) — which all run BEFORE the
    // terminating `respond-to-user` call — would have their attachments
    // silently dropped, because this catch block ran instead of the normal
    // completion path that aggregates them at line ~665.
    const attachmentsAtError = [
      ...(customToolsResult?.getAttachments() ?? []),
      ...(mcpGetAttachments?.() ?? []),
    ];
    // Recover pendingActions collected during the run. Mirrors the success
    // path at ~line 1178 which merges MCP-layer + custom-tool pendingActions.
    // Without this, a copilot-mode agent that calls a write tool (e.g.
    // spaces-create-ticket) AND respond-to-user in the same turn has its
    // signed pendingAction dropped on the floor — claw-auth never posts the
    // Approve/Decline FlowUI card and the user sees text saying
    // "pending approval" with nothing to approve.
    const pendingActionsAtError = [
      ...(mcpGetPendingActions?.() ?? []),
      ...(customToolsResult?.getPendingActions() ?? []),
    ];
    const dedupedPendingActionsAtError = pendingActionsAtError.filter(
      (action, index, actions) =>
        index ===
        actions.findIndex(
          (candidate) =>
            candidate.kind === action.kind &&
            candidate.title === action.title &&
            candidate.payloadUrl === action.payloadUrl,
        ),
    );
    // An explicit user stop wins over a just-generated answer. Without this, a
    // fast run (e.g. "count to 100") that calls respond-to-user a beat before
    // the cancel lands would post status="completed" and overwrite the user's
    // "Query aborted by user." in the UI. When the user cancelled, fall through
    // to the cancelled branch below instead.
    const isUserCancel = activeRuns.get(sessionId)?.userCancelled === true;
    if (
      pendingResponsesAtError.length > 0 &&
      !isUserCancel &&
      (err instanceof RunCancelledError || abortSignal?.aborted)
    ) {
      log(
        `Session terminated by respond-to-user (${pendingResponsesAtError.length} response(s), ${attachmentsAtError.length} attachment(s)): ${sessionId}`,
      );
      // Retrieve LLM-provided citations from add_citations tool (same as success path)
      const llmCitationsAtError = takeLlmCitations(sessionId);
      log(
        `llmCitations retrieved at respond-to-user: ${llmCitationsAtError?.length ?? 0} keypoint(s) for session ${sessionId}`,
      );
      // Fold the respond-to-user message(s) into `result` — the SAME rescue as
      // the success path (~line 2143). copilot/codex/verifyResponses delivery
      // terminates by ABORTING (respond-to-user throws), so it lands HERE in the
      // catch, never the success path — meaning that rescue never ran for these.
      // Without this, `result` stays "" and the automation / scheduled forward
      // path (webhook.ts result-forward branch) reads only `result`, ignoring
      // `pendingResponses`, so it forwards empty text → REPLY_ON_MESSAGE
      // (content: z.string().min(1)) silently drops it → no reply posts. Every
      // respond-to-user automation run. Mention/conversation runs post
      // pendingResponses directly, so a populated `result` here is a harmless,
      // consistent fallback (matches the success path, which sends both).
      const recoveredResultText = pendingResponsesAtError
        .map((r) => r.message)
        .filter((m) => typeof m === "string" && m.trim().length > 0)
        .join("\n\n")
        .trim();
      log(
        `Rescued result from ${pendingResponsesAtError.length} respond-to-user response(s) (length=${recoveredResultText.length})`,
      );
      const automationResultAtError =
        eventType === "automation"
          ? coerceAutomationResult(recoveredResultText)
          : undefined;
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        fastMode: fastModeForCallback,
        status: "completed",
        result: recoveredResultText,
        ...(automationResultAtError !== undefined
          ? { automationResult: automationResultAtError }
          : {}),
        pendingResponses: pendingResponsesAtError,
        // A queued capability card must survive the copilot terminal path too,
        // or "what can you do?" silently loses its card on those agents.
        ...(describeAgentRef.value ? { pendingAgentCard: describeAgentRef.value } : {}),
        ...(suggestConnectorsRef.value
          ? { pendingConnectorSuggestions: suggestConnectorsRef.value }
          : {}),
        ...(pendingGoalSuggestion ? { pendingGoalSuggestion } : {}),
        ...(dedupedPendingActionsAtError.length > 0 ? { pendingActions: dedupedPendingActionsAtError } : {}),
        ...(attachmentsAtError.length > 0 ? { attachments: attachmentsAtError } : {}),
        ...(err instanceof RunCancelledError && err.toolsUsed.length > 0 ? { toolsUsed: err.toolsUsed } : {}),
        ...(err instanceof RunCancelledError && err.toolInvocations.length > 0 ? { toolInvocations: err.toolInvocations } : {}),
        ...(err instanceof RunCancelledError ? { tokenUsage: err.tokenUsage } : {}),
        ...(llmCitationsAtError && llmCitationsAtError.length > 0 ? { llmCitations: llmCitationsAtError } : {}),
        provider: callbackProvider,
        model: callbackModel,
      });
    } else if (
      proposePlanRef.value &&
      !isUserCancel &&
      (err instanceof RunCancelledError || abortSignal?.aborted)
    ) {
      // Plan mode: propose-plan fired abortRun to end the turn, so the run lands
      // HERE (RunCancelledError), not the success path — the SAME pattern as
      // respond-to-user above. This is a normal, successful plan proposal, NOT a
      // cancellation: emit status="completed" carrying the plan. claw-auth's
      // /webhook/result posts the plan card (proposed → Approve, or executing +
      // auto-continue when trivial). The plan card is the deliverable, so no
      // chat text on this turn.
      log(
        `Session terminated by propose-plan (trivial=${proposePlanRef.value.trivial}, ${proposePlanRef.value.todos.length} todo(s)): ${sessionId}`,
      );
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        fastMode: fastModeForCallback,
        status: "completed",
        result: "",
        pendingPlan: proposePlanRef.value,
        ...(err instanceof RunCancelledError && err.toolsUsed.length > 0 ? { toolsUsed: err.toolsUsed } : {}),
        ...(err instanceof RunCancelledError && err.toolInvocations.length > 0 ? { toolInvocations: err.toolInvocations } : {}),
        ...(err instanceof RunCancelledError ? { tokenUsage: err.tokenUsage } : {}),
        provider: callbackProvider,
        model: callbackModel,
      });
    } else if (
      proposeAgentRef.value &&
      !isUserCancel &&
      (err instanceof RunCancelledError || abortSignal?.aborted)
    ) {
      // Agent authoring: propose-agent fired abortRun to end the turn, so the run
      // lands HERE (RunCancelledError), not the success path — the SAME pattern as
      // propose-plan above. This is a normal, successful draft, NOT a cancellation:
      // emit status="completed" carrying it. claw-auth validates the requested
      // tools, persists the draft as an AgentRequest and posts the agent card. The
      // card is the deliverable, so there is no chat text on this turn — and the
      // agent must not narrate a creation that has not been approved yet.
      log(
        `Session terminated by propose-agent (slug=${proposeAgentRef.value.agent.slug}, ${proposeAgentRef.value.agent.tools.length} tool(s)): ${sessionId}`,
      );
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        fastMode: fastModeForCallback,
        status: "completed",
        result: "",
        pendingAgentCard: proposeAgentRef.value,
        ...(err instanceof RunCancelledError && err.toolsUsed.length > 0 ? { toolsUsed: err.toolsUsed } : {}),
        ...(err instanceof RunCancelledError && err.toolInvocations.length > 0 ? { toolInvocations: err.toolInvocations } : {}),
        ...(err instanceof RunCancelledError ? { tokenUsage: err.tokenUsage } : {}),
        provider: callbackProvider,
        model: callbackModel,
      });
    } else if (
      emitBriefRef.value &&
      !isUserCancel &&
      (err instanceof RunCancelledError || abortSignal?.aborted)
    ) {
      // Daily brief: emit_brief fired abortRun to end the turn, so the run lands
      // HERE (RunCancelledError), not the success path — the SAME pattern as
      // propose-plan above. This is a normal, successful brief emission, NOT a
      // cancellation: emit status="completed" carrying the brief. claw-auth
      // persists it (kind=DAILY_BRIEF) and, on the SSE regenerate path, forwards
      // it to the dashboard on the terminal frame. The brief is the deliverable,
      // so there is no chat text on this turn.
      log(
        `Session terminated by emit_brief (needs=${emitBriefRef.value.what_needs_you.length}, overdue=${emitBriefRef.value.overdue.length}, schedule=${emitBriefRef.value.todays_schedule.length}): ${sessionId}`,
      );
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        fastMode: fastModeForCallback,
        status: "completed",
        result: "",
        dailyBrief: emitBriefRef.value,
        ...(err instanceof RunCancelledError && err.toolsUsed.length > 0 ? { toolsUsed: err.toolsUsed } : {}),
        ...(err instanceof RunCancelledError && err.toolInvocations.length > 0 ? { toolInvocations: err.toolInvocations } : {}),
        ...(err instanceof RunCancelledError ? { tokenUsage: err.tokenUsage } : {}),
        provider: callbackProvider,
        model: callbackModel,
      });
    } else if (err instanceof RunCancelledError || abortSignal?.aborted) {
      const gracefulInterrupt = activeRuns.get(sessionId)?.gracefulInterruptRequested === true;
      const partialResult = err instanceof RunCancelledError ? err.partialText?.trim() : "";
      if (gracefulInterrupt) {
        log(`Session interrupted with reply: ${sessionId}`);
        const interruptSummary = buildInterruptSummary(partialResult, err instanceof RunCancelledError ? {
          toolsUsed: err.toolsUsed,
          toolInvocations: err.toolInvocations,
        } : undefined);
        await sendCallback(callbackUrl, sessionToken, {
          sessionId,
          userId,
          conversationId: conversationId ?? null,
          agentSlug: agentSlug ?? null,
          fastMode: fastModeForCallback,
          status: "completed",
          result: interruptSummary,
          ...(err instanceof RunCancelledError && err.toolsUsed.length > 0
            ? { toolsUsed: err.toolsUsed }
            : {}),
          ...(err instanceof RunCancelledError && err.toolInvocations.length > 0
            ? { toolInvocations: err.toolInvocations }
            : {}),
          ...(err instanceof RunCancelledError
            ? { tokenUsage: err.tokenUsage }
            : {}),
          provider: callbackProvider,
          model: callbackModel,
        });
        return;
      }
      log(`Session cancelled: ${sessionId}`);
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        fastMode: fastModeForCallback,
        status: "cancelled",
        ...(err instanceof RunCancelledError && err.partialText
          ? { result: err.partialText }
          : {}),
        ...(err instanceof RunCancelledError && err.toolsUsed.length > 0
          ? { toolsUsed: err.toolsUsed }
          : {}),
        ...(err instanceof RunCancelledError && err.toolInvocations.length > 0
          ? { toolInvocations: err.toolInvocations }
          : {}),
        ...(err instanceof RunCancelledError
          ? { tokenUsage: err.tokenUsage }
          : {}),
        provider: callbackProvider,
        model: callbackModel,
      });
    } else if (isTransientProviderError(err)) {
      // Terminal transient failure — every provider (incl. the spaces fallback)
      // was unreachable/stalled. Interactive chat keeps a user-visible notice;
      // structured jobs fail closed because their deliverable/tool contract was
      // not completed (for example, an SDLC draft was never finalized).
      logErr(
        `Session failed (transient — all providers unavailable): ${err instanceof Error ? err.message : String(err)}`,
      );
      const stallProgress = err instanceof ProviderStallError
        ? {
            idleMs: err.idleMs,
            completedToolCount: err.toolInvocations.length,
            ...(err.toolInvocations.at(-1)
              ? {
                  lastTool: {
                    name: err.toolInvocations.at(-1)!.toolName,
                    failed: err.toolInvocations.at(-1)!.isError,
                    ...(err.toolInvocations.at(-1)!.isError
                      ? { error: err.toolInvocations.at(-1)!.result }
                      : {}),
                  },
                }
              : {}),
          }
        : undefined;
      const terminal = transientProviderCallback(
        requiresStructuredDelivery,
        stallProgress,
      );
      // Route EVERY terminal transient failure into claw-auth's capacity-retry
      // flow (scheduleProviderRetry — health-gated, auto-retries when the
      // provider recovers) instead of dead-ending on a "work stopped" notice.
      // We only reach here when isTransientProviderError(err) AND the whole
      // provider fallback chain is exhausted — a platform availability problem
      // (stall / 5xx / network), never a deterministic agent error or a user
      // cancel (both handled by earlier branches). Previously only the
      // EMPTY-completion capacity case was tagged, so stalls/timeouts — the
      // dominant failure under load — got the terminal notice and no retry.
      // Tagging emptyReason makes claw-auth's isCapacityFailure recognise it:
      // interactive runs send an EMPTY result so it lands in the empty-result
      // retry hook and the retry CARD replaces the notice; structured jobs keep
      // their failed terminal (deliverable fails closed) and the tag routes them
      // to the silent automation retry.
      const transientDetail = err instanceof ProviderStallError
        ? `model stopped responding for ${Math.round(err.idleMs / 1000)}s`
        : (err instanceof Error ? err.message : String(err)).split(/\r?\n/, 1)[0]!.slice(0, 200);
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        fastMode: fastModeForCallback,
        ...(requiresStructuredDelivery
          ? terminal
          : { status: "completed" as const, result: "" }),
        emptyReason: "provider_capacity" as const,
        ...(transientDetail ? { emptyReasonDetail: transientDetail } : {}),
        ...(err instanceof ProviderStallError && err.toolsUsed.length > 0
          ? { toolsUsed: err.toolsUsed }
          : {}),
        ...(err instanceof ProviderStallError && err.toolInvocations.length > 0
          ? { toolInvocations: err.toolInvocations }
          : {}),
        ...(err instanceof ProviderStallError
          ? { tokenUsage: err.tokenUsage }
          : {}),
        provider: callbackProvider,
        model: callbackModel,
      });
    } else {
      logErr(
        `Session failed: ${err instanceof Error ? err.message : String(err)}`,
      );

      // Drain kills are infra events, not agent failures — mark them so
      // claw-auth's result handler skips the user-facing error notice (the
      // recovery worker refires the run; see ActiveRunControl.drainCancelled).
      const drainKilled = activeRuns.get(sessionId)?.drainCancelled === true;
      const rawError = err instanceof Error ? err.message : "Internal error";
      await sendCallback(callbackUrl, sessionToken, {
        sessionId,
        userId,
        conversationId: conversationId ?? null,
        agentSlug: agentSlug ?? null,
        fastMode: fastModeForCallback,
        status: "failed",
        error: drainKilled ? `SHUTDOWN_DRAIN: ${rawError}` : rawError,
        provider: callbackProvider,
        model: callbackModel,
      });
    }
  } finally {
    if (sdlcSandboxCleanupContext) {
      await cleanupSdlcSandboxCredentialsForContext(sdlcSandboxCleanupContext).catch(() => {});
    }
    if (mcpCleanup) {
      await mcpCleanup().catch(() => {});
    }
    if (!requestCwd) {
      // Clean up ephemeral workspace. (Host-side git worktrees no longer
      // exist — repo work happens in the sandbox.)
      await deleteWorkspace(sessionId).catch(() => {});
    } else if (stagedRecordingAbsPaths.length > 0) {
      // Persistent cwd survives the run — remove the raw recordings we staged
      // into it (the sandbox has its own copy once analysis ran).
      const { unlink } = await import("node:fs/promises");
      for (const p of stagedRecordingAbsPaths) {
        await unlink(p).catch(() => {});
      }
    }
    // Free the per-run plan/todo state (todo-write store) so it doesn't
    // accumulate across runs. No-op when the run never used todo-write.
    clearPlan(sessionId);
  }
}

function coerceAutomationResult(text: string): Record<string, unknown> {
  return { result: text };
}

function buildLateFollowUpCallbackUrl(callbackUrl: string): string | undefined {
  try {
    const url = new URL(callbackUrl);
    const pathname = url.pathname.replace(/\/$/, "");
    // Only run-stream v2 owns the late callback contract. Other ask-ai
    // callback surfaces may share the agent slug but must keep their existing
    // single-callback behavior.
    if (!pathname.includes("/internal/run-stream/") || !pathname.endsWith("/callback")) {
      return undefined;
    }
    url.pathname = `${pathname}/follow-ups`;
    return url.toString();
  } catch {
    clog.warn(`[follow-ups] invalid late callback URL: ${callbackUrl}`);
    return undefined;
  }
}

export async function sendCallback(
  callbackUrl: ProgressDest,
  sessionToken: string,
  payload: Record<string, unknown>,
  opts?: { backoffsMs?: number[] },
): Promise<boolean> {
  const fencedSid = payload["sessionId"] as string | undefined;
  if (isFencedSession(fencedSid)) {
    clog.warn(`[run] suppressing result for superseded run (ownership lost) session=${fencedSid}`);
    metric.count("run_stale_result_suppressed", { session: fencedSid ?? "unknown" });
    return false;
  }
  // SSE mode: the final result is a `done` frame on the in-process emitter, not a POST.
  // The route handler closes the response after this returns.
  if (callbackUrl && typeof callbackUrl !== "string") {
    const sidSse = (payload["sessionId"] as string | undefined) ?? "?";
    try {
      await callbackUrl.done(sidSse, payload);
      return true;
    } catch (err) {
      clog.error(`[run] In-process done emit failed (session=${sidSse}): ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
  const url =
    callbackUrl ??
    `${SERVER.authServiceUrl}/claw/api/v1/sessions/${payload["sessionId"] as string}/result`;
  const sid = (payload["sessionId"] as string | undefined) ?? "?";
  // SSRF guard: callbackUrl is caller-supplied. Only post to the trusted
  // claw-auth origin; a non-allowlisted target (e.g. cloud metadata) is dropped.
  if (!isAllowedCallbackUrl(url)) {
    clog.error(
      `[run] Refusing callback to non-allowlisted URL (session=${sid}): ${url}`,
    );
    return false;
  }
  const body = JSON.stringify(payload);
  // Retries on transient failures (network throw OR 5xx OR 408/429).
  // We never retry 4xx other than 408/429 — those are caller-shape errors and
  // re-sending won't help. Each attempt is logged so a silent drop becomes
  // impossible. Default backoff 1s, 3s (3 attempts); callers with a longer
  // time budget (handoff during drain) pass a longer schedule.
  const backoffsMs = opts?.backoffsMs ?? [1000, 3000];
  const maxAttempts = backoffsMs.length + 1;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(SERVER.s2sKey ? { "x-s2s-key": SERVER.s2sKey } : {}),
          // Per-run proof bound to {sid, uid} so claw-auth can verify this
          // result actually belongs to this run, not just that it came from a
          // holder of the shared S2S key. Verified at the /result endpoints.
          ...(sessionToken ? { "x-session-token": sessionToken } : {}),
        },
        body,
      });
      if (res.ok) {
        if (attempt > 1) {
          clog.info(
            `[run] Callback to ${url} succeeded on attempt ${attempt} (session=${sid})`,
          );
        }
        return true;
      }
      // Non-2xx: read a snippet of the body so the failure mode is visible.
      const text = await res.text().catch(() => "");
      const retryable =
        res.status >= 500 || res.status === 408 || res.status === 429;
      clog.error(
        `[run] Callback ${res.status} from ${url} (session=${sid}, attempt=${attempt}, bytes=${body.length}, retryable=${retryable}): ${text.slice(0, 300)}`,
      );
      if (!retryable || attempt === maxAttempts) return false;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      clog.error(
        `[run] Callback to ${url} threw (session=${sid}, attempt=${attempt}, bytes=${body.length}): ${err instanceof Error ? err.message : String(err)}`,
      );
      if (attempt === maxAttempts) return false;
    }
    const wait = backoffsMs[attempt - 1] ?? 3000;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  if (lastErr) {
    clog.error(
      `[run] Callback exhausted retries to ${url} (session=${sid}): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }
  return false;
}

// ── Chain judge endpoint (called by xyne-claw-auth webhook) ──────────────

router.post("/chain-judge", validateS2SKey, async (req, res: Response) => {
  const {
    agentResult,
    sourceAgent,
    targetAgent,
    taskTemplate,
    userQuery,
    judgeContext,
    toolInvocations,
  } = req.body as {
    agentResult?: string;
    sourceAgent?: string;
    targetAgent?: string;
    taskTemplate?: string;
    userQuery?: string;
    judgeContext?: string;
    toolInvocations?: Array<{ toolName?: string; command?: string; isError?: boolean }>;
  };

  if (!agentResult || !sourceAgent || !targetAgent) {
    res
      .status(400)
      .json({
        success: false,
        error: "agentResult, sourceAgent, targetAgent required",
      });
    return;
  }

  const decision = await judgeChainContinuation(
    agentResult,
    sourceAgent,
    targetAgent,
    taskTemplate,
    userQuery,
    judgeContext,
    Array.isArray(toolInvocations) ? toolInvocations : undefined,
  );
  res.json({ success: true, data: decision });
});

// ── Provider availability penny-drop (called by claw-auth's retry poller) ──
// A run that died on provider capacity can't be retried blindly — claw-auth
// polls this to learn whether the exact model+key is serving again. The keys
// live HERE (claw env for platform-default runs; BYO config passed in the
// body), so the probe must run claw-side. Returns state=available|capacity|
// permanent; claw-auth re-dispatches on available, backs off on capacity, and
// stops on permanent.
router.post("/internal/provider-probe", validateS2SKey, async (req, res: Response) => {
  const { provider, model, providerConfig, automation } = req.body as {
    provider?: string;
    model?: string;
    providerConfig?: { apiKey: string; model: string; baseUrl?: string; authType?: string };
    automation?: boolean;
  };
  if (!provider || typeof provider !== "string") {
    res.status(400).json({ success: false, error: "provider is required" });
    return;
  }
  const { probeProvider } = await import("../provider-probe.js");
  const result = await probeProvider({
    provider,
    ...(typeof model === "string" ? { model } : {}),
    ...(providerConfig ? { providerConfig } : {}),
    ...(automation === true ? { automation: true } : {}),
  });
  res.json({ success: true, data: result });
});

// ── Generate agent prompt (called by xyne-claw-auth) ──────────────────────

router.post("/generate-prompt", validateS2SKey, async (req, res: Response) => {
  const { intent, agentName, existingPrompt } = req.body as {
    intent?: string;
    agentName?: string;
    existingPrompt?: string;
  };

  if (!intent || typeof intent !== "string") {
    res.status(400).json({ success: false, error: "intent is required" });
    return;
  }

  const isUpdate =
    existingPrompt &&
    typeof existingPrompt === "string" &&
    existingPrompt.trim().length > 0;

  const userMessage = isUpdate
    ? `Here is the current system prompt for an agent${agentName ? ` called "${agentName}"` : ""}:\n\n---\n${existingPrompt}\n---\n\nThe user wants to update it with the following instructions:\n\n"${intent}"\n\nApply the requested changes to the existing prompt. Keep the parts that are not affected by the update. Return the full updated prompt.`
    : `Generate a system prompt for an agent${agentName ? ` called "${agentName}"` : ""}. The user described it as:\n\n"${intent}"\n\nThe prompt should:\n- Define the agent's role and personality\n- List what the agent can and cannot do\n- Include guidelines for response style\n- Be concise but thorough (200-400 words)`;

  try {
    const llmRes = await fetch(`${LITELLM.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM.apiKey}`,
      },
      body: JSON.stringify({
        model: LITELLM.model,
        messages: [
          {
            role: "system",
            content:
              "You generate and update system prompts for AI agents. Return ONLY the system prompt text, no explanation or markdown wrapping.",
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        max_tokens: 2000,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!llmRes.ok) {
      res
        .status(500)
        .json({ success: false, error: `LLM returned ${llmRes.status}` });
      return;
    }

    const data = (await llmRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const prompt = data.choices?.[0]?.message?.content?.trim() ?? "";

    res.json({ success: true, data: { prompt } });
  } catch (err) {
    clog.error("[generate-prompt] Failed:", err);
    res
      .status(500)
      .json({ success: false, error: "Failed to generate prompt" });
  }
});

// ── Generate structured-output schema + template from a plain-text
//    description (called by xyne-claw-auth's dashboard proxy) ──────────────
//
// The user describes the output they want in normal language ("a report with
// 5 KPIs, trend arrows and a 2-line summary"); the LLM produces the JSON
// Schema for submit-result plus the matching {{placeholder}} markdown
// template. Forced tool call so the response is structured; the schema is
// parsed + sanity-checked server-side before returning, and template
// placeholders are cross-checked against the schema's top-level properties.

const OUTPUT_FORMAT_GENERATOR_SYSTEM = `
You design structured-output contracts for AI agents on this platform.

The platform mechanism: the agent's final answer is forced through a tool
whose input schema IS the JSON Schema you produce. A markdown template then
renders that JSON into the chat message. So: the schema captures the DATA
FIELDS, the template owns ALL layout, labels and punctuation.

Template language (STRICT — nothing else is supported):
- {{path.to.field}} substitutes a value (dot paths allowed)
- {{#each listField}}...{{/each}} iterates an array; inside, {{.}} is a
  scalar item and {{field}} resolves against the item object
- NO conditionals, NO else, NO formatting filters. For optional fragments,
  add a string field that holds the full fragment ("" when absent) and place
  it directly in the template.

Design rules (follow ALL):
1. Prefer "type":"string" for metric values so "n/a" stays representable —
   never force a fake 0 for missing data. Say so in the description.
2. Pre-format display strings in the schema fields (e.g. trend glyphs like
   "up 12%"), so the template stays a dumb substitution.
3. Every {{placeholder}} in the template MUST correspond to a schema field;
   every required schema field SHOULD appear in the template.
4. Keep descriptions one line each — they are instructions to the agent.
5. Mark all fields required unless genuinely optional.
6. No triple backticks anywhere in the template.
`.trim();

const EMIT_OUTPUT_FORMAT_TOOL = {
  type: "function" as const,
  function: {
    name: "emit_output_format",
    description: "Return the generated structured-output contract.",
    parameters: {
      type: "object",
      properties: {
        schema_json: {
          type: "string",
          description:
            "The JSON Schema as a JSON-encoded string. Top level must be an object schema.",
        },
        template: {
          type: "string",
          description:
            "The markdown render template using {{placeholders}}. Empty string when only a markdown outline was requested.",
        },
        notes: {
          type: "string",
          description:
            "1-3 short lines explaining non-obvious design choices, for display under the form.",
        },
      },
      required: ["schema_json", "template", "notes"],
    },
  },
};

/**
 * Top-level {{path}} placeholders that must exist as schema properties.
 * Placeholders INSIDE {{#each x}}…{{/each}} resolve against the array item,
 * not the root object, so they're excluded from the cross-check — only the
 * `each` target itself (x) is a root property. (Mirrors renderTemplate's scope
 * rules in agent-model-settings.ts.)
 */
function templatePlaceholders(template: string): string[] {
  const out = new Set<string>();
  // The `each` targets are root properties.
  for (const m of template.matchAll(/\{\{#each\s+([\w.]+)\s*\}\}/g)) {
    out.add(m[1]!.split(".")[0]!);
  }
  // Strip each-block bodies, then collect the remaining (root-scoped) refs.
  const rootScope = template.replace(
    /\{\{#each\s+[\w.]+\s*\}\}[\s\S]*?\{\{\/each\}\}/g,
    "",
  );
  for (const m of rootScope.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    const p = m[1];
    if (p && p !== ".") out.add(p.split(".")[0]!);
  }
  return [...out];
}

router.post(
  "/generate-output-format",
  validateS2SKey,
  async (req, res: Response) => {
    const { description, format, existingSchema, existingTemplate, agentName } =
      req.body as {
        description?: string;
        format?: "json" | "markdown";
        existingSchema?: string;
        existingTemplate?: string;
        agentName?: string;
      };

    if (
      !description ||
      typeof description !== "string" ||
      !description.trim()
    ) {
      res
        .status(400)
        .json({ success: false, error: "description is required" });
      return;
    }
    const wantMarkdownOnly = format === "markdown";

    const refining = Boolean(
      (existingSchema && existingSchema.trim()) ||
      (existingTemplate && existingTemplate.trim()),
    );
    const userMessage = [
      wantMarkdownOnly
        ? `Generate ONLY a markdown outline (no schema — set schema_json to "{}") that the agent${agentName ? ` "${agentName}"` : ""} will follow for its final answer.`
        : `Generate the JSON Schema + markdown template pair for the agent${agentName ? ` "${agentName}"` : ""}'s final answer.`,
      "",
      `The user describes the desired output as:`,
      `"${description.trim()}"`,
      ...(refining
        ? [
            "",
            "They already have a draft — apply the description as a refinement, keeping what still fits:",
            ...(existingSchema?.trim()
              ? ["Current schema:", existingSchema.trim()]
              : []),
            ...(existingTemplate?.trim()
              ? ["Current template:", existingTemplate.trim()]
              : []),
          ]
        : []),
    ].join("\n");

    try {
      const llmRes = await fetchLiteLLMWithRetry(
        `${LITELLM.url}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LITELLM.apiKey}`,
          },
          body: JSON.stringify({
            model: LITELLM.model,
            messages: [
              { role: "system", content: OUTPUT_FORMAT_GENERATOR_SYSTEM },
              { role: "user", content: userMessage },
            ],
            tools: [EMIT_OUTPUT_FORMAT_TOOL],
            tool_choice: {
              type: "function",
              function: { name: "emit_output_format" },
            },
            max_tokens: 4000,
            temperature: 0.2,
          }),
        },
        { timeoutMs: 45_000, label: "generate-output-format" },
      );

      if (!llmRes.ok) {
        res
          .status(500)
          .json({ success: false, error: `LLM returned ${llmRes.status}` });
        return;
      }
      const data = (await llmRes.json()) as {
        choices?: Array<{
          message?: {
            tool_calls?: Array<{ function?: { arguments?: string } }>;
          };
        }>;
      };
      const argsRaw =
        data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!argsRaw) {
        res
          .status(500)
          .json({ success: false, error: "LLM returned no tool call" });
        return;
      }
      const args = JSON.parse(argsRaw) as {
        schema_json?: string;
        template?: string;
        notes?: string;
      };
      const template = (args.template ?? "").trim();
      const notes = (args.notes ?? "").trim();

      // Server-side sanity checks — catch generator mistakes before the user
      // pastes a broken contract into the agent config.
      const warnings: string[] = [];
      let schemaOut = "";
      if (!wantMarkdownOnly) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(args.schema_json ?? "");
        } catch {
          res
            .status(422)
            .json({
              success: false,
              error:
                "Generator produced an invalid JSON schema — try rephrasing the description",
            });
          return;
        }
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          (parsed as Record<string, unknown>)["type"] !== "object"
        ) {
          res
            .status(422)
            .json({
              success: false,
              error:
                "Generated schema is not an object-typed JSON Schema — try rephrasing",
            });
          return;
        }
        schemaOut = JSON.stringify(parsed, null, 2);
        const props =
          (parsed as { properties?: Record<string, unknown> }).properties ?? {};
        for (const ph of templatePlaceholders(template)) {
          if (!(ph in props))
            warnings.push(
              `Template references {{${ph}}} which is not a top-level schema property`,
            );
        }
      }
      if (/```/.test(template))
        warnings.push(
          "Template contains triple backticks — remove them before saving",
        );

      res.json({
        success: true,
        data: { schema: schemaOut, template, notes, warnings },
      });
    } catch (err) {
      clog.error("[generate-output-format] Failed:", err);
      res
        .status(500)
        .json({ success: false, error: "Failed to generate output format" });
    }
  },
);

// ── Suggest tools for an agent (called by xyne-claw-auth) ────────────────
// Given the agent's intent (a short description or full system prompt) and a
// catalog of available tools, ask the LLM to pick a small, sensible default
// set. The endpoint is intentionally side-effect-free: it just returns a
// proposal and the UI renders it as a diff for the user to accept.

router.post("/suggest-tools", validateS2SKey, async (req, res: Response) => {
  const { intent, catalog } = req.body as {
    intent?: string;
    catalog?: {
      subagents: Array<{ name: string; description: string }>;
      integrations: Array<{
        slug: string;
        label: string;
        readTools: Array<{
          name: string;
          description: string;
          riskLevel: string;
        }>;
        writeTools: Array<{
          name: string;
          description: string;
          riskLevel: string;
        }>;
      }>;
    };
  };

  if (!intent || typeof intent !== "string" || intent.trim().length === 0) {
    res.status(400).json({ success: false, error: "intent is required" });
    return;
  }
  if (!catalog || typeof catalog !== "object") {
    res.status(400).json({ success: false, error: "catalog is required" });
    return;
  }

  // Compress the catalog into a token-cheap form. Tool descriptions are
  // truncated; an LLM doesn't need 500 chars per tool to recognise intent.
  const truncate = (s: string, n: number) => {
    const trimmed = (s ?? "").trim();
    return trimmed.length <= n ? trimmed : trimmed.slice(0, n - 1) + "…";
  };

  const subagentList = (catalog.subagents ?? [])
    .map((s) => `- ${s.name}: ${truncate(s.description, 120)}`)
    .join("\n");

  const integrationBlocks = (catalog.integrations ?? [])
    .map((i) => {
      const readLines = i.readTools
        .map(
          (t) =>
            `    - ${t.name}${t.description ? ": " + truncate(t.description, 100) : ""}`,
        )
        .join("\n");
      const writeLines = i.writeTools
        .map(
          (t) =>
            `    - ${t.name} [${t.riskLevel}]${t.description ? ": " + truncate(t.description, 100) : ""}`,
        )
        .join("\n");
      return [
        `## ${i.label} (slug: ${i.slug})`,
        readLines ? `  read tools:\n${readLines}` : "",
        writeLines ? `  write tools:\n${writeLines}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const userMessage = [
    "Select an appropriate, minimal set of tools for this agent based on its purpose.",
    "",
    "Agent intent / system prompt:",
    "---",
    intent,
    "---",
    "",
    "Available subagents (specialists this agent can delegate to):",
    subagentList || "(none)",
    "",
    "Available integrations and their tools:",
    integrationBlocks || "(none)",
    "",
    "Rules:",
    "- Be conservative. Prefer read-only tools. Only include write/destructive tools when the intent clearly demands them.",
    "- Prefer subagents (delegation) over a long list of raw integration tools when a matching specialist exists.",
    "- Aim for under 15 individual tools across all integrations unless intent demands more.",
    "- For each pick, give a one-sentence reason citing what in the intent justifies it.",
    "",
    "Return a strict JSON object matching this shape (no prose, no markdown wrapping):",
    `{
  "subagents": ["subagent-name", ...],
  "integrations": [
    { "slug": "integration-slug", "readTools": ["tool_name", ...], "writeTools": ["tool_name", ...] },
    ...
  ],
  "reasoning": { "subagent-or-tool-name": "one-sentence why", ... }
}`,
  ].join("\n");

  try {
    const llmRes = await fetch(`${LITELLM.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LITELLM.apiKey}`,
      },
      body: JSON.stringify({
        model: LITELLM.model,
        messages: [
          {
            role: "system",
            content:
              "You select tools for AI agents. You return ONLY a JSON object — no prose, no markdown fences. Be conservative and prefer read-only tools.",
          },
          { role: "user", content: userMessage },
        ],
        // Response is a small JSON object; cap is mainly a safety bound.
        max_tokens: 2000,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!llmRes.ok) {
      res
        .status(500)
        .json({ success: false, error: `LLM returned ${llmRes.status}` });
      return;
    }

    const data = (await llmRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content?.trim() ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      res.status(502).json({ success: false, error: "LLM returned non-JSON" });
      return;
    }

    res.json({ success: true, data: parsed });
  } catch (err) {
    clog.error("[suggest-tools] Failed:", err);
    res.status(500).json({ success: false, error: "Failed to suggest tools" });
  }
});

export { router as runRouter };
