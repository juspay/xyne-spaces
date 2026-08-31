/**
 * Webhook handler for Xyne Spaces app events.
 *
 * POST /webhook       — receives USER_MENTIONED events, starts xyne-claw for the mentioned user
 * POST /webhook/result — callback from xyne-claw, sends result to mentioned user's DM with approve/decline
 */

import { Router, type Request, type Response } from "express";
import { errMsg } from "../lib/errors.js";
import crypto from "node:crypto";
import { CONFIG } from "../config.js";
import {
  agentRepository,
  userRepository,
  userAgentConfigRepository,
  userProviderCredentialsRepository,
  agentProviderCredentialsRepository,
  userSubagentConfigRepository,
  agentShareRepository,
  agentRunRepository,
  chatMessageRepository,
  agentChainWorkflowRepository,
  activeGoalRepository,
  experimentRepository,
  agentRequestRepository,
} from "../repositories/index.js";
import { buildAvailableToolsCatalog } from "./tools.js";
import {
  identityFromAgentRow,
  identityFromDraftSpec,
  isValidAgentSlug,
  resolveAgentCapabilities,
  toolIdsFromConfig,
  unknownToolsNote,
  type DraftAgentSpec,
} from "../lib/agent-card.js";
import { getValidClaudeBearer } from "../lib/claude-oauth-refresh.js";
import { getValidCodexBearer } from "../lib/codex-oauth-refresh.js";
import { resolveAgentProviderConfigs, resolveSubagentProviderMode, KNOWN_PROVIDERS, buildProviderConfig, agentCredRefreshTarget, userCredRefreshTarget, agentDefaultSpeed, providerConfigForSpeed, applyFastModeModels } from "../lib/agent-provider-config.js";
import { dispatchLocalHarnessRun, isLocalHarnessProvider, pinnedModelForProvider, resolveLocalHarnessTarget } from "../lib/local-harness.js";
import { expandSpacesMentions, resolveUnboundMentions } from "../lib/mention-transform.js";
import { shouldTwinRespond, recordTwinSilence, FAIL_CLOSED } from "../services/twinRespondGate.js";
import { recordTwinApprovalPending } from "../services/twinResponseFeedback.js";

import { buildSpacesMentionLookups, buildSpacesMentionLookupsDb } from "../lib/mention-lookups.js";
import { mintSessionToken } from "../lib/session-tokens.js";
import { verifySpacesSignature } from "../middleware/verify-spaces-signature.js";
import { coerceAutomationForwardResult } from "../lib/automation-result.js";
import { parseSlashCommand } from "../lib/parseSlashCommand.js";
import { buildExperimentProofBundle } from "../lib/experiment-bundle.js";
import { resolveAuthForUser } from "../services/userMemoryFetcher.js";
import { parseExperimentCommand, formatDuration, dispatchExperimentEpoch, dispatchExperimentChecker, EXPERIMENT_PROVIDERS, buildFindingsMarkdown, cancelRunSession, seedUnderstandingFrontier } from "../lib/experiment.js";
import { resolveFastMode, setFastModeOverride } from "../lib/fast-mode.js";
import { acquireTwinSlot, renameTwinSlot, releaseTwinSlot } from "../lib/twin-limiter.js";
import { handleSlashCommandBeforeRun, normalizeGoalCondition, persistGoalStart, recordTurnAndDecide } from "../services/goalRelooper.js";
import {
  QUEUE_ENABLED,
  QUEUE_CAP,
  tryAcquireSlot,
  releaseSlot,
  refreshSlot,
  attachSlotSession,
  getSlotOwner,
  enqueueMessage,
  dequeueMessage,
  queueDepth,
  peekQueue,
  clearQueue,
  type QueuedMessage,
} from "../lib/message-queue.js";
import { createTraceId, createLogger } from "../logger.js";
import { decrypt } from "../crypto.js";
import { prisma } from "../db.js";
import { redisService } from "../redis.js";
import { publishLiveEvent } from "../lib/live-conversation-bus.js";
import { UNREGISTERED_USER_TEMPLATE } from "../constants.js";
import {
  registerRunRecovery,
  touchRunRecovery,
  handleRunCompletion,
  handleRunHandoff,
  hasActiveRunRecovery,
  getRecoveryContextForSession,
  cancelRunRecovery,
  type RecoverySessionContext,
} from "../queue/run-recovery-worker.js";
import { appendCitations, buildThreadCitationMeta } from "../lib/citations.js";
import { htmlToPlainText } from "../lib/html-to-text.js";
import { persistBase64ChatAttachments } from "../services/chatAttachmentService.js";
import { gcsService } from "../services/storageService.js";
import { getSpacesAuthForUser, spacesDbAvailable, getSpacesUserWorkspaceId, getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { ensureUserExists, orgIdForSpacesUser } from "../lib/users-jit.js";
import { finalizeOrphanedRun } from "../services/orphan-run-finalizer.js";
import { requireStrictS2S, s2sKeyMatches, requireResultToken } from "../middleware/require-auth.js";
import { isClawAdmin } from "../middleware/agent-acl.js";
import { renderAttachmentsToPdf } from "../lib/result-pdf.js";
import { renderMarkdownToHtml } from "../lib/result-html.js";
import { sendStoredExternalResultCallback, isInternalCallbackOrigin, isAllowedExternalCallbackUrl, type ExternalResultCallbackConfig } from "../surfaces/external-api/delivery.js";
import { encryptSurfaceSecret } from "../lib/surface-resolver.js";
import { deliverSlackResult, type SlackDeliveryTarget } from "../surfaces/slack/delivery.js";
import { designShareUrl, upsertDesignShare } from "./design-shares.js";
import {
  getActivePlanCard,
  setActivePlanCard,
  clearActivePlanCard,
  setPlanExecMeta,
  getPlanExecMeta,
  clearPlanExecMeta,
  normalizePlanTitle,
  filterToApprovedTitles,
  setPlanLastTodos,
  getPlanLastTodos,
  clearPlanLastTodos,
} from "../lib/session-context.js";
import { emitAgentWorkingSignal } from "../surfaces/spaces/client.js";
import JSZip from "jszip";

import {
  buildTicketProposalFlow,
  buildMcpSuggestFlow,
  buildCodeFlow,
  buildDiffFlow,
  buildChartFlow,
  isUiWidget,
} from "xyne-claw-shared";
import {   buildSdlcAgentToolProfile,SDLC_REQUIRED_TOOLS, buildWriteApprovalFlow, buildTwinApprovalFlow, buildUserQuestionFlow, buildPromoteProviderFlow, buildCapacityRetryFlow, buildGoalSuggestionFlow, buildPlanFlow, buildAgentCardFlow, buildAgentListFlow, buildAgentSummaryFlow, MAX_AGENT_LIST_CARDS, hashSkillContent, buildPrFlow, prScreenId, isTwinDelivery, type PrProvider, type PrStatus } from "xyne-claw-shared";
import { scheduleProviderRetry } from "../queue/provider-retry-worker.js";
import type { TwinDelivery, UiWidget } from "xyne-claw-shared";
import { isAgentInvocableBy } from "xyne-claw-shared";
import type { Todo } from "xyne-claw-shared";
import { tools as xyneSpacesTools } from "../mcp/servers/xyne-spaces-tools.js";
import { connectorTypesFromText, connectorTypesUserAskedToConnect } from "../lib/connector-hints.js";
import { availableServerIds } from "../lib/connector-availability.js";

const clog = createLogger("webhook");
const SDLC_AGENT_TOOL_PROFILE = buildSdlcAgentToolProfile(
  xyneSpacesTools.map((tool) => tool.name),
);

/** A run that died because the model provider was over capacity (429 / quota /
 *  overloaded / 5xx after fallback), as opposed to a real agent error. */
function isCapacityFailure(payload: { status?: string; error?: unknown; emptyReason?: string }): boolean {
  if (payload.emptyReason === "provider_capacity") return true;
  if (payload.status !== "failed") return false;
  const e = String(payload.error ?? "").toLowerCase();
  return /\b429\b|\b50[234]\b|quota|rate.?limit|overloaded|over capacity|service unavailable|too many requests/.test(e);
}

/**
 * Schedule an auto-retry when a run failed on PLATFORM provider capacity.
 *
 * Interactive → post a card and poll with it; automation → poll silently and
 * only surface if it gives up. Scoped to the platform provider (litellm/spaces):
 * a BYO provider that hit capacity is better served by promote-provider
 * (switch), and re-dispatching BYO needs cred reconstruction we defer. Returns
 * true if a retry was scheduled (interactive callers use it to suppress the
 * generic failure notice).
 */
async function scheduleCapacityRetryIfNeeded(
  ctx: SessionContext,
  payload: { status?: string; error?: unknown; emptyReason?: string; provider?: string; model?: string },
  interactive: boolean,
): Promise<boolean> {
  // Experiments run their own recovery loop (experiment supervisor); don't
  // double-drive them.
  if (ctx.isExperiment) return false;
  if (!isCapacityFailure(payload)) return false;
  const provider = payload.provider ?? ctx.provider;
  const isPlatform = !provider || provider === "litellm" || provider === "spaces";
  if (!isPlatform) return false;
  // channelId is only needed to POST the card — a channel-less automation
  // (pure API caller) must still get the silent retry.
  if (!ctx.agentSlug || !ctx.agentOrgId || !ctx.conversationId || !ctx.senderId) return false;
  if (interactive && !ctx.channelId) return false;

  const retryToken = crypto.randomUUID();
  const redispatch = {
    userId: ctx.senderId,
    task: ctx.task ?? "",
    agentSlug: ctx.agentSlug,
    orgId: ctx.agentOrgId,
    conversationId: ctx.conversationId,
    channelId: ctx.channelId ?? "",
    // Automation retries MUST re-declare their run type: claw's read-only tool
    // gating (isReadOnlyJob) keys on eventType, and losing it would hand the
    // retried automation write tools the original never had.
    ...(ctx.resultForwardUrl ? { eventType: "automation" } : {}),
    ...(provider ? { provider } : {}),
    ...(ctx.resultForwardUrl ? { resultForwardUrl: ctx.resultForwardUrl } : {}),
  };

  let card: { messageId: string; spacesAppId?: string } | undefined;
  if (interactive) {
    try {
      const flow = withSpacesAppId(
        buildCapacityRetryFlow(provider ?? "the model", {
          agentSlug: ctx.agentSlug,
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          userId: ctx.senderId,
          retryToken,
          phase: "pending",
        }),
        ctx.spacesAppId,
      );
      const posted = (await spacesAppFetch("/chat/postMessage", {
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        flow,
        userId: ctx.spacesAppUserId,
      }, ctx.appToken)) as { messageId?: string; id?: string };
      const messageId = posted?.messageId ?? posted?.id;
      if (messageId) card = { messageId, ...(ctx.spacesAppId ? { spacesAppId: ctx.spacesAppId } : {}) };
    } catch (err) {
      clog.warn("[capacity-retry] failed to post card (scheduling silently):", err instanceof Error ? err.message : err);
    }
  }

  await scheduleProviderRetry({
    retryToken,
    provider: provider ?? "litellm",
    ...(payload.model ? { model: payload.model } : {}),
    automation: !!ctx.resultForwardUrl,
    redispatch,
    ...(card ? { card } : {}),
  });
  clog.info(`[capacity-retry] scheduled token=${retryToken} interactive=${interactive} automation=${!!ctx.resultForwardUrl} conv=${ctx.conversationId}`);
  return true;
}

// Feature flag: when Spaces has the XYNE-12145 fix deployed
// (POST /api/apps/chat/agentProgress with the authenticateApp middleware), flip
// this to "true" to use the ephemeral <AgentSpinner /> signal path. Default
// false: claw posts a real placeholder message and edits it in-place — works
// on every Spaces version. Once the Spaces fix is live in prod, set
// SPACES_SUPPORTS_AGENT_PROGRESS=true in the deployment env, no code change.
const USE_EPHEMERAL_PROGRESS = true;

// Per-process dedup for the one-shot sandbox preview announce. Claw also
// guards against re-emit on its side; this Set is the second layer in case
// run-recovery re-delivers the same payload. Bounded (FIFO) so it can't grow
// unbounded over the process lifetime — every announced sessionId used to be
// retained forever.
const announcedSandboxPreviews = new Set<string>();
const ANNOUNCED_PREVIEWS_MAX = 5000;
function rememberAnnouncedPreview(sessionId: string): void {
  announcedSandboxPreviews.add(sessionId);
  if (announcedSandboxPreviews.size > ANNOUNCED_PREVIEWS_MAX) {
    // Drop the oldest insertion (Set preserves insertion order).
    const oldest = announcedSandboxPreviews.values().next().value;
    if (oldest !== undefined) announcedSandboxPreviews.delete(oldest);
  }
}

const router = Router();

function withSpacesAppId<T extends { data?: Record<string, unknown> }>(flow: T, spacesAppId?: string | null): T {
  if (!spacesAppId) return flow;
  return { ...flow, data: { ...(flow.data ?? {}), spacesAppId } };
}

// ── Agent Chain Config Types ────────────────────────────────────────

interface ChainConditions {
  /** Tools that MUST have been called for the chain to trigger */
  toolsMustInclude?: string[];
  /** Tools that must NOT have been called (e.g. skip chain if error-related tool ran) */
  toolsMustExclude?: string[];
}

interface ChainOnComplete {
  /** Slug of the agent to trigger next */
  triggerAgent: string;
  /** Task template for the next agent. Supports {{result}} and {{agentSlug}} */
  task: string;
  /** Instructions for the LLM judge on when to CONTINUE vs STOP */
  judgeContext?: string;
  /** Deterministic conditions that must pass before triggering */
  conditions?: ChainConditions;
}

interface ChainOnFailure {
  /** Agent to trigger on failure, or null to do nothing */
  triggerAgent?: string | null;
  /** If true, post a message in thread notifying that chain was escalated */
  escalate?: boolean;
}

interface ChainConfig {
  onComplete?: ChainOnComplete;
  onFailure?: ChainOnFailure;
  maxRetries?: number;
  /** Max times the chain can loop back (for bidirectional chains like doctor↔RCA). Default 1 (no loops). */
  maxDepth?: number;
}

/**
 * LLM-as-judge: determines whether a chain should continue or stop
 * based on the agent's natural response. Uses a fast/cheap model.
 */
/** Call xyne-claw's /chain-judge endpoint to decide if a chain should continue */
async function judgeChainContinuation(
  agentResult: string,
  sourceAgent: string,
  targetAgent: string,
  taskTemplate?: string,
  userQuery?: string,
  judgeContext?: string,
): Promise<"continue" | "stop"> {
  try {
    const res = await fetch(`${CONFIG.xyneClawUrl}/chain-judge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({ agentResult, sourceAgent, targetAgent, taskTemplate, userQuery, judgeContext }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      clog.warn(`[chain-judge] xyne-claw returned ${res.status}, defaulting to continue`);
      return "continue";
    }

    const data = (await res.json()) as { success: boolean; data?: { action: string; reason: string } };
    if (data.success && data.data) {
      clog.info(`[chain-judge] ${sourceAgent} → ${targetAgent}: ${data.data.action} (${data.data.reason})`);
      return data.data.action === "stop" ? "stop" : "continue";
    }

    return "continue";
  } catch (err) {
    clog.warn(`[chain-judge] Failed, defaulting to continue:`, err instanceof Error ? err.message : err);
    return "continue";
  }
}

function parseChainConfig(agentConfig: Record<string, unknown> | null): ChainConfig | undefined {
  const chain = (agentConfig as Record<string, unknown> | null)?.["chain"];
  if (!chain || typeof chain !== "object") return undefined;
  return chain as ChainConfig;
}

function evaluateChainConditions(conditions: ChainConditions | undefined, toolsUsed: string[]): boolean {
  if (!conditions) return true;

  if (conditions.toolsMustInclude?.length) {
    const allPresent = conditions.toolsMustInclude.every((t) => toolsUsed.includes(t));
    if (!allPresent) return false;
  }

  if (conditions.toolsMustExclude?.length) {
    const anyExcluded = conditions.toolsMustExclude.some((t) => toolsUsed.includes(t));
    if (anyExcluded) return false;
  }

  return true;
}

interface ChainWorkflowNode {
  id: string;
  agentSlug: string;
  taskTemplate?: string;
}

interface ChainWorkflowEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  mode?: "always" | "tools" | "judge";
  toolsMustInclude?: string[];
  toolsMustExclude?: string[];
  judgeContext?: string;
  taskTemplate?: string;
}

interface ChainWorkflowDefinition {
  version?: number;
  maxDepth?: number;
  nodes: ChainWorkflowNode[];
  edges: ChainWorkflowEdge[];
}

function parseWorkflowDefinition(definition: unknown): ChainWorkflowDefinition | null {
  if (!definition || typeof definition !== "object") return null;
  const raw = definition as Record<string, unknown>;
  if (!Array.isArray(raw["nodes"]) || !Array.isArray(raw["edges"])) return null;

  const nodes = raw["nodes"].filter((n): n is ChainWorkflowNode => (
    typeof n === "object" && n !== null &&
    typeof (n as Record<string, unknown>)["id"] === "string" &&
    typeof (n as Record<string, unknown>)["agentSlug"] === "string"
  )).map((n) => ({
    id: n.id,
    agentSlug: n.agentSlug,
    ...(typeof n.taskTemplate === "string" ? { taskTemplate: n.taskTemplate } : {}),
  }));

  const edges = raw["edges"].filter((e): e is ChainWorkflowEdge => (
    typeof e === "object" && e !== null &&
    typeof (e as Record<string, unknown>)["id"] === "string" &&
    typeof (e as Record<string, unknown>)["fromNodeId"] === "string" &&
    typeof (e as Record<string, unknown>)["toNodeId"] === "string"
  )).map((e) => ({
    id: e.id,
    fromNodeId: e.fromNodeId,
    toNodeId: e.toNodeId,
    ...(e.mode === "always" || e.mode === "tools" || e.mode === "judge" ? { mode: e.mode } : {}),
    ...(Array.isArray(e.toolsMustInclude) ? { toolsMustInclude: e.toolsMustInclude.filter((t): t is string => typeof t === "string") } : {}),
    ...(Array.isArray(e.toolsMustExclude) ? { toolsMustExclude: e.toolsMustExclude.filter((t): t is string => typeof t === "string") } : {}),
    ...(typeof e.judgeContext === "string" ? { judgeContext: e.judgeContext } : {}),
    ...(typeof e.taskTemplate === "string" ? { taskTemplate: e.taskTemplate } : {}),
  }));

  if (nodes.length === 0) return null;

  return {
    nodes,
    edges,
    ...(typeof raw["version"] === "number" ? { version: raw["version"] } : {}),
    ...(typeof raw["maxDepth"] === "number" ? { maxDepth: raw["maxDepth"] } : {}),
  };
}

function hasWorkflowCycle(workflow: ChainWorkflowDefinition): boolean {
  const nodeIds = workflow.nodes.map((node) => node.id);
  const graph = new Map<string, string[]>();
  for (const id of nodeIds) graph.set(id, []);
  for (const edge of workflow.edges) {
    const outgoing = graph.get(edge.fromNodeId);
    if (outgoing) outgoing.push(edge.toNodeId);
  }

  const color = new Map<string, 0 | 1 | 2>();
  for (const id of nodeIds) color.set(id, 0);

  const visit = (nodeId: string): boolean => {
    color.set(nodeId, 1);
    for (const next of graph.get(nodeId) ?? []) {
      const nextColor = color.get(next) ?? 0;
      if (nextColor === 1) return true;
      if (nextColor === 0 && visit(next)) return true;
    }
    color.set(nodeId, 2);
    return false;
  };

  for (const id of nodeIds) {
    if ((color.get(id) ?? 0) === 0 && visit(id)) return true;
  }

  return false;
}

async function selectNextWorkflowEdge(
  workflow: ChainWorkflowDefinition,
  currentAgentSlug: string,
  toolsUsed: string[],
  resultText: string,
  sourceTask: string,
): Promise<{ edge: ChainWorkflowEdge; nextNode: ChainWorkflowNode } | null> {
  const currentNode = workflow.nodes.find((node) => node.agentSlug === currentAgentSlug);
  if (!currentNode) return null;

  const outgoingEdges = workflow.edges.filter((edge) => edge.fromNodeId === currentNode.id);
  for (const edge of outgoingEdges) {
    const nextNode = workflow.nodes.find((node) => node.id === edge.toNodeId);
    if (!nextNode) continue;

    const mode = edge.mode ?? (edge.toolsMustInclude?.length || edge.toolsMustExclude?.length ? "tools" : "always");
    if (mode === "always") {
      return { edge, nextNode };
    }

    if (mode === "tools") {
      const matched = evaluateChainConditions({
        ...(edge.toolsMustInclude?.length ? { toolsMustInclude: edge.toolsMustInclude } : {}),
        ...(edge.toolsMustExclude?.length ? { toolsMustExclude: edge.toolsMustExclude } : {}),
      }, toolsUsed);
      if (matched) return { edge, nextNode };
      continue;
    }

    const decision = await judgeChainContinuation(
      resultText,
      currentAgentSlug,
      nextNode.agentSlug,
      edge.taskTemplate ?? nextNode.taskTemplate,
      sourceTask,
      edge.judgeContext,
    );
    if (decision === "continue") return { edge, nextNode };
  }

  return null;
}

function interpolateChainTask(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

import {
  type SessionContext,
  setSession,
  getSession,
  getSessionByConv,
  resolveSessionContext,
  ensureSessionContextOrg,
  deleteSession,
  convKey,
  automationRunDedupKey,
  AUTOMATION_RUN_DEDUP_TTL,
} from "../lib/session-context.js";
export { setSession, getSession, getSessionByConv, type SessionContext };
import {
  upsertWidgetBinding,
  findPrBindingByUrl,
  readPrBindingData,
  normalizePrUrl,
  setWidgetBindingStatus,
  upsertPlanBinding,
  findProposedPlanBinding,
  readPlanBindingData,
  markPlanBindingStatus,
} from "../lib/agent-widget-binding.js";

// ── Types ────────────────────────────────────────────────────────────

// Matches Spaces' AppEventAttachment shape from
// xyne-spaces/backend/src/apps/types/index.ts:39 — every field name MUST line up
// or we end up reading `undefined` ids and posting download URLs like
// `/api/attachments/undefined/download` (we hit this in prod, see logs around
// 06:04:19 on 2026-04-27 for callbackId d99e84b2).
interface WebhookAttachment {
  attachmentId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileUrl: string;
  width?: number;
  height?: number;
}

interface WebhookEvent {
  eventType: string;
  payload: {
    conversationId: string;
    messageId: string;
    content: string;
    cleanContent: string;
    createdAt: string | number;
    userId: string;
    senderName?: string;
    channelId: string;
    channelName?: string;
    projectId?: string;
    projectName?: string;
    mentionedUserIds?: string[];
    attachments?: WebhookAttachment[];
  };
  timestamp: string;
}

import {
  spacesAppFetch,
  spacesAppFetchGet,
  spacesAppFetchMultipart,
  SpacesApiError,
  isFlowSchemaRejection,
  withSpaces5xxRetry,
  decryptStoredField,
} from "../surfaces/spaces/client.js";
import {
  MAX_MESSAGE_CHARS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  type OutgoingAttachment,
  isImageAttachment,
  zipAttachmentsToBuffer,
  prepareAgentResultForPosting,
} from "../surfaces/spaces/attachments.js";

/** Owner display name + id for an agent's card chin ("Created by @x"). */
/** Connectors shown before the card defers to "Browse MCPs". */
const MCP_SUGGEST_ROSTER_SAMPLE = 5;

/** Agents listed on the roster card before it defers to "Browse agents". */
const AGENT_SUMMARY_SAMPLE = 5;

/** Cap on connectors the server offers unprompted, so a card never becomes a list. */
const MCP_SUGGEST_INFERRED_MAX = 3;

/**
 * Connector cards to post alongside a reply. The model requests these
 * explicitly (`title`/`listAll`); the server fills the same shape when it
 * infers a suggestion from the message text (`inferred`).
 */
type PendingConnectorSuggestions = {
  serverTypes: string[];
  title?: string;
  listAll?: boolean;
  inferred?: boolean;
};

async function agentOwnerCredit(
  ownerUserId: string | null | undefined,
): Promise<{ name?: string | null; id?: string | null } | undefined> {
  if (!ownerUserId) return undefined;
  const owner = await prisma.user
    .findUnique({ where: { id: ownerUserId }, select: { id: true, name: true } })
    .catch(() => null);
  return owner?.name ? { name: owner.name, id: owner.id } : undefined;
}


function experimentCounts(findings: Array<{ status: string }>): { conjecture: number; proved: number; refuted: number } {
  return {
    conjecture: findings.filter((f) => f.status === "conjecture").length,
    proved: findings.filter((f) => f.status === "proved").length,
    refuted: findings.filter((f) => f.status === "refuted").length,
  };
}

const EXPERIMENT_FINDINGS_MAX_BYTES = 200 * 1024;

function capExperimentFindingsMarkdown(markdown: string): string {
  if (Buffer.byteLength(markdown, "utf8") <= EXPERIMENT_FINDINGS_MAX_BYTES) return markdown;
  const suffix = "\n\n---\n\n_Report truncated at 200KB for Spaces file delivery._\n";
  let capped = markdown;
  while (Buffer.byteLength(capped + suffix, "utf8") > EXPERIMENT_FINDINGS_MAX_BYTES && capped.length > 0) {
    capped = capped.slice(0, Math.max(0, capped.length - 4096));
  }
  return `${capped.trimEnd()}${suffix}`;
}

function experimentFindingsFilename(agentSlug: string, date = new Date()): string {
  const safeSlug = agentSlug.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "agent";
  const stamp = date.toISOString().replace(/\.\d{3}Z$/, "").replace(/:/g, "-");
  return `experiment-findings-${safeSlug}-${stamp}.md`;
}

/**
 * Upload a generated markdown document as a thread attachment.
 *
 * FILE ONLY — deliberately no `flow` parameter. `/files/filesUpload`
 * (filesController.uploadFiles) does not read a flow field, so a card passed
 * here is silently dropped and no Approve/Decline buttons ever render. Post
 * approval cards separately via `/chat/postMessage` with `flow: <FlowDefinition>`.
 */
async function postGeneratedMarkdownFile(args: {
  channelId: string;
  conversationId: string;
  workspaceId?: string | null;
  userId: string;
  appToken: string;
  filename: string;
  /** Text body, or raw bytes when `mimeType` says the payload is binary. */
  markdown: string | Uint8Array;
  mimeType?: string;
  /** Additional files to attach to the SAME message (Spaces' filesUpload takes
   *  repeated `files` parts). Used by /experiment findings, which ships the
   *  proof zip AND the readable .md side by side — the zip is the archive, the
   *  markdown is what people actually open in the thread. */
  extraFiles?: Array<{ filename: string; content: string | Uint8Array; mimeType?: string }>;
  summary: string;
}): Promise<void> {
  const form = new FormData();
  const mimeType = args.mimeType ?? "text/markdown";
  const body = typeof args.markdown === "string"
    ? [args.markdown]
    : [new Uint8Array(args.markdown)];
  form.append("files", new Blob(body, { type: mimeType }), args.filename);
  for (const extra of args.extraFiles ?? []) {
    const extraBody = typeof extra.content === "string"
      ? [extra.content]
      : [new Uint8Array(extra.content)];
    form.append("files", new Blob(extraBody, { type: extra.mimeType ?? "text/markdown" }), extra.filename);
  }
  form.append("channelId", args.channelId);
  form.append("conversationId", args.conversationId);
  form.append("userId", args.userId);
  if (args.workspaceId) form.append("workspaceId", args.workspaceId);
  form.append("markdownText", args.summary);
  form.append("metadata", JSON.stringify({ contentFormat: "markdown" }));
  await spacesAppFetchMultipart("/files/filesUpload", form, args.appToken);
}

function formatExperimentStatus(
  run: Awaited<ReturnType<typeof experimentRepository.findActiveByConversation>>,
  findings: Array<{ status: string; title: string; epoch: number; createdAt: Date }>,
): string {
  if (!run) return "No active /experiment in this thread.";
  const elapsedMs = Date.now() - run.createdAt.getTime();
  const remainingMs = Math.max(0, run.deadlineAt.getTime() - Date.now());
  const counts = experimentCounts(findings);
  const recent = [...findings]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5);
  const icon = (status: string) => status === "proved" ? "✓" : status === "refuted" ? "✗" : "◉";
  return [
    `**/experiment status** — epoch ${run.epoch}`,
    `Elapsed: ${formatDuration(elapsedMs)} · Remaining: ${formatDuration(remainingMs)}`,
    ...(run.provider ? [`Model: ${formatExperimentModel(run.provider, run.modelId)}`] : []),
    `Now: ${run.currentHypothesis?.trim() || "(no current hypothesis recorded)"}`,
    `Findings: ${counts.conjecture} open · ${counts.proved} proved · ${counts.refuted} refuted`,
    recent.length
      ? ["", ...recent.map((f) => `${icon(f.status)} [epoch ${f.epoch}] ${f.title}`)].join("\n")
      : "\nNo findings recorded yet.",
  ].join("\n");
}

function formatExperimentModel(provider: string, modelId?: string | null): string {
  return modelId?.trim() ? `${provider}/${modelId.trim()}` : `${provider} (default)`;
}

async function continueExperimentAfterResult(ctx: SessionContext, sessionId: string): Promise<boolean> {
  const active = await experimentRepository.findActiveByConversation(ctx.conversationId);
  if (!active) return false;
  if (active.currentSessionId && active.currentSessionId !== sessionId) return false;

  const now = Date.now();
  if (active.status === "finishing") {
    await experimentRepository.update(active.id, { status: "done", lastEpochEndedAt: new Date() });
    return false;
  }

  // Rapid-fail brake: an epoch that died within seconds of STARTING (model
  // outage, misconfig) must NOT chain instantly — that's an unbounded tight
  // dispatch loop. Measured against the session's own startedAt (not the
  // experiment row's updatedAt, which ledger writes also bump). Deferring
  // leaves the run inactive; the supervisor's stale sweep re-dispatches after
  // its window, turning a hot loop into ~1 retry/10min.
  const MIN_EPOCH_MS = 30_000;
  const epochRun = await agentRunRepository.findBySessionId(sessionId).catch(() => null);
  const epochRanMs = epochRun?.startedAt ? now - epochRun.startedAt.getTime() : Number.POSITIVE_INFINITY;
  if (epochRanMs < MIN_EPOCH_MS) {
    clog.warn(`[experiment] epoch for ${active.id} lived only ${Math.round(epochRanMs / 1000)}s — deferring next epoch to supervisor (rapid-fail brake)`);
    await experimentRepository.update(active.id, { lastEpochEndedAt: new Date() }).catch(() => undefined);
    return true; // treated as handled: keep this thread's queue-drain semantics unchanged
  }

  // Check the epoch that just ended, in parallel with the next one starting.
  // Deliberately not awaited: the checker is advisory, and a slow or failing
  // verification pass must never delay or block the experiment's own progress.
  // Its verdicts land in the ledger and reach whichever epoch starts after.
  void dispatchExperimentChecker(active, active.epoch).catch((err) => {
    clog.warn("[experiment] checker dispatch threw", {
      experimentId: active.id,
      epoch: active.epoch,
      error: errMsg(err),
    });
  });

  // repo-history is COMMIT-bound, not time-bound: every commit from the initial
  // sha to HEAD must be walked, so the deadline is NOT its stop condition — it
  // keeps chaining epochs until the agent ends the run at HEAD (end-experiment,
  // which flips the row out of "active" so this function returns early next
  // time). The only backstop is an epoch-count cap, since a walk that never
  // advances the cursor would otherwise loop forever — a time deadline would
  // defeat the whole point. Other kinds keep the deadline as their safety cap.
  const MAX_REPO_HISTORY_EPOCHS = 1000;
  const keepGoing =
    active.kind === "repo-history"
      ? active.epoch < MAX_REPO_HISTORY_EPOCHS
      : now < active.deadlineAt.getTime();
  if (keepGoing) {
    const next = await experimentRepository.update(active.id, {
      epoch: { increment: 1 },
      lastEpochEndedAt: new Date(),
    });
    await dispatchExperimentEpoch(next);
    return true;
  }
  if (active.kind === "repo-history") {
    clog.warn(`[experiment] repo-history ${active.id} hit the ${MAX_REPO_HISTORY_EPOCHS}-epoch backstop without reaching HEAD — finishing; the walk likely stalled (cursor not advancing)`);
  }

  const finishing = await experimentRepository.update(active.id, {
    status: "finishing",
    epoch: { increment: 1 },
    lastEpochEndedAt: new Date(),
  });
  await dispatchExperimentEpoch(finishing);
  return true;
}

function recordParam(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function pendingActionTargetConversationId(action: Record<string, unknown>): string | undefined {
  const params = recordParam(action["params"]);
  const raw = params["conversationId"] ?? params["targetConversationId"];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function pendingActionTargetChannelId(action: Record<string, unknown>): string | undefined {
  const params = recordParam(action["params"]);
  const raw = params["channelId"];
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

async function pendingActionTargetValidation(
  action: Record<string, unknown>,
  ctx: SessionContext,
  appToken: string,
): Promise<{ error: string | null; channelName?: string }> {
  const conversationId = pendingActionTargetConversationId(action);
  const channelId = pendingActionTargetChannelId(action);

  if (action["tool"] === "user-send-message" && !!conversationId === !!channelId) {
    return { error: "provide exactly one target: use conversationId for an existing thread or channelId to post into a channel" };
  }

  if (conversationId) {
    try {
      await spacesAppFetchGet(
        `/chat/conversationReplies?conversationId=${encodeURIComponent(conversationId)}&limit=1`,
        appToken,
      );
      return { error: null };
    } catch (err) {
      // Branch on the typed HTTP status, not message text. Only a definitive 404
      // rejects a conversation target; everything else (403 included, preserving
      // prior behavior) fails open so the Spaces API stays the final judge.
      const status = err instanceof SpacesApiError ? err.status : undefined;
      if (status === 404) {
        return { error: `conversation ${conversationId} not found — use a real Spaces conversation id, e.g. from the triggering thread` };
      }
      clog.warn(
        `[webhook/result] approval conversation lookup failed open tool=${String(action["tool"] ?? "")} conversationId=${conversationId} userId=${ctx.senderId} spacesAppId=${ctx.spacesAppId} status=${status ?? "n/a"} err=${(errMsg(err)).slice(0, 240)}`,
      );
      return { error: null };
    }
  }

  if (!channelId) return { error: null };

  try {
    const channel = (await spacesAppFetch("/channel/info", { channelId }, appToken)) as { name?: string } | undefined;
    return channel?.name ? { error: null, channelName: channel.name } : { error: null };
  } catch (err) {
    // Same typed-status branch as the queue-time validator (mcp/validators.ts):
    // 404 → not found, 403 → not accessible, anything else fails open.
    const status = err instanceof SpacesApiError ? err.status : undefined;
    if (status === 404) {
      return { error: `channel ${channelId} not found — use a real Spaces channel id` };
    }
    if (status === 403) {
      return { error: `channel ${channelId} is not accessible — add the app to the channel or choose a channel it can access` };
    }
    clog.warn(
      `[webhook/result] approval channel lookup failed open tool=${String(action["tool"] ?? "")} channelId=${channelId} userId=${ctx.senderId} spacesAppId=${ctx.spacesAppId} status=${status ?? "n/a"} err=${(errMsg(err)).slice(0, 240)}`,
    );
    return { error: null };
  }
}

/**
 * Digital Twin (approval mode): open a DM with the mentioned user and send the
 * agent's result as an approve/decline flow — with attachments when present.
 * Nothing is posted to the originating thread; everything goes through the DM.
 * Deletes the session on completion. Caller should `return` after invoking.
 */
/** Union invocation lists (payload + persisted run) deduped by toolCallId,
 *  preferring the entry that CARRIES citations — subagent children (which the
 *  reasoning's `[clf-…]` tokens reference) live only in the persisted run, not
 *  the parent's payload. Mirrors the merge used by the thread-reply citation path. */
function mergeInvocationsForCitations(...lists: unknown[]): unknown[] {
  const byId = new Map<string, unknown>();
  const order: string[] = [];
  const hasCitations = (x: unknown): boolean =>
    !!x && typeof x === "object" && Array.isArray((x as Record<string, unknown>)["citations"]);
  let noId = 0;
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const inv of list) {
      const rawId = inv && typeof inv === "object" ? (inv as Record<string, unknown>)["toolCallId"] : undefined;
      const key = typeof rawId === "string" && rawId ? rawId : `__noid_${noId++}`;
      const existing = byId.get(key);
      if (existing === undefined) {
        order.push(key);
        byId.set(key, inv);
      } else if (!hasCitations(existing) && hasCitations(inv)) {
        byId.set(key, inv); // upgrade to the entry that has citations
      }
    }
  }
  return order.map((k) => byId.get(k));
}

/**
 * LEGACY delivery path (pre-XYNE-17815): post the Twin's proposal as an
 * approve/decline card in a DM with the owner. Kept ONLY as the fallback for
 * Spaces backends that don't yet serve /api/internal/twin-reply-draft — see
 * sendTwinReplyDraft. Delete once every environment runs the in-thread draft.
 * The signature suffix is already applied by the caller, so the original
 * inline suffix block was removed on restore (it would double-append).
 */
async function sendDigitalTwinApprovalDm(
  ctx: SessionContext,
  delivery: TwinDelivery,
  attachments: Array<{ fileName: string; mimeType: string; data: string }> | undefined,
  sessionId: string,
): Promise<void> {
  // Defense-in-depth: an `ignore` delivery must NEVER reach here (the caller
  // drops it). If it somehow does, never open a DM / post / write a pending row.
  if (delivery.action === "ignore") {
    clog.warn(`[webhook/result] sendDigitalTwinApprovalDm called with action=ignore — dropping, session ${sessionId}`);
    await deleteSession(sessionId);
    return;
  }
  const token = ctx.appToken;

  // workspaceId required by prod openDm schema. Empty fallback only to satisfy
  // types — the earlier USER_MENTIONED gate already rejected runs where we
  // couldn't resolve the workspaceId, so this should always have a real value.
  const dmResult = (await spacesAppFetch("/channel/openDm", {
    targetUserId: ctx.mentionedUserId,
    workspaceId: ctx.workspaceId ?? "",
  }, token)) as { channelId: string };

  const twinFlow = withSpacesAppId(buildTwinApprovalFlow({
    delivery: delivery,
    ...(ctx.sourceMessageId ? { sourceMessageId: ctx.sourceMessageId } : {}),
    targetChannelId: ctx.channelId,
    targetConversationId: ctx.conversationId,
    mentionedUserId: ctx.mentionedUserId,
    workspaceId: ctx.workspaceId ?? "",
    senderId: ctx.senderId,
    senderName: ctx.senderName,
    channelName: ctx.channelName,
    task: ctx.task,
    ...(ctx.agentSlug ? { agentSlug: ctx.agentSlug } : {}),
    dmChannelId: dmResult.channelId,
    spacesBaseUrl: CONFIG.spacesAppUrl,
  }), ctx.spacesAppId);

  if (attachments?.length) {
    const form = new FormData();
    for (const att of attachments) {
      const buffer = Buffer.from(att.data, "base64");
      const blob = new Blob([buffer], { type: att.mimeType });
      form.append("files", blob, att.fileName);
    }
    form.append("channelId", dmResult.channelId);
    form.append("userId", ctx.spacesAppUserId);
    form.append("flow", JSON.stringify(twinFlow));

    await spacesAppFetchMultipart("/files/filesUpload", form, token);
  } else {
    await spacesAppFetch("/chat/postMessage", {
      channelId: dmResult.channelId,
      flow: twinFlow,
      userId: ctx.spacesAppUserId,
    }, token);
  }

  // Record a PENDING feedback row so the daily learning loop can later reconcile
  // the user's accept / decline / edit / ignore of this proposal. Fire-and-forget.
  void recordTwinApprovalPending({
    userId: ctx.mentionedUserId,
    conversationId: ctx.conversationId,
    channelId: ctx.channelId,
    channelName: ctx.channelName,
    ...(ctx.sourceMessageId ? { sourceMessageId: ctx.sourceMessageId } : {}),
    incomingTask: ctx.task,
    delivery: delivery,
  });

  clog.info(`[webhook/result] Digital Twin: sent approve/decline DM to ${ctx.mentionedUserId} (asked by ${ctx.senderId})`);
  await deleteSession(sessionId);
}

/**
 * Deliver the Twin's structured proposal as an OWNER-ONLY in-thread reply draft
 * (replaces the old approval DM card). Bakes citation metadata from the Twin's
 * private `reasoning` (its `[clf-…#n]` tokens reference the Spaces tools it
 * searched) so the "Why?" panel can render clickable source chips, then creates
 * the draft in Spaces (Redis, owner-partitioned) via S2S. Fail-CLOSED: any
 * create failure leaves nothing posted and the session cleaned up.
 */
async function sendTwinReplyDraft(
  ctx: SessionContext,
  delivery: TwinDelivery,
  toolInvocations: unknown,
  sessionId: string,
  /** Callback attachments — only used by the legacy approval-DM fallback. */
  attachments?: Array<{ fileName: string; mimeType: string; data: string }> | undefined,
): Promise<void> {
  // Defense-in-depth: an `ignore` delivery must NEVER reach here (the caller
  // drops it). If it somehow does, never create a draft / write a pending row.
  if (delivery.action === "ignore") {
    clog.warn(`[webhook/result] sendTwinReplyDraft called with action=ignore — dropping, session ${sessionId}`);
    await deleteSession(sessionId);
    return;
  }

  // Apply the user's configured Twin signature/disclaimer to the REPLY body (not
  // to a react-only delivery). Deterministic server-side append.
  let effectiveDelivery = delivery;
  if (delivery.message && ctx.mentionedUserId) {
    try {
      const u = await prisma.user.findUnique({
        where: { id: ctx.mentionedUserId },
        select: { digitalTwinResponseSuffix: true },
      });
      const suffix = u?.digitalTwinResponseSuffix?.trim();
      if (suffix && !delivery.message.endsWith(suffix)) {
        effectiveDelivery = { ...delivery, message: `${delivery.message.trimEnd()}\n\n${suffix}` };
      }
    } catch (err) {
      clog.warn(`[webhook/result] Twin suffix lookup failed for user ${ctx.mentionedUserId}: ${errMsg(err)}`);
    }
  }

  // Bake citation metadata from the private reasoning. Null when the reasoning
  // carries no `[clf-…]` tokens — the "Why?" panel then renders plain reasoning.
  let citationMeta: ReturnType<typeof buildThreadCitationMeta> = null;
  if (effectiveDelivery.reasoning) {
    try {
      const persisted = await agentRunRepository.findBySessionId(sessionId).catch(() => null);
      const merged = mergeInvocationsForCitations(persisted?.toolInvocations, toolInvocations);
      citationMeta = buildThreadCitationMeta(merged, effectiveDelivery.reasoning);
    } catch (err) {
      clog.warn(`[webhook/result] Twin citation baking failed: ${errMsg(err)}`);
    }
  }

  const dest = effectiveDelivery.destination;
  const draft = {
    conversationId: ctx.conversationId,
    ownerUserId: ctx.mentionedUserId,
    channelId: ctx.channelId,
    action: effectiveDelivery.action,
    ...(effectiveDelivery.message ? { message: effectiveDelivery.message } : {}),
    ...(effectiveDelivery.emoji ? { emoji: effectiveDelivery.emoji } : {}),
    ...(effectiveDelivery.reasoning ? { reasoning: effectiveDelivery.reasoning } : {}),
    ...(citationMeta?.clawCitations ? { clawCitations: citationMeta.clawCitations } : {}),
    ...(citationMeta?.clawCitationIcons ? { clawCitationIcons: citationMeta.clawCitationIcons } : {}),
    destinationKind: dest?.kind ?? "origin_thread",
    ...(dest && "channelId" in dest ? { destinationChannelId: dest.channelId } : {}),
    ...(dest && "conversationId" in dest ? { destinationConversationId: dest.conversationId } : {}),
    ...(dest && "userId" in dest ? { destinationUserId: dest.userId } : {}),
    ...(dest && "channelName" in dest && dest.channelName ? { destinationChannelName: dest.channelName } : {}),
    // DM recipient name for the owner-facing "sends a DM to …" label. `dm` may
    // carry it on the destination; `dm_sender` is the mention sender we already
    // know. Spaces resolves any remaining name from the user id at draft create.
    ...(dest?.kind === "dm" && dest.userName ? { destinationUserName: dest.userName } : {}),
    ...(dest?.kind === "dm_sender" && ctx.senderName ? { destinationUserName: ctx.senderName } : {}),
    ...(effectiveDelivery.destinationReason ? { destinationReason: effectiveDelivery.destinationReason } : {}),
    ...(ctx.sourceMessageId ? { sourceMessageId: ctx.sourceMessageId } : {}),
    mentionedUserId: ctx.mentionedUserId,
    workspaceId: ctx.workspaceId ?? "",
    ...(ctx.senderId ? { senderId: ctx.senderId } : {}),
    ...(ctx.senderName ? { senderName: ctx.senderName } : {}),
    ...(ctx.channelName ? { channelName: ctx.channelName } : {}),
    ...(ctx.task ? { incomingTask: ctx.task } : {}),
    ...(ctx.agentSlug ? { agentSlug: ctx.agentSlug } : {}),
    ...(ctx.spacesAppId ? { spacesAppId: ctx.spacesAppId } : {}),
    sessionId,
  };

  // Create the owner-only in-thread draft in Spaces. When the Spaces backend
  // doesn't serve /api/internal/twin-reply-draft yet (route added in
  // XYNE-17815; caller shipped 2026-07-23, route reached main 2026-08-05), the
  // request falls through to the user-auth middleware and comes back 401/404.
  // That skew silently killed EVERY twin reply for ~2 weeks because this path
  // was fail-closed with no alternative. Fall back to the pre-XYNE-17815
  // approval DM card instead: the twin keeps working on old backends, and the
  // moment the route deploys we're back on the in-thread draft with no change.
  try {
    const resp = await fetch(`${CONFIG.spacesInternalUrl}/api/internal/twin-reply-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": process.env["INTERNAL_S2S_KEY"] ?? "" },
      body: JSON.stringify(draft),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      // 401/404 == endpoint not deployed (or not reachable as S2S) → legacy DM.
      // Any other status is a genuine draft-create failure: stay fail-closed.
      if (resp.status === 401 || resp.status === 404) {
        clog.warn(`[webhook/result] Twin reply-draft endpoint unavailable (${resp.status}) — falling back to approval DM, session ${sessionId}`);
        await sendDigitalTwinApprovalDm(ctx, effectiveDelivery, attachments, sessionId);
        return;
      }
      clog.error(`[webhook/result] Twin reply-draft create failed: ${resp.status} ${text.slice(0, 200)} — staying silent, session ${sessionId}`);
      await deleteSession(sessionId);
      return;
    }
  } catch (err) {
    clog.error(`[webhook/result] Twin reply-draft create error: ${errMsg(err)} — staying silent, session ${sessionId}`);
    await deleteSession(sessionId);
    return;
  }

  // Record a PENDING feedback row so the daily learning loop can later reconcile
  // the user's accept / decline / edit / ignore of this proposal. Fire-and-forget.
  void recordTwinApprovalPending({
    userId: ctx.mentionedUserId,
    conversationId: ctx.conversationId,
    channelId: ctx.channelId,
    channelName: ctx.channelName,
    ...(ctx.sourceMessageId ? { sourceMessageId: ctx.sourceMessageId } : {}),
    incomingTask: ctx.task,
    delivery: effectiveDelivery,
  });

  clog.info(`[webhook/result] Digital Twin: posted in-thread reply draft for ${ctx.mentionedUserId} (asked by ${ctx.senderId}) action=${effectiveDelivery.action} dest=${dest?.kind ?? "origin_thread"}`);
  await deleteSession(sessionId);
}

/**
 * Surface a /goal lifecycle phase (Starting…, Turn N/M…) as an EPHEMERAL
 * progress signal instead of a permanent chat message — same surface tool
 * calls use, so the loop's per-turn chatter rides the agent's activity spinner
 * rather than spamming the thread with one message per turn. Terminal outcomes
 * (/goal complete|stopped — reason) deliberately stay real posted messages so
 * the user sees how and why the loop ended.
 *
 * Fire-and-forget; best-effort. When USE_EPHEMERAL_PROGRESS is off (no Spaces
 * agentProgress support), falls back to a normal message so the phase isn't
 * silently lost in that mode.
 */
async function postGoalPhase(
  fields: { conversationId: string; channelId?: string | undefined; agentSlug?: string | undefined; spacesAppUserId: string; appToken: string },
  label: string,
): Promise<void> {
  try {
    if (USE_EPHEMERAL_PROGRESS) {
      await spacesAppFetch("/chat/agentProgress", {
        conversationId: fields.conversationId,
        ...(fields.channelId ? { channelId: fields.channelId } : {}),
        ...(fields.agentSlug ? { agentSlug: fields.agentSlug } : {}),
        userId: fields.spacesAppUserId,
        toolLabel: label,
        status: "working",
      }, fields.appToken);
    } else {
      await spacesAppFetch("/chat/postMessage", {
        ...(fields.channelId ? { channelId: fields.channelId } : {}),
        conversationId: fields.conversationId,
        markdownText: label,
        userId: fields.spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      }, fields.appToken);
    }
  } catch {
    // Best-effort: a missed progress signal must never break the goal loop.
  }
}

interface ResolvedAgent {
  id: string;
  slug: string;
  /** Display name — the text a leftover "@Display Name" mention carries. */
  name: string;
  orgId: string;
  appToken: string;
  spacesAppId: string;
  spacesAppUserId: string;
  isDefault: boolean;
}

/**
 * Strip a leftover leading "@<agent mention>" so a slash command lands at byte
 * zero. Matches only the given names verbatim (display name first, slug as
 * fallback) — never a generic @-token+words pattern, which cannot distinguish
 * a multi-word display name from the user's own prose.
 */
function stripLeadingAgentMention(text: string, names: Array<string | null | undefined>): string {
  for (const raw of names) {
    const name = raw?.trim();
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^@${escaped}(?=\\s|$)`, "i");
    if (re.test(text)) return text.replace(re, "").trimStart();
  }
  return text;
}

async function resolveAgentByAppUserId(appUserId: string): Promise<ResolvedAgent | null> {
  const agent = await agentRepository.findByAppUserId(appUserId);

  if (agent?.spacesAppToken && agent.spacesAppId) {
    return {
      id: agent.id,
      slug: agent.slug,
      name: agent.name ?? agent.slug,
      orgId: agent.orgId,
      appToken: decryptStoredField(agent.spacesAppToken),
      spacesAppId: agent.spacesAppId,
      spacesAppUserId: agent.spacesAppUserId ?? "",
      isDefault: agent.isDefault,
    };
  }

  return null;
}

async function getDefaultAgent(): Promise<ResolvedAgent | null> {
  const agent = await agentRepository.findDefault();

  if (!agent?.spacesAppToken || !agent.spacesAppId) return null;

  return {
    slug: agent.slug,
    id: agent.id,
    name: agent.name ?? agent.slug,
    orgId: agent.orgId,
    appToken: decryptStoredField(agent.spacesAppToken),
    spacesAppId: agent.spacesAppId,
    spacesAppUserId: agent.spacesAppUserId ?? "",
    isDefault: true,
  };
}

export async function fetchConversationHistory(
  conversationId: string,
  appToken?: string,
  excludeUserId?: string,
): Promise<string | undefined> {
  try {
    const data = await spacesAppFetchGet(
      `/chat/conversationReplies?conversationId=${encodeURIComponent(conversationId)}`,
      appToken,
    ) as { items?: Array<{ userId: string; cleanContent: string; createdAt: string }> };

    let items = data.items ?? [];
    if (excludeUserId) {
      items = items.filter((m) => m.userId !== excludeUserId);
    }
    if (items.length === 0) return undefined;

    // Resolve which userIds belong to OTHER AI agents (their bot users) vs
    // humans. Without this distinction the receiving agent's LLM treats every
    // first-person message in history as a peer speaking AS itself, and on
    // the Twin path that causes identity-bleed — the Twin sees an Assistant
    // agent's "I'm a coding assistant" line and reproduces it as its own
    // first-person voice. Labelling other agents explicitly with a "do not
    // adopt this voice" marker stops the LLM from wearing their persona.
    const uniqueUserIds = [...new Set(items.map((m) => m.userId))];
    const agentBots = uniqueUserIds.length > 0
      ? await prisma.agent.findMany({
          where: { spacesAppUserId: { in: uniqueUserIds } },
          select: { spacesAppUserId: true, slug: true, name: true },
        }).catch(() => [])
      : [];
    const agentByBotUserId = new Map(
      agentBots
        .filter((a): a is { spacesAppUserId: string; slug: string; name: string } => !!a.spacesAppUserId)
        .map((a) => [a.spacesAppUserId, a]),
    );

    const lines = items.map((m) => {
      const a = agentByBotUserId.get(m.userId);
      const speaker = a
        ? `@${a.slug} (OTHER AI AGENT — not you; do not adopt this voice or identity)`
        : `human-user:${m.userId}`;
      return `[${new Date(m.createdAt).toISOString()}] ${speaker}: ${m.cleanContent}`;
    });
    return `Thread history (oldest → newest):\n${lines.join("\n")}`;
  } catch (err) {
    clog.warn("[webhook] Failed to fetch conversation history:", err);
    return undefined;
  }
}

// buildAppActionFrontmatter removed — replaced by buildTwinApprovalFlow from xyne-claw-shared

// ── Action formatting ───────────────────────────────────────────────

/** Tickets rendered in full inside the bulk approval card. The rest are
 *  summarised by count — every ticket in `params` is still created on approve,
 *  since the executed payload comes from the HMAC-signed action, not the card. */
const BULK_TICKETS_CARD_LIMIT = 25;

type TicketCardPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
const TICKET_CARD_PRIORITIES: TicketCardPriority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function formatActionDescription(tool: string, params: Record<string, unknown>, options?: { channelName?: string }): string {
  if (tool === "user-send-message") {
    const content = (params["content"] as string ?? "").slice(0, 300);
    const conversationId = params["conversationId"] as string | undefined;
    const channelId = params["channelId"] as string | undefined;
    const lines = [`**Send Message as You**`, ``];
    if (channelId) {
      lines.push(`**Destination:** post NEW message to #${options?.channelName ?? channelId}`);
    } else if (conversationId) {
      lines.push(`**Destination:** reply in existing thread ${conversationId}`);
    }
    if (content) lines.push(``, `**Message:** ${content}${(params["content"] as string ?? "").length > 300 ? "..." : ""}`);
    return lines.join("\n");
  }

  if (tool === "spaces-create-ticket") {
    const title = params["title"] as string ?? "";
    const desc = (params["description"] as string ?? "").slice(0, 300);
    const lines = [`**Create Ticket**`, ``, `**Title:** ${title}`];
    if (desc) lines.push(`**Description:** ${desc}${(params["description"] as string ?? "").length > 300 ? "..." : ""}`);
    return lines.join("\n");
  }

  if (tool === "spaces-create-bulk-tickets") {
    const tickets = Array.isArray(params["tickets"]) ? params["tickets"] as Array<Record<string, unknown>> : [];
    const lines = [
      `**Create ${tickets.length} Tickets**`,
      ``,
      `**Project/Board/Channel:** ${String(params["projectId"] ?? "")} / ${String(params["boardId"] ?? "")} / ${options?.channelName ? `#${options.channelName}` : String(params["channelId"] ?? "")}`,
      ``,
    ];
    // Everything the approver needs lives in THIS card — no companion file
    // upload. Same shape as spaces-create-ticket above (title + trimmed
    // description), repeated per ticket. The card body scrolls past 280px
    // (buildWriteApprovalFlow), so a long batch stays readable in-thread.
    tickets.slice(0, BULK_TICKETS_CARD_LIMIT).forEach((ticket, index) => {
      const title = String(ticket["title"] ?? "(untitled)");
      const priority = String(ticket["priority"] ?? params["defaultPriority"] ?? "");
      const assignee = String(ticket["assignedTo"] ?? params["defaultAssignedTo"] ?? "");
      const tags = Array.isArray(ticket["tags"]) ? (ticket["tags"] as unknown[]).join(", ") : "";
      const rawDesc = String(ticket["description"] ?? "");
      const desc = rawDesc.slice(0, 200);
      const meta = [priority, assignee && `→ ${assignee}`, tags && `[${tags}]`].filter(Boolean).join(" · ");
      lines.push(`**${index + 1}. ${title}**${meta ? ` — ${meta}` : ""}`);
      if (desc) lines.push(`${desc}${rawDesc.length > 200 ? "…" : ""}`);
      lines.push(``);
    });
    if (tickets.length > BULK_TICKETS_CARD_LIMIT) {
      lines.push(`_…and ${tickets.length - BULK_TICKETS_CARD_LIMIT} more — all ${tickets.length} are created on approve._`);
    }
    return lines.join("\n");
  }

  if (tool === "spaces-update-bulk-tickets") {
    const tickets = Array.isArray(params["tickets"]) ? params["tickets"] as Array<Record<string, unknown>> : [];
    const lines = [`**Update ${tickets.length} Tickets**`, ``];

    const defaults: string[] = [];
    if (params["defaultStatus"]) defaults.push(`status \u2192 ${String(params["defaultStatus"])}`);
    if (params["defaultStage"]) defaults.push(`stage \u2192 ${String(params["defaultStage"])}`);
    if (params["defaultPriority"]) defaults.push(`priority \u2192 ${String(params["defaultPriority"])}`);
    if (params["defaultAssigneeId"]) defaults.push(`assignee \u2192 ${String(params["defaultAssigneeId"])}`);
    if (Array.isArray(params["defaultTags"]) && (params["defaultTags"] as unknown[]).length) {
      defaults.push(`tags [${(params["defaultTags"] as unknown[]).join(", ")}]`);
    }
    if (defaults.length) lines.push(`**Defaults:** ${defaults.join(" \u00b7 ")}`, ``);

    tickets.slice(0, BULK_TICKETS_CARD_LIMIT).forEach((ticket, index) => {
      const ticketId = String(ticket["ticketId"] ?? "(no id)");
      const changes: string[] = [];
      const status = ticket["status"] ?? params["defaultStatus"];
      const stage = ticket["stage"] ?? params["defaultStage"];
      const priority = ticket["priority"] ?? params["defaultPriority"];
      const assignee = ticket["assigneeId"] ?? params["defaultAssigneeId"];
      if (status) changes.push(`status \u2192 ${String(status)}`);
      if (stage) changes.push(`stage \u2192 ${String(stage)}`);
      if (priority) changes.push(`priority \u2192 ${String(priority)}`);
      if (assignee) changes.push(`assignee \u2192 ${String(assignee)}`);
      if (ticket["title"]) changes.push(`title`);
      if (ticket["description"]) changes.push(`description`);
      if (ticket["eta"]) changes.push(`eta \u2192 ${String(ticket["eta"])}`);
      if (Array.isArray(ticket["tags"]) || Array.isArray(params["defaultTags"])) changes.push(`tags`);
      lines.push(`**${index + 1}. ${ticketId}**${changes.length ? ` \u2014 ${changes.join(" \u00b7 ")}` : ""}`);
    });
    if (tickets.length > BULK_TICKETS_CARD_LIMIT) {
      lines.push(``, `_\u2026and ${tickets.length - BULK_TICKETS_CARD_LIMIT} more \u2014 all ${tickets.length} are updated on approve._`);
    }
    return lines.join("\n");
  }

  if (tool === "spaces-schedule-call") {
    const title = params["title"] as string ?? "Call";
    const startsAt = params["startsAt"] as string ?? "";
    const endsAt = params["endsAt"] as string ?? "";
    const lines = [`**Schedule Call**`, ``, `**Title:** ${title}`];
    if (startsAt) lines.push(`**Starts:** ${new Date(startsAt).toLocaleString()}`);
    if (endsAt) lines.push(`**Ends:** ${new Date(endsAt).toLocaleString()}`);
    return lines.join("\n");
  }

  if (tool === "spaces-memory-create") {
    const docType = (params["docType"] as string ?? "fact").toUpperCase();
    const query = params["query"] as string ?? "";
    const tags = params["tags"] as string[] ?? [];
    const lines = [`**Save to Knowledge Base (${docType})**`];
    if (query) lines.push(``, `**Summary:** ${query}`);
    if (tags.length > 0) lines.push(`**Tags:** ${tags.join(", ")}`);
    lines.push(``, `_See attached file for full content._`);
    return lines.join("\n");
  }

  if (tool === "create-skill") {
    const name = (params["name"] as string) ?? "";
    const slug = (params["slug"] as string) ?? "";
    const description = (params["description"] as string) ?? "";
    const content = (params["content"] as string) ?? "";
    const lines = [`**Create Skill**`, ``, `**Name:** ${name}`];
    if (slug) lines.push(`**Slug:** \`${slug}\``);
    if (description) lines.push(`**Description:** ${description}`);
    lines.push(``, `**Content (${content.length} chars):**`, "```md", content.slice(0, 1500) + (content.length > 1500 ? "\n…(truncated)" : ""), "```");
    return lines.join("\n");
  }

  // Fallback for unknown tools
  const entries = Object.entries(params).filter(([, v]) => v != null).slice(0, 8);
  const lines = [`**${tool}**`, ``];
  for (const [key, value] of entries) {
    const val = typeof value === "string" ? value.slice(0, 200) : JSON.stringify(value).slice(0, 200);
    lines.push(`**${key}:** ${val}`);
  }
  return lines.join("\n");
}

async function postWriteApprovalAction(args: {
  action: Record<string, unknown>;
  ctx: SessionContext;
  token: string;
  targetValidation: { channelName?: string };
}): Promise<void> {
  const { action, ctx, token, targetValidation } = args;
  const params = action["params"] as Record<string, unknown>;
  const actionDesc = formatActionDescription(action["tool"] as string, params, targetValidation);

  // The pending-action signature is minted before the Spaces delivery target is
  // known. Verify it, then bind the trusted session agent to the card signature
  // so flow-action cannot be replayed with another org's app credentials.
  const { signAction, verifyActionSignature } = await import("./mcp.js");
  const pendingActionPayload = {
    serverType: action["serverType"] as string,
    tool: action["tool"] as string,
    params,
    userId: action["userId"] as string,
  };
  if (!verifyActionSignature(pendingActionPayload, action["signature"] as string)) {
    throw new Error("Invalid pending write-action signature");
  }
  const agentSlug = ctx.agentSlug ?? "";
  const spacesAppId = ctx.spacesAppId ?? "";
  const cardSignature = signAction({ ...pendingActionPayload, agentSlug, spacesAppId });

  const cardAction = {
    serverType: pendingActionPayload.serverType,
    tool: pendingActionPayload.tool,
    params,
    userId: pendingActionPayload.userId,
    signature: cardSignature,
    agentSlug,
    channelId: ctx.channelId,
    conversationId: ctx.conversationId,
  };

  const ticketTitle = typeof params?.["title"] === "string" ? params["title"].trim() : "";
  // The rich `ticket` FlowUI component is only rendered by newer Spaces
  // backends; older deployments reject it. Track when we used it so a flow-
  // schema rejection can fall back to the generic approval card below.
  const usedRichTicketCard = pendingActionPayload.tool === "spaces-create-ticket" && !!ticketTitle;
  const writeFlow = withSpacesAppId(
    usedRichTicketCard
      ? buildTicketProposalFlow({
          title: ticketTitle,
          ...(TICKET_CARD_PRIORITIES.includes(params["priority"] as TicketCardPriority)
            ? { priority: params["priority"] as TicketCardPriority }
            : {}),
          ...(typeof params["eta"] === "string" && params["eta"] ? { eta: params["eta"] } : {}),
          ...(typeof params["assignedTo"] === "string" && params["assignedTo"]
            ? { assigneeId: params["assignedTo"] }
            : {}),
        }, cardAction)
      : buildWriteApprovalFlow(actionDesc, cardAction),
    spacesAppId,
  );

  // Any attachment is a SEPARATE post from the card. `/files/filesUpload`
  // (filesController.uploadFiles) has no flow handling at all — a `flow` field
  // sent with an upload is silently dropped, so the Approve/Decline card never
  // appears. Only `/chat/postMessage` renders a card, and its schema calls the
  // field `flow` (UpdateMessage uses `flowJSON` — different route, different
  // name).
  //
  // spaces-create-bulk-tickets deliberately posts NO file: the batch renders
  // inline in the approval card itself (formatActionDescription), same as
  // spaces-create-ticket. One message, one Approve button, nothing to open.
  if (action["tool"] === "spaces-memory-create" && params?.["content"]) {
    const memContent = params["content"] as string;
    const memDocType = (params["docType"] as string) ?? "fact";
    try {
      await postGeneratedMarkdownFile({
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
        userId: ctx.spacesAppUserId,
        appToken: token,
        filename: `memory-${memDocType}-${Date.now()}.md`,
        markdown: memContent,
        summary: "",
      });
    } catch (err) {
      clog.warn("[webhook/result] memory attachment upload failed; posting approval card without attachment", {
        error: errMsg(err),
      });
    }
  }

  const postCard = (flow: unknown): Promise<unknown> =>
    spacesAppFetch("/chat/postMessage", {
      channelId: ctx.channelId,
      // Same empty-conversationId guard as the result post: an API/event-triggered
      // run has no thread, so posting the approval card with conversationId: ""
      // 400s in Spaces' channel-validation middleware and the card silently never
      // appears. Omit when empty → the card posts as a top-level channel message.
      ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
      flow,
      userId: ctx.spacesAppUserId,
    }, token);

  try {
    await postCard(writeFlow);
  } catch (err) {
    // The rich `ticket` component isn't rendered by every deployed Spaces
    // backend; when it isn't, /chat/postMessage rejects the ENTIRE card with a
    // 400 "Invalid flowJSON" (unknown component discriminator) and the approval
    // never appears (prod 2026-08-24, arya-doctor spaces-create-ticket). Degrade
    // to the generic approve/decline card, which uses only universally-supported
    // component types and carries the identical signed action, so the write can
    // still be approved. ONLY a flow-schema 400 triggers this — any other error
    // (auth, channel validation, network) re-throws so the caller's skip/target
    // logic is unaffected. Once Spaces ships `ticket`, the rich card works again
    // with no code change.
    if (!usedRichTicketCard || !isFlowSchemaRejection(err)) throw err;
    clog.warn(
      `[webhook/result] ticket approval card rejected by Spaces flow schema; falling back to generic approval card tool=${pendingActionPayload.tool} channelId=${ctx.channelId} conversationId=${ctx.conversationId ?? ""}`,
    );
    await postCard(withSpacesAppId(buildWriteApprovalFlow(actionDesc, cardAction), spacesAppId));
  }
}

// ── POST /webhook and /webhook/:agentSlug — receive events from Xyne Spaces ──

async function handleWebhook(req: Request, res: Response): Promise<void> {
  const traceId = createTraceId();
  const log = createLogger("webhook", traceId);
  const event = req.body as WebhookEvent;
  const { eventType, payload } = event;

  // Only handle mention events
  if (eventType !== "USER_MENTIONED" && eventType !== "APP_MENTIONED" && eventType !== "DIRECT_MESSAGE") {
    res.json({ success: true });
    return;
  }

  // Digital Twin (USER_MENTIONED) is gated PER-USER below — only users who
  // explicitly flipped `User.digitalTwinEnabled = true` via POST
  // /digital-twin/enable get a Twin response. The DB default is `false`, so
  // every existing user is opted out unless they opt in.
  //
  // This replaces the previous `XYNE_DIGITAL_TWIN_DISABLED` global env-flag
  // kill switch — the per-user gate provides equivalent (or stronger)
  // protection. To mass-disable, set `User.digitalTwinEnabled = false`
  // across all users.

  // For APP_MENTIONED: the agent identity comes from the URL param (app id for
  // new webhooks, slug for legacy webhooks).
  // For USER_MENTIONED: resolve from mentionedUserIds
  let agent: ResolvedAgent | null = null;

  // workspaceId of the mentioned user is resolved PER-USER in the twin dispatch
  // loop and passed into dispatchRunForTarget as a parameter (threaded through
  // SessionContext + the Flow UI data context so flow-action.ts can pass it to
  // /api/internal/postAsUser — Spaces refuses to post for the user without it).
  // No longer a shared function-scope variable.

  // Set to true once we've verified this is a USER_MENTIONED on the default
  // agent (assistant) AND the mentioned user has opted into Digital Twin.
  // At /run dispatch we swap the agentSlug to "digital-twin" so the dedicated
  // Twin agent (with user-memory recall + Twin system prompt) actually
  // processes the reply. The assistant's Spaces App still owns the DM
  // channel — we only swap which agent's brain runs, not where the reply
  // posts.
  let runAsTwin = false;

  const { agentSlug: agentSlugFromUrl, spacesAppId: spacesAppIdFromUrl } = req.params as { agentSlug?: string; spacesAppId?: string };
  if (spacesAppIdFromUrl) {
    const agentRow = await agentRepository.findBySpacesAppId(spacesAppIdFromUrl);
    if (!agentRow) {
      log.warn(`Webhook app route miss for spacesAppId=${spacesAppIdFromUrl}`);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    if (agentRow.spacesAppToken && agentRow.spacesAppId) {
      agent = {
        id: agentRow.id,
        slug: agentRow.slug,
        name: agentRow.name ?? agentRow.slug,
        orgId: agentRow.orgId ?? null,
        appToken: decryptStoredField(agentRow.spacesAppToken),
        spacesAppId: agentRow.spacesAppId,
        spacesAppUserId: agentRow.spacesAppUserId ?? "",
        isDefault: agentRow.isDefault,
      };
    }
    if (eventType === "USER_MENTIONED" && agentRow.slug !== "digital-twin") {
      log.info(`Ignoring USER_MENTIONED on app/${spacesAppIdFromUrl} (${agentRow.slug}) — Twin handles this exclusively via digital-twin`);
      res.json({ success: true });
      return;
    }
    if (eventType === "USER_MENTIONED") {
      // Per-user eligibility (registered + digitalTwinEnabled + resolvable
      // workspaceId) is resolved AFTER the ack, ONCE PER mentioned user, in the
      // twin dispatch loop below — so a message mentioning MULTIPLE users fires
      // one twin run per eligible user instead of being dropped. Here we only
      // flag that this (twin-only) route has at least one mention to act on.
      const mentionedUserIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];
      runAsTwin = mentionedUserIds.length > 0;
    }
  } else if (agentSlugFromUrl) {
    const legacyMatches = await prisma.agent.findMany({
      where: { slug: agentSlugFromUrl },
      take: 2,
    });
    if (legacyMatches.length > 1) {
      log.error(`[webhook] legacy slug route ambiguous after org-scoped slug flip agentSlug=${agentSlugFromUrl}; returning 404`);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const agentRow = legacyMatches[0] ?? null;
    const mentionerOrgId = await orgIdForSpacesUser(payload.userId, "webhook", agentRow?.orgId ?? undefined);

    // USER_MENTIONED is **digital-twin-only**. Spaces fans the mention to
    // every agent installed in the channel; we accept it on exactly ONE
    // webhook (digital-twin) and reject on all others. This means:
    //   - The mentioned user MUST have the Digital Twin Spaces App
    //     installed in their workspace for the Twin flow to work.
    //   - Assistant, doctor-agent etc. are explicitly NOT
    //     entry points for the Twin — they're conversation agents only.
    //   - The DM with approve/decline buttons always arrives from the
    //     Digital Twin bot (because we authenticate using digital-twin's
    //     spacesAppToken — which is the agentRow loaded for this webhook).
    //
    // Rationale (2026-05-23): user observed that mentions were arriving
    // via Assistant's bot, posting approve-DMs from Assistant rather than
    // from Digital Twin. The earlier "any agent can be entry" design had
    // the right intent but the credential-swap fallback masked the wrong
    // bot identity. Clean fix: route is the source of truth. Whichever
    // webhook URL Spaces delivers to determines the bot — and we only
    // allow `/webhook/digital-twin` for this event.
    if (eventType === "USER_MENTIONED" && agentSlugFromUrl !== "digital-twin") {
      log.info(`Ignoring USER_MENTIONED on /${agentSlugFromUrl} — Twin handles this exclusively via /webhook/digital-twin`);
      res.json({ success: true });
      return;
    }

    if (eventType === "USER_MENTIONED") {
      // See the app-route gate above: per-user opt-in + workspaceId resolution
      // happens AFTER the ack in the twin dispatch loop, once per mentioned
      // user, so multi-user mentions each fire their own twin run. Digital Twin
      // is still OFF by default — the loop enforces digitalTwinEnabled per user
      // (the prod-OOM guard) before dispatching anything.
      const mentionedUserIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];
      runAsTwin = mentionedUserIds.length > 0;
    }

    if (agentRow?.spacesAppToken && agentRow.spacesAppId) {
      agent = {
        id: agentRow.id,
        slug: agentRow.slug,
        name: agentRow.name ?? agentRow.slug,
        orgId: agentRow.orgId ?? null,
        appToken: decryptStoredField(agentRow.spacesAppToken),
        spacesAppId: agentRow.spacesAppId,
        spacesAppUserId: agentRow.spacesAppUserId ?? "",
        isDefault: agentRow.isDefault,
      };
    }
  } else if (eventType === "USER_MENTIONED") {
    const mentionedUserIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];
    if (mentionedUserIds.length > 0) {
      // First check if the mentioned user is an agent bot
      agent = await resolveAgentByAppUserId(mentionedUserIds[0]!);

      // If not an agent bot, check if the mentioned user is registered in claw-auth
      // (i.e. they have a Digital Twin set up with MCP connections)
      if (!agent) {
        let mentionedUser = await userRepository.findById(mentionedUserIds[0]!);
        if (!mentionedUser) {
          // JIT-mirror from Spaces — they may exist there but not here.
          await ensureUserExists(mentionedUserIds[0]!, "webhook").catch(() => {});
          mentionedUser = await userRepository.findById(mentionedUserIds[0]!);
        }
        if (!mentionedUser) {
          log.info(`Ignoring USER_MENTIONED — user ${mentionedUserIds[0]} not registered in claw-auth`);
          res.json({ success: true });
          return;
        }
        // User exists in claw-auth — fall through to default agent (Digital Twin)
      }
    }
  }

  // Fall back to default agent
  if (!agent) {
    agent = await getDefaultAgent();
  }

  if (!agent) {
    log.error("No agent found and no default agent registered");
    res.json({ success: true });
    return;
  }

  // Verify the sender has an account in claw-auth — JIT-mirror from Spaces
  // first so a user who's never opened the dashboard still goes through.
  let senderUser = await userRepository.findById(payload.userId);
  if (!senderUser) {
    await ensureUserExists(payload.userId, "webhook", agent.orgId ?? undefined).catch(() => {});
    senderUser = await userRepository.findById(payload.userId);
  }
  if (!senderUser) {
    if (eventType === "DIRECT_MESSAGE") {
      log.info(`Sender ${payload.userId} not registered — sending setup template`);
      res.json({ success: true });
      spacesAppFetch("/chat/postMessage", {
        channelId: payload.channelId,
        conversationId: payload.conversationId,
        markdownText: UNREGISTERED_USER_TEMPLATE,
        userId: agent.spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      }, agent.appToken).catch((err) => {
        log.error("Failed to send unregistered-user template", {
          error: errMsg(err),
        });
      });
    } else {
      log.info(`Ignoring ${eventType} — sender ${payload.userId} not registered in claw-auth`);
      res.json({ success: true });
    }
    return;
  }

  log.info(`${eventType} from user ${payload.userId} → agent ${agent.slug}`);

  // Acknowledge immediately
  res.json({ success: true });

  const userText = payload.cleanContent?.trim();
  if (!userText) return;
  // Commands whose leading slash is an execution contract in xyne-claw. Keep
  // them out of auto-goal/plan mode: both transforms strip or suspend the
  // command before the runtime can mount its command-owned tools.
  // cleanContent usually removes the bot mention, but some Spaces event
  // producers leave a leading "@Display Name" behind. Strip ONLY this agent's
  // own mention (exact display name, or slug as fallback). A generic
  // "@word word..." strip is unanchorable: word-classes can't tell display-name
  // tokens from the user's prose, so "@Bot how do I use /explainer" would lose
  // "how do I use" and force command mode on a question.
  const taskCommandText = stripLeadingAgentMention(userText, [agent.name, agent.slug]);
  // KEEP IN SYNC with TASK_COMMANDS in apps/xyne-claw/src/task-commands.ts —
  // a command missing here ships with the mention un-stripped, so claw never
  // sees it at byte zero and the whole contract silently degrades (bit /design
  // in prod 2026-08-08). Proper fix: shared registry in xyne-claw-shared.
  const immediateTaskCommand = /^\/(?:explainer|record-skill|design|dashboard|spec)(?:\s|$)/i.test(taskCommandText);
  const recordSkillCommand = /^\/record-skill(?:\s|$)/i.test(taskCommandText);
  if (!agent.orgId) {
    log.error(`Agent ${agent.slug} has no orgId; refusing webhook dispatch`);
    return;
  }

  // ── Auto-goal: when agent.config.autoGoal === true, every non-slash
  //   message is automatically wrapped as `/goal <text>` before parsing.
  //   The user can still send explicit `/stop` or `/goal status` controls
  //   — those start with `/` so they bypass the wrap and reach the normal
  //   parser unchanged. Failure to load the config is non-fatal: we just
  //   fall through to ordinary slash-command handling.
  let autoGoalEnabled = false;
  // Plan mode: when agent.config.planMode === true, non-twin thread mentions
  // start in plan mode (the agent proposes a plan and awaits approval before
  // executing). Read alongside autoGoal so it is visible where the
  // dispatchPayload + sessionContext are assembled below. Default OFF.
  let planModeEnabled = false;
  try {
    const cfgRow = await agentRepository.findBySlug(agent.slug, agent.orgId ?? undefined);
    autoGoalEnabled = ((cfgRow?.config ?? {}) as Record<string, unknown>)["autoGoal"] === true;
    planModeEnabled = ((cfgRow?.config ?? {}) as Record<string, unknown>)["planMode"] === true;
  } catch (err) {
    log.warn("autoGoal config lookup failed — treating as off", {
      error: errMsg(err),
    });
  }
  // ── /goal slash command interception ─────────────────────────────────────
  // Recognised forms: `/goal <condition>`, `/goal status`, `/goal clear`,
  // `/stop`. Status/clear short-circuit before claw is invoked; goal-start
  // rewrites the worker's first-turn task to the relooper template and
  // stashes context for subsequent loop turns (recording happens after
  // run-dispatch below, once dispatchPayload is assembled).
  //
  // Parse the RAW message first: an explicit control command anywhere in the
  // text (e.g. "@Agent /stop") must win over autoGoal. Only when the user
  // typed no command do we auto-wrap the message as a `/goal <text>` start.
  // Without this, autoGoal turns "/stop" into "/goal … /stop" (a new goal),
  // making the thread impossible to stop.
  const rawSlash = parseSlashCommand(userText);
  const slash =
    rawSlash ??
    (autoGoalEnabled && !immediateTaskCommand ? parseSlashCommand(`/goal ${userText}`) : null);
  const experimentCommand = parseExperimentCommand(userText);

  if (experimentCommand) {
    const postExperimentReply = (markdownText: string) => spacesAppFetch("/chat/postMessage", {
      channelId: payload.channelId,
      conversationId: payload.conversationId,
      markdownText,
      userId: agent.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, agent.appToken).catch((err) => {
      log.warn("Failed to post /experiment reply", { error: errMsg(err) });
    });

    if (experimentCommand.sub === "unknown") {
      await postExperimentReply([
        "/experiment <duration> [provider=…] [model=…] [focus…]",
        "/understanding [duration cap] [focus…] — coverage-gated: runs until the code-path frontier is exhausted",
        "/experiment status",
        "/experiment list",
        "/experiment findings [id]",
        "/experiment stop",
      ].join("\n"));
      return;
    }

    if (experimentCommand.sub === "status") {
      const run = await experimentRepository.findActiveByConversation(payload.conversationId);
      const findings = run ? await experimentRepository.listFindings(run.id) : [];
      await postExperimentReply(formatExperimentStatus(run, findings));
      return;
    }

    if (experimentCommand.sub === "stop") {
      const run = await experimentRepository.findActiveByConversation(payload.conversationId);
      if (!run) {
        await postExperimentReply("No active /experiment to stop.");
        return;
      }
      const allowed = run.userId === payload.userId || await isClawAdmin(payload.userId);
      if (!allowed) {
        await postExperimentReply("Only the requester or a claw admin can stop this /experiment.");
        return;
      }
      await experimentRepository.update(run.id, { status: "aborted", lastEpochEndedAt: new Date() });
      // Cancel in-flight CHECKER sessions too. They never claim
      // currentSessionId (claiming it would chain the next epoch off their
      // completion), so before this they survived stop and kept posting into
      // the thread after the run was already aborted.
      let cancelledCheckers = 0;
      for (const checkerSessionId of run.checkerSessionIds ?? []) {
        try {
          await cancelRunSession(checkerSessionId, run.userId);
          cancelledCheckers++;
        } catch {
          // Already finished or unknown to claw — nothing to cancel.
        }
      }
      let cancelledEpoch = false;
      if (run.currentSessionId) {
        try {
          await cancelRunSession(run.currentSessionId, run.userId);
          cancelledEpoch = true;
        } catch (err) {
          log.warn("[experiment] failed to cancel running epoch", {
            experimentId: run.id,
            sessionId: run.currentSessionId,
            error: errMsg(err),
          });
        }
      }
      const stoppedParts = [
        ...(cancelledEpoch ? ["cancelled the running epoch"] : []),
        ...(cancelledCheckers > 0 ? [`cancelled ${cancelledCheckers} checker run${cancelledCheckers === 1 ? "" : "s"}`] : []),
      ];
      await postExperimentReply(stoppedParts.length > 0
        ? `Stopped /experiment (${stoppedParts.join(", ")}).`
        : "Stopped /experiment.");
      return;
    }

    if (experimentCommand.sub === "list") {
      // Thread-scoped, no ownership gate — same visibility as /experiment
      // status. The run ids printed here are what `/experiment findings <id>`
      // takes, and THAT path does gate on owner/admin.
      const runs = await experimentRepository.listRecentByConversationWithFindingCounts(payload.conversationId, 15);
      if (runs.length === 0) {
        await postExperimentReply("No /experiment has run in this thread.");
        return;
      }
      const rows = runs.map((run) => {
        const started = run.createdAt.toISOString().slice(0, 16).replace("T", " ");
        const model = run.provider ? ` · ${formatExperimentModel(run.provider, run.modelId)}` : "";
        const live = run.status === "running" || run.status === "finishing" ? " ← active" : "";
        return `\`${run.id}\` — ${run.status}, ${run._count.findings} findings, epoch ${run.epoch}${model} · ${started}${live}`;
      });
      await postExperimentReply([
        `**/experiment list** — ${runs.length} run${runs.length === 1 ? "" : "s"} in this thread`,
        "",
        ...rows,
        "",
        "Pull any one with `/experiment findings <id>`.",
      ].join("\n"));
      return;
    }

    if (experimentCommand.sub === "findings") {
      const run = experimentCommand.id
        ? await experimentRepository.findById(experimentCommand.id)
        : await experimentRepository.findBestForFindings(payload.conversationId);
      if (!run) {
        await postExperimentReply(experimentCommand.id
          ? "Experiment not found."
          : "No /experiment has run in this thread.");
        return;
      }
      if (experimentCommand.id && run.userId !== payload.userId && !(await isClawAdmin(payload.userId))) {
        await postExperimentReply("Not your experiment.");
        return;
      }
      const [findings, reviews] = await Promise.all([
        experimentRepository.listFindings(run.id),
        experimentRepository.listReviews(run.id),
      ]);
      const recentRuns = await experimentRepository.listRecentByConversationWithFindingCounts(payload.conversationId);
      const counts = experimentCounts(findings);
      const summaryLines = [
        `**/experiment findings** — ${run.agentSlug}`,
        `Status: ${run.status} · Epoch: ${run.epoch} · Findings: ${counts.proved} proved, ${counts.conjecture} open, ${counts.refuted} refuted`,
      ];
      if (!experimentCommand.id && recentRuns[0] && recentRuns[0].id !== run.id) {
        summaryLines.push(`(showing experiment ${run.id} — the most recent run in this thread had no findings)`);
      }
      const otherRuns = recentRuns.filter((candidate) => candidate.id !== run.id).slice(0, 5);
      if (recentRuns.length > 1 && otherRuns.length > 0) {
        summaryLines.push(`Other runs in this thread: ${otherRuns.map((candidate) =>
          `${candidate.id} (${candidate.status}, ${candidate._count.findings} findings, ${candidate.createdAt.toISOString().slice(0, 10)})`
        ).join(" · ")}`);
      }
      const markdown = capExperimentFindingsMarkdown(buildFindingsMarkdown(run, findings, reviews));
      const filename = experimentFindingsFilename(run.agentSlug);

      // Prefer ONE zip laid out by epoch over a bare .md: the proof artifacts
      // are otherwise scattered across hours of thread messages, and a proof
      // you can't locate is a proof you don't have. Falls back to the markdown
      // when the thread has no attachments or Spaces is unreachable.
      let bundle: Awaited<ReturnType<typeof buildExperimentProofBundle>> = null;
      try {
        // Reads the thread's attachments as the REQUESTER, so the bundle can
        // never contain a file they couldn't already open in the thread.
        const bundleAuth = await resolveAuthForUser(payload.userId);
        if (!bundleAuth) {
          log.warn("[experiment] no Spaces credentials for requester; findings will be markdown-only", {
            userId: payload.userId,
          });
        } else {
          bundle = await buildExperimentProofBundle({
            run,
            findings,
            findingsMarkdown: markdown,
            conversationId: payload.conversationId,
            auth: bundleAuth,
          });
        }
      } catch (err) {
        log.warn("[experiment] proof bundle failed; falling back to markdown only", {
          error: errMsg(err),
        });
      }
      if (bundle) {
        summaryLines.push(
          `Proof bundle: ${bundle.includedCount} of ${bundle.entries.length} findings have their artifact attached` +
          (bundle.missingCount > 0 ? ` · ${bundle.missingCount} missing (see MANIFEST.md)` : "") +
          ` — organised by epoch inside the zip. The findings write-up is also attached as ${filename}.`,
        );
      }
      const summary = summaryLines.join("\n");
      try {
        await postGeneratedMarkdownFile({
          channelId: payload.channelId,
          conversationId: payload.conversationId,
          userId: agent.spacesAppUserId,
          appToken: agent.appToken,
          filename: bundle ? bundle.filename : filename,
          markdown: bundle ? bundle.buffer : markdown,
          ...(bundle ? { mimeType: "application/zip" } : {}),
          // Ship the readable findings .md alongside the zip. The zip is the
          // complete archive (proof artifacts organised by epoch), but nobody
          // wants to download-and-unzip just to read the write-up — so the
          // markdown rides the same message, exactly as it did before bundling.
          ...(bundle ? { extraFiles: [{ filename, content: markdown, mimeType: "text/markdown" }] } : {}),
          summary,
        });
      } catch (err) {
        log.warn("[experiment] findings file upload failed; posting inline fallback", {
          error: errMsg(err),
        });
        await postExperimentReply(`${summary}\n\n⚠️ _Couldn't attach ${bundle ? bundle.filename : filename} (upload failed); posting the markdown inline._\n\n${markdown}`);
      }
      return;
    }

    if (experimentCommand.invalidProvider !== undefined) {
      await postExperimentReply([
        `Invalid /experiment provider: ${experimentCommand.invalidProvider || "(empty)"}`,
        `Valid providers: ${Array.from(EXPERIMENT_PROVIDERS).join(", ")}`,
      ].join("\n"));
      return;
    }

    const existing = await experimentRepository.findActiveByConversation(payload.conversationId);
    if (existing) {
      await postExperimentReply("An active /experiment is already running in this thread. Use `/experiment status` or `/experiment stop`.");
      return;
    }
    const run = await experimentRepository.createRun({
      conversationId: payload.conversationId,
      channelId: payload.channelId,
      agentSlug: agent.slug,
      userId: payload.userId,
      orgId: agent.orgId,
      focus: experimentCommand.focus ?? null,
      provider: experimentCommand.provider ?? null,
      modelId: experimentCommand.model ?? null,
      kind: experimentCommand.kind ?? null,
      deadlineAt: new Date(Date.now() + experimentCommand.durationMs),
    });
    const isUnderstanding = experimentCommand.kind === "understanding";
    // Seed the frontier from a list the user already gave us (e.g. 57 table
    // names). Ground truth beats model enumeration: with the paths pre-recorded
    // the run cannot exit by imagining fewer of them.
    const seededPaths = isUnderstanding
      ? await seedUnderstandingFrontier(run.id, experimentCommand.focus).catch(() => 0)
      : 0;
    await postExperimentReply([
      isUnderstanding ? "**/understanding started**" : "**/experiment started**",
      isUnderstanding
        ? `Mode: coverage-gated understanding loop (ends when the code-path frontier is exhausted)`
        : `Mode: time-boxed autonomous exploration`,
      `${isUnderstanding ? "Safety cap" : "Duration"}: ${formatDuration(experimentCommand.durationMs)}`,
      ...(experimentCommand.provider ? [`Model: ${formatExperimentModel(experimentCommand.provider, experimentCommand.model)}`] : []),
      seededPaths > 0
        ? `Frontier: ${seededPaths} path(s) seeded from your list — the run ends when all of them are closed.`
        : `Focus: ${experimentCommand.focus?.trim() || "(none)"}`,
      // Never drop part of the user's scope in silence: the old cap cut a
      // 57-table list mid-word and the run explored a narrower scope than the
      // user believed they had asked for.
      ...(experimentCommand.droppedFocus
        ? [`⚠️ Focus was too long — this was NOT included: \`${experimentCommand.droppedFocus.slice(0, 400)}\`${experimentCommand.droppedFocus.length > 400 ? " …" : ""}\nStart a second run for the remainder, or shorten the focus.`]
        : []),
      `Use \`/experiment status\` to inspect progress.`,
    ].join("\n"));
    try {
      await dispatchExperimentEpoch(run);
    } catch (err) {
      // A silent failure here strands a zombie "active" run that blocks every
      // future /experiment in this thread. Abort it and tell the user why.
      const msg = errMsg(err);
      log.warn("[experiment] initial dispatch failed", { error: msg });
      await experimentRepository.update(run.id, { status: "aborted", lastEpochEndedAt: new Date() }).catch(() => undefined);
      await postExperimentReply(`⚠️ /experiment could not start: ${msg.slice(0, 300)}\nThe experiment was aborted — fix the issue and start again.`);
    }
    return;
  }

  // ── /queue ── show messages waiting behind the active run, then stop.
  if (slash?.kind === "queueShow") {
    const convId = payload.conversationId;
    const depth = convId ? await queueDepth(convId, agent.slug) : 0;
    const waiting = convId ? await peekQueue(convId, agent.slug) : [];
    const lines =
      depth === 0
        ? ["🕒 **Message queue** — empty. Nothing is waiting behind the current run."]
        : [
            `🕒 **Message queue** — ${depth} message${depth === 1 ? "" : "s"} waiting behind the active run:`,
            ...waiting.map((m, i) => {
              const preview = m.task.replace(/\s+/g, " ").slice(0, 80);
              return `${i + 1}. ${preview}${m.task.length > 80 ? "…" : ""}`;
            }),
          ];
    await spacesAppFetch("/chat/postMessage", {
      channelId: payload.channelId,
      conversationId: payload.conversationId,
      markdownText: lines.join("\n"),
      userId: agent.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, agent.appToken).catch((err) => {
      log.warn("Failed to post /queue reply", { error: errMsg(err) });
    });
    return;
  }

  // ── /help ── list the available slash commands, then stop.
  if (slash?.kind === "help") {
    await spacesAppFetch("/chat/postMessage", {
      channelId: payload.channelId,
      conversationId: payload.conversationId,
      markdownText: [
        // KEEP IN SYNC with what actually parses: parseSlashCommand (this
        // file's control commands), parseExperimentCommand (lib/experiment.ts)
        // and TASK_COMMANDS (apps/xyne-claw/src/task-commands.ts). Every entry
        // below is routable today; a command that works but is missing here is
        // a command nobody discovers — /design, /dashboard, /explainer and
        // /record-skill shipped unlisted for months.
        "**Slash commands**",
        "",
        "*Autonomy*",
        "- `/goal <condition>` — work autonomously until the condition is met · `/goal status`",
        "- `/experiment <duration> [provider=… model=…] [focus...]` — explore until the deadline",
        "- `/understanding [duration cap] [focus...]` — explain every path in scope; ends when the frontier is exhausted, not on the clock",
        "- `/experiment status` · `/experiment list` · `/experiment findings [id]` · `/experiment stop`",
        "",
        "*Producing something*",
        "- `/design <brief>` — design-studio run: produces a self-contained HTML artifact",
        "- `/dashboard <brief>` — live-data dashboard snapshot, refreshable on a schedule",
        "- `/explainer <topic>` — narrated explainer video",
        "- `/record-skill` — turn a recorded walkthrough into a reusable skill",
        "- `/spec <ticket>` — interview you, then write the specification onto the ticket",
        "",
        "*Controlling this thread*",
        "- `/stop` (or `/goal clear`) — stop the current run, drop queued messages, and clear any active goal",
        "- `/clear` — wipe this thread's context and start fresh",
        "- `/compact [focus]` — summarize & shrink the context, then continue",
        "- `/queue` — show messages waiting behind the current run · `/queue <message>` — run it after the current run without interrupting · `/queue clear` — drop waiting messages",
        "- `/upgrade [task]` — use the premium model for this conversation",
        "- `/fast [task]` / `/fast off` — fast mode: the agent calls tools directly instead of delegating to subagents (quicker for short asks; use normal mode for deep investigations)",
        "- `/help` — show this list",
      ].join("\n"),
      userId: agent.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, agent.appToken).catch((err) => {
      log.warn("Failed to post /help reply", { error: errMsg(err) });
    });
    return;
  }

  if (slash?.kind === "fastModeUsage") {
    await spacesAppFetch("/chat/postMessage", {
      channelId: payload.channelId,
      conversationId: payload.conversationId,
      markdownText: "Usage: `/fast` · `/fast off` · `/fast <task>` (turn on fast mode and run the task)",
      userId: agent.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, agent.appToken).catch((err) => {
      log.warn("Failed to post /fast reply", { error: errMsg(err) });
    });
    return;
  }

  if (slash?.kind === "fastMode") {
    // This slash handler runs only for normal mention/DM webhooks; scheduled
    // automation runs can only be detected here by their one-shot conversation id.
    const isAutomationThread = payload.conversationId?.startsWith("scheduled_") === true;
    let markdownText = isAutomationThread
      ? "⚡ `/fast` does not persist for scheduled/automation firings because each firing uses a new conversation. Set `fastMode: true` on the agent instead."
      : slash.enabled
        ? "⚡ fast mode on — tools load on demand, no subagent delegation."
        : "⚡ fast mode off — subagent delegation restored for the next run.";
    if (!isAutomationThread) {
      try {
        await setFastModeOverride(payload.conversationId, agent.slug, slash.enabled);
      } catch (err) {
        log.warn("Failed to set /fast override", { error: errMsg(err) });
        markdownText = "⚠️ couldn't persist fast mode — try again";
      }
    }
    await spacesAppFetch("/chat/postMessage", {
      channelId: payload.channelId,
      conversationId: payload.conversationId,
      markdownText,
      userId: agent.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, agent.appToken).catch((err) => {
      log.warn("Failed to post /fast reply", { error: errMsg(err) });
    });
    return;
  }

  // ── /clear ── wipe this thread's agent session in claw-pod, then ack and
  // stop. The agent forgets all prior context; the next message starts fresh.
  if (slash?.kind === "clear") {
    let cleared = false;
    try {
      const r = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/clear-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}) },
        body: JSON.stringify({ userId: payload.userId, conversationId: payload.conversationId, agentSlug: agent.slug }),
      });
      cleared = (r as unknown as { ok: boolean }).ok;
    } catch (err) {
      log.warn("Failed to clear claw session", { error: errMsg(err) });
    }
    await spacesAppFetch("/chat/postMessage", {
      channelId: payload.channelId,
      conversationId: payload.conversationId,
      markdownText: cleared
        ? "🧹 Cleared this thread's context — I'll start fresh on your next message."
        : "⚠️ Couldn't clear the conversation context. Please try again.",
      userId: agent.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, agent.appToken).catch((err) => {
      log.warn("Failed to post /clear reply", { error: errMsg(err) });
    });
    return;
  }

  // ── /queue clear ── drop the messages waiting behind the active run. Does
  // NOT stop the current run (that's /stop) — the active run keeps going and
  // will simply have nothing to drain when it finishes.
  if (slash?.kind === "queueClear") {
    const convId = payload.conversationId;
    const discarded = convId ? await clearQueue(convId, agent.slug) : 0;
    const reply =
      discarded > 0
        ? `🧹 Cleared the queue — dropped ${discarded} waiting message${discarded === 1 ? "" : "s"}. The current run continues.`
        : "The queue is already empty.";
    await spacesAppFetch("/chat/postMessage", {
      channelId: payload.channelId,
      conversationId: payload.conversationId,
      markdownText: reply,
      userId: agent.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, agent.appToken).catch((err) => {
      log.warn("Failed to post /queue clear reply", { error: errMsg(err) });
    });
    return;
  }

  // ── /stop (and /goal clear) ── halt EVERYTHING active in this thread: cancel
  // the in-flight run, drop queued messages, and clear any active goal. Queued
  // messages must go too — the cancel's failure result drains the queue
  // immediately, so keeping them would restart work the instant it stopped.
  // Any thread participant may stop (same permissive model as /goal clear).
  if (slash?.kind === "goalClear") {
    const convId = payload.conversationId;
    let goalWasActive = false;
    if (convId) {
      const g = await activeGoalRepository.findActiveByConversation(convId).catch(() => null);
      if (g) {
        goalWasActive = true;
        await activeGoalRepository.terminate(convId, "cancelled", "user_stopped").catch(() => {});
      }
    }
    const stopResult = convId
      ? await reconcileStoppedRuns(convId, agent.slug)
      : { stopped: 0, cleaned: 0, queued: 0, hadRunningRows: false };

    const parts: string[] = [];
    parts.push(`Stopped ${stopResult.stopped} running run${stopResult.stopped === 1 ? "" : "s"}`);
    parts.push(`cleaned ${stopResult.cleaned} stale run${stopResult.cleaned === 1 ? "" : "s"}`);
    parts.push(`dropped ${stopResult.queued} queued message${stopResult.queued === 1 ? "" : "s"}`);
    if (goalWasActive) parts.push("cleared the active /goal");
    const reply =
      stopResult.hadRunningRows || goalWasActive || stopResult.queued > 0
        ? `🛑 ${parts.join(" - ")}.`
        : "Nothing is currently running in this thread.";

    await spacesAppFetch("/chat/postMessage", {
      channelId: payload.channelId,
      conversationId: payload.conversationId,
      markdownText: reply,
      userId: agent.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, agent.appToken).catch((err) => {
      log.warn("Failed to post /stop reply", { error: errMsg(err) });
    });
    return;
  }

  // ── /compact ── compact (summarize) this thread's context before the run.
  // Not a short-circuit: it dispatches a normal turn with compactBeforeRun set,
  // so the agent compacts the resumed session and replies with a summary.
  const compactBeforeRun = slash?.kind === "compact";
  const explicitQueueOnly = slash?.kind === "queueAdd";

  // Only goal commands reach the goal relooper; stop/clear/compact are handled
  // here (goalClear was short-circuited above into the full /stop path).
  const goalCommand =
    slash && (slash.kind === "goalStart" || slash.kind === "goalStatus")
      ? slash
      : null;
  const intercept = await handleSlashCommandBeforeRun({ command: goalCommand, conversationId: payload.conversationId });
  let pendingGoalStart: { condition: string; providerOverride?: { provider: string; model?: string } } | null = null;
  let task: string;
  if (intercept.kind === "goalStatusReply" || intercept.kind === "goalCleared") {
    await spacesAppFetch("/chat/postMessage", {
      channelId: payload.channelId,
      conversationId: payload.conversationId,
      markdownText: intercept.replyToUser,
      userId: agent.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, agent.appToken).catch((err) => {
      log.warn("Failed to post /goal control reply", { error: errMsg(err) });
    });
    return;
  } else if (slash?.kind === "queueAdd") {
    // `/queue <message>` is an explicit opt-out from same-user interrupt-with-reply.
    // If a run is active the slot gate below will enqueue it without touching the
    // active run; if nothing is active we just run the message now.
    task = slash.message;
  } else if (compactBeforeRun) {
    // The run resumes the session, forces a compaction, and answers this task —
    // a short summary for the user while the context shrinks.
    task =
      slash?.kind === "compact" && slash.instructions
        ? `The user ran /compact. Summarize the conversation so far concisely, focusing on: ${slash.instructions}. Then we continue.`
        : "The user ran /compact. Give a concise summary of the conversation so far so we can continue with a smaller context.";
  } else if (intercept.kind === "goalStarted") {
    pendingGoalStart = {
      condition: intercept.condition,
      ...(intercept.providerOverride ? { providerOverride: intercept.providerOverride } : {}),
    };
    task = intercept.firstTurnTask;
    // Show "Starting /goal…" on the ephemeral progress spinner (same surface as
    // tool calls), not as a permanent chat message — the goal loop's meta lines
    // shouldn't clutter the thread. The terminal outcome stays a real message.
    await postGoalPhase(
      { conversationId: payload.conversationId, channelId: payload.channelId, agentSlug: agent.slug, spacesAppUserId: agent.spacesAppUserId, appToken: agent.appToken },
      intercept.replyToUser,
    );
  } else {
    task = immediateTaskCommand ? taskCommandText : userText;
  }

  // `/upgrade` — explicit user opt-in to the agent's premium provider for
  // this conversation. Not handled by parseSlashCommand (that's goal-only).
  // Two shapes:
  //   "/upgrade"        → flip the flag, post an ack, no run dispatch.
  //   "/upgrade <task>" → flip the flag AND dispatch the remainder with the
  //                       escalated provider in one shot.
  // The flag persists on SessionContext.escalatedProvider (Redis convKey
  // index) for the lifetime of the conversation. Resolution happens further
  // down in the dispatch block — this only records intent.
  //
  // Strip leading @mentions before matching — Spaces' cleanContent doesn't
  // always remove them, and the user typically writes "@Xyne Doctor /upgrade".
  // Mirrors LEADING_MENTIONS in parseSlashCommand.ts so display names with
  // spaces ("@Xyne Doctor") match the same way as the /goal parser.
  const LEADING_MENTIONS_RE = /^(?:@[\w.\-]+(?:\s+[\w.\-]+)*\s*)+/;
  const taskWithoutMentions = task.replace(LEADING_MENTIONS_RE, "");
  const UPGRADE_RE = /^\s*\/upgrade(?:\s+([\s\S]+))?\s*$/i;
  const upgradeMatch = UPGRADE_RE.exec(taskWithoutMentions);
  const userRequestedUpgrade = upgradeMatch !== null;
  if (userRequestedUpgrade) {
    task = upgradeMatch[1]?.trim() ?? "";
  }

  // `/fast <task>` — enable fast mode AND dispatch the remainder in one shot,
  // mirroring `/upgrade <task>`. Bare `/fast`, `/fast on|off`, and on/off
  // typos were already handled (ack-only) by the parseSlashCommand branch
  // above, so only the with-task shape reaches this regex. `/fast off <task>`
  // disables fast mode and still runs the task.
  const FAST_TASK_RE = /^\s*\/fast\s+([\s\S]+?)\s*$/i;
  const fastTaskMatch = FAST_TASK_RE.exec(taskWithoutMentions);
  if (fastTaskMatch) {
    let rest = fastTaskMatch[1]!.trim();
    let fastEnable = true;
    if (/^off\b/i.test(rest)) {
      fastEnable = false;
      rest = rest.replace(/^off\b/i, "").trim();
    }
    task = rest;
    if (payload.conversationId) {
      try {
        await setFastModeOverride(payload.conversationId, agent.slug, fastEnable);
      } catch (err) {
        // Run the task anyway — resolveFastMode falls back to agent config.
        log.warn("Failed to set /fast override for /fast <task>", { error: errMsg(err) });
      }
    }
  }

  // For USER_MENTIONED: run as the mentioned user (their tools, their twin).
  const allMentionedIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];
  const targetUserId = eventType === "USER_MENTIONED" && allMentionedIds.length > 0
    ? allMentionedIds[0]! : payload.userId;

  // Twin dispatch uses the agent selected by the /webhook/digital-twin route.
  const runAgentSlug = agent.slug;
  if (runAsTwin) {
    log.info(`USER_MENTIONED Twin dispatch — running ${agent.slug} (webhook /${agentSlugFromUrl})`);
  }

  // Mid-run message-queue slot ownership token for this dispatch. Declared at
  // function scope so both the try body (acquire) and the catch (dispatch-error
  // drain) can release owner-checked. null until/unless we acquire the slot.
  let slotToken: string | null = null;

  // Claim the conversation slot before slow provider/history/attachment setup.
  // Bare `/upgrade` is an ack-only command, so it must not reserve a run slot.
  if (QUEUE_ENABLED && eventType !== "USER_MENTIONED" && payload.conversationId && task) {
    const slot = await tryAcquireSlot(payload.conversationId, runAgentSlug, undefined, targetUserId);
    slotToken = slot;
    if (!slot) {
      const slotOwner = await getSlotOwner(payload.conversationId, runAgentSlug).catch(() => null);
      const activeRunToInterrupt =
        !explicitQueueOnly && slotOwner?.sessionId
          ? { sessionId: slotOwner.sessionId, ownerUserId: slotOwner.userId }
          : null;
      const queuedMsg: QueuedMessage = {
        eventId: (payload as { messageId?: string }).messageId ?? traceId,
        conversationId: payload.conversationId,
        channelId: payload.channelId,
        ...(payload.channelName ? { channelName: payload.channelName } : {}),
        userId: targetUserId,
        ...(payload.senderName ? { senderName: payload.senderName } : {}),
        agentSlug: runAgentSlug,
        orgId: agent.orgId,
        task,
        eventType,
        queueReason: activeRunToInterrupt ? "interrupt_followup" : explicitQueueOnly ? "explicit_queue" : "busy",
        interruptMode: activeRunToInterrupt ? "interrupt_with_reply" : "queue_only",
        ts: Date.now(),
      };
      const enq = await enqueueMessage(queuedMsg);
      let interruptRequested = false;
      if (enq.enqueued && activeRunToInterrupt) {
        try {
          const interruptRes = await fetch(
            `${CONFIG.internalUrl}/claw/api/v1/internal/run/${encodeURIComponent(activeRunToInterrupt.sessionId)}/interrupt-with-reply`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
                "x-user-id": targetUserId,
              },
            },
          );
          interruptRequested = interruptRes.ok;
          if (!interruptRes.ok) {
            const body = await interruptRes.text().catch(() => "");
            log.warn(`[msg-queue] interrupt-with-reply rejected session=${activeRunToInterrupt.sessionId} owner=${activeRunToInterrupt.ownerUserId ?? "?"} by=${targetUserId} status=${interruptRes.status} body=${body.slice(0, 200)}`);
          }
        } catch (err) {
          log.warn("Failed to request interrupt-with-reply", { error: errMsg(err) });
        }
      }
      const notice = activeRunToInterrupt && interruptRequested
        ? `⏸️ I’ll wrap up my current reply first, then continue with your new message.`
        : enq.enqueued
          ? explicitQueueOnly
            ? `🕒 Queued after the current run (position ${enq.position}).`
            : `🕒 I’m still working on your previous message — this one is queued (position ${enq.position}). I’ll get to it as soon as I’m done.`
          : enq.deduped
            ? `🕒 Already queued — I’ll get to it as soon as I’m done with the current one.`
            : enq.full
              ? `⚠️ I’m still working and this thread’s queue is full (${QUEUE_CAP}). Please resend once I’ve caught up.`
              : `⚠️ I’m still working on your previous message and couldn’t queue this one. Please resend in a moment.`;
      await spacesAppFetch("/chat/postMessage", {
        channelId: payload.channelId,
        conversationId: payload.conversationId,
        markdownText: notice,
        userId: agent.spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      }, agent.appToken).catch((err) => {
        log.warn("Failed to post queue notice", { error: errMsg(err) });
      });
      log.info(`[msg-queue] conv ${payload.conversationId} busy — queued eventId=${queuedMsg.eventId} reason=${queuedMsg.queueReason} interruptRequested=${interruptRequested} (enqueued=${enq.enqueued} pos=${enq.position} deduped=${enq.deduped} full=${enq.full})`);
      return;
    }
  }

  try {
    // Fetch thread history to give the agent context (exclude own messages to avoid duplication on resume)
    const history = await fetchConversationHistory(payload.conversationId, agent.appToken, agent.spacesAppUserId);

    // Resolve agent config (skills) — shared across every dispatched target.
    const agentRow = await agentRepository.findBySlugWithRelations(agent.slug, agent.orgId ?? undefined);
    // Forward each skill's attached files (e.g. cam-templates/template.pdf)
    // alongside SKILL.md content. Without `files`, fill-pdf-form &
    // inspect-pdf-form get ENOENT because session-skills.ts has nothing to
    // materialize. Files arrive as base64 in SkillFile.content for binary
    // contentTypes; session-skills.ts handles the decode on disk write.
    const agentSkills = agentRow?.skills?.map((s) => ({
      name: s.skill.name,
      content: s.skill.content,
      ...(s.skill.files && s.skill.files.length > 0
        ? {
            files: s.skill.files.map((f) => ({
              relativePath: f.relativePath,
              content: f.content,
              ...(f.contentType ? { contentType: f.contentType } : {}),
            })),
          }
        : {}),
    }));

    // Per-target dispatch unit. Runs provider resolution against the TARGET
    // user's own credentials, downloads attachments, fires /run, and registers
    // the session + run-recovery. Called ONCE for conversation-mode events (as
    // the sender), or ONCE PER eligible mentioned user for the Digital Twin
    // (each gets a private claw session via buildSandboxStoreKey + a per-user
    // conv index). Every per-user local (provider resolution, escalation, /run,
    // setSession) lives INSIDE so two twins in one thread never share state.
    const dispatchRunForTarget = async (
      targetUserId: string,
      twinWorkspaceId: string | undefined,
    ): Promise<void> => {

    // Per-agent: which provider to use as the parent agent LLM.
    // "spaces" is the LiteLLM/Kimi platform sentinel, not a personal credential
    // choice — historically the GET /user-config endpoint returned `"spaces"`
    // as a default-display value, which led users to "Save" it and pin it as
    // an override that blocked agent-level providerOrder. Treat it as "no
    // personal preference" so the resolver falls through to the agent-level
    // chain. Only truthy non-"spaces" picks (codex/claude/copilot/openrouter)
    // count as a real personal override.
    const userAgentConfig = agent.orgId
      ? await userAgentConfigRepository.findByUserAndAgent(targetUserId, agent.orgId, agent.slug).catch(() => null)
      : null;
    const rawPersonalProvider = userAgentConfig?.provider;
    const selectedPersonalProvider = rawPersonalProvider && rawPersonalProvider !== "spaces"
      ? rawPersonalProvider
      : undefined;
    const personalProvider = isLocalHarnessProvider(selectedPersonalProvider)
      ? undefined
      : selectedPersonalProvider;

    // Agent-level fallback: shared keys the agent's owner/admin configured.
    // Anurag's framing: "If someone configures codex at xyne doctor level then
    // if quota is there it will use codex … If user has there own provider
    // that will take preference." Resolution chain becomes:
    //   1. personal provider (user picked in agent settings + has own creds)
    //   2. agent-level provider (agent.config.provider + agentProviderCredentials)
    //   3. "spaces" / LiteLLM platform default
    // Agent-default fast mode may resolve against its own provider profile
    // (config.fastModeProfile) — see lib/agent-provider-config.ts.
    const mentionSpeed = agentDefaultSpeed(agentRow?.config);
    const mentionSpeedConfig = providerConfigForSpeed(agentRow?.config, mentionSpeed);
    const agentLevelProvider = mentionSpeedConfig["provider"] as string | undefined;
    // Owners can also pin an ordered preference list under config.providerOrder.
    // We use it (a) to pick which agent-level provider to bind as the parent
    // model, and (b) to thread the full fallback chain into the runtime so
    // claw can walk it on quota exhaustion instead of dropping straight to
    // LiteLLM. Validation: keep only known provider strings.
    const rawProviderOrder = mentionSpeedConfig["providerOrder"];
    const agentProviderOrder: string[] = Array.isArray(rawProviderOrder)
      ? rawProviderOrder.filter((p): p is string => typeof p === "string" && KNOWN_PROVIDERS.has(p))
      : [];
    const userProvider = personalProvider ?? agentLevelProvider;

    // User-level: all provider credentials (copilot/claude) owned by this user
    const allCreds = await userProviderCredentialsRepository.listByUser(targetUserId).catch(() => []);
    const credsByProvider = new Map(allCreds.map((c) => [c.provider, c] as const));

    // Agent-level: all provider credentials configured on the agent itself
    const agentCreds = agentRow?.id
      ? await agentProviderCredentialsRepository.listByAgent(agentRow.id).catch(() => [])
      : [];
    const agentCredsByProvider = new Map(agentCreds.map((c) => [c.provider, c] as const));

    // User-level: per-subagent provider routing overrides
    const subagentConfigs = await userSubagentConfigRepository.listByUser(targetUserId).catch(() => []);
    const subagentProviders: Record<string, string> = {};
    for (const s of subagentConfigs) subagentProviders[s.subagentName] = s.provider;

    // Agent-level: default provider for subagents WITHOUT an explicit override
    // above — "parent" (inherit the parent's provider, legacy default) or
    // "spaces" (run subagents on the Spaces platform default). See
    // resolveSubagentProviderMode. The runtime applies this only to subagents not
    // present in `subagentProviders`.
    const subagentProviderMode = resolveSubagentProviderMode(agentRow?.config);

    // buildProviderConfig + KNOWN_PROVIDERS come from the shared resolver module
    // (lib/agent-provider-config.ts) — one source of truth for the per-provider
    // default models + OAuth-bundle extraction, so adding a provider is a
    // one-place change (these inline copies used to drift).

    // Build providerConfigs.
    //
    // Normally the user's personal credentials take preference, and agent-level
    // creds fill any gaps. BUT if the user has explicitly picked "spaces" for
    // this agent, they're opting OUT of their personal providers and deferring
    // to the agent's configuration ENTIRELY — keys included. In that case we
    // skip the user-level credential preference so the resolved (agent-level)
    // provider runs on the AGENT's credentials, not the user's. Without this, a
    // user who picked "spaces" but happens to have a personal codex key would
    // still silently run on their own codex instead of the agent's.
    const userDeferredToAgent = rawPersonalProvider === "spaces";
    const providerConfigs: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string; reasoningEffort?: string }> = {};
    const providerScope: Record<string, "user" | "agent"> = {};
    if (!userDeferredToAgent) {
      for (const [provider, row] of credsByProvider) {
        const cfg = buildProviderConfig(provider, row);
        if (cfg) {
          providerConfigs[provider] = cfg;
          providerScope[provider] = "user";
        }
      }
    }
    for (const [provider, row] of agentCredsByProvider) {
      if (providerConfigs[provider]) continue; // user has personal — keep theirs
      const cfg = buildProviderConfig(provider, row);
      if (cfg) {
        providerConfigs[provider] = cfg;
        providerScope[provider] = "agent";
      }
    }
    applyFastModeModels(providerConfigs, agentRow?.config, mentionSpeed);

    // Refresh the Claude OAuth token before use — it's short-lived. Codex
    // already stores+refreshes a bundle; Claude historically stored a raw token
    // that simply expired → 401 → silent Spaces fallback. getValidClaudeBearer
    // refreshes (when expired) and persists the rotated token back to the
    // owning cred row, returning a fresh bearer. Bare-token / api_key creds and
    // not-yet-expired tokens pass through unchanged (no network call).
    const claudeCfg = providerConfigs["claude"];
    if (claudeCfg && claudeCfg.authType === "oauth_token") {
      const scope = providerScope["claude"];
      const credRow = scope === "agent" ? agentCredsByProvider.get("claude") : credsByProvider.get("claude");
      const ownerId = scope === "agent" ? agentRow?.id : targetUserId;
      if (credRow && ownerId) {
        // Rows in EITHER scope may be BINDINGS to a shared org credential —
        // the refresh must then single-flight + persist against the shared
        // row (one live OAuth session across every binding), not the copy.
        const target = scope === "agent" && agentRow?.id
          ? agentCredRefreshTarget(agentRow.id, "claude", credRow as { sharedCredentialId?: string | null })
          : userCredRefreshTarget(targetUserId, "claude", credRow as { sharedCredentialId?: string | null });
        try {
          claudeCfg.apiKey = await getValidClaudeBearer(target.credKey, credRow, target.persist);
        } catch (err) {
          // Refresh failed (expired + no/invalid refresh token). Leave the stale
          // token; the run will 401 and surface via the error path. Logged so
          // it's visible rather than a mystery empty-completion.
          log.warn("Claude OAuth refresh failed — credential likely needs reconnect", {
            scope,
            error: errMsg(err),
          });
        }
      }
    }

    // Refresh the Codex OAuth token before use — same shape as Claude above.
    // Codex stores a {access_token, refresh_token, expires_at} bundle but
    // historically NOTHING refreshed it: the access token simply expired → 401
    // "authentication token is expired" → always-on codex agents (and their
    // codex-inheriting subagents) failed until a manual reconnect.
    // getValidCodexBearer refreshes (when expired) via the stored refresh_token
    // and persists the rotated bundle. api_key creds / not-yet-expired tokens
    // pass through unchanged (no network call).
    const codexCfg = providerConfigs["codex"];
    if (codexCfg && codexCfg.authType === "oauth_token") {
      const scope = providerScope["codex"];
      const credRow = scope === "agent" ? agentCredsByProvider.get("codex") : credsByProvider.get("codex");
      const ownerId = scope === "agent" ? agentRow?.id : targetUserId;
      if (credRow && ownerId) {
        // Same shared-binding awareness as the Claude block above.
        const target = scope === "agent" && agentRow?.id
          ? agentCredRefreshTarget(agentRow.id, "codex", credRow as { sharedCredentialId?: string | null })
          : userCredRefreshTarget(targetUserId, "codex", credRow as { sharedCredentialId?: string | null });
        try {
          codexCfg.apiKey = await getValidCodexBearer(target.credKey, credRow, target.persist);
        } catch (err) {
          // Refresh failed (expired + no/invalid refresh token). Leave the stale
          // token; the run will 401 and surface via the error path. Logged so
          // it's visible rather than a mystery empty-completion.
          log.warn("Codex OAuth refresh failed — credential likely needs reconnect", {
            scope,
            error: errMsg(err),
          });
        }
      }
    }

    // Resolution chain — kimi-first, agent-level providers are escalation-only.
    //
    // Order:
    //   1. Personal provider — user's own paid creds always win when configured.
    //   2. Conversation-scoped escalation — set by an earlier accepted FlowUI
    //      promote-provider prompt or by `/upgrade` in the user's message.
    //      Once set on SessionContext (convKey index), all subsequent turns
    //      in the same conversation use the escalated provider directly.
    //   3. Undefined → claw falls through to spaces/LiteLLM (Kimi) default.
    //
    // Agent-level providers (agent.config.provider + agentProviderCredentials)
    // are NO LONGER consulted as a default. They are the escalation pool only:
    // — `escalationCandidate` (below) names the first one with resolved creds,
    //   used to drive `/upgrade` and the failure-prompt's "Retry with X?" copy.
    // — Their creds stay in `providerConfigs` so claw can use them when the
    //   resolver picks one via escalation; runtimeProviderOrder gates which
    //   ones claw is allowed to walk on quota exhaustion.
    //
    // Key invariant unchanged: we never promote a provider that lacks creds.
    const priorSession = payload.conversationId
      ? await getSessionByConv(payload.conversationId, agent.slug, targetUserId).catch(() => null)
      : null;
    const priorEscalation = priorSession?.escalatedProvider;

    // First agent-level provider with resolved creds — the candidate for both
    // `/upgrade` (auto-accept) and the failure-prompt (named in the question).
    const escalationCandidate: string | undefined =
      agentProviderOrder.find((p) => providerConfigs[p] && providerScope[p] === "agent")
      ?? (agentLevelProvider && providerConfigs[agentLevelProvider] && providerScope[agentLevelProvider] === "agent"
          ? agentLevelProvider
          : undefined);

    let escalatedProvider: string | undefined;
    if (priorEscalation && providerConfigs[priorEscalation]) {
      escalatedProvider = priorEscalation;
    } else if (userRequestedUpgrade && escalationCandidate) {
      escalatedProvider = escalationCandidate;
    }

    // Per-agent policy switch:
    //   `agent.config.providerAlwaysOn === false` → kimi-first / escalate-on-demand
    //                                                (the new flow above).
    //   anything else (true or undefined)        → agent-first resolution
    //                                                (the legacy behavior; backfill
    //                                                default so existing agents
    //                                                keep working exactly as they
    //                                                used to until an owner opts
    //                                                in to the new flow).
    const providerAlwaysOnRaw = (agentRow?.config as Record<string, unknown> | null)?.["providerAlwaysOn"];
    const providerAlwaysOn = providerAlwaysOnRaw !== false;

    let resolvedParentProvider: string | undefined;
    let runtimeProviderOrder: string[];

    if (providerAlwaysOn) {
      // Legacy "always on" — agent's configured provider wins by default.
      // Identical to the pre-feature resolution: providerOrder → legacy
      // agent.config.provider → personal (tiebreaker) → any-with-creds.
      if (agentProviderOrder.length > 0) {
        resolvedParentProvider = agentProviderOrder.find((p) => providerConfigs[p]);
      }
      if (!resolvedParentProvider && agentLevelProvider && providerConfigs[agentLevelProvider]) {
        resolvedParentProvider = agentLevelProvider;
      }
      if (!resolvedParentProvider && personalProvider && providerConfigs[personalProvider]) {
        resolvedParentProvider = personalProvider;
      }
      if (!resolvedParentProvider) {
        const available = Object.keys(providerConfigs);
        if (available.length > 0) resolvedParentProvider = available[0];
      }
      runtimeProviderOrder = agentProviderOrder.length > 0
        ? agentProviderOrder
        : (resolvedParentProvider ? [resolvedParentProvider] : []);
    } else {
      // Kimi-first / escalate-on-demand — see comment block above the chain.
      if (personalProvider && providerConfigs[personalProvider]) {
        resolvedParentProvider = personalProvider;
      }
      if (!resolvedParentProvider && escalatedProvider) {
        resolvedParentProvider = escalatedProvider;
      }
      // No further fallback — leave undefined so claw uses spaces/LiteLLM.
      runtimeProviderOrder = resolvedParentProvider ? [resolvedParentProvider] : [];
    }

    log.info(`Provider resolution: mode=${providerAlwaysOn ? "always-on" : "kimi-first"} parent=${resolvedParentProvider ?? "spaces"} scope=${resolvedParentProvider ? (providerScope[resolvedParentProvider] ?? "fallback") : "platform"} creds=[${Object.keys(providerConfigs).join(",")}] order=[${runtimeProviderOrder.join(",")}] escalated=${escalatedProvider ?? "(none)"} userUpgrade=${userRequestedUpgrade} subagentOverrides=${JSON.stringify(subagentProviders)} subagentProviderMode=${subagentProviderMode}`);

    // Handle bare `/upgrade` (no task remainder). We just need to flip the
    // conversation flag and ack the user; no run to dispatch.
    if (userRequestedUpgrade && !task) {
      // In always-on mode the agent provider is already the default — /upgrade
      // is a no-op. Tell the user instead of silently flipping a flag that
      // wouldn't change anything.
      if (providerAlwaysOn) {
        await spacesAppFetch("/chat/postMessage", {
          channelId: payload.channelId,
          conversationId: payload.conversationId,
          markdownText: escalationCandidate
            ? `✓ Already using **${escalationCandidate}** by default for this agent (always-on is enabled).`
            : "✓ No premium provider is configured, and always-on is enabled — there's nothing to switch to.",
          userId: agent.spacesAppUserId,
          metadata: { contentFormat: "markdown" },
        }, agent.appToken).catch(() => {});
        return;
      }
      if (escalatedProvider) {
        // Persist the flag on the convKey index so the NEXT message in this
        // conversation picks it up via the resolution chain above.
        // setSession writes both the per-session AND per-conv indexes; the
        // session: key is irrelevant here but harmless (TTLs out in 24h).
        const ackSessionId = `upgrade-ack-${createTraceId()}`;
          const ackContext: SessionContext = {
            mentionedUserId: agent.spacesAppUserId,
            senderId: payload.userId,
          senderName: payload.senderName ?? payload.userId,
          channelId: payload.channelId,
          channelName: payload.channelName ?? payload.channelId,
            conversationId: payload.conversationId,
            task: "/upgrade",
            agentId: agent.id,
            agentOrgId: agent.orgId,
            agentSlug: agent.slug,
          responseMode: "conversation",
          appToken: agent.appToken,
          spacesAppId: agent.spacesAppId,
          spacesAppUserId: agent.spacesAppUserId,
          traceId,
          rootAgentSlug: agent.slug,
          triggerSource: "spaces",
          escalatedProvider,
          // Preserve other prior-session fields where helpful.
          ...(priorSession?.workflowId ? { workflowId: priorSession.workflowId } : {}),
        };
        await setSession(ackSessionId, ackContext);
        await spacesAppFetch("/chat/postMessage", {
          channelId: payload.channelId,
          conversationId: payload.conversationId,
          markdownText: `✅ Upgraded to **${escalatedProvider}** for this conversation. Send your next message and I'll use it.`,
          userId: agent.spacesAppUserId,
          metadata: { contentFormat: "markdown" },
        }, agent.appToken).catch((err) => {
          log.warn("Failed to post /upgrade ack", { error: errMsg(err) });
        });
        log.info(`/upgrade flipped escalation to ${escalatedProvider} for conv ${payload.conversationId}`);
      } else {
        await spacesAppFetch("/chat/postMessage", {
          channelId: payload.channelId,
          conversationId: payload.conversationId,
          markdownText: "⚠️ No premium provider configured for this agent. Ask an admin to add one in the agent's Provider Credentials.",
          userId: agent.spacesAppUserId,
          metadata: { contentFormat: "markdown" },
        }, agent.appToken).catch(() => {});
        log.info(`/upgrade requested but no escalationCandidate available for agent ${agent.slug}`);
      }
      return;
    }

    // Download image attachments from Spaces (if any) to pass to the agent.
    // Spaces' attachment routes use user-session auth and reject app tokens
    // (HTTP 401), so we use the *sender's* xyne-spaces MCP token (stored
    // encrypted in userMcpConnection by users.ts:autoConfigureSpaces). That
    // token authenticates as the actual user who sent the message.
    //
    // Source order:
    //   1. Direct fetch of `att.fileUrl` (signed/public URL — no auth)
    //   2. Spaces user-session route with the sender's MCP token
    //   3. Spaces apps-route with agent appToken (last resort)
    let userSpacesToken: string | undefined;
    let userSpacesSessionId: string | undefined;
    let userSpacesWorkspaceId: string | undefined;
    // Prefer a live read from the Spaces DB (always fresh). Falls back to the
    // cached userMcpConnection copy when SPACES_DB_URL is unset or the user
    // has no active session row.
    const liveSpaces = await getSpacesAuthForUser(payload.userId, "webhook");
    if (liveSpaces) {
      userSpacesToken = liveSpaces.token;
      userSpacesSessionId = liveSpaces.sessionId;
      userSpacesWorkspaceId = liveSpaces.workspaceId;
      log.info(`Resolved Spaces creds from live DB for user ${payload.userId} workspaceId=${liveSpaces.workspaceId}`);
    } else {
      try {
        const conn = await prisma.userMcpConnection.findFirst({
          where: { userId: payload.userId, mcpServer: { type: "xyne-spaces" } },
        });
        if (conn) {
          const decrypted = decrypt(conn.encryptedCreds, conn.iv, conn.authTag, CONFIG.encryptionKey);
          const parsed = JSON.parse(decrypted) as { token?: string; sessionId?: string; workspaceId?: string };
          if (parsed.token) userSpacesToken = parsed.token;
          if (parsed.sessionId) userSpacesSessionId = parsed.sessionId;
          if (parsed.workspaceId) userSpacesWorkspaceId = parsed.workspaceId;
        }
      } catch (err) {
        log.warn(`Failed to load user Spaces token for ${payload.userId}: ${errMsg(err)}`);
      }
    }
    if (userSpacesToken && !userSpacesWorkspaceId) {
      const workspaceId = await getWorkspaceIdForUser(payload.userId, "webhook").catch(() => null);
      if (workspaceId) {
        userSpacesWorkspaceId = workspaceId;
        log.info(`Resolved Spaces workspaceId=${workspaceId} from user row for cached webhook auth user ${payload.userId}`);
      }
    }

    // Spaces auth middleware (backend/src/middleware/auth.ts) needs the JWT
    // AND a session cookie to silently refresh expired JWTs. Pure Bearer-only
    // 401s the moment the JWT TTL elapses. We cover all three cookie name
    // aliases (legacy + workspace + V2) so any of Spaces' middleware variants
    // can find what it needs.
    const userCookieParts: string[] = [];
    if (userSpacesToken) {
      userCookieParts.push(`google_access_token=${userSpacesToken}`);
    }
    if (userSpacesSessionId) {
      userCookieParts.push(`user_session_id=${userSpacesSessionId}`);
      userCookieParts.push(`xyne_session=${userSpacesSessionId}`);
    }
    if (userSpacesWorkspaceId) userCookieParts.push(`xyne_last_workspace=${userSpacesWorkspaceId}`);
    const userCookieHeader = userCookieParts.length > 0 ? userCookieParts.join("; ") : undefined;

    const inboundAttachments: Array<{ fileName: string; mimeType: string; data: string }> = [];
    // Large /record-skill videos travel as authenticated references. The
    // internal /run proxy binds these to its newly minted session; xyne-claw
    // later streams the bytes through claw-auth into the sandbox in bounded
    // chunks. Never base64 a screen recording into the 50 MB JSON body.
    const inboundRecordingRefs: Array<{
      attachmentId: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
    }> = [];
    // Mime allow-list for what xyne-claw's /run can consume. Must stay in
    // sync with TEXT_ATTACHMENT_MIME_TYPES / TEXT_ATTACHMENT_EXTENSIONS and
    // the xlsx/pdf detectors in xyne-claw/src/routes/run.ts — claw-auth
    // filters here, claw filters again on receipt; both lists must agree.
    //   image/*               → passed to LLM as ImageContent
    //   text/* + structured   → written to .context/<file>, agent reads via Read tool
    //   application/pdf       → server-side text-extracted via unpdf, written as <file>.md
    const isAllowedAttachment = (att: WebhookAttachment): boolean => {
      const mime = att.mimeType?.toLowerCase() ?? "";
      if (mime.startsWith("image/")) return true;
      // Video — extracted to a frame-by-frame narrative + keyframes by
      // videoBufferToContext in xyne-claw/src/video-attachment.ts before the
      // agent sees it (the model can't ingest video, only frames).
      if (mime.startsWith("video/")) return true;
      if (mime === "text/plain" || mime === "text/markdown") return true;
      if (mime === "application/json" || mime === "text/csv") return true;
      if (mime === "application/yaml" || mime === "text/yaml") return true;
      if (mime === "application/xml" || mime === "text/xml") return true;
      // HTML — written verbatim to .context/<file>.html so the model can
      // reason about structure inline (no DOM stripping). See html-attachment.ts.
      if (mime === "text/html" || mime === "application/xhtml+xml") return true;
      if (mime === "application/pdf") return true;
      // xlsx / xlsm — extracted to multi-sheet markdown by xlsxBufferToMarkdown
      // in xyne-claw/src/xlsx-attachment.ts before the agent sees it.
      if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return true;
      if (mime === "application/vnd.ms-excel.sheet.macroenabled.12") return true;
      // docx / pptx — converted to markdown by mammoth / JSZip+XML parsing.
      if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true;
      if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return true;
      // ZIP — unzipped server-side; each entry routes through the same
      // per-type pipeline. Nested zips are skipped (logged in manifest).
      // See xyne-claw/src/zip-attachment.ts for safety caps (200 entries,
      // 50 MB/entry, 200 MB total).
      if (mime === "application/zip" || mime === "application/x-zip-compressed" || mime === "application/x-zip") return true;
      // Extension fallback for clients that send octet-stream / no mimetype.
      const lowerName = att.fileName?.toLowerCase() ?? "";
      if (/\.(txt|md|json|csv|yml|yaml|xml|log|pdf|xlsx|xlsm|docx|pptx|html|htm|xhtml|zip)$/.test(lowerName)) return true;
      if (/\.(mov|mp4|m4v|webm|avi|mkv|mpg|mpeg|wmv|flv)$/.test(lowerName)) return true;
      return false;
    };
    if (payload.attachments?.length) {
      for (const att of payload.attachments) {
        if (!isAllowedAttachment(att)) {
          log.warn(
            `Skipping attachment ${att.attachmentId} (${att.fileName}, ${att.mimeType}) — not in claw-auth allow-list. Update isAllowedAttachment in webhook.ts.`,
          );
          continue;
        }
        const videoExtMatch = /\.(mov|mp4|m4v|webm|avi|mkv|mpg|mpeg|wmv|flv)$/i.exec(att.fileName ?? "");
        const isVideoRecording = att.mimeType?.toLowerCase().startsWith("video/") || videoExtMatch !== null;
        if (recordSkillCommand && isVideoRecording) {
          // A dropped recording must TELL the user — a /record-skill run that
          // silently loses its video still force-mounts analyze-skill-recording
          // and pressures the model to draft a skill from nothing.
          const notifyRecordingDropped = (reason: string) => {
            log.warn(`Skipping /record-skill recording ${att.attachmentId} (${att.fileName}) — ${reason}`);
            if (!payload.conversationId) return;
            void spacesAppFetch("/chat/postMessage", {
              channelId: payload.channelId,
              conversationId: payload.conversationId,
              markdownText: `⚠️ Recording **${att.fileName ?? att.attachmentId}** was skipped: ${reason}. The run will continue without it.`,
              userId: agent.spacesAppUserId,
              metadata: { contentFormat: "markdown" },
            }, agent.appToken).catch(() => {});
          };
          const fileSize = Number(att.fileSize);
          if (!Number.isFinite(fileSize) || fileSize <= 0) {
            notifyRecordingDropped("its size was not reported by the upload — please re-upload it");
            continue;
          }
          if (fileSize > 1024 * 1024 * 1024) {
            notifyRecordingDropped("it exceeds the 1 GB recording limit");
            continue;
          }
          // claw-auth's /run consumer validates each ref strictly; normalize
          // HERE (the producer) so a client that stored a .mov as
          // application/octet-stream doesn't get rejected downstream.
          if (inboundRecordingRefs.length >= 4) {
            notifyRecordingDropped("at most 4 recordings are analyzed per run");
            continue;
          }
          const normalizedMime = att.mimeType?.toLowerCase().startsWith("video/")
            ? att.mimeType
            : `video/${(videoExtMatch?.[1] ?? "mp4").toLowerCase()}`;
          const safeFileName = (att.fileName ?? `recording-${att.attachmentId}`)
            .replace(/[/\\]/g, "_")
            .slice(0, 255);
          inboundRecordingRefs.push({
            attachmentId: att.attachmentId,
            fileName: safeFileName,
            mimeType: normalizedMime,
            fileSize,
          });
          log.info(
            `Deferred /record-skill recording ${att.attachmentId} (${safeFileName}, ${fileSize} bytes, ${normalizedMime}) to sandbox stream`,
          );
          continue;
        }
        log.info(
          `Attachment ${att.attachmentId}: fileUrl=${att.fileUrl ? `"${att.fileUrl.slice(0, 120)}"` : "(empty)"} hasUserToken=${!!userSpacesToken} hasSessionId=${!!userSpacesSessionId}`,
        );

        const sources: Array<{ label: string; url: string; headers?: Record<string, string> }> = [];
        if (att.fileUrl && /^https?:\/\//i.test(att.fileUrl)) {
          sources.push({ label: "fileUrl", url: att.fileUrl });
        }
        if (userSpacesToken) {
          sources.push({
            label: "user-token",
            url: `${CONFIG.spacesInternalUrl}/api/attachments/${att.attachmentId}/download`,
            headers: {
              Authorization: `Bearer ${userSpacesToken}`,
              ...(userSpacesWorkspaceId ? { "x-workspace-id": userSpacesWorkspaceId } : {}),
              ...(userCookieHeader ? { Cookie: userCookieHeader } : {}),
            },
          });
        }
        sources.push({
          label: "apps-route",
          url: `${CONFIG.spacesInternalUrl}/api/apps/attachments/${att.attachmentId}/download`,
          headers: { Authorization: `Bearer ${agent.appToken}` },
        });
        sources.push({
          label: "user-route",
          url: `${CONFIG.spacesInternalUrl}/api/attachments/${att.attachmentId}/download`,
          headers: { Authorization: `Bearer ${agent.appToken}` },
        });

        const failures: string[] = [];
        let downloaded = false;
        for (const src of sources) {
          try {
            const dlRes = await fetch(src.url, {
              signal: AbortSignal.timeout(15_000),
              ...(src.headers ? { headers: src.headers } : {}),
            });
            if (dlRes.ok) {
              const buffer = Buffer.from(await dlRes.arrayBuffer());
              inboundAttachments.push({
                fileName: att.fileName,
                mimeType: att.mimeType,
                data: buffer.toString("base64"),
              });
              log.info(
                `Downloaded attachment ${att.attachmentId} (${att.fileName}, ${att.mimeType}, ${buffer.length} bytes) via ${src.label}`,
              );
              downloaded = true;
              break;
            }
            const body = await dlRes.text().catch(() => "");
            failures.push(`${src.label}: HTTP ${dlRes.status} ${body.slice(0, 120)}`);
          } catch (err) {
            failures.push(`${src.label}: ${errMsg(err)}`);
          }
        }
        if (!downloaded) {
          log.warn(
            `Failed to download attachment ${att.attachmentId} (${att.fileName}); tried ${sources.length} source(s): ${failures.join(" | ")}`,
          );
        }
      }
    }

    const fastModeEnabled = await resolveFastMode(payload.conversationId, runAgentSlug, agentRow?.config);

    // (The global twin concurrency limiter — the fleet-wide LiteLLM cap — is
    // acquired further down, AFTER the new per-user FIFO gate, so a queued
    // follow-up tag never burns a fleet-wide slot. See globalTwinSlotToken.)

    // Digital Twin (USER_MENTIONED): make WHO mentioned the user and WHERE
    // explicit in the run context. The thread history labels the sender only by
    // id, so the twin can't otherwise reason about who's asking / where to reply.
    //
    // CRITICAL: build this ONCE here and reuse it for BOTH the live
    // /internal/run dispatch (fetchRun below) AND the run-recovery / goal-replay
    // payload (dispatchPayload). A prior split built the live-run context inline
    // (thread-awareness only) while a SEPARATE dispatchContext carried the
    // mention note — so the first/live run shipped WITHOUT the "@mentioned by"
    // block and only the recovery copy had it. Single source of truth = no drift.
    const twinMentionNote =
      eventType === "USER_MENTIONED"
        ? `## You were @mentioned\nYou were @mentioned by **${payload.senderName ?? "someone"}**${payload.channelName ? ` in **#${payload.channelName}**` : ""}. Their message is the Query below — decide how you'd respond to them, there.`
        : "";
    const threadAwarenessBlock = history
      ? `## Thread Awareness\nYou are in a group thread in Xyne Spaces where multiple users and agents can participate. The thread history below shows messages from other participants — use it to understand context. Your own previous messages are NOT included here (they are already in your session). If you need more context, use spaces-messages or spaces-message-detail to read the full thread.\n\n**Speaker labels in the history below:**\n- \`human-user:<id>\` — a human in the thread; their words are user input.\n- \`@<agent-slug> (OTHER AI AGENT — not you; do not adopt this voice or identity)\` — another AI agent's message. When they say "I", they mean themselves, NOT you. NEVER answer in their voice, NEVER claim to be them, and NEVER paraphrase their first-person identity as your own. If asked to compare yourself to them, refer to them in the third person ("the X agent said …").\n\n${history}`
      : "";
    const dispatchContext = [twinMentionNote, threadAwarenessBlock].filter(Boolean).join("\n\n");

    // Suppress the bot placeholder + DM and forward the result to this URL when a
    // Spaces email auto-draft synthesized an APP_MENTIONED (see /webhook/result).
    // Moved up: the pre-dispatch sessionContext + the placeholder gate both read it.
    const resultForwardUrl =
      ((payload as { metadata?: Record<string, unknown> }).metadata?.["resultForwardUrl"] as string | undefined) || undefined;

    // Build the /internal/run body + the SessionContext ONCE, UP FRONT — before
    // any dispatch decision — so the per-user twin FIFO can enqueue a fully-formed
    // replay blob when the owner already has a run in flight. A queued tag then
    // creates NO /internal/run, NO AgentRun and NO user ChatMessage until it drains
    // (this is what fixes the branched-UI: one query + reply at a time). Neither
    // object depends on the run's sessionId (that's only ever the setSession key),
    // so building them here is safe, and it collapses the old duplicate
    // fetchRun-body / dispatchPayload into a single source of truth.
    const dispatchPayload = {
      userId: targetUserId,
      task,
      conversationId: payload.conversationId,
      agentSlug: runAgentSlug,
      orgId: agent.orgId,
      eventType,
      traceId,
      callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
      progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
      channelId: payload.channelId,
      // WHO/WHERE for the twin_deliver mandate's who/where line (run.ts reads
      // these to populate "You were mentioned by X in #Y" in the SYSTEM prompt).
      ...(payload.senderName ? { senderName: payload.senderName } : {}),
      ...(payload.channelName ? { channelName: payload.channelName } : {}),
      ...(payload.projectId ? { projectId: payload.projectId } : {}),
      ...(payload.projectName ? { projectName: payload.projectName } : {}),
      ...(dispatchContext ? { context: dispatchContext } : {}),
      ...(agentSkills && agentSkills.length > 0 ? { skills: agentSkills } : {}),
      ...(resolvedParentProvider ? { provider: resolvedParentProvider } : {}),
      ...(runtimeProviderOrder.length > 1 ? { providerOrder: runtimeProviderOrder } : {}),
      ...(Object.keys(subagentProviders).length > 0 ? { subagentProviders } : {}),
      // Default provider for subagents not listed in `subagentProviders`:
      // "parent" (inherit parent's provider) or "spaces" (platform default).
      subagentProviderMode,
      ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
      // `/goal provider=… model=…` pins every turn of the autonomous loop.
      // The full dispatch body is persisted below and re-used by the relooper.
      ...(pendingGoalStart?.providerOverride ? { providerOverride: pendingGoalStart.providerOverride } : {}),
      ...(inboundAttachments.length > 0 ? { attachments: inboundAttachments } : {}),
      ...(inboundRecordingRefs.length > 0 ? { recordingRefs: inboundRecordingRefs } : {}),
      // Ship the agent's JSONB config so xyne-claw can enable per-agent
      // features that read from it: memoryEnabled (memory-search tool),
      // toolPermissions (per-tool deny/ask), skillTriggers, promptInjections,
      // and custom-tool config values (PPT_API_KEY etc). Without this,
      // those features silently default to "off"/"allow" on Spaces mentions.
      ...(agentRow?.config ? { agentConfig: agentRow.config as Record<string, unknown> } : {}),
      fastMode: fastModeEnabled,
      // `/compact` — force a one-shot compaction of the resumed session
      // before this turn so the thread continues with a smaller context.
      ...(compactBeforeRun ? { compactBeforeRun: true } : {}),
      // Plan mode: only a non-twin interactive thread mention on a planMode
      // agent starts in plan mode (agent proposes a plan and stops for approval).
      // Gated on eventType !== "USER_MENTIONED" (INVARIANT B: twin never plans)
      // and on the planMode opt-in (INVARIANT A: unchanged when off). This
      // /webhook path only serves interactive mentions (USER_MENTIONED /
      // APP_MENTIONED / DIRECT_MESSAGE); scheduled/automation runs arrive via the
      // separate S2S handler and must NOT be configured with planMode.
      ...(planModeEnabled && !immediateTaskCommand && eventType !== "USER_MENTIONED" ? { mode: "plan" as const } : {}),
    };

    // progressMessageId is the ONLY session field not knowable pre-dispatch — it's
    // assigned after the placeholder post below (conversation-mode only), just
    // before setSession. Everything else is final here.
    const sessionContext: SessionContext = {
      // Per-user: for the twin this is THIS iteration's mentioned user
      // (targetUserId) so the approve/decline DM + per-user conv index route right.
      mentionedUserId: eventType === "USER_MENTIONED" ? targetUserId : agent.spacesAppUserId,
      targetUserId,
      senderId: payload.userId,
      senderName: payload.senderName ?? payload.userId,
      channelId: payload.channelId,
      channelName: payload.channelName ?? payload.channelId,
      conversationId: payload.conversationId,
      ...(payload.messageId ? { sourceMessageId: payload.messageId } : {}),
      task,
      agentId: agent.id,
      agentOrgId: agent.orgId,
      agentSlug: agent.slug,
      responseMode: eventType === "USER_MENTIONED" ? "approval" as const : "conversation" as const,
      appToken: agent.appToken,
      spacesAppId: agent.spacesAppId,
      spacesAppUserId: agent.spacesAppUserId,
      traceId,
      rootAgentSlug: agent.slug,
      triggerSource: "spaces",
      ...(resolvedParentProvider ? { provider: resolvedParentProvider } : {}),
      ...(escalatedProvider ? { escalatedProvider } : {}),
      ...(userSpacesWorkspaceId ? { workspaceId: userSpacesWorkspaceId } : {}),
      ...(twinWorkspaceId ? { workspaceId: twinWorkspaceId } : {}),
      ...(resultForwardUrl ? { resultForwardUrl } : {}),
      // Plan mode (see dispatchPayload): 'plan' only when the agent opts in AND
      // this is a non-twin interactive mention. Absent ⇒ 'auto' (today's flow).
      // The plan-approval flow-action flips this to 'auto' for Turn 2.
      ...(planModeEnabled && !immediateTaskCommand && eventType !== "USER_MENTIONED" ? { mode: "plan" as const } : {}),
    };

    // ── Per-user twin FIFO gate ───────────────────────────────────────────────
    // Serialize same-owner tags on this conversation: if this owner already has a
    // twin run in flight here, enqueue THIS tag (fully-built payload) and return
    // BEFORE dispatch — no /internal/run, no AgentRun, no user message until it
    // drains on the active run's completion. Different owners use different keys
    // (scoped by targetUserId) so they still run in parallel. MUST precede the
    // global limiter so a queued tag never burns a fleet-wide slot.
    const twinUserScope = runAsTwin ? targetUserId : undefined;
    let twinConvSlotToken: string | null = null;
    if (runAsTwin && QUEUE_ENABLED && payload.conversationId && task) {
      twinConvSlotToken = await tryAcquireSlot(payload.conversationId, runAgentSlug, twinUserScope);
      if (!twinConvSlotToken) {
        const queuedMsg: QueuedMessage = {
          eventId: payload.messageId ?? traceId,
          conversationId: payload.conversationId,
          channelId: payload.channelId,
          ...(payload.channelName ? { channelName: payload.channelName } : {}),
          userId: targetUserId,
          ...(payload.senderName ? { senderName: payload.senderName } : {}),
          agentSlug: runAgentSlug,
          ...(agent.orgId ? { orgId: agent.orgId } : {}),
          ...(twinWorkspaceId ? { workspaceId: twinWorkspaceId } : {}),
          task,
          eventType,
          ...(twinUserScope ? { userScopeId: twinUserScope } : {}),
          responseMode: "approval" as const,
          dispatchPayload,
          sessionContext: sessionContext as unknown as Record<string, unknown>,
          ts: Date.now(),
        };
        const enq = await enqueueMessage(queuedMsg);
        log.info(`[twin-queue] conv ${payload.conversationId} owner ${twinUserScope} busy — queued eventId=${queuedMsg.eventId} enqueued=${enq.enqueued} pos=${enq.position} deduped=${enq.deduped} full=${enq.full}`);
        return;
      }
    }

    // Global twin concurrency cap (fleet-wide LiteLLM limiter). Acquired AFTER the
    // per-user gate; re-keyed to the run's sessionId below and freed by
    // /webhook/result on any terminal callback (TTL backstop in the lib).
    let globalTwinSlotToken: string | null = null;
    if (runAsTwin) {
      globalTwinSlotToken = await acquireTwinSlot();
      if (globalTwinSlotToken === null) {
        log.warn(`Twin dispatch dropped for ${targetUserId} — concurrency queue never drained`);
        // Free/drain the per-user slot we hold so a follow-up tag isn't wedged.
        if (twinConvSlotToken && payload.conversationId) {
          await drainNextQueued(payload.conversationId, runAgentSlug, twinConvSlotToken, twinUserScope).catch(() => {});
        }
        return;
      }
    }

    const runUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run`;
    // eslint-disable-next-line no-inner-declarations
    const fetchRun = () => fetch(runUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(dispatchPayload),
    });

    // A dispatch that dies on a TRANSIENT upstream failure (envoy 502/503/504
    // "no healthy upstream" during a claw rollout, a connection refusal against
    // a terminating pod) is retryable — the run never started, so nothing is
    // duplicated by trying again. Without this, a routine claw deploy turns
    // every in-flight mention into a user-visible "I couldn't start this
    // request: no healthy upstream" (observed prod 2026-08-05) even though a
    // retry two seconds later would have succeeded. Mirrors the retry the /run
    // proxy already does (routes/run.ts fetchClawRunWithRetry).
    //
    // The ladder must OUTLAST a claw rollout, not just a blip: envoy keeps
    // returning 503 for the full pod-boot window (image pull + boot +
    // readiness, 1–3 min observed prod 2026-08-06 — a 2s×2 ladder exhausted in
    // 4.5s and still posted the "briefly unavailable" notice for every mention
    // landing mid-deploy). This runs after the webhook was ack'd, so waiting
    // here blocks no caller; the message is already acked and the queue slot
    // is held for this conversation.
    const DISPATCH_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000, 45_000, 60_000];
    const isTransientUpstream = (status: number, body: string): boolean =>
      status === 502 || status === 503 || status === 504 ||
      /no healthy upstream|upstream connect error|connection (refused|reset)|EAI_AGAIN|ECONNREFUSED|fetch failed/i.test(body);

    const fetchRunWithRetry = async (): Promise<Awaited<ReturnType<typeof fetchRun>>> => {
      let lastRes: Awaited<ReturnType<typeof fetchRun>> | undefined;
      const attempts = DISPATCH_RETRY_DELAYS_MS.length + 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, DISPATCH_RETRY_DELAYS_MS[attempt - 1]));
        const res = await fetchRun();
        if (res.ok) return res;
        // Peek at the body WITHOUT consuming the caller's copy.
        const peek = await res.clone().text().catch(() => "");
        if (!isTransientUpstream(res.status, peek)) return res;
        lastRes = res;
        log.warn(
          `Dispatch attempt ${attempt + 1}/${attempts} hit transient upstream (${res.status}) for agent=${agent.slug}` +
          (attempt < attempts - 1 ? ` — retrying in ${DISPATCH_RETRY_DELAYS_MS[attempt]! / 1000}s` : " — giving up"),
        );
      }
      return lastRes!;
    };

    // Local-harness routing: only mention-driven runs are eligible. If the user
    // has an online authenticated local device for a preferred provider, the run
    // is dispatched there; otherwise we fall through to the server run below.
    const localHarnessEligible = eventType === "USER_MENTIONED" || eventType === "APP_MENTIONED";
    const rawAgentOrder = (agentRow?.config as Record<string, unknown> | null)?.["providerOrder"];
    const localTarget = localHarnessEligible
      ? await resolveLocalHarnessTarget({
          userId: targetUserId,
          orgId: agent.orgId,
          providerOrder: Array.isArray(rawAgentOrder)
            ? rawAgentOrder.filter((p): p is string => typeof p === "string")
            : [],
          personalProvider: rawPersonalProvider,
        }).catch((err: unknown) => {
          log.warn("Local-harness resolution failed — using server run", {
            error: err instanceof Error ? err.message : String(err),
          });
          return undefined;
        })
      : undefined;

    let body: { success: boolean; sessionId?: string; error?: string };
    let runRes: Awaited<ReturnType<typeof fetchRun>> | undefined;
    if (localTarget) {
      let dispatched: Awaited<ReturnType<typeof dispatchLocalHarnessRun>>;
      try {
        dispatched = await dispatchLocalHarnessRun({
          target: localTarget,
          userId: targetUserId,
          orgId: agent.orgId,
          conversationId: payload.conversationId,
          agentSlug: runAgentSlug,
          agentName: agentRow?.name ?? agent.slug,
          systemPrompt: agentRow?.systemPrompt ?? "",
          model: pinnedModelForProvider(agentRow?.config, localTarget.provider),
          task,
          context: dispatchContext || null,
          progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
          callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
          serverFallbackBody: dispatchPayload as unknown as Record<string, unknown>,
        });
      } catch (err) {
        if (globalTwinSlotToken !== null) void releaseTwinSlot(globalTwinSlotToken);
        if (twinConvSlotToken !== null && payload.conversationId) {
          await drainNextQueued(payload.conversationId, runAgentSlug, twinConvSlotToken, twinUserScope).catch(() => {});
        }
        throw err;
      }
      body = { success: true, sessionId: dispatched.sessionId };
    } else {
      try {
        runRes = await fetchRunWithRetry();
      } catch (err) {
        // Dispatch never happened — free the global twin slot, and drain/free the
        // per-user FIFO slot so a queued follow-up tag isn't wedged behind a run
        // that never started.
        if (globalTwinSlotToken !== null) void releaseTwinSlot(globalTwinSlotToken);
        if (twinConvSlotToken !== null && payload.conversationId) {
          await drainNextQueued(payload.conversationId, runAgentSlug, twinConvSlotToken, twinUserScope).catch(() => {});
        }
        throw err;
      }
      body = (await runRes.json()) as { success: boolean; sessionId?: string; error?: string };
    }

    // Re-key the GLOBAL twin slot to the real sessionId (released by
    // /webhook/result); free it immediately if the dispatch didn't produce a run.
    if (globalTwinSlotToken !== null) {
      if (body.success && body.sessionId) {
        void renameTwinSlot(globalTwinSlotToken, body.sessionId);
      } else {
        void releaseTwinSlot(globalTwinSlotToken);
      }
    }

    if (body.success && body.sessionId) {
      // Progress signal to the dashboard. Two paths, switched by flag:
      //   USE_EPHEMERAL_PROGRESS=true  → POST /chat/agentProgress (requires Spaces XYNE-12145)
      //   USE_EPHEMERAL_PROGRESS=false → POST /chat/postMessage for a "⏳ Working on it..."
      //                                  placeholder; we capture messageId and edit it later.
      // USER_MENTIONED (twin) skips this entirely, so progressMessageId stays
      // undefined on the twin path. `resultForwardUrl` was resolved pre-dispatch.
      let progressMessageId: string | undefined;
      if (eventType !== "USER_MENTIONED" && !resultForwardUrl) {
        try {
          if (USE_EPHEMERAL_PROGRESS) {
            await spacesAppFetch("/chat/agentProgress", {
              conversationId: payload.conversationId,
              channelId: payload.channelId,
              agentSlug: agent.slug,
              userId: agent.spacesAppUserId,
              toolLabel: "Working on it...",
              status: "working",
            }, agent.appToken);
          } else {
            const placeholderRes = (await spacesAppFetch("/chat/postMessage", {
              channelId: payload.channelId,
              conversationId: payload.conversationId,
              markdownText: "⏳ Working on it...",
              userId: agent.spacesAppUserId,
              metadata: { contentFormat: "markdown" },
            }, agent.appToken)) as { messageId?: string };
            progressMessageId = placeholderRes?.messageId;
            log.info(`Posted progress placeholder, messageId=${progressMessageId}`);
          }
        } catch (err) {
          log.warn("Failed to publish initial agent progress signal", { error: errMsg(err) });
        }
      }

      // Fold the (conversation-mode-only) placeholder id into the pre-built
      // sessionContext before persisting. On the twin path this is a no-op.
      if (progressMessageId) sessionContext.progressMessageId = progressMessageId;

      await setSession(body.sessionId, sessionContext);

      // Run-recovery / goal-replay reuses the SAME dispatchPayload that was
      // dispatched above (built once before the per-user gate) — byte-identical
      // replay, no mention-note drift. Skipped on the local-harness path: the
      // run lives in the user's Electron app, so a server-side retry can't
      // recover it.
      if (!localTarget) {
        await registerRunRecovery({
          rootSessionId: body.sessionId,
          maxRetries: CONFIG.runRecoveryMaxRetries,
          timeoutMs: CONFIG.runRecoveryTimeoutMs,
          retryBackoffMs: CONFIG.runRecoveryBackoffMs,
          dispatchPayload,
          sessionContext,
        });
      }

      // /goal turn-0 persistence: same dispatchPayload is replayed by the
      // relooper for each subsequent turn (task is overwritten with the
      // relooper template each loop).
      if (pendingGoalStart) {
        await persistGoalStart({
          conversationId: payload.conversationId,
          channelId: payload.channelId ?? null,
          ...(userSpacesWorkspaceId ? { workspaceId: userSpacesWorkspaceId } : {}),
          ...(twinWorkspaceId ? { workspaceId: twinWorkspaceId } : {}),
          userId: targetUserId,
          agentSlug: agent.slug,
          orgId: agent.orgId,
          condition: pendingGoalStart.condition,
          // dispatchPayload is JSON-safe by construction (strings / arrays /
          // plain objects only); the cast satisfies Prisma's InputJsonValue
          // brand which doesn't accept Record<string, unknown> directly.
          runPayload: JSON.parse(JSON.stringify(dispatchPayload)),
        }).catch((err) => {
          log.warn("Failed to persist /goal start — loop will not auto-continue", { error: errMsg(err) });
        });
      }

      // AgentRun + user ChatMessage writes are owned by the /run handler this
      // webhook just called (routes/run.ts:351-373). Doing them again here
      // would race the /run insert and fail the unique constraint on
      // AgentRun.sessionId for every webhook hit — historical bug, ~216/day
      // in prod logs before this dedupe. Leave it to /run.

      log.info(`Forwarded to xyne-claw, sessionId=${body.sessionId}`);
    } else if (runAsTwin && QUEUE_ENABLED && payload.conversationId) {
      // Twin runtime produced no run — drain this owner's per-user queue so a
      // follow-up tag isn't wedged behind a phantom slot.
      await drainNextQueued(payload.conversationId, runAgentSlug, twinConvSlotToken, twinUserScope).catch(() => {});
    } else if (QUEUE_ENABLED && eventType !== "USER_MENTIONED" && payload.conversationId) {
      // Runtime rejected the dispatch — drain any queued follow-up (or release
      // the slot) so the conversation isn’t wedged until the busy TTL expires.
      // We hold the token here, so release is owner-checked.
      await drainNextQueued(payload.conversationId, runAgentSlug, slotToken).catch(() => {});
    }

    // A refused dispatch (agent disabled, no provider, resolution failure)
    // previously left the thread SILENT — the user mentioned the agent and
    // nothing happened. Surface the refusal for interactive mentions. Twin
    // mentions stay silent (background persona; a refusal notice would be
    // noise), and resultForward callers get the failure via their callback.
    if (!(body.success && body.sessionId) && eventType !== "USER_MENTIONED" && !resultForwardUrl && payload.conversationId) {
      const refusal = body.error ?? "the run could not be started";
      // Three shapes of refusal, three honest messages. A transient upstream
      // failure that survived the retries above is an infra blip, not a broken
      // agent — saying "I couldn't start this request: no healthy upstream"
      // reads as an agent fault and tells the user nothing actionable.
      const notice = /disabled/i.test(refusal)
        ? `🚫 **${agent.slug}** is currently disabled — an admin can re-enable it in the agent dashboard.`
        : runRes && isTransientUpstream(runRes.status, refusal)
          ? `⏳ The agent service is briefly unavailable (deploy or restart in progress). Please send that again in a moment.`
          : `⚠️ I couldn't start this request: ${refusal}`;
      await spacesAppFetch("/chat/postMessage", {
        channelId: payload.channelId,
        conversationId: payload.conversationId,
        markdownText: notice,
        userId: agent.spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      }, agent.appToken).catch((err) =>
        log.warn("Failed to post dispatch-refusal notice", { error: errMsg(err) }),
      );
      log.warn(`Dispatch refused for agent=${agent.slug} conv=${payload.conversationId}: ${refusal}`);
    }
    }; // end dispatchRunForTarget

    if (eventType === "USER_MENTIONED") {
      // BUG FIX (multi-mention): fire ONE twin run per eligible mentioned user
      // instead of dropping any message that tags more than one user. Route
      // guards above already ensured this is the digital-twin agent.
      //
      // Eligibility (registered in claw-auth + digitalTwinEnabled + resolvable
      // Spaces workspaceId) is checked HERE — after the ack — once per mentioned
      // user, so an opted-out / unresolvable user is skipped individually
      // without dropping the rest.
      const mentioned = Array.from(
        new Set((payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? []),
      );
      const eligibleTwins: Array<{ userId: string; workspaceId: string; respondPolicy: string }> = [];
      for (const uid of mentioned) {
        const u = await userRepository.findById(uid).catch(() => null);
        if (!u) {
          log.info(`Twin: skipping ${uid} — not registered in claw-auth`);
          continue;
        }
        if (!u.digitalTwinEnabled) {
          log.info(`Twin: skipping ${uid} — Digital Twin disabled`);
          continue;
        }
        const twinAuth = await getSpacesAuthForUser(uid, "webhook").catch(() => null);
        if (!twinAuth?.workspaceId) {
          log.info(`Twin: skipping ${uid} — no resolvable workspaceId (no active Spaces session)`);
          continue;
        }
        eligibleTwins.push({
          userId: uid,
          workspaceId: twinAuth.workspaceId,
          respondPolicy: (u as { digitalTwinRespondPolicy?: string }).digitalTwinRespondPolicy ?? "learned",
        });
      }
      if (eligibleTwins.length === 0) {
        log.info(`Twin: no eligible mentioned users among [${mentioned.join(", ")}] — nothing to dispatch`);
        return;
      }
      // Per-iteration isolation: one user's dispatch failure (a /run 5xx, a
      // provider-resolution throw, flaky creds) must NEVER abort the loop and
      // silently drop the remaining mentioned users — that would just relocate
      // the very multi-mention bug we're fixing.
      for (const twin of eligibleTwins) {
        try {
          // Learned respond/ignore gate — only when the user opted in. Consults
          // their captured patterns. FAIL-CLOSED: the twin posts ONLY on a usable
          // gate "respond". A respond:false (at any confidence), or a null/errored
          // gate, → stay silent. Better a wrong silence (recoverable via the
          // should-have-replied feedback loop) than a wrong post AS the user.
          if (twin.respondPolicy === "learned") {
            const decision = await shouldTwinRespond(twin.userId, {
              incoming: payload.content ?? "",
              ...(payload.channelName ? { channelName: payload.channelName } : {}),
              ...(payload.channelId ? { channelId: payload.channelId } : {}),
              ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
              ...(payload.senderName ? { senderName: payload.senderName } : {}),
              ...(payload.userId ? { senderId: payload.userId } : {}),
              ...(payload.messageId ? { sourceMessageId: payload.messageId } : {}),
            }).catch(() => null);
            if (!decision || !decision.respond) {
              log.info(
                `Twin: staying silent for ${twin.userId} — ${
                  decision
                    ? `gate ignore (conf ${decision.confidence.toFixed(2)}): ${decision.reason}`
                    : "gate unavailable (fail-closed)"
                }`,
              );
              // Record the silence so the daily pipeline can reconcile it: if the
              // user replies themselves, it becomes a "should have responded"
              // correction that feeds future gate decisions.
              await recordTwinSilence(
                twin.userId,
                {
                  sourceMessageId: payload.messageId,
                  ...(payload.channelId ? { channelId: payload.channelId } : {}),
                  ...(payload.channelName ? { channelName: payload.channelName } : {}),
                  ...(payload.userId ? { senderId: payload.userId } : {}),
                  occurredAt: payload.createdAt,
                  triggerPreview: payload.cleanContent || payload.content,
                },
                decision ?? FAIL_CLOSED,
              ).catch(() => {});
              continue;
            }
            log.info(
              `Twin: proceeding for ${twin.userId} — gate=${decision.source} respond=true conf=${decision.confidence.toFixed(2)}`,
            );
          }
          await dispatchRunForTarget(twin.userId, twin.workspaceId);
        } catch (err) {
          log.error(`Twin dispatch failed for user ${twin.userId} — other mentioned users unaffected`, {
            error: errMsg(err),
          });
        }
      }
      return;
    }

    // Conversation mode (APP_MENTIONED / DIRECT_MESSAGE): a single run as the
    // sender — one call, sender is the target, no twin workspaceId. Behavior
    // unchanged from before the per-target refactor.
    //
    // Invocation whitelist: this is the "someone called the agent" path, so
    // gate it on agent.config.privacy before dispatch. Denied callers get the
    // same shape of notice as a disabled agent (per product decision), never a
    // silent drop. Twin (USER_MENTIONED) runs above are a persona of the
    // mentioned user, not an agent call, so they are intentionally not gated.
    {
      const invocRow = await agentRepository.findBySlug(agent.slug, agent.orgId ?? undefined).catch(() => null);
      if (invocRow && !isAgentInvocableBy(invocRow.config as Record<string, unknown> | null, payload.userId)) {
        log.warn(`Invocation denied (not whitelisted) agent=${agent.slug} userId=${payload.userId} conv=${payload.conversationId}`);
        if (payload.conversationId) {
          await spacesAppFetch("/chat/postMessage", {
            channelId: payload.channelId,
            conversationId: payload.conversationId,
            markdownText: `🚫 **${agent.slug}** is restricted — you don't have access to it. Ask the agent's owner to add you.`,
            userId: agent.spacesAppUserId,
            metadata: { contentFormat: "markdown" },
          }, agent.appToken).catch((err) =>
            log.warn("Failed to post invocation-denied notice", { error: errMsg(err) }),
          );
        }
        if (QUEUE_ENABLED && payload.conversationId) {
          await drainNextQueued(payload.conversationId, agent.slug, slotToken).catch(() => {});
        }
        return;
      }
    }
    await dispatchRunForTarget(payload.userId, undefined);
  } catch (err) {
    log.error("Error forwarding:", { error: errMsg(err) });
    if (QUEUE_ENABLED && eventType !== "USER_MENTIONED" && payload.conversationId) {
      await drainNextQueued(payload.conversationId, agent.slug, slotToken).catch(() => {});
    }
  }
}

interface StopReconcileSummary {
  stopped: number;
  cleaned: number;
  queued: number;
  hadRunningRows: boolean;
}

// Reconcile the whole conversation for Spaces /stop. Enumerates every running
// AgentRun row, POSTs the runtime's per-session cancel, and treats
// status="not_running" as the existing stale-row janitor signal.
async function reconcileStoppedRuns(conversationId: string, fallbackAgentSlug: string): Promise<StopReconcileSummary> {
  const runningRuns = await agentRunRepository.listRunningByConversation(conversationId);
  const agentSlugs = new Set<string>([fallbackAgentSlug, ...runningRuns.map((run) => run.agentSlug)]);
  // DROP queued messages BEFORE cancelling. The cancelled run's failure result
  // drains the queue in the same breath as the cancel, so a queued message
  // would instantly re-start the work the user just stopped — /queue clear can
  // never win that race (2026-07-16: customer-support resumed its stopped plan
  // one second after 🛑 from a queued "\help"). /stop means halt everything in
  // the thread; the user can resend a message to continue.
  let queued = 0;
  for (const agentSlug of agentSlugs) {
    queued += await clearQueue(conversationId, agentSlug);
  }

  const summary: StopReconcileSummary = {
    stopped: 0,
    cleaned: 0,
    queued,
    hadRunningRows: runningRuns.length > 0,
  };
  if (runningRuns.length === 0) return summary;

  const cleanedAgentSlugs = new Set<string>();
  for (const run of runningRuns) {
    try {
      // Kill run-recovery for this run FIRST, so the watchdog can't resurrect
      // the aborted run later ("no heartbeat before timeout" → retry →
      // re-dispatch that posts anyway). Independent of the pod-cancel result
      // below: even if the cancel call fails or the run lives on another pod,
      // the pending retry must be dropped. Best-effort — never block the
      // actual cancel on this. (finalizeOrphanedRun repeats it idempotently
      // on the orphan path.)
      await cancelRunRecovery(run.sessionId).catch((err) =>
        clog.warn(`[stop] cancelRunRecovery failed for ${run.sessionId}: ${errMsg(err)}`),
      );
      const res = await fetch(
        `${CONFIG.internalUrl}/claw/api/v1/internal/run/${encodeURIComponent(run.sessionId)}/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
            ...(run.userId ? { "x-user-id": run.userId } : {}),
          },
        },
      );
      if (!res.ok) {
        clog.warn(`[stop] cancel run ${run.sessionId} returned HTTP ${res.status}`);
        continue;
      }

      const body = (await res.json().catch(() => ({}))) as { status?: string };
      if (body.status === "cancelled") {
        summary.stopped++;
        clog.info(`[stop] cancelled run ${run.sessionId} for conv ${conversationId}`);
        continue;
      }

      clog.info(`[stop] run ${run.sessionId} not cancellable (status=${body.status ?? "unknown"}) for conv ${conversationId}`);
      if (body.status === "not_running") {
        const cleaned = await finalizeOrphanedRun(run, "orphaned run cleaned by /stop", "stop");
        if (cleaned) {
          summary.cleaned++;
          cleanedAgentSlugs.add(run.agentSlug);
        }
      }
    } catch (err) {
      clog.warn(`[stop] reconcile failed for run ${run.sessionId} conv ${conversationId}: ${errMsg(err)}`);
    }
  }

  for (const agentSlug of cleanedAgentSlugs) {
    await drainNextQueued(conversationId, agentSlug).catch((err) =>
      clog.warn(`[stop] orphan drain failed for conv ${conversationId}: ${errMsg(err)}`),
    );
  }
  return summary;
}

// ── Mid-run message queue helpers (see lib/message-queue.ts) ────────────
// Re-dispatch a queued message to xyne-claw’s /internal/run. Minimal replay:
// the agent’s thread memory is preserved by the persisted claw session, so we
// ship identity + task only (not the full first-turn history/skills payload).
async function redispatchQueuedMessage(msg: QueuedMessage): Promise<void> {
  const runUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run`;
  let queuedOrgId = msg.orgId
    ?? (await prisma.user.findUnique({ where: { id: msg.userId }, select: { orgId: true } }))?.orgId;
  if (!queuedOrgId) {
    const ctx = await getSessionByConv(msg.conversationId, msg.agentSlug).catch(() => null);
    const conversationOrgId = ctx?.agentOrgId
      ?? (await prisma.agentRun.findFirst({
        where: { conversationId: msg.conversationId, agentSlug: msg.agentSlug },
        orderBy: { startedAt: "desc" },
        select: { orgId: true },
      }))?.orgId;
    const agent = conversationOrgId
      ? await prisma.agent.findUnique({
        where: { orgId_slug: { orgId: conversationOrgId, slug: msg.agentSlug } },
        select: { orgId: true },
      })
      : null;
    queuedOrgId = agent?.orgId;
  }
  if (!queuedOrgId) {
    throw new Error(`/internal/run queued redispatch missing orgId for conv=${msg.conversationId} agent=${msg.agentSlug} user=${msg.userId}`);
  }
  const agentRow = await prisma.agent.findUnique({
    where: { orgId_slug: { orgId: queuedOrgId, slug: msg.agentSlug } },
    select: {
      id: true,
      orgId: true,
      slug: true,
      spacesAppToken: true,
      spacesAppId: true,
      spacesAppUserId: true,
      config: true,
    },
  });
  if (!agentRow?.spacesAppToken || !agentRow.spacesAppId) {
    throw new Error(`/internal/run queued redispatch missing Spaces app identity for conv=${msg.conversationId} agent=${msg.agentSlug} org=${queuedOrgId}`);
  }
  const appToken = decryptStoredField(agentRow.spacesAppToken);
  const workspaceId = msg.workspaceId
    ?? (await getWorkspaceIdForUser(msg.userId, "webhook").catch(() => null))
    ?? (agentRow.spacesAppUserId ? await getSpacesUserWorkspaceId(agentRow.spacesAppUserId).catch(() => null) : null);
  const traceId = createTraceId();
  const fastModeEnabled = await resolveFastMode(msg.conversationId, msg.agentSlug, agentRow.config);
  const res = await fetch(runUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify({
      userId: msg.userId,
      task: msg.task,
      conversationId: msg.conversationId,
      agentSlug: msg.agentSlug,
      orgId: queuedOrgId,
      eventType: msg.eventType,
      traceId,
      callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
      progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
      channelId: msg.channelId,
      ...(msg.context ? { context: msg.context } : {}),
      // Experiment epochs re-dispatched from the queue must keep their context,
      // else claw injects no experiment-ledger/-review tools on the retry.
      ...(msg.experiment ? { experiment: msg.experiment } : {}),
      // /record-skill refs must survive the hop too — /run re-binds them in
      // Redis under the fresh sessionId; without this the retried run's
      // analyze-skill-recording finds no registered recordings (404).
      ...(msg.recordingRefs?.length ? { recordingRefs: msg.recordingRefs } : {}),
      // A lock-contention retry already persisted its user message on the first
      // dispatch — skip re-persisting so the retry doesn't create a duplicate
      // root user row (branch). Proactively-queued mentions leave this unset and
      // persist normally on drain.
      ...(msg.alreadyPersisted ? { __skipUserMessagePersist: true } : {}),
      fastMode: fastModeEnabled,
    }),
  });
  if (!res.ok) {
    throw new Error(`/internal/run for queued message returned HTTP ${res.status}`);
  }
  const body = (await res.json().catch(() => null)) as { success?: boolean; sessionId?: string } | null;
  if (!body?.success || !body.sessionId) {
    throw new Error(`/internal/run for queued message returned no sessionId conv=${msg.conversationId} agent=${msg.agentSlug}`);
  }
  const queuedContext: SessionContext = {
    mentionedUserId: agentRow.spacesAppUserId ?? "",
    senderId: msg.userId,
    senderName: msg.senderName ?? msg.userId,
    channelId: msg.channelId,
    channelName: msg.channelName ?? msg.channelId,
    conversationId: msg.conversationId,
    task: msg.task,
    agentId: agentRow.id,
    agentOrgId: agentRow.orgId,
    agentSlug: agentRow.slug,
    responseMode: "conversation",
    appToken,
    spacesAppId: agentRow.spacesAppId,
    spacesAppUserId: agentRow.spacesAppUserId ?? "",
    traceId,
    rootAgentSlug: agentRow.slug,
    ...(workspaceId ? { workspaceId } : {}),
    ...(msg.resultForwardUrl ? { resultForwardUrl: msg.resultForwardUrl } : {}),
    ...(msg.resolveMentions ? { resolveMentions: msg.resolveMentions } : {}),
  };
  await setSession(body.sessionId, queuedContext);
  if (msg.queueReason === "interrupt_followup") {
    void emitAgentWorkingSignal({
      conversationId: msg.conversationId,
      channelId: msg.channelId,
      agentSlug: msg.agentSlug,
      spacesAppUserId: agentRow.spacesAppUserId ?? "",
      appToken,
      toolLabel: "Picked up your new message — continuing from the summary above…",
    });
  }
  clog.info(`[msg-queue] registered queued session context sessionId=${body.sessionId} conv=${msg.conversationId} agent=${msg.agentSlug} workspaceId=${workspaceId ?? "(none)"}`);
}

// Drain the next queued message for a conversation, or release the slot when
// the queue is empty. Called from the /webhook/result finalizer (no token) and
// the same-request dispatch-failure paths (token in hand). The slot stays HELD
// when a message is re-dispatched (that run becomes the active one) and its TTL
// is refreshed so a long drain-chain can't let the marker expire mid-flight; it
// is released only when nothing remains to run. Release is owner-checked when a
// `token` is supplied, so a late finalizer can't delete a newer run's slot.
export async function drainNextQueued(conversationId: string, agentSlug: string, token?: string | null, userScopeId?: string): Promise<void> {
  if (!QUEUE_ENABLED || !conversationId || !agentSlug) return;
  const next = await dequeueMessage(conversationId, agentSlug, userScopeId);
  if (!next) {
    await releaseSlot(conversationId, agentSlug, token ?? undefined, userScopeId);
    return;
  }
  try {
    // Twin FIFO entries carry a fully-built replay blob (dispatchPayload +
    // sessionContext) and are replayed VERBATIM (approval mode preserved, user
    // message created fresh on drain). Conversation-mode entries carry a thin
    // task and re-derive context — the legacy path.
    if (next.dispatchPayload && next.sessionContext) {
      await redispatchTwinQueuedMessage(next);
    } else {
      await redispatchQueuedMessage(next);
    }
    // Hand the slot to the freshly re-dispatched run: bump the TTL so it owns
    // the conversation for a full window rather than inheriting the remaining
    // time from the run that just finished.
    await refreshSlot(conversationId, agentSlug, undefined, userScopeId);
    clog.info(`[msg-queue] conv ${conversationId} agent ${agentSlug}${userScopeId ? ` owner ${userScopeId}` : ""}: dispatched queued eventId=${next.eventId}`);
  } catch (err) {
    clog.warn(`[msg-queue] conv ${conversationId} agent ${agentSlug}: redispatch failed, releasing slot: ${errMsg(err)}`);
    await releaseSlot(conversationId, agentSlug, token ?? undefined, userScopeId);
  }
}

// Re-dispatch a PROACTIVELY-queued twin tag by replaying its stored, fully-built
// /internal/run payload verbatim. Unlike redispatchQueuedMessage (which rebuilds
// a conversation-mode context), this preserves approval mode + the per-turn
// mention context exactly as the original would have dispatched. CRITICAL: it
// does NOT set __skipUserMessagePersist — a proactively queued tag never
// dispatched, so its user ChatMessage must be created NOW (this is what keeps the
// chat sequential: one query + reply at a time, no branch). A fresh traceId is
// minted per drained attempt.
async function redispatchTwinQueuedMessage(msg: QueuedMessage): Promise<void> {
  const traceId = createTraceId();
  const dispatch = { ...(msg.dispatchPayload as Record<string, unknown>), traceId };
  const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify(dispatch),
  });
  const body = (await res.json().catch(() => null)) as { success?: boolean; sessionId?: string } | null;
  if (!res.ok || !body?.success || !body.sessionId) {
    throw new Error(`/internal/run for queued twin message returned no sessionId conv=${msg.conversationId} owner=${msg.userScopeId ?? "?"}`);
  }
  const sessionContext = { ...(msg.sessionContext as unknown as SessionContext), traceId };
  await setSession(body.sessionId, sessionContext);
  await registerRunRecovery({
    rootSessionId: body.sessionId,
    maxRetries: CONFIG.runRecoveryMaxRetries,
    timeoutMs: CONFIG.runRecoveryTimeoutMs,
    retryBackoffMs: CONFIG.runRecoveryBackoffMs,
    dispatchPayload: dispatch as unknown as Parameters<typeof registerRunRecovery>[0]["dispatchPayload"],
    sessionContext,
  });
  clog.info(`[twin-queue] redispatched queued twin sessionId=${body.sessionId} conv=${msg.conversationId} owner=${msg.userScopeId ?? "?"}`);
}

// ── S2S automation webhook handler for /webhook/:agentSlug ────────────────
//
// Why this exists, and why we don't reuse `/run`:
//   - `POST /claw/api/v1/run` (run.ts:243) is the user-facing dispatcher — it
//     reads cookies via `requireAuth`, only opens the S2S backdoor for testing,
//     and runs ~230 lines of attached-context / mention-expansion / chat-message
//     bookkeeping the spaces automation engine doesn't need (and shouldn't
//     trigger). Routing automations through it conflates two clients.
//   - The public Spaces event webhook shape is different from the automation
//     contract. Automations send `{sessionId, task, userId, callbackUrl, ...}`
//     and need the final callback to resume the workflow step.
//   - The target agent must be path-bound. The old bare `/webhook` route took
//     `agentSlug` from the body, which made the endpoint too broad.
export async function handleAutomationWebhook(
  req: Request,
  res: Response,
  pathAgentSlug: string,
  pathAgentOrgId?: string | null,
): Promise<void> {
  const payload = req.body as {
    sessionId?: string;
    agentSlug?: string;
    task?: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    callbackUrl?: string;
    callbackSecret?: string;
    context?: string;
    conversationId?: string | null;
    channelId?: string | null;
    channelName?: string | null;
    workspaceId?: string | null;
    allowWriteInReadOnlyJob?: boolean;
    executionProfile?: "sdlc";
    sdlcOperation?: "baseline" | "work" | "wiki";
    sdlcWikiRole?:
      | "BOOTSTRAP_SURVEY"
      | "BOOTSTRAP_PAGE"
      | "BOOTSTRAP_EDITOR"
      | "BOOTSTRAP"
      | "GENERATOR"
      | "ARCHITECTURE_VALIDATOR"
      | "CORRECTOR";
    sdlcContext?: Record<string, unknown>;
  };

  const { sessionId, userId, callbackUrl, callbackSecret, context } = payload;
  let task = payload.task;
  const agentSlug = pathAgentSlug;
  if (payload.agentSlug && payload.agentSlug !== pathAgentSlug) {
    res
      .status(400)
      .json({ success: false, error: `body agentSlug does not match path agent "${pathAgentSlug}"` });
    return;
  }

  // Field validation — fail fast with specific errors so the spaces side can
  // surface the actual problem instead of a generic 500 from claw-pod.
  const missing: string[] = [];
  if (!sessionId) missing.push("sessionId");
  if (!task) missing.push("task");
  if (!userId) missing.push("userId");
  if (!callbackUrl) missing.push("callbackUrl");
  if (missing.length > 0) {
    res.status(400).json({ success: false, error: `missing required fields: ${missing.join(", ")}` });
    return;
  }
  if (callbackSecret !== undefined && (typeof callbackSecret !== "string" || callbackSecret.length > 256)) {
    res.status(400).json({
      success: false,
      error: "callbackSecret must be a string of at most 256 characters",
    });
    return;
  }
  const externalResultCallback: ExternalResultCallbackConfig | undefined =
    callbackUrl && callbackSecret
      ? { url: callbackUrl, encryptedSecret: encryptSurfaceSecret(callbackSecret) }
      : undefined;

  // Agent existence + enabled check. Without this, spaces fires the run and
  // only finds out it was rejected when the (never-arriving) callback never
  // fires — turning a bad-slug typo into a silent hang on the automation side.
  // Phase-2 Design A: scope to the triggering user's org (global fallback when
  // unresolved).
  const automationOrgId = await orgIdForSpacesUser(userId, "scheduled-job", pathAgentOrgId ?? undefined);
  if (!automationOrgId) {
    clog.error(
      `[webhook/automation-run] orgId is required userId=${userId} agentSlug=${agentSlug} sessionId=${sessionId} callbackUrl=${callbackUrl ?? "none"}`,
    );
    res.status(400).json({ success: false, error: "orgId is required" });
    return;
  }
  const agent = await agentRepository.findBySlug(agentSlug, automationOrgId);
  if (!agent) {
    clog.warn(
      `[webhook/automation-run] agent org-scoped miss slug=${agentSlug} orgId=${automationOrgId ?? "none"} userId=${userId} sessionId=${sessionId}`,
    );
    res.status(404).json({ success: false, error: `agent "${agentSlug}" not found` });
    return;
  }
  if (!agent.enabled) {
    res.status(403).json({ success: false, error: `agent "${agentSlug}" is disabled` });
    return;
  }
  // Invocation whitelist — automations run under `userId` (the run owner); gate
  // them exactly like a human caller so "all surfaces" holds. Refused like
  // disabled (403), which the automation callback surfaces to the trigger.
  if (!isAgentInvocableBy(agent.config as Record<string, unknown> | null, userId)) {
    clog.warn(`[webhook/automation-run] invocation denied (not whitelisted) agent=${agentSlug} userId=${userId} sessionId=${sessionId}`);
    res.status(403).json({ success: false, error: `agent "${agentSlug}" is restricted — you don't have access to it` });
    return;
  }

  // Flatten the rich-text/HTML the Spaces automation builder sends (authored
  // prompt + resolved message.content, both HTML) to plain text so the agent
  // reads a clean prompt instead of <p>/<span> markup. No-op on plain strings.
  if (task) {
    task = htmlToPlainText(task);
  }

  // Workflow-step idempotency. The automation engine retries a step whose
  // async result hasn't arrived within its (~20s) ack window, re-sending the
  // SAME dispatch id suffixed `:retry-N` (observed prod 2026-07-08: a 24s run
  // executed 4x — original + retry-1..3). Every retry of one step must map to
  // the ONE already-running run: dedupe on the retry-stripped step id for the
  // lifetime of a plausible run. Deliberately conversation-INDEPENDENT —
  // workflow steps are usually conversation-less, which skips the
  // (conversation, agent) key below — and the reply is a 200 ack (not 409) so
  // the engine keeps waiting for the original run's result instead of
  // error-retrying. No release needed: retries share the base id only within
  // one firing; a future re-fire mints a fresh step id.
  if (typeof sessionId === "string" && sessionId.length > 0) {
    const stepBaseId = sessionId.replace(/:retry-\d+$/, "");
    const stepKey = `automation-step-dedup:${agentSlug}:${stepBaseId}`;
    try {
      const redis = redisService.getConnection();
      const acquiredStep = await redis.set(stepKey, sessionId, "EX", 900, "NX");
      if (acquiredStep !== "OK") {
        const holder = await redis.get(stepKey);
        if (holder && holder !== sessionId) {
          clog.info(
            `[webhook/automation-run] step retry absorbed step=${stepBaseId} incoming=${sessionId} holder=${holder} agent=${agentSlug}`,
          );
          res.status(200).json({ success: true, sessionId: holder, deduplicated: true });
          return;
        }
      }
    } catch (err) {
      clog.warn(
        `[webhook/automation-run] step dedup check failed step=${stepBaseId} agent=${agentSlug}: ${errMsg(err)}`,
      );
    }
  }

  if (typeof payload.conversationId === "string" && payload.conversationId.length > 0) {
    const dedupKey = automationRunDedupKey(payload.conversationId, agentSlug);
    try {
      const redis = redisService.getConnection();
      const acquired = await redis.set(dedupKey, sessionId!, "EX", AUTOMATION_RUN_DEDUP_TTL, "NX");
      if (acquired !== "OK") {
        const holder = await redis.get(dedupKey);
        if (holder && holder !== sessionId) {
          clog.warn(
            `[webhook/automation-run] duplicate automation run rejected conversationId=${payload.conversationId} agentSlug=${agentSlug} incomingSessionId=${sessionId} holderSessionId=${holder}`,
          );
          res.status(409).json({
            success: false,
            error: "duplicate automation run for this conversation and agent already in progress",
            deduplicated: true,
          });
          return;
        }
      }
    } catch (err) {
      clog.warn(
        `[webhook/automation-run] automation dedup check failed conversationId=${payload.conversationId} agentSlug=${agentSlug} sessionId=${sessionId}: ${errMsg(err)}`,
      );
    }
  }

  // Interpose on the result whenever the agent has a Spaces bot identity. When
  // we do, we route claw's callback back through claw-auth's /webhook/result
  // (instead of straight to the automation's callback) so we can resolve the
  // agent's plain `@Name`/`@email` mentions into clickable/notifying Spaces
  // mentions before the automation's REPLY_ON_MESSAGE posts them. The automation
  // has no human session, so resolution uses the agent's bot token + workspace
  // (derived from spacesAppUserId) — it does NOT need conversationId/channelId.
  // We deliberately do NOT gate on conversationId/channelId: automations that
  // create a NEW conversation have no conversationId at call time, yet still
  // need their mentions resolved (the resolve-and-forward path posts nothing
  // itself — it forwards the resolved text to the automation's callback, which
  // creates the conversation). Without a bot identity we keep the original
  // direct-callback behavior (no interposition, no mention resolution).
  const interpose = Boolean(
    callbackUrl && agent.spacesAppUserId && agent.spacesAppToken && agent.spacesAppId,
  );
  let automationSlotToken: string | null = null;
  const releaseAutomationSlot = async (): Promise<void> => {
    if (automationSlotToken && payload.conversationId) {
      await drainNextQueued(payload.conversationId, agentSlug, automationSlotToken).catch(() => {});
    }
  };
  if (QUEUE_ENABLED && interpose && payload.conversationId) {
    const slot = await tryAcquireSlot(payload.conversationId, agentSlug);
    automationSlotToken = slot;
    if (!slot) {
      const queuedMsg: QueuedMessage = {
        eventId: `automation:${sessionId}`,
        conversationId: payload.conversationId,
        channelId: payload.channelId ?? "",
        ...(payload.channelName ? { channelName: payload.channelName } : {}),
        userId: userId!,
        agentSlug,
        orgId: agent.orgId,
        ...(payload.workspaceId ? { workspaceId: payload.workspaceId } : {}),
        task: task!,
        eventType: "automation",
        ...(context ? { context } : {}),
        resultForwardUrl: callbackUrl!,
        resolveMentions: true,
        ts: Date.now(),
      };
      const enq = await enqueueMessage(queuedMsg);
      clog.info(
        `[webhook/automation-run] conv ${payload.conversationId} busy — queued automation session=${sessionId} enqueued=${enq.enqueued} deduped=${enq.deduped} full=${enq.full} pos=${enq.position}`,
      );
      if (enq.enqueued || enq.deduped) {
        res.status(202).json({ success: true, queued: true, sessionId });
      } else {
        res
          .status(enq.full ? 429 : 503)
          .json({
            success: false,
            error: enq.full ? "conversation queue is full" : "failed to queue automation run",
          });
      }
      return;
    }
  }
  if (interpose) {
    const appToken = decryptStoredField(agent.spacesAppToken!);
    const sessionContext: SessionContext = {
      mentionedUserId: agent.spacesAppUserId!,
      senderId: userId!,
      senderName: userId!,
      // conversationId/channelId may be absent for new-conversation automations.
      // The resolve-and-forward path doesn't read them; default to "" so the
      // typed context stays valid.
      channelId: payload.channelId ?? "",
      channelName: payload.channelName ?? payload.channelId ?? "",
      conversationId: payload.conversationId ?? "",
      // The automation's workspace — scopes the mention resolver's user lookups
      // (byName/byEmail/byHandle) so @email/@name resolve to the single user in
      // THIS workspace instead of matching the same person across workspaces
      // (treated as ambiguous → mention left raw). The bot app-user has no
      // workspace, so this must come from the automation dispatch.
      ...(payload.workspaceId ? { workspaceId: payload.workspaceId } : {}),
      task: task!,
      agentId: agent.id,
      agentOrgId: agent.orgId,
      agentSlug: agent.slug,
      responseMode: "conversation",
      appToken,
      spacesAppId: agent.spacesAppId!,
      spacesAppUserId: agent.spacesAppUserId!,
      rootAgentSlug: agent.slug,
      // Explicit automation marker — routes/mcp.ts keys the app-mode Spaces
      // MCP swap on this (not on the resolveMentions proxy).
      isAutomation: true,
      triggerSource: "automation",
      // Forward the resolved result to the automation's original callback (so
      // step-1.output.result carries clickable mentions) instead of posting a
      // bot message, and turn on mention resolution for that forward.
      ...(externalResultCallback
        ? { externalResultCallback }
        : { resultForwardUrl: callbackUrl!, resolveMentions: true }),
    };
    await setSession(sessionId!, sessionContext);
  }

  // Do NOT create an AgentRun row here. /internal/run preserves this trusted
  // sessionId and inserts the run row itself, deriving triggerSource="automation" from
  // eventType. A pre-insert under OUR sessionId created a SECOND row that no
  // execution or result callback ever referenced — it sat "running" forever
  // (the Control Center double-run report, 2026-07-08, and the ~1,400 zombie
  // rows the orphan-finalizer swept). CC visibility is unaffected: the
  // /internal/run insert happens within the forward round-trip below.

  // Proxy to claw-pod's internal /run. When interposing (see above) we route
  // claw's callback through claw-auth's own /webhook/result so we can resolve
  // mentions before forwarding to the automation's callback. That endpoint is
  // requireResultToken-gated, so we mint a per-run token and pass it; claw
  // echoes it as `x-session-token` on the callback. When NOT interposing we
  // pass the automation's callbackUrl straight through, as before.
  const clawCallbackUrl =
    interpose || externalResultCallback ? `${CONFIG.internalUrl}/claw/api/v1/webhook/result` : callbackUrl;

  // Read-only enforcement for automation runs lives in CODE (isReadOnlyJob), so
  // the write EXCEPTION is code-driven too — the CALLER declares it. When the
  // dispatch asks for it (the error-pipeline runner sets allowWriteInReadOnlyJob
  // so it can fix → build → push → PR), we merge it into the forwarded
  // agentConfig; claw already honors that flag on both gates (tool-palette strip
  // + sbx-git routing). Any caller that doesn't send it stays read-only, and no
  // per-agent DB flag is needed.
  const sdlcProfile =
    payload.executionProfile === "sdlc" &&
    agentSlug === "sdlc-agent" &&
    s2sKeyMatches(req.headers["x-s2s-key"]);
  const baseAgentConfig = (agent.config as Record<string, unknown> | null) ?? {};
  const baseTools = (baseAgentConfig["tools"] as Record<string, unknown> | undefined) ?? {};
  const wikiValidator =
    payload.sdlcWikiRole === "BOOTSTRAP_EDITOR" ||
    payload.sdlcWikiRole === "ARCHITECTURE_VALIDATOR";
  const wikiSurvey = payload.sdlcWikiRole === "BOOTSTRAP_SURVEY";
  const wikiPageWriter = payload.sdlcWikiRole === "BOOTSTRAP_PAGE";
  const sdlcOutputFormat =
    payload.sdlcOperation === "wiki" && wikiSurvey
      ? {
          type: "json",
          schema: {
            type: "object",
            properties: {
              repositorySummary: { type: "string" },
              pages: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    path: { type: "string" },
                    purpose: { type: "string" },
                    concepts: { type: "array", items: { type: "string" } },
                    priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                    archetype: {
                      type: "string",
                      enum: ["overview", "subsystem", "flow", "data-model", "interface", "operations", "decision"],
                    },
                    sourceAreas: { type: "array", items: { type: "string" } },
                    relatedPages: { type: "array", items: { type: "string" } },
                    tableCandidates: { type: "array", items: { type: "string" } },
                    diagramCandidates: { type: "array", items: { type: "string" } },
                  },
                  required: ["path", "purpose", "concepts", "priority", "archetype", "sourceAreas", "relatedPages", "tableCandidates", "diagramCandidates"],
                },
              },
            },
            required: ["repositorySummary", "pages"],
          },
          requireToolsBeforeSubmit: [...SDLC_REQUIRED_TOOLS.wikiSurvey],
        }
      : payload.sdlcOperation === "wiki" && wikiValidator
        ? {
            type: "json",
            schema: {
              type: "object",
              properties: {
                complete: { type: "boolean" },
                missingTopics: { type: "array", items: { type: "string" } },
                issues: { type: "array", items: { type: "string" } },
                suggestions: { type: "array", items: { type: "string" } },
              },
              required: ["complete", "missingTopics", "issues", "suggestions"],
            },
          }
        : payload.sdlcOperation === "wiki"
          ? {
              type: "json",
              schema: {
                type: "object",
                properties: { completed: { type: "boolean" } },
                required: ["completed"],
              },
          requireToolsBeforeSubmit: wikiPageWriter
            ? [...SDLC_REQUIRED_TOOLS.wikiPage]
            : [...SDLC_REQUIRED_TOOLS.wikiFinalize],
            }
    : payload.sdlcOperation === "work"
      ? {
          type: "json",
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              branchName: { type: "string" },
              commitHash: { type: "string" },
              pullRequestUrl: { type: "string" },
            },
            required: ["summary", "branchName", "commitHash", "pullRequestUrl"],
          },
          requireToolsBeforeSubmit: [...SDLC_REQUIRED_TOOLS.work],
        }
      : {
          type: "json",
          schema: {
            type: "object",
            properties: {
              created: { type: "boolean" },
              canvasId: { type: "string" },
              artifactKind: { type: "string" },
            },
            required: ["created", "canvasId", "artifactKind"],
          },
          requireToolsBeforeSubmit: [...SDLC_REQUIRED_TOOLS.baseline],
        };
  const forwardedAgentConfig: Record<string, unknown> | undefined =
    agent.config || payload.allowWriteInReadOnlyJob || sdlcProfile
      ? {
          ...baseAgentConfig,
          ...(payload.allowWriteInReadOnlyJob || sdlcProfile ? { allowWriteInReadOnlyJob: true } : {}),
          ...(sdlcProfile
            ? {
                tools: {
                  ...baseTools,
                  direct: SDLC_AGENT_TOOL_PROFILE.tools.direct,
                  custom: SDLC_AGENT_TOOL_PROFILE.tools.custom,
                  subagents: SDLC_AGENT_TOOL_PROFILE.tools.subagents,
                },
                toolPermissions: {
                  ...((baseAgentConfig["toolPermissions"] as Record<string, unknown> | undefined) ?? {}),
                  ...SDLC_AGENT_TOOL_PROFILE.toolPermissions,
                },
                outputFormat: sdlcOutputFormat,
                sdlcContext: payload.sdlcContext,
              }
            : {}),
        }
      : undefined;
  const resultToken = interpose
    ? mintSessionToken({
        sessionId: sessionId!,
        userId: userId!,
        agentSlug,
        ...(agent.spacesAppId ? { spacesAppId: agent.spacesAppId } : {}),
        ttlSeconds: 3600,
      })
    : undefined;
  const fastModeEnabled = await resolveFastMode(payload.conversationId, agentSlug, forwardedAgentConfig);

  // Resolve the agent's configured provider so an automation run uses the same
  // (premium) model a human chat would — not the platform default. Headless:
  // agent-level creds only, honoring the agent's providerAlwaysOn policy.
  // [AUTODBG] instrument the whole dispatch window — automations were observed
  // stalling silently right after [agent-run] start (no forward, no error).
  clog.info(
    `[webhook] AUTODBG ${sessionId}: after AgentRun.start — resolving provider configs (agent=${agentSlug}, interpose=${interpose})`,
  );
  const __t0 = process.hrtime.bigint();
  let providerConfigs: Awaited<ReturnType<typeof resolveAgentProviderConfigs>>["providerConfigs"] = {};
  let providerOrder: Awaited<ReturnType<typeof resolveAgentProviderConfigs>>["providerOrder"] = [];
  let providerParent: string | undefined;
  try {
    // headlessBulk: this handler serves automations, external webhooks, and
    // the error-pipeline runner — the per-agent automationProvider downgrade
    // applies here (never to human chat/mention dispatches).
    ({
      providerConfigs,
      providerOrder,
      parent: providerParent,
    } = await resolveAgentProviderConfigs(agent, { headlessBulk: true }));
  } catch (provErr) {
    clog.error(
      `[webhook] AUTODBG ${sessionId}: resolveAgentProviderConfigs THREW: ${provErr instanceof Error ? provErr.stack || provErr.message : String(provErr)}`,
    );
    await releaseAutomationSlot();
    res.status(502).json({ success: false, error: "provider config resolution failed" });
    return;
  }
  const __provMs = Number((process.hrtime.bigint() - __t0) / 1_000_000n);
  clog.info(
    `[webhook] AUTODBG ${sessionId}: provider configs resolved in ${__provMs}ms (configs=${Object.keys(providerConfigs).length}, order=${providerOrder.length}) — forwarding to ${CONFIG.internalUrl}/claw/api/v1/internal/run`,
  );

  let runRes: Response | undefined;
  try {
    runRes = (await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-s2s-key": CONFIG.xyneClawS2sKey,
      },
      body: JSON.stringify({
        sessionId,
        agentSlug,
        orgId: agent.orgId,
        task,
        userId,
        ...(payload.userName ? { userName: payload.userName } : {}),
        ...(payload.userEmail ? { userEmail: payload.userEmail } : {}),
        eventType: "automation",
        // SDLC callers are callback-driven and only need the accepted session
        // id here. Without detached mode this request enters the SSE bridge,
        // whose event-consumption loop can delay flushing the outer webhook
        // response during event-heavy setup runs. The Spaces backend then
        // times out even though Claw continues successfully.
        ...(sdlcProfile ? { detached: true } : {}),
        callbackUrl: clawCallbackUrl,
        ...(resultToken ? { sessionToken: resultToken } : {}),
        ...(forwardedAgentConfig ? { agentConfig: forwardedAgentConfig } : {}),
        fastMode: fastModeEnabled,
        // Primary provider — the pod keys its model off `provider` (defaults to
        // "spaces"/kimi when unset), so without this every automation ran on
        // the platform default regardless of the agent's configured provider.
        ...(providerParent ? { provider: providerParent } : {}),
        ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
        ...(providerOrder.length > 1 ? { providerOrder } : {}),
        ...(context ? { context } : {}),
        ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
        ...(payload.channelId ? { channelId: payload.channelId } : {}),
        progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
      }),
      // [AUTODBG] the original fetch had NO timeout — a hung /internal/run would
      // freeze this handler forever with no log. Bound it so a hang surfaces.
      signal: AbortSignal.timeout(180_000),
    })) as unknown as Response;
  } catch (err) {
    clog.error(
      `[webhook] AUTODBG forward to claw-pod failed for session ${sessionId} after ${Number((process.hrtime.bigint() - __t0) / 1_000_000n)}ms: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    );
    await releaseAutomationSlot();
    res.status(502).json({ success: false, error: "failed to reach claw-pod" });
    return;
  }

  // Pass through claw-pod's response code + body so the automation engine
  // can distinguish "claw rejected" from "claw-auth rejected".
  const status = (runRes as unknown as { status: number }).status;
  const text = await (runRes as unknown as { text: () => Promise<string> }).text();
  clog.info(
    `[webhook] AUTODBG ${sessionId}: /internal/run responded status=${status} bodyLen=${text.length} body=${text.slice(0, 200)}`,
  );
  if (status < 200 || status >= 300) {
    await releaseAutomationSlot();
  }
  let runSessionId = sessionId!;
  try {
    const parsed = JSON.parse(text) as { sessionId?: string };
    if (parsed.sessionId) runSessionId = parsed.sessionId;
  } catch {
    // Non-JSON body — retain the caller-provided session id.
  }
  if (externalResultCallback && status >= 200 && status < 300) {
    const storedRun = await prisma.agentRun.findUnique({
      where: { sessionId: runSessionId },
      select: { metadata: true },
    });
    const metadata =
      storedRun?.metadata && typeof storedRun.metadata === "object" && !Array.isArray(storedRun.metadata)
        ? (storedRun.metadata as Record<string, unknown>)
        : {};
    await prisma.agentRun.update({
      where: { sessionId: runSessionId },
      data: { metadata: { ...metadata, externalResultCallback } },
    });
  }

  // Crash/stall resilience — ONLY for interposed runs. When interposing, the
  // result routes through claw-auth's /webhook/result (so recovery's stored
  // SessionContext + exhausted-notice poster apply) and we hold the agent's app
  // identity. We key recovery off the preserved authoritative sessionId so the
  // GCS idempotency marker and the
  // progress-heartbeat → root mapping line up. If claw-pod stalls without a
  // completed-result marker, the worker replays this payload under a fresh
  // session — idempotency-keyed, so a finished run is never re-forwarded (no
  // double workflow-step advance). Non-interpose runs callback straight to the
  // automation engine, which owns its own retry; we deliberately don't layer on.
  if (interpose && status >= 200 && status < 300) {
    const recoveryPayload = {
      userId: userId!,
      task: task!,
      conversationId: payload.conversationId ?? "",
      agentSlug,
      orgId: agent.orgId,
      eventType: "automation",
      traceId: "",
      callbackUrl: clawCallbackUrl!,
      progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
      channelId: payload.channelId ?? "",
      ...(payload.workspaceId ? { workspaceId: payload.workspaceId } : {}),
      ...(resultToken ? { sessionToken: resultToken } : {}),
      ...(forwardedAgentConfig ? { agentConfig: forwardedAgentConfig } : {}),
      fastMode: fastModeEnabled,
      ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
      ...(providerOrder.length > 1 ? { providerOrder } : {}),
      // Primary provider must survive a recovery replay too — without it the
      // retried run silently downgrades to the platform default.
      ...(providerParent ? { provider: providerParent } : {}),
      ...(context ? { context } : {}),
    };
    const recoveryCtx: RecoverySessionContext = {
      mentionedUserId: agent.spacesAppUserId!,
      senderId: userId!,
      senderName: userId!,
      channelId: payload.channelId ?? "",
      channelName: payload.channelName ?? payload.channelId ?? "",
      conversationId: payload.conversationId ?? "",
      task: task!,
      agentSlug: agent.slug,
      responseMode: "conversation",
      appToken: decryptStoredField(agent.spacesAppToken!),
      spacesAppId: agent.spacesAppId!,
      spacesAppUserId: agent.spacesAppUserId!,
      ...(payload.workspaceId ? { workspaceId: payload.workspaceId } : {}),
      // Explicit automation marker — see SessionContext.isAutomation. Set
      // unconditionally: a plain-callback automation (no externalResultCallback,
      // no interpose) otherwise carries NEITHER forward flag, and a recovery
      // replay of it would be indistinguishable from an interactive run.
      isAutomation: true,
      // Carry the automation's forward target through recovery. claw calls back
      // with its own sessionId (misses the Redis session keyed by the dispatch
      // id), so /webhook/result resolves ctx from THIS recovery context. Mirror
      // the interpose session (line ~2252): forward the result to the
      // automation's callback instead of posting to a (nonexistent) channel.
      ...(externalResultCallback
        ? { externalResultCallback }
        : interpose
          ? { resultForwardUrl: callbackUrl!, resolveMentions: true }
          : {}),
    };
    await registerRunRecovery({
      rootSessionId: runSessionId,
      maxRetries: CONFIG.runRecoveryMaxRetries,
      timeoutMs: CONFIG.runRecoveryTimeoutMs,
      retryBackoffMs: CONFIG.runRecoveryBackoffMs,
      dispatchPayload: recoveryPayload,
      sessionContext: recoveryCtx,
    }).catch((err) => {
      clog.warn(
        `[webhook] registerRunRecovery non-fatal for ${runSessionId}: ${errMsg(err)}`,
      );
    });
  }

  res.status(status).type("application/json").send(text);
}

/**
 * Forward a finished run's result to a caller-supplied URL (Spaces auto-draft
 * callback / any automation forward). Best-effort, s2s-signed; matches the
 * autodraft-callback payload shape the Spaces side expects.
 */
async function forwardResult(
  url: string,
  payload: {
    sessionId?: string;
    status?: string;
    error?: string;
    attachments?: OutgoingAttachment[];
  },
  result: string,
): Promise<void> {
  // The Spaces automation RUN_AGENT executor (backend/src/automations/steps/
  // run-agent.step.ts) reads the forwarded `result` field, runs JSON.parse on it
  // (parseAgentJson) and validates the parsed object against the step's
  // outputSchema. Plain-text/markdown results must be wrapped as
  // `{"result":"<text>"}` so the executor still produces a parseable object and
  // downstream steps see `output.result = <text>`. Structured JSON output is
  // already a JSON object string, so wrapping it again double-encodes the
  // payload and breaks the schema check. We therefore forward JSON object
  // strings unchanged and only wrap plain text. Non-automation forward targets
  // (Spaces auto-draft) keep the raw text so they don't suddenly receive
  // escaped JSON.
  const isAutomationCallback = url.includes("/automations/claw-callback/");
  const resultField = isAutomationCallback ? coerceAutomationForwardResult(result) : result;
  const forwardToInternal = isInternalCallbackOrigin(url);
  // Origin only — the full URL can carry a secret path segment.
  const targetOrigin = (() => { try { return new URL(url).origin; } catch { return "(unparseable)"; } })();
  // A dropped forward means the automation upstream waits forever for a result
  // that will never arrive, so every non-delivery outcome here must be LOUD:
  // error-level, event-tagged for the log bridge, and counted as a metric —
  // not a warn that scrolls past.
  const forwardFailure = (outcome: string, detail: string): void => {
    clog.error(`[webhook/result] resultForward ${outcome} session=${payload.sessionId} origin=${targetOrigin} ${detail}`, {
      event: "result_forward_failed",
      sessionId: payload.sessionId,
      outcome,
      origin: targetOrigin,
      internal: forwardToInternal,
      automationCallback: isAutomationCallback,
    });
    clog.info([
      "[metric]",
      "name=result_forward",
      "kind=count",
      `outcome=${outcome}`,
      `internal=${forwardToInternal}`,
      `automation=${isAutomationCallback}`,
    ].join(" "));
  };
  if (!forwardToInternal && !isAllowedExternalCallbackUrl(url)) {
    forwardFailure("refused_origin", "target origin is neither internal nor an allowed external callback — result DROPPED");
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(forwardToInternal && CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({
        sessionId: payload.sessionId,
        status: payload.status,
        result: resultField,
        ...(payload.error ? { error: payload.error } : {}),
        ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
      }),
    });
    if (!res.ok) {
      // 401/403 on an internal-classified target is the L-18 misconfiguration
      // signature (callback origin not in selfUrl/internalUrl/xyneClawUrl, or
      // key mismatch) — the detail names it so the fix is obvious from the log.
      const authHint = res.status === 401 || res.status === 403
        ? " (auth rejected — check the callback origin against SELF_URL/INTERNAL_URL/XYNE_CLAW_URL and the S2S key)"
        : "";
      forwardFailure(`http_${res.status}`, `delivery rejected by target${authHint}`);
    }
  } catch (err) {
    forwardFailure("network_error", errMsg(err));
  }
}

// ── POST /webhook/result — callback from xyne-claw (MUST be before /:agentSlug) ──

/**
 * Persist the callback's base64 attachments as chat_attachments rows on an
 * assistant message (GCS upload + row per file) — mirrors what the run-stream
 * (interactive chat) persist does. Without this, files produced by headless
 * runs (automations, the error-pipeline doctor) exist only as Spaces posts
 * and the claw chat / error-pipeline UIs have nothing to show.
 * Best-effort per file: one bad attachment never blocks the rest.
 */
async function persistCallbackAttachments(
  chatMessageId: string,
  uploaderUserId: string,
  attachments: Array<{ fileName: string; mimeType: string; data: string }> | undefined,
): Promise<Array<{ id: string; originalFilename: string; mimeType: string }>> {
  return persistBase64ChatAttachments(chatMessageId, uploaderUserId, attachments);
}

/**
 * Auto-publish for /design and /dashboard runs delivered into Spaces threads: the thread
 * already holds the artifact file, so mint (or refresh) the conversation's
 * stable share link and post it — one click to the rendered design instead of
 * a download. Reuses the Studio share model: per (owner, conversation) row,
 * revocable from Studio, opaque-origin serving. Best-effort — a share failure
 * must never disturb the delivered result.
 */
async function publishThreadArtifactShare(
  ctx: SessionContext,
  runOwnerId: string,
  created: Array<{ id: string; originalFilename: string; mimeType: string }>,
): Promise<void> {
  try {
    const command = ctx.task?.trimStart().toLowerCase().match(/^\/(design|dashboard)(?:\s|$)/)?.[1];
    if (!command) return;
    if (ctx.responseMode !== "conversation" || !ctx.conversationId || !ctx.agentOrgId) return;
    const html = [...created].reverse().find((a) =>
      a.mimeType.toLowerCase().includes("html") || a.originalFilename.toLowerCase().endsWith(".html"),
    );
    if (!html) return;
    const share = await upsertDesignShare({
      ownerUserId: runOwnerId,
      orgId: ctx.agentOrgId,
      conversationId: ctx.conversationId,
      attachmentId: html.id,
      title: html.originalFilename.replace(/\.html?$/i, ""),
      expiresAt: null,
    });
    const link = designShareUrl(share.sharePath);
    await spacesAppFetch("/chat/postMessage", {
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      markdownText: `🔗 **Live ${command}:** ${link}\nOpens the rendered snapshot in the browser — the same link updates with future revisions in this thread.`,
      userId: ctx.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, ctx.appToken);
    clog.info(`[webhook/result] posted design share link shareId=${share.id} conv=${ctx.conversationId}`);
  } catch (err) {
    clog.warn(`[webhook/result] design share publish failed (non-fatal): ${errMsg(err)}`);
  }
}

router.post("/result", requireStrictS2S, requireResultToken((req) => (req.body as { sessionId?: string })?.sessionId), async (req: Request, res: Response) => {
  const payload = req.body as {
    sessionId?: string;
    userId?: string;
    status?: string;
    result?: string;
    reasoning?: string;
    error?: string;
    toolsUsed?: string[];
    toolInvocations?: unknown;
    tokenUsage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    latency?: {
      totalMs?: number;
      llmTotalMs?: number;
      llmDecodeMs?: number;
      llmWaitMs?: number;
      llmTurns?: number;
      llmRetries?: number;
      firstTurnTtftMs?: number;
      tokensPerSec?: number;
      toolMs?: number;
      lastRetryReason?: string;
    };
    attachments?: Array<{ fileName: string; mimeType: string; data: string }>;
    pendingResponses?: Array<{ responseId: string; message: string }>;
    // Set when the worker called the suggest-goal tool. claw-auth renders a
    // one-click button below the agent's reply so the user can promote the
    // remaining work to a /goal autonomous loop. See start-goal handling in
    // flow-action.ts. Only present when the agent's config has
    // suggestGoal=true AND the tool was actually called this turn.
    pendingGoalSuggestion?: { condition: string; rationale: string };
    provider?: string;
    model?: string;
    localHarness?: {
      provider: string;
      harnessName: string;
      label: string;
      ownerName: string;
      deviceName?: string;
    };
    localHarnessUnreachable?: boolean;
    localHarnessProvider?: string;
    fastMode?: boolean;
    // Conversation identity claw ships on every callback (see
    // xyne-claw/src/routes/run.ts:1040-1046). Used by the conv-keyed
    // fallback below — needed because /goal refires (and other code paths
    // that re-dispatch /run) mint a fresh sessionId that claw-auth never
    // registered, so the per-sessionId lookup misses.
    conversationId?: string | null;
    agentSlug?: string | null;
    // Set by claw when a run delivered nothing user-visible AFTER a provider
    // fallback (429 / quota / empty completion). Lets the empty-result notice
    // below tell the user it was a provider capacity issue — with the safe
    // underlying detail (e.g. "HTTP 429 quota_exceeded") — instead of the
    // generic "I wasn't able to produce a response". See xyne-claw run.ts.
    emptyReason?: "provider_capacity";
    emptyReasonDetail?: string;
    // Digital Twin mention flow: the structured delivery produced by the
    // mandatory twin_deliver tool (react and/or reply, and where). Absent when
    // the model never delivered — claw-auth then stays silent (fail-closed).
    twinDelivery?: TwinDelivery;
    // Plan mode: set by claw's propose-plan terminal tool when a plan-mode
    // Turn 1 finishes. Renders the plan card in the thread (proposed → Approve
    // gate, or trivial → auto-execute Turn 2). Wire contract, never for twin.
    pendingPlan?: { title: string; desc?: string; document?: string; todos: Array<{ id: string; title: string }>; trivial: boolean };
    // Agent authoring: set by claw's propose-agent terminal tool. Renders the
    // `agent` artifact card (variant "draft", phase "pending") and awaits the
    // user's approval — nothing is created until they approve. A union because
    // the same card serves other agent surfaces (a read-only profile next).
    pendingAgentCard?:
      | { variant: "draft"; agent: DraftAgentSpec }
      | { variant: "profile"; slug?: string }
      // "which agents can do X?" — a stack of read-only cards, capped server-side.
      | { variant: "profile-list"; slugs: string[] }
      // "list all my agents" — counts only, with a link into the library.
      | { variant: "summary" };
    // Connector cards to post alongside the reply, so the user can connect
    // without leaving the conversation.
    pendingConnectorSuggestions?: PendingConnectorSuggestions;
  };

  const sessionId = payload.sessionId ?? "";

  // Acknowledge immediately (per-run token already verified by
  // requireResultToken middleware).
  res.json({ success: true });

  // Free the twin concurrency slot on ANY terminal callback (completed /
  // failed / handoff). Cheap no-op ZREM for non-twin sessions; the limiter's
  // TTL prune is the backstop when a callback never arrives.
  if (sessionId) void releaseTwinSlot(sessionId);

  if (payload.status === "handoff") {
    const lastTurn = typeof (payload as { lastTurn?: unknown }).lastTurn === "number"
      ? (payload as { lastTurn: number }).lastTurn
      : undefined;
    clog.info(`[webhook/result] handoff callback session=${sessionId} conversation=${payload.conversationId ?? ""} agent=${payload.agentSlug ?? ""} lastTurn=${lastTurn ?? "unknown"}`);
    const handoff = await handleRunHandoff(sessionId).catch((err) => {
      clog.warn(`[webhook/result] handoff re-dispatch failed session=${sessionId}:`, errMsg(err));
      return null;
    });
    if (handoff) {
      clog.info(`[webhook/result] handoff re-dispatched root=${handoff.rootSessionId} newSession=${handoff.newSessionId}`);
    } else if (await hasActiveRunRecovery(sessionId).catch(() => false)) {
      // A failed handoff dispatch schedules a recovery retry. A duplicate/stale
      // handoff can also race a live continuation; both will produce a result later.
      clog.info(`[webhook/result] handoff continuation remains active session=${sessionId}`);
    } else {
      clog.warn(`[webhook/result] handoff callback had no recovery state session=${sessionId}`);
      // No new run was dispatched, so this handoff is terminal for an external
      // caller. Notify it now instead of waiting for a result that cannot arrive.
      let handoffCtx = await resolveSessionContext(sessionId, payload.conversationId, payload.agentSlug, payload.userId);
      handoffCtx = await ensureSessionContextOrg(handoffCtx, sessionId);
      let callback = handoffCtx?.externalResultCallback;
      if (!handoffCtx && sessionId) {
        const storedRun = await agentRunRepository.findBySessionId(sessionId).catch(() => null);
        const metadata = storedRun?.metadata as { externalResultCallback?: ExternalResultCallbackConfig } | null | undefined;
        callback = metadata?.externalResultCallback;
      }
      if (callback) {
        await sendStoredExternalResultCallback(callback, {
          sessionId,
          status: "failed",
          result: "",
          error: "run_handoff_not_recoverable",
        });
        await deleteSession(sessionId);
      }
    }
    return;
  }

  // ── Mid-run message queue: this /result is the END of the active run for
  // this conversation. On EVERY exit path below (success, empty, failed, early
  // return, thrown error) the `finally` drains the next queued message or
  // releases the slot — UNLESS a /goal turn is continuing (goalContinues),
  // which keeps the slot so the loop owns the conversation across turns.
  let goalContinues = false;
  let experimentContinues = false;
  let skipQueueDrain = false;
  // Recovery continuations execute under fresh physical AgentRun ids, while
  // external callers (including SDLC Wiki) remain bound to the original
  // logical run id. Capture the root returned by recovery settlement and use
  // it only for the external callback identity.
  let externalCallbackSessionId = sessionId;
  let resultConversationId = payload.conversationId ?? "";
  let resultAgentSlug = payload.agentSlug ?? "";
  // Per-user twin FIFO scope for the finalizer's drain. MUST be declared at THIS
  // scope (not inside the try) so the approval-mode early return — the twin case —
  // still drains the right owner's queue in the finally. Empty for non-twin.
  let resultUserScope = "";
  let dedupReleaseConversationId = "";
  let dedupReleaseAgentSlug = "";
  try {
    if (sessionId && payload.status === "failed" && payload.error === "sse stream broken") {
      const existingRun = await agentRunRepository.findBySessionId(sessionId).catch(() => null);
      if (existingRun && existingRun.status !== "running") {
        clog.info(`[webhook/result] duplicate broken-SSE terminal for ${sessionId}; existing status=${existingRun.status}, skipping`);
        skipQueueDrain = true;
        return;
      }
    }

    let ctx = await resolveSessionContext(
      sessionId,
      payload.conversationId,
      payload.agentSlug,
      // Twin runs are per-user: disambiguate the conv-index fallback by the
      // mentioned user claw echoes back, else two twins in one thread collide.
      payload.userId,
    );
    ctx = await ensureSessionContextOrg(ctx, sessionId);
    resultConversationId = ctx?.conversationId ?? resultConversationId;
    resultAgentSlug = ctx?.agentSlug ?? resultAgentSlug;
    // Twin runs are drained per-owner (mentionedUserId = the twin owner). Only
    // digital-twin uses a user-scoped queue; everything else stays unscoped.
    resultUserScope = ctx?.agentSlug === "digital-twin" ? (ctx?.mentionedUserId ?? "") : "";
    dedupReleaseConversationId = ctx?.conversationId ?? "";
    dedupReleaseAgentSlug = ctx?.agentSlug ?? "";

  // ── Digital Twin mention flow (approval) ───────────────────────────────────
  // The run delivered a STRUCTURED proposal via the mandatory twin_deliver tool.
  // Route it straight to the approve/decline DM — NONE of the conversation-reply
  // processing below (citations, memory-search footer, thread posting) runs, so
  // the user never sees process narration or tool footers. Fail-CLOSED: if the
  // model never delivered (no twinDelivery), the Twin wasn't confident enough to
  // speak, so we stay silent rather than posting anything.
  if (ctx?.responseMode === "approval" && payload.status === "completed") {
    // The RUN itself completed successfully — the twin merely chose HOW to act
    // (deliver a draft / react / ignore / stay silent). Finalize the AgentRun
    // and settle run-recovery HERE, before the early return below, exactly as
    // the conversation-mode path does at its own finalize/handleRunCompletion
    // sites. Skipping this was leaving every delivered twin reply stuck
    // "running" until an orphan-reaper mislabeled it "interrupted (orphaned
    // run)" (65 of 72 orphans had actually called twin_deliver), and left stale
    // recovery state that could spuriously re-fire the run.
    // Persist the twin's OUTCOME as an assistant message in the owner's
    // control-center chat so the conversation reads query → reply → query
    // (LINEAR — no `<x/y>` branch pager). The frontend groups CONSECUTIVE
    // same-role messages as sibling variants (resolveEffectiveParents), and a
    // twin thread is otherwise ALL user rows — its real reply is a Spaces draft,
    // never an assistant row — so 3 rapid tags rendered as 3 branches. This also
    // lets the owner SEE what their twin drafted (previously only the raw run
    // debug showed it). Tagged to the owner (mentionedUserId = run owner) so the
    // /messages ACL groups it with the mention; created BEFORE finalize so the
    // run links to it via chatMessageId.
    const twinDelivered = payload.twinDelivery;
    const twinOutcomeText =
      twinDelivered?.action === "ignore"
        ? "_Chose not to reply to this._"
        : isTwinDelivery(twinDelivered)
          ? typeof twinDelivered.message === "string" && twinDelivered.message.trim()
            ? twinDelivered.emoji
              ? `${twinDelivered.emoji} ${twinDelivered.message.trim()}`
              : twinDelivered.message.trim()
            : twinDelivered.emoji
              ? `Reacted ${twinDelivered.emoji}`
              : "_Drafted a reply._"
          : "_Stayed silent — not confident enough to reply._";
    let twinAssistantMsgId: string | undefined;
    if (ctx.conversationId && ctx.agentSlug && ctx.agentOrgId && ctx.mentionedUserId) {
      try {
        const outcomeMsg = await chatMessageRepository.create({
          conversationId: ctx.conversationId,
          agentSlug: ctx.agentSlug,
          userId: ctx.mentionedUserId,
          orgId: ctx.agentOrgId,
          role: "assistant",
          content: twinOutcomeText,
          status: "completed",
          ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
        });
        twinAssistantMsgId = outcomeMsg.id;
      } catch (e) {
        clog.warn(`[webhook/result] Twin: failed to persist outcome chat message for ${sessionId}: ${errMsg(e)}`);
      }
    }

    if (sessionId) {
      const deliveredText =
        isTwinDelivery(payload.twinDelivery) && typeof payload.twinDelivery.message === "string"
          ? payload.twinDelivery.message
          : null;
      agentRunRepository.finalize(sessionId, {
        status: "completed",
        result: deliveredText,
        error: null,
        ...(twinAssistantMsgId ? { chatMessageId: twinAssistantMsgId } : {}),
        ...(payload.provider !== undefined ? { provider: payload.provider } : {}),
        ...(payload.model !== undefined ? { model: payload.model } : {}),
        ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
        toolsUsed: payload.toolsUsed ?? [],
        ...(payload.toolInvocations !== undefined ? { toolInvocations: payload.toolInvocations } : {}),
        ...(payload.tokenUsage ? { tokenUsage: payload.tokenUsage } : {}),
        ...(payload.latency ? { latency: payload.latency } : {}),
        ...(payload.fastMode !== undefined ? { fastMode: payload.fastMode === true } : {}),
      }).catch(() => {});
      await handleRunCompletion(sessionId, "completed").catch((err) => {
        clog.warn(`[webhook/result] Twin: failed to settle run recovery for ${sessionId}:`, err instanceof Error ? err.message : err);
      });
    }

    // action="ignore" is a CONFIDENT decision to post nothing. It is a valid
    // delivery (isTwinDelivery returns true), so this MUST be checked BEFORE the
    // dispatch below — otherwise it would wrongly open an approval DM. Drop it and
    // end the session; no DM, no post, no pending feedback row.
    if (payload.twinDelivery?.action === "ignore") {
      clog.info(`[webhook/result] Digital Twin chose to ignore — dropping, no DM/post, session ${sessionId}`);
      await deleteSession(sessionId);
    } else if (isTwinDelivery(payload.twinDelivery)) {
      await sendTwinReplyDraft(ctx, payload.twinDelivery, payload.toolInvocations, sessionId, payload.attachments);
    } else {
      clog.info(`[webhook/result] Digital Twin stayed silent — no twin_deliver delivery (fail-closed), session ${sessionId}`);
      await deleteSession(sessionId);
    }
    return;
  }

  // Digital Twin response-suffix. If the responding agent is `digital-twin`
  // and the *target user* (the person the Twin is acting as) has configured
  // a suffix string, append it to the result text below. This lets users add
  // their own disclaimer / signature without us inferring intent from the
  // LLM ("please add a footer" via prompt is unreliable; a deterministic
  // server-side append is what people actually want).
  if (ctx?.agentSlug === "digital-twin" && ctx.mentionedUserId && typeof payload.result === "string") {
    try {
      const u = await prisma.user.findUnique({
        where: { id: ctx.mentionedUserId },
        select: { digitalTwinResponseSuffix: true },
      });
      const suffix = u?.digitalTwinResponseSuffix?.trim();
      if (suffix && suffix.length > 0 && !payload.result.endsWith(suffix)) {
        // Two newlines so the suffix sits visually separated from the body.
        // Idempotent: skip the append if the agent already happened to end
        // with the user's exact suffix string (rare but cheap to check).
        payload.result = `${payload.result.trimEnd()}\n\n${suffix}`;
      }
    } catch (err) {
      clog.warn(`[webhook/result] Twin suffix lookup failed for user ${ctx.mentionedUserId}: ${errMsg(err)}`);
      // Non-fatal — the reply still posts, just without the user's suffix.
    }
  }

  // Per-agent citation toggle: `config.replyOptions.includeCitations === true`
  // OPTS IN to the "### Citations" section appended to the reply. Default is
  // false now — the citation block was noisy and not wanted by most agents.
  // Agents that explicitly want it (e.g. research agents) can re-enable it
  // via agent.config.replyOptions.includeCitations = true.
  let includeCitations = false;
  if (ctx?.agentSlug && ctx.agentOrgId) {
    try {
      const agentRow = await agentRepository.findBySlug(ctx.agentSlug, ctx.agentOrgId);
      const replyOpts = (agentRow?.config as { replyOptions?: { includeCitations?: boolean } } | undefined)?.replyOptions;
      if (replyOpts && replyOpts.includeCitations === true) includeCitations = true;
    } catch {
      // Non-fatal — fall back to default (no citations).
    }
  }

  const llmCitations = (payload as { llmCitations?: unknown }).llmCitations;

  let resultWithCitations = payload.status === "completed" && payload.result
    ? appendCitations(payload.result, payload.toolInvocations, {
      baseUrl: CONFIG.spacesAppUrl,
      includeCitations,
      ...(ctx?.channelId ? { defaultChannelId: ctx.channelId } : {}),
    }, llmCitations)
    : payload.result ?? "";

  // Memory footer: count successful memory-search tool invocations for the run
  // and append a single italic line. Tool-based recall replaced prefetch-and-inject
  // — the agent now searches on demand, so the footer reflects calls, not facts.
  const memorySearchCount = Array.isArray(payload.toolInvocations)
    ? (payload.toolInvocations as Array<{ toolName?: string; isError?: boolean }>).filter(
        (inv) => inv.toolName === "memory-search" && inv.isError !== true,
      ).length
    : 0;
  if (payload.status === "completed" && resultWithCitations.trim() && memorySearchCount > 0) {
    const label = memorySearchCount === 1 ? "time" : "times";
    resultWithCitations = `${resultWithCitations.trimEnd()}\n\n_Searched agent memory ${memorySearchCount} ${label}._`;
  }

  // Pending write-action footer: a DETERMINISTIC, per-action-honest correction.
  // Write tools now live in child subagent palettes too, so a parent (or child)
  // can queue a signed write and then narrate as if it already ran. The write is
  // execution-gated (nothing runs until the approval card is approved), but two
  // things could still mislead the user: (1) the narration claims success, and
  // (2) the approval card is SKIPPED when the target channel isn't app-accessible
  // (see the loop below, which validates and `continue`s). Before that skip was
  // silent — the user saw "queued, approve it" and no card ever came.
  //
  // Fix: validate every queued write HERE, against the same target-validation the
  // card loop uses, and (a) stash the result so the loop reuses it — the footer
  // can never claim a card the loop then drops — and (b) split the footer into
  // "actually queued" vs "could NOT be queued (with reason)". A rejected action
  // is stated as a failure, so there is no silent "queued" exit. The warning
  // fires even on an empty result (seeding the message) because a dropped card
  // must always be surfaced.
  const pendingActionList = Array.isArray(
    (payload as { pendingActions?: Array<Record<string, unknown>> }).pendingActions,
  )
    ? (payload as { pendingActions: Array<Record<string, unknown>> }).pendingActions
    : [];
  const pendingActionValidation = new Map<
    Record<string, unknown>,
    { error: string | null; channelName?: string }
  >();
  if (ctx && payload.status === "completed" && pendingActionList.length > 0) {
    for (const action of pendingActionList) {
      const v = await pendingActionTargetValidation(action, ctx, ctx.appToken).catch(
        () => ({ error: null as string | null }),
      );
      pendingActionValidation.set(action, v);
    }
    const toolOf = (a: Record<string, unknown>): string =>
      typeof a["tool"] === "string" && a["tool"].trim() ? a["tool"].trim() : "write action";
    const queued = pendingActionList.filter((a) => !pendingActionValidation.get(a)?.error);
    const rejected = pendingActionList.filter((a) => pendingActionValidation.get(a)?.error);

    const lines: string[] = [];
    if (queued.length > 0) {
      const names = [...new Set(queued.map(toolOf))].slice(0, 6).map((t) => `\`${t}\``);
      const noun = queued.length === 1 ? "action is" : "actions are";
      lines.push(
        `⏳ ${queued.length} write ${noun} queued and awaiting your approval — nothing has run yet: ${names.join(", ")}. Approve the card${queued.length === 1 ? "" : "s"} to execute.`,
      );
    }
    for (const action of rejected) {
      const reason = pendingActionValidation.get(action)?.error ?? "target not accessible";
      lines.push(`⚠️ \`${toolOf(action)}\` was NOT queued — nothing was created. ${reason}`);
    }
    if (lines.length > 0) {
      const body = lines.map((l) => `_${l}_`).join("\n\n");
      resultWithCitations = resultWithCitations.trim()
        ? `${resultWithCitations.trimEnd()}\n\n${body}`
        : body;
    }
  }

  // When an active /goal loop is running, prefix every turn's user-facing reply
  // with a turn counter for clarity. The goal's turnCount is still pre-increment
  // here (recordTurnAndDecide bumps it in the relooper hook below), so the turn
  // that JUST ran is turnCount + 1. Gated on non-empty result so it never
  // resurrects an empty turn past the empty-result handling further down, and
  // applied before finalize/persist/post so it shows everywhere consistently.
  if (payload.status === "completed" && resultWithCitations.trim() && ctx?.conversationId) {
    const goal = await activeGoalRepository
      .findActiveByConversation(ctx.conversationId)
      .catch(() => null);
    if (goal) {
      resultWithCitations = `🎯 **Goal · Turn ${goal.turnCount + 1}/${goal.maxTurns}**\n\n${resultWithCitations}`;
    }
  }

  // Finalize the AgentRun record (fire-and-forget)
  if (sessionId) {
    const status = payload.status === "completed" ? "completed" : "failed";
    agentRunRepository.finalize(sessionId, {
      status,
      result: payload.result !== undefined ? resultWithCitations : null,
      error: payload.error ?? null,
      ...(payload.provider !== undefined ? { provider: payload.provider } : {}),
      ...(payload.model !== undefined ? { model: payload.model } : {}),
      ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
      toolsUsed: payload.toolsUsed ?? [],
      ...(payload.toolInvocations !== undefined ? { toolInvocations: payload.toolInvocations } : {}),
      ...(payload.tokenUsage ? { tokenUsage: payload.tokenUsage } : {}),
      ...(payload.latency ? { latency: payload.latency } : {}),
      ...(payload.fastMode !== undefined ? { fastMode: payload.fastMode === true } : {}),
    }).catch(() => {});
  }

  if (payload.status === "completed") {
    const recoveryCompletion = await handleRunCompletion(sessionId, "completed").catch((err) => {
      clog.warn(`[webhook/result] Failed to mark ${sessionId} completed in run recovery:`, err instanceof Error ? err.message : err);
      return null;
    });
    externalCallbackSessionId = recoveryCompletion?.rootSessionId ?? sessionId;
    if (ctx?.conversationId && ctx.agentSlug) {
      experimentContinues = await continueExperimentAfterResult(ctx, sessionId).catch((err) => {
        clog.warn(`[experiment] continuation hook failed session=${sessionId}:`, errMsg(err));
        return false;
      });
    }
  }

  const isSessionLockedFailure = payload.status === "failed" && payload.error === "session_locked";
  if (isSessionLockedFailure) {
    // Lock contention is NOT a crash: no user-facing failure, no recovery
    // retries burned. handleRunCompletion (run-recovery) enqueues the run into
    // the mid-run FIFO itself when recovery state exists; when it doesn't
    // (webhook dispatches that never registered recovery), fall back to
    // enqueueing from the stored session ctx below.
    skipQueueDrain = true;
    const recoveryFailure = await handleRunCompletion(sessionId, "failed", "session_locked").catch((err) => {
      clog.warn(`[webhook/result] Failed to process ${sessionId} lock contention in run recovery:`, err instanceof Error ? err.message : err);
      return null;
    });
    let sessionLockRecovered = Boolean(
      recoveryFailure && !recoveryFailure.exhausted && recoveryFailure.terminalDrop !== true,
    );
    if (!recoveryFailure && ctx?.responseMode === "conversation" && ctx.conversationId && ctx.agentSlug) {
      const queuedMsg: QueuedMessage = {
        eventId: `lock:${sessionId || ctx.traceId || createTraceId()}`,
        conversationId: ctx.conversationId,
        channelId: ctx.channelId,
        ...(ctx.channelName ? { channelName: ctx.channelName } : {}),
        userId: ctx.senderId,
        ...(ctx.senderName ? { senderName: ctx.senderName } : {}),
        agentSlug: ctx.agentSlug,
        ...(ctx.agentOrgId ? { orgId: ctx.agentOrgId } : {}),
        ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
        task: ctx.task,
        eventType: "APP_MENTIONED",
        ...(ctx.resultForwardUrl ? { resultForwardUrl: ctx.resultForwardUrl } : {}),
        ...(ctx.resolveMentions ? { resolveMentions: ctx.resolveMentions } : {}),
        ts: Date.now(),
      };
      const enq = await enqueueMessage(queuedMsg);
      sessionLockRecovered = enq.enqueued || enq.deduped;
      clog.info(`[webhook/result] Session ${sessionId}: session locked; queued from session context enqueued=${enq.enqueued} deduped=${enq.deduped} full=${enq.full} pos=${enq.position}`);
    } else {
      clog.info(`[webhook/result] Session ${sessionId}: session locked; queued via run recovery without user-facing failure`);
    }
    if (!sessionLockRecovered) {
      // Recovery was absent/exhausted and the FIFO did not accept the run, so
      // this branch is terminal. Do not fail callbacks for deferred/requeued runs.
      let callback = ctx?.externalResultCallback;
      if (!ctx && sessionId) {
        const storedRun = await agentRunRepository.findBySessionId(sessionId).catch(() => null);
        const metadata = storedRun?.metadata as { externalResultCallback?: ExternalResultCallbackConfig } | null | undefined;
        callback = metadata?.externalResultCallback;
      }
      if (callback) {
        await sendStoredExternalResultCallback(callback, {
          sessionId,
          status: "failed",
          result: "",
          error: "session_locked",
        });
        await deleteSession(sessionId);
      }
    }
    // Release OUR busy marker so it doesn't leak for BUSY_TTL_MS (20m) and
    // stall the queue — but do NOT drainNextQueued here: that would instantly
    // re-dispatch the message we just enqueued into the still-held session
    // lock, whose new session_locked result re-enters this handler (live
    // ping-pong). The lock holder's own completion drains this queue.
    // MUST pass resultUserScope: a digital-twin slot is keyed
    // conv:digital-twin:<userId> (see scoped() in message-queue.ts). Releasing
    // without it targets the 2-part conv:digital-twin key, misses the real
    // 3-part marker, and the twin slot leaks for the full 20m TTL — every new
    // twin tag then queues behind a phantom "active run" (observed 2026-08-19).
    if (QUEUE_ENABLED && resultConversationId && resultAgentSlug) {
      await releaseSlot(resultConversationId, resultAgentSlug, undefined, resultUserScope || undefined).catch(() => {});
    }
    return;
  }

  if (payload.status === "failed" || payload.status === "cancelled") {
    const recoveryFailure = await handleRunCompletion(sessionId, "failed", payload.error ?? payload.status).catch((err) => {
      clog.warn(`[webhook/result] Failed to process ${sessionId} failure in run recovery:`, err instanceof Error ? err.message : err);
      return null;
    });

    externalCallbackSessionId = recoveryFailure?.rootSessionId ?? sessionId;

    if (recoveryFailure?.retried) {
      clog.info(`[webhook/result] Session ${sessionId}: retry queued (${recoveryFailure.retriesUsed}/${recoveryFailure.maxRetries})`);
      return;
    }
  }

  // External API callbacks are interposed by /run: claw only ever calls this
  // internal endpoint, and claw-auth performs the untrusted outbound delivery.
  // Prefer Redis context, with AgentRun.metadata as a durable fallback. A
  // recovery attempt may have sparse physical-run metadata, so fall back to
  // the logical recovery root as well.
  let externalResultCallback = ctx?.externalResultCallback;
  if (!ctx && sessionId) {
    for (const callbackSessionId of new Set([sessionId, externalCallbackSessionId])) {
      const storedRun = await agentRunRepository.findBySessionId(callbackSessionId).catch(() => null);
      const metadata = storedRun?.metadata as { externalResultCallback?: ExternalResultCallbackConfig } | null | undefined;
      externalResultCallback = metadata?.externalResultCallback;
      if (externalResultCallback) break;
    }
  }
  if (externalResultCallback) {
    // HITL for API/service-token runs: the external caller receives its result
    // via the callback, but a gated write (spaces-create-ticket, user-send-message,
    // ...) still needs a human to approve/decline. Those approval cards are only
    // posted on the normal channel path further below - which this branch returns
    // before reaching. When the run is bound to a Spaces channel (the service
    // token carried spaces:channels:post, so /run let channelId survive), post the
    // cards into that channel BEFORE we tear the session down. Implicitly gated by
    // ctx.channelId: headless runs with no bound channel skip this, exactly as before.
    const externalPendingActions = (payload as { pendingActions?: Array<Record<string, unknown>> }).pendingActions;
    const cbCtx = ctx;
    if (cbCtx?.channelId && cbCtx.appToken && externalPendingActions?.length) {
      const cbAppToken = cbCtx.appToken;
      let approvalCardsSent = 0;
      for (const action of externalPendingActions) {
        try {
          const targetValidation = await pendingActionTargetValidation(action, cbCtx, cbAppToken);
          if (targetValidation.error) {
            clog.info(`[webhook/result] external-callback skipped write approval card tool=${String(action["tool"] ?? "")}: ${targetValidation.error}`);
            continue;
          }
          await postWriteApprovalAction({ action, ctx: cbCtx, token: cbAppToken, targetValidation });
          approvalCardsSent += 1;
        } catch (err) {
          clog.warn(`[webhook/result] external-callback approval card failed tool=${String(action["tool"] ?? "")} sessionId=${sessionId}: ${errMsg(err)}`);
        }
      }
      clog.info(`[webhook/result] external-callback sent ${approvalCardsSent}/${externalPendingActions.length} write approval card(s) channelId=${cbCtx.channelId} sessionId=${sessionId}`);
    }
    await deleteSession(sessionId);
    await sendStoredExternalResultCallback(
      externalResultCallback,
      {
        sessionId: externalCallbackSessionId,
        status: payload.status ?? "failed",
        result: payload.result ?? "",
        ...(payload.error ? { error: payload.error } : {}),
      },
    );
    return;
  }

  // Slack runs are finalized above in the same ordering as external callbacks,
  // then delivered to the originating thread instead of a Spaces conversation.
  if (ctx?.slackDelivery) {
    await deleteSession(sessionId);
    await deliverSlackResult({
      target: ctx.slackDelivery,
      status: payload.status ?? "failed",
      result: resultWithCitations,
      ...(payload.attachments?.length ? { attachments: payload.attachments } : {}),
    }).catch((err) => {
      clog.warn(`[webhook/result] Slack delivery failed for session ${sessionId}: ${errMsg(err)}`);
    });
    return;
  }

  // The run is over and will NOT continue: every path that re-dispatches or
  // re-queues (handoff, broken-SSE retry, session_locked, recovery retry) has
  // already returned above. Settle the plan card here, so it covers a failed or
  // cancelled run too — those are exactly the ones that die mid-step.
  await reconcileStalePlanTodos(
    sessionId,
    ctx?.conversationId ?? payload.conversationId ?? null,
    ctx?.agentSlug ?? payload.agentSlug ?? null,
  ).catch((err) =>
    clog.warn(
      "[webhook/result] plan todo reconcile failed (non-fatal):",
      err instanceof Error ? err.message : err,
    ),
  );

  if (payload.status !== "completed") {
    // Result-forward callers (Spaces auto-draft / automations) get the failure
    // via their callback and return BEFORE the bot-mention surfacing below —
    // they want the callback, not a message posted into a thread.
    if (ctx?.resultForwardUrl) {
      // Automation capacity failure: schedule a SILENT auto-retry before
      // forwarding, so an over-capacity model self-heals overnight instead of
      // the user finding it undone hours later. The retry is a fresh dispatch
      // carrying the same resultForwardUrl, so its eventual success forwards on.
      await scheduleCapacityRetryIfNeeded(ctx, payload, false).catch(() => false);
      await forwardResult(ctx.resultForwardUrl, { sessionId, status: "failed", ...(payload.error ? { error: payload.error } : {}) }, "");
      return;
    }

    // Track whether the failure was surfaced to the user by ANY branch below
    // (escalation message, promote-provider prompt). If none fires, we post a
    // generic notice before returning — a failed run must never leave the
    // thread silent (prod 2026-06-11: an always-on agent's copilot-quota 429
    // failed with no chain and no promote-prompt, so the user saw nothing and
    // asked "why no reply"). Cancellations are intentional and stay silent.
    let failureSurfaced = false;
    const rawErr = String(payload.error ?? "");
    // SHUTDOWN_DRAIN-prefixed failures are pod-restart kills (claw's drain
    // deadline aborted the run — see cancelActiveRunsForDrain). The recovery
    // worker refires these, so NOTHING below should treat them as agent
    // failures: no chain escalation, no failure-investigation dispatch, no
    // "internal error" notice. If the refire also dies it fails with a normal
    // (unprefixed) error and the full failure path runs then — the thread is
    // never permanently silent.
    const isShutdownDrain = /^SHUTDOWN_DRAIN:/.test(rawErr);
    // ── Handle failure chain if configured ──
    if (payload.status === "failed" && !isShutdownDrain && ctx?.agentSlug && ctx.agentOrgId) {
      try {
        const agentRow = await agentRepository.findBySlug(ctx.agentSlug, ctx.agentOrgId);

        // Check user-level chain config first, fall back to global agent config
        const userChainRow = ctx.agentOrgId
          ? await userAgentConfigRepository.findByUserAndAgent(ctx.senderId, ctx.agentOrgId, ctx.agentSlug)
          : null;
        const chain = userChainRow?.chainConfig
          ? parseChainConfig({ chain: userChainRow.chainConfig } as Record<string, unknown>)
          : parseChainConfig(agentRow?.config as Record<string, unknown> | null);

        if (chain?.onFailure?.escalate) {
          const token = ctx.appToken;
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            markdownText: `⚠️ **Agent chain escalation**: \`${ctx.agentSlug}\` failed. Error: ${payload.error ?? "unknown"}. Manual intervention needed.`,
            userId: ctx.spacesAppUserId,
            metadata: { contentFormat: "markdown" },
          }, token).catch(() => {});
          failureSurfaced = true;
        }

        if (chain?.onFailure?.triggerAgent) {
          const runUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run`;
          const failureTask = `The agent "${ctx.agentSlug}" failed with error: ${payload.error ?? "unknown"}. Original task was: ${ctx.task}. Please investigate and resolve.`;
          const failureAgentRow = await agentRepository.findBySlug(chain.onFailure.triggerAgent, ctx.agentOrgId);
          const failureOrgId = failureAgentRow?.orgId ?? ctx.agentOrgId;
          const runRes = await fetch(runUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
            },
            body: JSON.stringify({
              userId: ctx.senderId,
              task: failureTask,
              agentSlug: chain.onFailure.triggerAgent,
              orgId: failureOrgId,
              channelId: ctx.channelId,
              callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
              progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
            }),
          });
          if (!runRes.ok) { clog.error(`[webhook/result] Failure chain trigger HTTP ${runRes.status}`); return; }
          const runBody = (await runRes.json()) as { success: boolean; sessionId?: string };
          if (runBody.success && runBody.sessionId && failureAgentRow?.spacesAppToken && failureAgentRow.spacesAppId) {
            const failureAppToken = decryptStoredField(failureAgentRow.spacesAppToken);
            const failureContext: SessionContext = {
              mentionedUserId: failureAgentRow.spacesAppUserId ?? "",
              senderId: ctx.senderId,
              senderName: ctx.senderName,
              channelId: ctx.channelId,
              channelName: ctx.channelName,
              conversationId: ctx.conversationId,
              task: ctx.task,
              agentId: failureAgentRow.id,
              agentOrgId: failureAgentRow.orgId ?? null,
              agentSlug: chain.onFailure.triggerAgent,
              responseMode: "conversation",
              appToken: failureAppToken,
              spacesAppId: failureAgentRow.spacesAppId,
              spacesAppUserId: failureAgentRow.spacesAppUserId ?? "",
              chainDepth: (ctx.chainDepth ?? 0) + 1,
              // Thread workflow identity through failure chains so the next
              // agent in the chain can re-resolve the same workflow binding
              // and continue from where this one failed.
              rootAgentSlug: ctx.rootAgentSlug ?? ctx.agentSlug,
              ...(ctx.workflowId ? { workflowId: ctx.workflowId } : {}),
            };
            await setSession(runBody.sessionId, failureContext);
            const failureDispatchPayload = {
              userId: ctx.senderId,
              task: failureTask,
              conversationId: ctx.conversationId,
              agentSlug: chain.onFailure.triggerAgent,
              orgId: failureAgentRow.orgId,
              eventType: "APP_MENTIONED",
              traceId: ctx.traceId ?? runBody.sessionId,
              callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
              progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
              channelId: ctx.channelId,
            };
            await registerRunRecovery({
              rootSessionId: runBody.sessionId,
              maxRetries: CONFIG.runRecoveryMaxRetries,
              timeoutMs: CONFIG.runRecoveryTimeoutMs,
              retryBackoffMs: CONFIG.runRecoveryBackoffMs,
              dispatchPayload: failureDispatchPayload,
              sessionContext: failureContext,
            });
          }
          clog.info(`[webhook/result] Failure chain: ${ctx.agentSlug} → ${chain.onFailure.triggerAgent}`);
        }
      } catch (chainErr) {
        clog.error("[webhook/result] Failure chain error (non-fatal):", chainErr);
      }
    }

    // Promote-provider prompt: kimi/spaces was the parent provider (no
    // escalatedProvider set on ctx → resolution fell through to platform
    // default) AND the agent has a premium provider configured. Offer the
    // user a one-tap retry. Single prompt per conversation; once accepted
    // (or declined) the conversation continues without re-asking.
    if (
      payload.status === "failed" &&
      ctx &&
      !ctx.escalatedProvider &&
      ctx.agentSlug &&
      ctx.agentOrgId &&
      ctx.conversationId &&
      ctx.channelId
    ) {
      try {
        const agentRow = await agentRepository.findBySlug(ctx.agentSlug, ctx.agentOrgId);
        if (agentRow) {
          // Skip the prompt entirely when the agent is in always-on mode —
          // the premium provider is already the default, so the failure
          // wasn't a "kimi couldn't" situation. No use suggesting an
          // escalation that's already in place.
          const alwaysOnRaw = (agentRow.config as Record<string, unknown> | null)?.["providerAlwaysOn"];
          const isAlwaysOn = alwaysOnRaw !== false;
          if (!isAlwaysOn) {
            const agentCreds = await agentProviderCredentialsRepository.listByAgent(agentRow.id).catch(() => []);
            const hasCreds = (p: string) => {
              const row = agentCreds.find((c) => c.provider === p);
              return !!(row?.encryptedKey && row.iv && row.authTag);
            };
            const KNOWN = new Set(["codex", "claude", "copilot", "openrouter", "litellm"]);
            const rawOrder = (agentRow.config as Record<string, unknown> | null)?.["providerOrder"];
            const order: string[] = Array.isArray(rawOrder)
              ? rawOrder.filter((p): p is string => typeof p === "string" && KNOWN.has(p))
              : [];
            const legacy = (agentRow.config as Record<string, unknown> | null)?.["provider"] as string | undefined;
            const candidate =
              order.find(hasCreds) ??
              (legacy && KNOWN.has(legacy) && hasCreds(legacy) ? legacy : undefined);
            if (candidate) {
              const flow = withSpacesAppId(buildPromoteProviderFlow(candidate, {
                agentSlug: ctx.agentSlug,
                channelId: ctx.channelId,
                conversationId: ctx.conversationId,
                userId: ctx.senderId,
                originalTask: ctx.task,
              }), ctx.spacesAppId);
              await spacesAppFetch("/chat/postMessage", {
                channelId: ctx.channelId,
                conversationId: ctx.conversationId,
                flow,
                userId: ctx.spacesAppUserId,
              }, ctx.appToken).catch((err) => {
                clog.warn("[webhook/result] failed to post promote-provider prompt:", err instanceof Error ? err.message : err);
              });
              failureSurfaced = true;
              clog.info(`[webhook/result] posted promote-provider prompt for conv ${ctx.conversationId} (provider=${candidate})`);
            }
          }
        }
      } catch (err) {
        clog.warn("[webhook/result] promote-provider prompt error (non-fatal):", err instanceof Error ? err.message : err);
      }
    }

    // Capacity auto-retry (interactive): only when promote-provider did NOT fire
    // — switching to a working provider is the better offer when one exists;
    // this "wait for the same model to come back" card is for when it doesn't.
    // Shutdown drains are pod restarts, not capacity — run-recovery refires them.
    if (!failureSurfaced && !isShutdownDrain && ctx) {
      const scheduled = await scheduleCapacityRetryIfNeeded(ctx, payload, true).catch(() => false);
      if (scheduled) failureSurfaced = true;
    }

    // Safety net: a failed run that nothing above surfaced must still tell the
    // user — otherwise the thread goes silent and looks like the agent ignored
    // the mention. Only for conversation-mode failures with a thread to post
    // to; cancellations and approval-mode runs stay silent by design.
    // A dropped SSE stream ("…ended without a done frame") is a TRANSIENT
    // transport flake — claw-auth retries the dispatch automatically and the
    // retry almost always completes and posts the real reply. Surfacing a
    // failure notice for it shows the user a spurious "internal error" next to
    // the actual answer (race-dependent). Skip the notice for this specific
    // transient; genuine agent failures carry a different error string. If BOTH
    // attempts drop the stream (rare) the thread stays silent — acceptable vs a
    // spurious error on normal runs.
    const isTransientSseDrop = /SSE stream ended without a done frame/i.test(rawErr);
    if (
      payload.status === "failed" &&
      !failureSurfaced &&
      !isTransientSseDrop &&
      !isShutdownDrain &&
      ctx?.conversationId &&
      ctx?.channelId &&
      ctx.responseMode === "conversation"
    ) {
      const isQuota = /\b429\b|quota|rate.?limit|exceeded|out of credit/i.test(rawErr);
      const harnessLabel = payload.localHarnessProvider === "codex-cli" ? "Codex CLI" : "Claude Code";
      const notice = payload.localHarnessUnreachable
        ? `⚠️ I couldn't reach **${harnessLabel}** on your machine, and running this on Xyne's servers instead didn't start either. Open the Xyne desktop app (or turn off the local harness for this agent) and try again.`
        : isQuota
          ? "⚠️ I couldn't respond — the provider configured for this agent is out of quota / rate-limited right now. Please retry shortly, or switch the agent's provider in its settings."
          : "⚠️ I couldn't complete this request due to an internal error. Please try again.";
      await spacesAppFetch("/chat/postMessage", {
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        markdownText: notice,
        userId: ctx.spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      }, ctx.appToken).catch((err) =>
        clog.warn("[webhook/result] failed to post failure notice:", err instanceof Error ? err.message : err),
      );
      clog.info(`[webhook/result] posted generic failure notice for conv ${ctx.conversationId} (quota=${isQuota})`);
    }

    return;
  }

  if (!ctx) {
    clog.warn(`[webhook/result] No session context for ${sessionId}`);
    return;
  }

  const log = createLogger("webhook/result", ctx.traceId ?? sessionId.slice(0, 8));
  log.info(`status=${payload.status}, resultLength=${resultWithCitations.length}`);

  // The assistant transcript row must be owned by the RUN OWNER — the mentioned
  // user for a twin USER_MENTIONED run — so it lines up with the AgentRun and
  // the `user` ChatMessage (both persisted under targetUserId by run.ts). Using
  // ctx.senderId here mis-tagged the reply to the SENDER: the owner then can't
  // see their own twin reply (per-user read ACL filters it out) while the
  // sender saw it in their history. Fall back to the responseMode-derived owner
  // for sessions created before this field existed / non-twin flows.
  const runOwnerId = ctx.targetUserId ?? (ctx.responseMode === "approval" ? ctx.mentionedUserId : ctx.senderId);

  // Live tap: tell v3 viewers the turn finished so they refetch the canonical
  // transcript (assistant text + paired tool calls) from Postgres. The assistant
  // ChatMessage save below is fire-and-forget, so the client refetches with a
  // short retry rather than trusting this event's timing. Conversation mode only
  // — approval/digital-twin have no v3 live surface.
  if (CONFIG.liveToolCallsEnabled && ctx.responseMode === "conversation" && ctx.conversationId) {
    publishLiveEvent(ctx.conversationId, {
      type: "done",
      conversationId: ctx.conversationId,
      agentSlug: ctx.agentSlug,
      userId: ctx.senderId,
      status: typeof payload.status === "string" ? payload.status : "completed",
      ts: Date.now(),
    });
  }

  // Result-forward branch (Spaces auto-draft / automations): this run was
  // triggered with a forward URL, not a real mention. Persist the assistant
  // message (Claw UI + Reasoning) exactly as the normal path does, then POST the
  // result to the caller instead of posting a bot DM. No placeholder was posted
  // (suppressed at dispatch), so nothing to clean up.
  if (ctx.resultForwardUrl) {
    if (resultWithCitations.trim() && ctx.conversationId && ctx.agentSlug && ctx.agentOrgId) {
      const parentId = await chatMessageRepository.latestMessageId(ctx.conversationId, ctx.agentSlug).catch(() => null);
      chatMessageRepository.create({
        conversationId: ctx.conversationId,
        agentSlug: ctx.agentSlug,
        userId: runOwnerId,
        orgId: ctx.agentOrgId,
        ...(parentId ? { parentId } : {}),
        role: "assistant",
        content: resultWithCitations,
        status: "completed",
        ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
      })
        // Files the agent produced must land in chat_attachments too — the
        // run-stream (interactive chat) path persists them, but this branch
        // silently dropped them, so pipeline/automation runs never showed
        // their reports (e.g. the error-pipeline RCA .html) as attachments.
        .then((msg) => persistCallbackAttachments(msg.id, runOwnerId, payload.attachments))
        .then((created) => publishThreadArtifactShare(ctx, runOwnerId, created))
        .catch((e) => log.warn("Failed to save assistant ChatMessage", { error: errMsg(e) }));
    }
    // Automation reply: resolve the agent's plain `@Name` mentions into
    // clickable/notifying Spaces mentions before forwarding, so the
    // downstream REPLY_ON_MESSAGE posts a real tag rather than dead text.
    // No human session exists here, so we search with the agent's bot token
    // (ctx.appToken). Fail-open: any error forwards the raw text unchanged.
    // Verify-Responses / copilot agents deliver their turn via `pendingResponses`
    // (often with a placeholder/empty result.text). The channel-post path posts
    // pendingResponses INSTEAD of result.text (line ~3044); the forward branch must
    // do the same, or the automation ships the placeholder and the real reply never
    // reaches the caller — the "only the first/placeholder message came" bug.
    // Prefer the combined pendingResponses when present; else the result text.
    let forwardText = payload.pendingResponses?.length
      ? payload.pendingResponses.map((pr) => pr.message).join("\n\n")
      : resultWithCitations;
    // DIAG: confirm whether mention resolution is even attempted for this forward.
    // If skipped, the @email stays raw — and the per-email byEmail logs won't fire.
    log.info(`[webhook/result] mention-resolve gate: resolveMentions=${!!ctx.resolveMentions} appToken=${!!ctx.appToken} hasText=${!!forwardText.trim()} pending=${payload.pendingResponses?.length ?? 0} usedPending=${!resultWithCitations.trim() && !!forwardText.trim()} sessionId=${sessionId}`);
    if (ctx.resolveMentions && ctx.appToken && forwardText.trim()) {
      try {
        // Scope name resolution to the agent's workspace. Automations don't
        // carry ctx.workspaceId, so derive it from the agent's app user.
        const wsId = ctx.workspaceId
          ?? (ctx.spacesAppUserId ? await getSpacesUserWorkspaceId(ctx.spacesAppUserId) : null);
        const resolved = await resolveUnboundMentions(
          forwardText,
          buildSpacesMentionLookups({
            token: ctx.appToken,
            ...(wsId ? { workspaceId: wsId } : {}),
          }),
        );
        forwardText = expandSpacesMentions(resolved);
      } catch (err) {
        log.warn(`mention resolution failed — forwarding raw text: ${errMsg(err)}`);
      }
    }
    // Capacity failure shaped as an EMPTY completed result: schedule the same
    // silent retry as the failed path before forwarding, so the automation
    // self-heals instead of its caller receiving a blank and nobody retrying.
    if (payload.emptyReason === "provider_capacity" && !forwardText.trim()) {
      await scheduleCapacityRetryIfNeeded(ctx, payload, false).catch(() => false);
    }
    await forwardResult(ctx.resultForwardUrl, payload, forwardText);
    return;
  }

  // Safety net: a headless/automation run has no Spaces channel to reply in
  // (channelId + conversationId both empty). If we somehow got here without a
  // resultForwardUrl (e.g. an old in-flight run dispatched before the recovery
  // ctx carried it), the channel-post path below would call /chat/postMessage
  // with channelId="" → Spaces 400 "Validation error" → "Failed to send result"
  // → run-recovery retries the whole LLM run pointlessly. Bail cleanly instead.
  if (ctx.responseMode === "conversation" && !ctx.channelId && !ctx.conversationId) {
    log.warn(`No channel and no resultForwardUrl for ${sessionId} — nowhere to deliver; skipping channel post (no retry).`);
    await deleteSession(sessionId);
    return;
  }

  // Clear the ephemeral agent progress signal — dashboard drops the spinner.
  // Only fires in the ephemeral path; the placeholder path clears naturally
  // when we edit the "⏳" message with the final result below.
  // Same deliverability guard as the per-tool push in /progress: twin runs and
  // claw-only conversations (no Spaces channelId) never posted a spinner, so
  // clearing would only add another guaranteed-4xx call.
  if (USE_EPHEMERAL_PROGRESS && ctx.agentSlug !== "digital-twin" && ctx.channelId) {
    spacesAppFetch("/chat/agentProgress", {
      conversationId: ctx.conversationId,
      channelId: ctx.channelId,
      agentSlug: ctx.agentSlug,
      userId: ctx.spacesAppUserId,
      status: "done",
    }, ctx.appToken).catch((err) =>
      log.warn("Failed to clear agent progress signal", { error: errMsg(err) }),
    );
  }

  // Persist the assistant response as a ChatMessage (transcript) — fire-and-forget
  if (resultWithCitations.trim() && ctx.conversationId && ctx.agentSlug && ctx.agentOrgId) {
    // Same chaining as the forward branch above — keeps the tree linear so a
    // follow-up in chat resumes THIS run's pi session instead of branching.
    const parentId = await chatMessageRepository.latestMessageId(ctx.conversationId, ctx.agentSlug).catch(() => null);
    chatMessageRepository.create({
      conversationId: ctx.conversationId,
      agentSlug: ctx.agentSlug,
      userId: runOwnerId,
      orgId: ctx.agentOrgId,
      ...(parentId ? { parentId } : {}),
      role: "assistant",
      content: resultWithCitations,
      status: "completed",
      ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
    })
      // Same as the forward branch: keep agent-produced files on the
      // transcript row (Spaces gets them as posted files, but the claw chat
      // UI reads chat_attachments).
      .then((msg) => persistCallbackAttachments(msg.id, runOwnerId, payload.attachments))
        .then((created) => publishThreadArtifactShare(ctx, runOwnerId, created))
      .catch((e) => log.warn("Failed to save assistant ChatMessage", { error: errMsg(e) }));
  }

  // ── Plan mode Turn 1: post the plan card and short-circuit ──
  // claw's propose-plan terminal tool ends the turn with an EMPTY result plus a
  // `pendingPlan`. Handle it HERE — BEFORE the empty-result "Sorry" notice below
  // (which would otherwise fire and return) and before the normal text-posting
  // path (which would run heavy citation/mention logic and could post an empty
  // message). NEVER for twin (responseMode "approval"); requires the run to have
  // been dispatched in plan mode (ctx.mode === "plan"). Fail-open. Short-circuits
  // with `return` so nothing else posts. The session is intentionally NOT deleted
  // — it stays alive (carrying planMessageId) so flow-action.ts's plan-approval
  // branch can read it when the user approves (non-trivial), and so Turn 2's
  // todo-write updates the SAME card (trivial + on approval).
  const pendingPlan = payload.pendingPlan;
  if (
    pendingPlan &&
    pendingPlan.todos?.length &&
    ctx.responseMode === "conversation" &&
    ctx.mode === "plan"
  ) {
    const token = ctx.appToken;
    try {
      const planTodos = pendingPlan.todos; // [{ id, title }]
      const trivial = pendingPlan.trivial === true;
      const phase = trivial ? "executing" : "proposed";
      // Trivial plans auto-approve now — stamp the decision time ONCE and reuse it
      // for the initial executing card AND the durable exec meta, so Turn 2's live
      // renders keep the same "Auto-approved · <time>" footer. (Ignored for the
      // proposed path — a rejected/approved time is stamped later at decision.)
      const planApprovedAt = new Date().toISOString();

      // Bug 5+4: persist the plan as an assistant transcript row (chat_messages).
      // The interactive card only exists in Spaces; the claw chat reads
      // chat_messages and renders assistant content as MARKDOWN, so without this
      // the plan turn shows NOTHING under the user's query and the next turn's
      // user row (a second consecutive user message) groups as a sibling BRANCH
      // instead of chaining linearly. A markdown summary row fixes both, and the
      // run's tool calls pair to it by chronology so they render too.
      if (ctx.conversationId && ctx.agentSlug && ctx.agentOrgId) {
        try {
          const numbered = planTodos.map((t, i) => `${i + 1}. ${t.title}`).join("\n");
          const summary = trivial
            ? `**📋 Plan — auto-approved**\n\n${numbered}\n\n_Trivial request — running it now._`
            : `**📋 Proposed a plan**\n\n${numbered}\n\n_Review and approve it to start._`;
          const parentId = await chatMessageRepository
            .latestMessageId(ctx.conversationId, ctx.agentSlug)
            .catch(() => null);
          await chatMessageRepository.create({
            conversationId: ctx.conversationId,
            agentSlug: ctx.agentSlug,
            userId: runOwnerId,
            orgId: ctx.agentOrgId,
            ...(parentId ? { parentId } : {}),
            role: "assistant",
            content: summary,
            status: "completed",
            ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
          });
        } catch (e) {
          log.warn("Failed to persist plan assistant transcript row (non-fatal)", {
            error: errMsg(e),
          });
        }
      }

      // Bug 8: a prior proposed card in this thread is now stale (the agent
      // re-planned). Grey it out + disable its Approve button so a superseded
      // plan can't be run. Best-effort; the new card posts regardless.
      if (ctx.conversationId && ctx.agentSlug) {
        // Redis is the fast path; the durable binding is what still finds a
        // proposal older than the 24h TTL — without it an ancient card would
        // stay tappable (and, now that approval survives, actually runnable)
        // after the agent has already re-planned.
        const prevBinding = await findProposedPlanBinding(ctx.conversationId, ctx.agentSlug).catch(() => null);
        const prevBindingData = prevBinding ? readPlanBindingData(prevBinding) : null;
        const prevCard =
          (await getActivePlanCard(ctx.conversationId, ctx.agentSlug).catch(() => null)) ??
          (prevBinding?.messageId && prevBindingData
            ? {
                messageId: prevBinding.messageId,
                todos: prevBindingData.todos,
                ...(prevBindingData.title ? { title: prevBindingData.title } : {}),
                ...(prevBindingData.desc ? { desc: prevBindingData.desc } : {}),
                ...(prevBindingData.document ? { document: prevBindingData.document } : {}),
              }
            : null);
        if (prevCard?.messageId) {
          try {
            const supersededFlow = withSpacesAppId(
              buildPlanFlow(prevCard.todos, {
                title: prevCard.title ?? "Plan",
                ...(prevCard.desc ? { desc: prevCard.desc } : {}),
                ...(prevCard.document ? { document: prevCard.document } : {}),
                phase: "proposed",
                superseded: true,
                data: {
                  actionType: "plan-approval",
                  agentSlug: ctx.agentSlug,
                  conversationId: ctx.conversationId,
                  channelId: ctx.channelId,
                  userId: ctx.senderId,
                },
              }),
              ctx.spacesAppId,
            );
            await spacesAppFetch(
              "/chat/updateMessage",
              { messageId: prevCard.messageId, flowJSON: supersededFlow, userId: ctx.spacesAppUserId, channelId: ctx.channelId },
              token,
            );
          } catch (e) {
            log.warn("Failed to supersede prior plan card (non-fatal)", {
              error: errMsg(e),
            });
          }
        }
        // Terminal in the durable store too, whether or not the card repaint
        // above succeeded: a superseded plan must fail the approve guard forever,
        // not just until its Redis pointer is overwritten.
        if (prevBinding) {
          await markPlanBindingStatus(prevBinding.id, "superseded").catch((e) => {
            log.warn("Failed to mark prior plan binding superseded (non-fatal)", {
              error: errMsg(e),
            });
          });
        }
      }

      const flow = withSpacesAppId(
        buildPlanFlow(planTodos, {
          title: pendingPlan.title,
          ...(pendingPlan.desc ? { desc: pendingPlan.desc } : {}),
          ...(pendingPlan.document ? { document: pendingPlan.document } : {}),
          phase,
          // Bug 1: trivial plans skipped the approval gate — flag it so the card
          // shows an "Auto-approved" chip instead of a plain "Approved" one, plus
          // the decision time for the audit footer.
          ...(trivial ? { autoApproved: true, approvedAt: planApprovedAt } : {}),
          ...(phase === "proposed"
            ? {
                data: {
                  actionType: "plan-approval",
                  agentSlug: ctx.agentSlug,
                  conversationId: ctx.conversationId,
                  channelId: ctx.channelId,
                  userId: ctx.senderId,
                },
              }
            : {}),
        }),
        ctx.spacesAppId,
      );

      const planResp = (await spacesAppFetch(
        "/chat/postMessage",
        {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          flow,
          userId: ctx.spacesAppUserId,
        },
        token,
      )) as { messageId?: string; id?: string; data?: { messageId?: string; id?: string } };
      const planMessageId = planResp?.messageId ?? planResp?.id ?? planResp?.data?.messageId ?? planResp?.data?.id;
      if (planMessageId) {
        // Persist so Turn 2's todo-write updates THIS same card in place, and so
        // flow-action.ts's plan-approval can carry it forward.
        await setSession(sessionId, { ...ctx, planMessageId }).catch(() => {});
      } else {
        // No messageId in the postMessage response → Turn 2's todo-write can't
        // update this card in place and will post a NEW one (duplicate). Surface
        // it so a Spaces API contract change is caught instead of failing silently.
        log.warn(`Plan card posted but no messageId returned — Turn 2 may post a duplicate card (conv=${ctx.conversationId})`, { planResp });
      }
      log.info(`Posted plan card (${phase}) in thread ${ctx.conversationId}`);

      // Bug 8: track the active proposed card so the NEXT re-plan can supersede
      // it; a trivial/auto-run plan leaves nothing to approve, so clear instead.
      if (ctx.conversationId && ctx.agentSlug) {
        if (!trivial && planMessageId) {
          await setActivePlanCard(ctx.conversationId, ctx.agentSlug, {
            messageId: planMessageId,
            todos: planTodos,
            ...(pendingPlan.title ? { title: pendingPlan.title } : {}),
            ...(pendingPlan.desc ? { desc: pendingPlan.desc } : {}),
            ...(pendingPlan.document ? { document: pendingPlan.document } : {}),
          }).catch(() => {});
          // Durable mirror of the line above. The Redis pointer and the session
          // both expire in 24h, but the card in the thread does not — this row is
          // what lets someone approve a plan days later. It carries everything
          // flow-action.ts needs with NO surviving Redis state: the executable
          // todos, the card's routing, and the proposer (the only user allowed to
          // act on it). Best-effort: a failure here costs durability, never the
          // card, and the Redis fast path still covers the first 24h.
          if (ctx.agentOrgId && ctx.spacesAppId && ctx.spacesAppUserId) {
            await upsertPlanBinding({
              orgId: ctx.agentOrgId,
              conversationId: ctx.conversationId,
              channelId: ctx.channelId,
              messageId: planMessageId,
              spacesAppId: ctx.spacesAppId,
              spacesAppUserId: ctx.spacesAppUserId,
              agentSlug: ctx.agentSlug,
              data: {
                todos: planTodos,
                ownerUserId: ctx.senderId,
                ...(pendingPlan.title ? { title: pendingPlan.title } : {}),
                ...(pendingPlan.desc ? { desc: pendingPlan.desc } : {}),
                ...(pendingPlan.document ? { document: pendingPlan.document } : {}),
              },
            }).catch((e) => {
              log.warn("Failed to persist plan binding — approval will expire with Redis (non-fatal)", {
                error: errMsg(e),
              });
            });
          } else {
            log.warn(
              `Plan card posted without org/app context — no durable binding written, approval expires in 24h (conv=${ctx.conversationId})`,
            );
          }
          // Fresh proposal awaiting approval: reset any prior run's exec meta so
          // stale approvedTitles/autoApproved can't leak into this plan. The
          // approve flow-action writes the real meta before it dispatches Turn 2.
          await clearPlanExecMeta(ctx.conversationId, ctx.agentSlug).catch(() => {});
        } else {
          await clearActivePlanCard(ctx.conversationId, ctx.agentSlug).catch(() => {});
        }
      }

      // Trivial plan: skip the user gate — auto-dispatch Turn 2 (auto mode)
      // immediately. Mirrors the flow-action.ts plan-approval dispatch shape.
      if (trivial) {
        // Conversation-mode run owner == sender (see runOwnerId derivation).
        const planRunOwnerId = ctx.senderId;
        const task =
          "Execute this approved plan:\n" +
          planTodos.map((t, i) => `${i + 1}. ${t.title}`).join("\n");
        const fastModeEnabled = await resolveFastMode(
          ctx.conversationId,
          ctx.agentSlug ?? "",
          undefined,
        ).catch(() => false);
        const dispatchPayload: Record<string, unknown> = {
          userId: planRunOwnerId,
          task,
          conversationId: ctx.conversationId,
          channelId: ctx.channelId,
          agentSlug: ctx.agentSlug,
          orgId: ctx.agentOrgId,
          callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
          // Required for Turn 2's todo-write progress to reach /webhook/progress
          // and advance the plan card live — without it postProgress no-ops (see
          // the flow-action.ts plan-approval dispatch for the full rationale).
          progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
          mode: "auto",
          planContinuation: true,
          fastMode: fastModeEnabled,
        };
        // Deterministic plan facts for Turn 2's live render, written BEFORE
        // dispatch so the very first todo-write sees them: trivial ⇒ auto-approved
        // chip; approvedTitles = every todo (nothing was rejected in a trivial run).
        if (ctx.conversationId && ctx.agentSlug) {
          await setPlanExecMeta(ctx.conversationId, ctx.agentSlug, {
            autoApproved: true,
            approvedTitles: planTodos.map((t) => normalizePlanTitle(t.title)),
            approvedAt: planApprovedAt,
            ...(pendingPlan.title ? { title: pendingPlan.title } : {}),
            ...(pendingPlan.desc ? { desc: pendingPlan.desc } : {}),
            ...(pendingPlan.document ? { document: pendingPlan.document } : {}),
          }).catch(() => {});
        }
        const runRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
          },
          body: JSON.stringify(dispatchPayload),
        });
        const runBody = (await runRes.json().catch(() => null)) as { success?: boolean; sessionId?: string } | null;
        if (runBody?.success && runBody.sessionId) {
          // Register Turn 2's session so its /result resolves agent context and
          // its todo-write updates the SAME plan card (carry planMessageId). The
          // "Auto-approved" chip is driven by the durable plan-exec meta set
          // above (deterministic, race-free), not a session flag.
          await setSession(runBody.sessionId, {
            ...ctx,
            task,
            mode: "auto",
            pendingPlan: { todos: planTodos },
            ...(planMessageId ? { planMessageId } : {}),
          }).catch(() => {});
          // Light the "working" pill immediately — Turn 2 was dispatched DIRECT to
          // /internal/run (bypassing the normal mention path that posts this), so
          // without it the indicator only appears on the first tool-call tick.
          void emitAgentWorkingSignal({
            conversationId: ctx.conversationId,
            channelId: ctx.channelId,
            agentSlug: ctx.agentSlug,
            spacesAppUserId: ctx.spacesAppUserId,
            appToken: ctx.appToken,
            toolLabel: "Starting the plan…",
          });
          log.info(`Auto-dispatched trivial plan Turn 2 session=${runBody.sessionId} conv=${ctx.conversationId}`);
        } else {
          log.warn(`Trivial plan Turn 2 dispatch failed conv=${ctx.conversationId}`, { runBody });
        }
      }
    } catch (err) {
      log.warn("Failed to post/dispatch plan card (non-fatal)", {
        error: errMsg(err),
      });
    }
    return;
  }

  // ── Agent authoring: propose-agent drafted an agent ────────────────────────
  // Handled HERE — before the empty-result notice below (propose-agent ships
  // result: "" because the CARD is the deliverable) and before the normal
  // text-posting path. Conversation mode only: a draft needs a human to approve
  // it, and the twin flow has its own approval surface.
  //
  // Nothing is created here. The draft is persisted as an AgentRequest row and
  // the card carries only its requestId, so the spec the user approves is the
  // spec that gets created — it never round-trips through the browser.
  const pendingAgentCard = payload.pendingAgentCard;
  const agentCardDeliverable =
    ctx.responseMode === "conversation" && !!ctx.agentSlug && !!ctx.agentOrgId;
  if (pendingAgentCard && !agentCardDeliverable) {
    // The card can't be posted without a thread and an org. Falling through
    // lands on the empty-result notice ("Sorry…"), which is honest but says
    // nothing about why — log the real reason so this is one grep away instead
    // of a mystery.
    log.warn(
      `[agent-card] dropping ${pendingAgentCard.variant} card — responseMode=${ctx.responseMode} agentSlug=${ctx.agentSlug ?? "(none)"} orgId=${ctx.agentOrgId ?? "(none)"}`,
    );
  }

  // ── Capability card: the agent describing itself ───────────────────────────
  // Emitted by describe-agent ("what can you do?"). Unlike the draft, this does
  // NOT short-circuit: the card accompanies the reply, so we post it and let the
  // normal text path run. `postedAgentProfileCard` then stops the empty-result
  // notice from firing when the card WAS the whole answer.
  //
  // Authority: the identity is read from the target agent's own row. The pod
  // only names a slug — nothing the model wrote reaches this card, so an agent
  // cannot advertise a capability it was never granted.
  let postedAgentProfileCard = false;
  if (pendingAgentCard?.variant === "profile" && agentCardDeliverable && ctx.agentOrgId) {
    try {
      const targetSlug = pendingAgentCard.slug?.trim() || ctx.agentSlug!;
      const row = await agentRepository.findBySlug(targetSlug, ctx.agentOrgId);
      if (!row) {
        log.info(`[agent-card] profile card skipped — no agent "${targetSlug}" in org ${ctx.agentOrgId}`);
      } else {
        const catalog = await buildAvailableToolsCatalog(undefined, ctx.agentOrgId);
        const resolved = await resolveAgentCapabilities(
          toolIdsFromConfig(row.config),
          catalog,
          ctx.senderId,
        );
        const ownerCredit = await agentOwnerCredit(row.ownerUserId);
        const flow = withSpacesAppId(
          buildAgentCardFlow(
            { variant: "profile", agent: identityFromAgentRow(row, resolved, undefined, ownerCredit) },
            {
              agentSlug: ctx.agentSlug!,
              targetSlug,
              userId: ctx.senderId,
              conversationId: ctx.conversationId,
              channelId: ctx.channelId,
            },
          ),
          ctx.spacesAppId,
        );
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          flow,
          userId: ctx.spacesAppUserId,
        }, ctx.appToken);
        postedAgentProfileCard = true;
        log.info(`[agent-card] posted profile card for ${targetSlug} conv=${ctx.conversationId}`);
      }
    } catch (err) {
      // Non-fatal: the reply itself still posts below.
      log.warn("Failed to post agent profile card (non-fatal)", {
        error: errMsg(err),
      });
    }
  }
  // Fall back to the server's own reading of the request when the model did not
  // ask for cards. It routinely misses the moment — most often by assuming a
  // connector is already connected — and a missing capability is exactly when
  // the user most needs the offer. Only unconnected connectors survive the
  // filter below, so a wrong guess costs nothing.
  // Fail-safe: this runs before the reply is posted, so a throw here would cost
  // the user their answer. A suggestion is never worth that.
  let inferredTypes: string[] = [];
  if (!payload.pendingConnectorSuggestions) {
    try {
      inferredTypes = connectorTypesFromText(ctx.rootTask ?? ctx.task ?? "").slice(
        0,
        MCP_SUGGEST_INFERRED_MAX,
      );
    } catch (err) {
      log.warn("[mcp-suggest] connector inference failed (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const pendingConnectorSuggestions: PendingConnectorSuggestions | undefined =
    payload.pendingConnectorSuggestions ??
    (inferredTypes.length > 0 ? { serverTypes: inferredTypes, inferred: true } : undefined);
  if (pendingConnectorSuggestions && agentCardDeliverable) {
    try {
      // Roster mode: the user asked what exists, so the SERVER picks the sample
      // — the model must not decide which connectors represent the catalog.
      const listAll = pendingConnectorSuggestions.listAll === true;
      const totalCount = listAll
        ? await prisma.mcpServer.count({ where: { enabled: true } })
        : undefined;

      // Resolve every requested type against the catalog. The model supplies
      // names only — descriptions and display names come from the row, and an
      // unknown type is dropped rather than rendered as an empty card.
      const rows = listAll
        ? await prisma.mcpServer.findMany({
            where: { enabled: true },
            select: { id: true, type: true, name: true, description: true },
            orderBy: { name: "asc" },
            take: MCP_SUGGEST_ROSTER_SAMPLE,
          })
        : await prisma.mcpServer.findMany({
            where: { type: { in: pendingConnectorSuggestions.serverTypes }, enabled: true },
            select: { id: true, type: true, name: true, description: true },
          });
      const byType = new Map(rows.map((row) => [row.type, row]));

      const connectedIds = await availableServerIds(
        ctx.senderId,
        rows.map((r) => r.id),
      );

      // Roster mode is already ordered by the query; otherwise preserve the
      // model's ordering, since it ranked them by relevance.
      const ordered = listAll
        ? rows
        : pendingConnectorSuggestions.serverTypes
            .map((type) => byType.get(type))
            .filter((row): row is NonNullable<typeof row> => !!row);

      const inferred = pendingConnectorSuggestions.inferred === true;

      // Derived from the user's own words, never from the model's claim: a model
      // that wants its card shown will assert explicit intent for a plain task
      // request, which is exactly how an already-usable connector slipped
      // through. The server owns this fact like every other on the card.
      const askedToConnect = new Set(
        connectorTypesUserAskedToConnect(ctx.rootTask ?? ctx.task ?? ""),
      );

      const connectors = ordered
        // An unsolicited suggestion only earns its place when the connector is
        // not already usable — personally connected or shared org-wide. Two
        // exceptions, both genuine user intent: roster mode ("what exists?"),
        // and the user naming a connector they want to connect, where a personal
        // connection is a legitimate want even under an org credential.
        .filter((row) => listAll || askedToConnect.has(row.type) || !connectedIds.has(row.id))
        .map((row) => ({
          serverType: row.type,
          name: row.name,
          ...(row.description ? { description: row.description } : {}),
          connected: connectedIds.has(row.id),
        }));

      if (connectors.length === 0) {
        log.info(
          `[mcp-suggest] skipped — none of ${pendingConnectorSuggestions.serverTypes.join(", ")} are known connectors`,
        );
      } else {
        const flow = withSpacesAppId(
          buildMcpSuggestFlow({
            connectors,
            ...(pendingConnectorSuggestions.title
              ? { title: pendingConnectorSuggestions.title }
              : listAll
                ? { title: "Connectors you can add" }
                : {}),
            ...(listAll ? { browseAll: true } : {}),
            ...(inferred && !pendingConnectorSuggestions.title
              ? { title: "Connect to unlock this" }
              : {}),
            ...(totalCount !== undefined ? { totalCount } : {}),
            screenKey: `${ctx.senderId}-${connectors.map((c) => c.serverType).join("-")}`,
            ...(ctx.agentSlug ? { agentSlug: ctx.agentSlug } : {}),
            userId: ctx.senderId,
            conversationId: ctx.conversationId,
            channelId: ctx.channelId,
          }),
          ctx.spacesAppId,
        );
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          flow,
          userId: ctx.spacesAppUserId,
        }, ctx.appToken);
        log.info(`[mcp-suggest] posted ${connectors.length} connector cards conv=${ctx.conversationId}`);
      }
    } catch (err) {
      log.warn("Failed to post connector suggestions (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (pendingAgentCard?.variant === "summary" && agentCardDeliverable && ctx.agentOrgId) {
    try {
      const [total, globalCount, sampleAgents] = await Promise.all([
        prisma.agent.count({ where: { orgId: ctx.agentOrgId, enabled: true } }),
        prisma.agent.count({ where: { orgId: ctx.agentOrgId, enabled: true, scope: "global" } }),
        // Sample rows for the card. The SERVER picks them — the model must not
        // decide which agents represent the roster.
        prisma.agent.findMany({
          where: { orgId: ctx.agentOrgId, enabled: true },
          select: { slug: true, name: true, description: true },
          orderBy: { name: "asc" },
          take: AGENT_SUMMARY_SAMPLE,
        }),
      ]);

      if (total === 0) {
        log.info(`[agent-card] summary skipped — no agents in org ${ctx.agentOrgId}`);
      } else {
        const flow = withSpacesAppId(
          buildAgentSummaryFlow(
            {
              total,
              global: globalCount,
              personal: total - globalCount,
              agents: sampleAgents.map((a) => ({
                slug: a.slug,
                name: a.name,
                ...(a.description ? { description: a.description } : {}),
              })),
            },
            {
              agentSlug: ctx.agentSlug!,
              userId: ctx.senderId,
              conversationId: ctx.conversationId,
              channelId: ctx.channelId,
            },
          ),
          ctx.spacesAppId,
        );
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          flow,
          userId: ctx.spacesAppUserId,
        }, ctx.appToken);
        postedAgentProfileCard = true;
        log.info(`[agent-card] posted roster summary (${total}) conv=${ctx.conversationId}`);
      }
    } catch (err) {
      log.warn("Failed to post agent summary card (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (pendingAgentCard?.variant === "profile-list" && agentCardDeliverable && ctx.agentOrgId) {
    try {
      const unique = [
        ...new Set(pendingAgentCard.slugs.map((slug) => slug.trim()).filter((slug) => slug.length > 0)),
      ];
      const capped = unique.slice(0, MAX_AGENT_LIST_CARDS);

      // Matches are rendered as compact roster rows, not full profile cards:
      // "which agents can review PRs?" wants a scannable shortlist, and five
      // stacked identity cards buries it. Each row opens the agent's own page.
      const rows = [];
      for (const slug of capped) {
        const row = await agentRepository.findBySlug(slug, ctx.agentOrgId);
        if (!row) {
          log.info(`[agent-card] list row skipped — no agent "${slug}" in org ${ctx.agentOrgId}`);
          continue;
        }
        rows.push({
          slug: row.slug,
          name: row.name,
          ...(row.description ? { description: row.description } : {}),
        });
      }

      if (rows.length === 0) {
        log.info(`[agent-card] list card skipped — none of ${unique.length} slugs resolved`);
      } else {
        const flow = withSpacesAppId(
          buildAgentSummaryFlow(
            {
              total: rows.length,
              agents: rows,
            },
            {
              agentSlug: ctx.agentSlug!,
              userId: ctx.senderId,
              conversationId: ctx.conversationId,
              channelId: ctx.channelId,
            },
            // Matches, not the whole roster — so the header counts what was
            // found rather than claiming every agent in the org.
            `${rows.length} ${rows.length === 1 ? "agent" : "agents"} that can help`,
          ),
          ctx.spacesAppId,
        );
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          flow,
          userId: ctx.spacesAppUserId,
        }, ctx.appToken);
        postedAgentProfileCard = true;
        log.info(`[agent-card] posted ${rows.length} matching agents conv=${ctx.conversationId}`);
      }
    } catch (err) {
      // Non-fatal: the reply itself still posts below.
      log.warn("Failed to post matching agent card (non-fatal)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (
    pendingAgentCard?.variant === "draft" &&
    ctx.responseMode === "conversation" &&
    ctx.agentSlug &&
    ctx.agentOrgId
  ) {
    const token = ctx.appToken;
    const spec = pendingAgentCard.agent;
    try {
      const orgId = ctx.agentOrgId;
      const requesterId = ctx.senderId;

      // Fail loudly on the card rather than silently creating a mis-slugged
      // agent: the pod normalizes, so an invalid slug here means drift.
      if (!isValidAgentSlug(spec.slug)) {
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          markdownText: `⚠️ I drafted an agent but \`${spec.slug}\` isn't a usable identifier. Ask me again with a simple name like "ticket triage".`,
          userId: ctx.spacesAppUserId,
          metadata: { contentFormat: "markdown" },
        }, token);
        log.warn(`[agent-card] rejected draft with invalid slug "${spec.slug}" conv=${ctx.conversationId}`);
        await deleteSession(sessionId).catch(() => {});
        return;
      }

      // Duplicate slug: catch it NOW, while the agent can still be re-asked,
      // instead of at approval time when the user has already committed.
      const existing = await agentRepository.findBySlug(spec.slug, orgId);
      if (existing) {
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          markdownText: `⚠️ An agent called **${existing.name}** (\`${spec.slug}\`) already exists here, so I didn't create a draft. Ask me again with a different name, or edit the existing agent.`,
          userId: ctx.spacesAppUserId,
          metadata: { contentFormat: "markdown" },
        }, token);
        log.info(`[agent-card] draft dropped — slug ${spec.slug} already exists in org ${orgId}`);
        await deleteSession(sessionId).catch(() => {});
        return;
      }

      // Resolve the requested tools against THIS org's catalog. Unmatched
      // tokens are reported on the card and never persisted.
      const catalog = await buildAvailableToolsCatalog(undefined, orgId);
      const resolved = await resolveAgentCapabilities(spec.tools ?? [], catalog, requesterId);
      const note = unknownToolsNote(resolved.unknown);
      if (resolved.unknown.length > 0) {
        log.info(`[agent-card] draft ${spec.slug}: unmatched tools [${resolved.unknown.join(", ")}]`);
      }

      // The draft itself lives server-side. proposedContent is what the approve
      // path re-reads and creates — the card is display only.
      const proposedContent = JSON.stringify(spec);
      const outcome = await agentRequestRepository.supersedeAndCreateAgentCreate({
        agentSlug: spec.slug,
        requesterId,
        orgId,
        proposedContent,
        proposedContentHash: hashSkillContent(proposedContent),
      });
      if (outcome.supersededCount > 0) {
        log.info(`[agent-card] superseded ${outcome.supersededCount} stale draft(s) for ${spec.slug} by ${requesterId}`);
      }

      // A lead-in line so the card isn't dropped into the thread wordlessly. The
      // agent's own `summary` (why it made these calls) when it wrote one;
      // otherwise a neutral line — never a restatement of the card, which would
      // just be the same content twice.
      const leadIn =
        spec.summary?.trim() ||
        `I've drafted an agent for this — have a look and approve it below if it's right.`;
      try {
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          markdownText: leadIn,
          userId: ctx.spacesAppUserId,
          metadata: { contentFormat: "markdown" },
        }, token);
      } catch (e) {
        // Non-fatal: the card is the deliverable and still posts below.
        log.warn("Failed to post agent-draft lead-in (non-fatal)", {
          error: errMsg(e),
        });
      }

      const identity = identityFromDraftSpec(spec, resolved, ctx.agentSlug);
      const flow = withSpacesAppId(
        buildAgentCardFlow(
          {
            variant: "draft",
            phase: "pending",
            agent: identity,
            ...(note ? { note } : {}),
          },
          {
            requestId: outcome.request.id,
            agentSlug: ctx.agentSlug,
            userId: requesterId,
            conversationId: ctx.conversationId,
            channelId: ctx.channelId,
          },
        ),
        ctx.spacesAppId,
      );

      await spacesAppFetch("/chat/postMessage", {
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        flow,
        userId: ctx.spacesAppUserId,
      }, token);
      log.info(`[agent-card] posted draft card slug=${spec.slug} request=${outcome.request.id} conv=${ctx.conversationId}`);

      // Persist an assistant transcript row: the interactive card exists only in
      // Spaces, so without this the claw chat shows nothing for this turn and the
      // next user message groups as a sibling branch. Same reasoning as the plan
      // card's transcript row above.
      try {
        const capabilityLine = identity.capabilities?.length
          ? `\n\n**Capabilities:** ${identity.capabilities.map((c) => c.label).join(", ")}`
          : "";
        const parentId = await chatMessageRepository
          .latestMessageId(ctx.conversationId, ctx.agentSlug)
          .catch(() => null);
        await chatMessageRepository.create({
          conversationId: ctx.conversationId,
          agentSlug: ctx.agentSlug,
          userId: runOwnerId,
          orgId,
          ...(parentId ? { parentId } : {}),
          role: "assistant",
          content: `**🤖 Drafted an agent — ${identity.name}** (\`${identity.slug}\`)\n\n${identity.description ?? ""}${capabilityLine}\n\n_Approve the card to create it._`,
          status: "completed",
          ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
        });
      } catch (e) {
        log.warn("Failed to persist agent-draft assistant transcript row (non-fatal)", {
          error: errMsg(e),
        });
      }
    } catch (err) {
      log.error("Failed to post agent draft card", {
        error: errMsg(err),
        slug: spec.slug,
      });
      try {
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          markdownText: "⚠️ I drafted the agent but couldn't post it for approval. Please try again.",
          userId: ctx.spacesAppUserId,
          metadata: { contentFormat: "markdown" },
        }, token);
      } catch {
        // The user already lost this turn; don't compound it with a throw.
      }
    }
    await deleteSession(sessionId).catch(() => {});
    return;
  }

  // CHECKER RUNS ARE SILENT. Their verdicts are already persisted to the ledger
  // via /internal/experiments/:id/reviews and surface in `/experiment findings`.
  // Posting them to the thread adds noise AND interleaves with real
  // conversation: a checker that finishes after the user's next message reads
  // as a reply to it.
  if (ctx.suppressThreadReply) {
    log.info(`[webhook/result] suppressed thread reply for silent run session=${sessionId} agent=${ctx.agentSlug ?? ""}`);
    await deleteSession(sessionId);
    return;
  }

  // Notify user if result is empty (but not if copilot has pendingResponses, and
  // not when a capability card was just posted — there the card IS the answer
  // and an apology under it would be nonsense).
  // ATTACHMENTS COUNT AS AN ANSWER. Without `!payload.attachments?.length` here,
  // a run whose entire output is a file — a rendered video, a PDF, a report zip —
  // falls into the empty-result branch: the user is told "I didn't have a final
  // answer to show" and the file is DROPPED, never posted. Observed live: a
  // 92 KB explainer.mp4 rendered successfully, the run completed, and the thread
  // got the apology instead of the video.
  if (
    !resultWithCitations.trim() &&
    !payload.attachments?.length &&
    !payload.pendingResponses?.length &&
    !postedAgentProfileCard
  ) {
    if (ctx.responseMode === "approval") {
      log.warn("Empty result in approval mode — skipping (no thread message)");
      await deleteSession(sessionId);
      return;
    }

    // Capacity failures often surface as an EMPTY result (status=completed,
    // emptyReason=provider_capacity), not status=failed — so hook the auto-retry
    // here too. The card replaces the generic "try again in a moment" notice.
    if (payload.emptyReason === "provider_capacity") {
      const scheduled = await scheduleCapacityRetryIfNeeded(ctx, payload, true).catch(() => false);
      if (scheduled) {
        await deleteSession(sessionId).catch(() => {});
        return;
      }
    }

    log.warn("Empty result — notifying user", {
      ...(payload.emptyReason ? { emptyReason: payload.emptyReason } : {}),
      ...(payload.emptyReasonDetail ? { emptyReasonDetail: payload.emptyReasonDetail } : {}),
    });
    try {
      const token = ctx.appToken;
      // Raw payload.error must not be surfaced to users (leak risk). But when
      // claw tagged the blank as a provider failure after a fallback (429 /
      // quota / transient error / empty completion), say so — and include the
      // safe, sanitized underlying detail it forwarded — so the user knows it's
      // a transient provider issue to retry, not the agent having nothing to say.
      const usedTools = (payload.toolsUsed?.length ?? 0) > 0;
      const sorryText = payload.emptyReason === "provider_capacity"
        ? `⚠️ The AI provider had a temporary problem and couldn't complete your request${payload.emptyReasonDetail ? ` — \`${payload.emptyReasonDetail}\`` : ""}. Please try again in a moment.`
        : usedTools
          ? "Sorry — I completed some steps but didn't have a final answer to show. Please try rephrasing, or send your message again."
          : "Sorry, I wasn't able to produce a response. Please try sending your message again.";
      await spacesAppFetch("/chat/postMessage", {
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        markdownText: sorryText,
        userId: ctx.spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      }, token);
    } catch (err) {
      log.error("Failed to send empty-result notice", { error: errMsg(err) });
    }
    return;
  }

  // Don't delete session yet — agent conversations may continue
  // sessionStore.delete(sessionId);

  try {
    const token = ctx.appToken;

    // pendingResponses (Verify Responses OR copilot) are posted RAW below,
    // unlike the normal result path which runs prepareAgentResultForPosting.
    // That meant an agent's plain `@Name` never became a clickable/notifying
    // mention on verify-responses/copilot replies. Resolve them here too:
    // prefer the triggering human's Spaces session (best user-search scope),
    // fall back to the agent's bot token. Fail-open — return the text unchanged
    // on any error so the reply still posts.
    const pendingSenderAuth = payload.pendingResponses?.length
      ? await getSpacesAuthForUser(ctx.senderId, "webhook").catch(() => null)
      : null;
    const resolvePendingMentions = async (text: string): Promise<string> => {
      const lookupToken = pendingSenderAuth?.token ?? ctx.appToken;
      if (!text.trim() || !lookupToken) return text;
      try {
        // Human sender's workspace if we have one, else the agent's own.
        const wsId = pendingSenderAuth?.workspaceId ?? ctx.workspaceId
          ?? (ctx.spacesAppUserId ? await getSpacesUserWorkspaceId(ctx.spacesAppUserId) : null);
        const resolved = await resolveUnboundMentions(
          text,
          buildSpacesMentionLookups({
            token: lookupToken,
            ...(pendingSenderAuth?.sessionId ? { sessionId: pendingSenderAuth.sessionId } : {}),
            ...(wsId ? { workspaceId: wsId } : {}),
          }),
        );
        return expandSpacesMentions(resolved);
      } catch (err) {
        log.warn(`pending-response mention resolution failed — posting raw: ${errMsg(err)}`);
        return text;
      }
    };

    // The result-webhook `payload.toolInvocations` carries ONLY the parent
    // agent's own tool calls. Nested subagent CHILD invocations — each with its
    // own citations, and the rows the inline `[clf-<toolCallId>#n]` tokens
    // actually reference — are live-streamed into the AgentRun during the run
    // (appendToolInvocation) and unioned at finalize. Read the persisted run
    // back and merge (dedupe by toolCallId, streamed children first) so citation
    // baking sees the full flat list the /messages sidebar path also uses.
    // Without this, subagent citations (Google/Spaces subagents) never resolve.
    const mergeInvocationsById = (...lists: unknown[]): unknown[] => {
      const out: Array<Record<string, unknown>> = [];
      const seen = new Set<string>();
      const keyFor = (inv: Record<string, unknown>): string =>
        String(inv["toolCallId"] ?? `${inv["toolName"] ?? ""}-${inv["startedAt"] ?? ""}`);
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const inv of list) {
          if (!inv || typeof inv !== "object") continue;
          const k = keyFor(inv as Record<string, unknown>);
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(inv as Record<string, unknown>);
        }
      }
      return out;
    };
    // Citations are SESSION-scoped, not turn-scoped: a follow-up turn often
    // re-cites a `[clf-<toolCallId>#n]` chunk produced by a tool call in an
    // EARLIER turn (the tool isn't re-run, so that toolCallId is absent from
    // this run's invocations). Union tool invocations across (a) this run's
    // persisted/enriched row, (b) EVERY prior run in the same conversation, and
    // (c) the raw payload — dedupe by toolCallId, this run first. Token-scoping
    // in buildThreadCitationMeta then bakes only the invocations a token
    // actually references, so the union is just the resolution pool.
    let citationInvocations: unknown = payload.toolInvocations;
    try {
      const lists: unknown[] = [];
      if (sessionId) {
        const persistedRun = await agentRunRepository.findBySessionId(sessionId);
        if (Array.isArray(persistedRun?.toolInvocations)) {
          lists.push(persistedRun.toolInvocations);
        }
      }
      if (ctx.conversationId && ctx.senderId) {
        const priorRuns = await agentRunRepository.listByConversation(
          ctx.conversationId,
          ctx.senderId,
          { limit: 50 },
        );
        for (const r of priorRuns) {
          if (Array.isArray(r.toolInvocations)) lists.push(r.toolInvocations);
        }
      }
      lists.push(payload.toolInvocations);
      const merged = mergeInvocationsById(...lists);
      if (merged.length > 0) citationInvocations = merged;
    } catch (e) {
      log.warn(`Failed to assemble citation invocations for baking: ${errMsg(e)}`);
    }

    // Build the /chat/postMessage `metadata` for a bot reply, baking in the
    // citation lookup scoped to the tokens in THIS message's text (see
    // buildThreadCitationMeta). Used by the copilot/pendingResponses posts
    // below, which deliver the answer via a different path than the normal
    // conversation branch (convMetadata) and would otherwise ship no citations.
    const runOriginMeta: Record<string, unknown> = payload.localHarness
      ? { clawRunOrigin: { kind: "local-harness", ...payload.localHarness } }
      : {};

    const buildPostMetadata = (text: string): Record<string, unknown> => {
      const meta: Record<string, unknown> = { contentFormat: "markdown", ...runOriginMeta };
      const tc = buildThreadCitationMeta(citationInvocations, text);
      if (tc) {
        meta["clawCitations"] = tc.clawCitations;
        meta["clawCitationIcons"] = tc.clawCitationIcons;
      }
      return meta;
    };

    // ── Copilot mode: post pendingResponses instead of result.text ──
    if (payload.pendingResponses?.length) {
      if (ctx.responseMode === "approval") {
        // Merge copilot responses into a single result for the approval DM
        const combinedResult = payload.pendingResponses.map((pr) => pr.message).join("\n\n");
        // workspaceId is required by Spaces' /channel/openDm Zod schema
        // (prod-deployed channel.ts:11-15 adds workspaceId.min(1) which our
        // source tree at work_dir didn't have). Without it the route 400s
        // with a single-field Zod error, the catch above swallows it, and
        // the reply never posts.
        const dmResult = (await spacesAppFetch("/channel/openDm", {
          targetUserId: ctx.mentionedUserId,
          workspaceId: ctx.workspaceId ?? "",
        }, token)) as { channelId: string };

        const twinFlow = withSpacesAppId(buildTwinApprovalFlow({
          delivery: { action: "reply", message: combinedResult },
          ...(ctx.sourceMessageId ? { sourceMessageId: ctx.sourceMessageId } : {}),
          targetChannelId: ctx.channelId,
          targetConversationId: ctx.conversationId,
          mentionedUserId: ctx.mentionedUserId,
          workspaceId: ctx.workspaceId ?? "",
          senderId: ctx.senderId,
          senderName: ctx.senderName,
          channelName: ctx.channelName,
          task: ctx.task,
          ...(ctx.agentSlug ? { agentSlug: ctx.agentSlug } : {}),
          dmChannelId: dmResult.channelId,
          spacesBaseUrl: CONFIG.spacesAppUrl,
        }), ctx.spacesAppId);

        await spacesAppFetch("/chat/postMessage", {
          channelId: dmResult.channelId,
          flow: twinFlow,
          userId: ctx.spacesAppUserId,
        }, token);

        log.info(`Digital Twin (copilot): sent approve/decline DM to ${ctx.mentionedUserId}`);
        await deleteSession(sessionId);
        return;
      }

      if (payload.attachments?.length) {
        // Run the combined reply + attachments through prepareAgentResultForPosting
        // BEFORE uploading. Previously this branch appended every raw attachment
        // into one /files/filesUpload, which is fronted by multer's `files: 10`
        // cap — an agent that produced >10 artifacts (e.g. 11 screenshots) tripped
        // `400 "Unexpected field"` (LIMIT_UNEXPECTED_FILE), and with no fallback
        // here the whole reply was dropped (run completes, thread shows nothing).
        // prepare() bundles >MAX_ATTACHMENTS_PER_MESSAGE into gallery+zip so we
        // never exceed the cap, and length-guards the body. Mentions are already
        // resolved via resolvePendingMentions, so we don't pass a sender token.
        const combinedText = await resolvePendingMentions(
          payload.pendingResponses.map((pr) => pr.message).join("\n\n"),
        );
        const prepared = await prepareAgentResultForPosting(
          combinedText,
          payload.attachments as OutgoingAttachment[],
          { ...(ctx.agentSlug ? { agentSlug: ctx.agentSlug } : {}) },
        );
        const form = new FormData();
        for (const att of prepared.attachments) {
          const buffer = Buffer.from(att.data, "base64");
          const blob = new Blob([buffer], { type: att.mimeType });
          form.append("files", blob, att.fileName);
        }
        form.append("channelId", ctx.channelId);
        form.append("conversationId", ctx.conversationId);
        form.append("userId", ctx.spacesAppUserId);
        form.append("markdownText", prepared.text);
        form.append("metadata", JSON.stringify(buildPostMetadata(prepared.text)));
        try {
          await spacesAppFetchMultipart("/files/filesUpload", form, token);
          log.info(`Copilot: uploaded ${prepared.attachments.length} attachment(s) with response(s) in thread ${ctx.conversationId}`);
        } catch (err) {
          // Attachment upload failed — don't drop the whole reply. Post the text
          // answer via /chat/postMessage so the user still gets the response;
          // only the files couldn't be delivered. Mirrors the normal result path.
          log.warn(
            `Copilot: attachment upload failed for ${ctx.agentSlug} — falling back to text-only reply`,
            { error: errMsg(err) },
          );
          const fileNote = `⚠️ _Couldn't attach ${prepared.attachments.length} file(s) (upload failed)._`;
          const fallbackText = prepared.text?.trim()
            ? `${prepared.text}\n\n${fileNote}`
            : `${fileNote} Please try again.`;
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            markdownText: fallbackText,
            userId: ctx.spacesAppUserId,
            metadata: buildPostMetadata(fallbackText),
          }, token);
          log.info(`Copilot: posted text-only fallback after attachment upload failure in thread ${ctx.conversationId}`);
        }
      } else {
        for (const pr of payload.pendingResponses) {
          const prText = await resolvePendingMentions(pr.message);
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            markdownText: prText,
            userId: ctx.spacesAppUserId,
            metadata: buildPostMetadata(prText),
          }, token);
        }
        log.info(`Copilot: posted ${payload.pendingResponses.length} response(s) in thread ${ctx.conversationId}`);
      }

      // Persist the reply as a ChatMessage so the Claw chat window (which reads
      // ONLY chat_messages) can show it. Both Verify-Responses and copilot modes
      // deliver the turn via pendingResponses with an EMPTY result.text (see the
      // "Verify Responses OR copilot" note above), so the normal save in the
      // resultWithCitations branch is skipped — without this, EVERY reply from
      // such agents (e.g. xyne-spaces-architect) is invisible in the chat window
      // and its tool calls can't pair to an assistant row. Uses ctx.agentSlug +
      // runOwnerId to match the user-message rows (also written under the run
      // owner) so the per-agent scope and per-user ACL on read both line up.
      // `!resultWithCitations.trim()` guards against a double-save: the normal
      // save above already fires when result.text is non-empty, so only persist
      // here when it was empty (the actual Verify-Responses/copilot case).
      const pendingReply = payload.pendingResponses.map((pr) => pr.message).join("\n\n");
      if (!resultWithCitations.trim() && pendingReply.trim() && ctx.conversationId && ctx.agentSlug && ctx.agentOrgId) {
        chatMessageRepository.create({
          conversationId: ctx.conversationId,
          agentSlug: ctx.agentSlug,
          userId: runOwnerId,
          orgId: ctx.agentOrgId,
          role: "assistant",
          content: pendingReply,
          status: "completed",
          ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
        }).catch((e) => log.warn("Failed to save pending-response assistant ChatMessage", { error: errMsg(e) }));
      }

      // Post pending write action approvals (e.g. spaces-memory-create) before returning
      const copilotPendingActions = (payload as { pendingActions?: Array<Record<string, unknown>> }).pendingActions;
      if (copilotPendingActions?.length) {
        let copilotApprovalCardsSent = 0;
        for (const action of copilotPendingActions) {
          const targetValidation = await pendingActionTargetValidation(action, ctx, token);
          if (targetValidation.error) {
            log.info(`[webhook/result] skipped write approval card tool=${String(action["tool"] ?? "")}: ${targetValidation.error}`);
            continue;
          }

          await postWriteApprovalAction({ action, ctx, token, targetValidation });
          copilotApprovalCardsSent += 1;
        }
        log.info(`Copilot: posted ${copilotApprovalCardsSent}/${copilotPendingActions.length} write action approval(s)`);
      }

      // Don't delete session — copilot sessions persist for multi-turn
      return;
    }

    if (ctx.responseMode === "approval") {
      // Digital Twin approval is handled by the early twin-delivery branch above
      // (it short-circuits before any conversation processing). Reaching here
      // means a completed approval run that produced no structured delivery —
      // stay silent (fail-closed) rather than posting anything.
      clog.warn(`[webhook/result] approval path reached post-processing with no delivery — staying silent, session ${sessionId}`);
      await deleteSession(sessionId);
      return;
    } else {
      // ── Agent conversation mode: edit the progress placeholder in-place,
      // or post a new message if no placeholder exists ──
      // Bake the structured citation lookup into the message metadata so a
      // re-opened Spaces thread can render clickable citation chips WITHOUT
      // re-calling claw (the thread transcript is served straight from
      // Postgres, which the /messages sidebar path never touches). Mirrors what
      // the /messages API ships: a slimmed toolInvocations list (toolCallId +
      // Citation[]) plus a de-duplicated iconKey→data:URI map. Additive — the
      // inline `[clf-…#n]` tokens already live in `agentResult`.
      const threadCitationMeta = buildThreadCitationMeta(
        citationInvocations,
        resultWithCitations,
      );
      const convMetadata = {
        contentFormat: "markdown",
        ...runOriginMeta,
        ...(threadCitationMeta
          ? {
              clawCitations: threadCitationMeta.clawCitations,
              clawCitationIcons: threadCitationMeta.clawCitationIcons,
            }
          : {}),
      };
      const agentResult = resultWithCitations;

      // Resolve the triggering human's Spaces session so prepareAgentResultForPosting
      // can do name → userId lookups for plain `@Name` mentions the LLM emitted
      // without brackets. Falls back to null on lookup failure — the prepare
      // function gracefully skips resolution when senderSpacesToken is absent.
      const senderAuth = await getSpacesAuthForUser(ctx.senderId, "webhook").catch(() => null);

      // Apply the 10K-char + attachment-count guards. When the result is
      // too long, this swaps the body for a stub + a PDF attachment, which
      // forces the multipart code path even when the original agent didn't
      // emit any attachments.
      // Headless run (no human sender) → scope name resolution to the agent's
      // own workspace, derived from its app user. Skipped when a sender token
      // exists (that path carries the human's workspace already).
      const agentWsId = !senderAuth?.token && ctx.spacesAppUserId
        ? (ctx.workspaceId ?? await getSpacesUserWorkspaceId(ctx.spacesAppUserId))
        : null;
      const prepared = await prepareAgentResultForPosting(
        agentResult,
        payload.attachments as OutgoingAttachment[] | undefined,
        {
          ...(ctx.agentSlug ? { agentSlug: ctx.agentSlug } : {}),
          ...(senderAuth?.token ? { senderSpacesToken: senderAuth.token } : {}),
          ...(senderAuth?.sessionId ? { senderSpacesSessionId: senderAuth.sessionId } : {}),
          ...(senderAuth?.workspaceId ? { senderWorkspaceId: senderAuth.workspaceId } : {}),
          ...(agentWsId ? { agentWorkspaceId: agentWsId } : {}),
        },
      );

      if (prepared.attachments.length > 0) {
        const form = new FormData();
        for (const att of prepared.attachments) {
          const buffer = Buffer.from(att.data, "base64");
          const blob = new Blob([buffer], { type: att.mimeType });
          form.append("files", blob, att.fileName);
        }
        form.append("channelId", ctx.channelId);
        form.append("conversationId", ctx.conversationId);
        form.append("userId", ctx.spacesAppUserId);
        form.append("markdownText", prepared.text);
        form.append("metadata", JSON.stringify(convMetadata));
        try {
          await spacesAppFetchMultipart("/files/filesUpload", form, token);
          log.info(
            `Agent ${ctx.agentSlug}: replied with ${prepared.attachments.length} attachment(s)` +
            (agentResult.length > MAX_MESSAGE_CHARS ? ` (PDF fallback, original ${agentResult.length} chars)` : ""),
          );
        } catch (err) {
          // The attachment upload (Spaces /files/filesUpload) failed — do NOT
          // drop the whole reply. Fall back to posting the text answer via
          // /chat/postMessage so the user still gets the response; only the
          // file couldn't be delivered. (Common when Spaces' file storage is
          // unavailable, e.g. GCS unauthenticated.)
          log.warn(
            `Attachment upload failed for ${ctx.agentSlug} — falling back to text-only reply`,
            { error: errMsg(err) },
          );
          const fileNote = `⚠️ _Couldn't attach ${prepared.attachments.length} file(s) (upload failed)._`;
          const fallbackText = prepared.text?.trim()
            ? `${prepared.text}\n\n${fileNote}`
            : `${fileNote} Please try again.`;
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            markdownText: fallbackText,
            userId: ctx.spacesAppUserId,
            metadata: convMetadata,
          }, token);
          log.info(`Agent ${ctx.agentSlug}: posted text-only fallback after attachment upload failure in thread ${ctx.conversationId}`);
        }
      } else {
        // Placeholder path: if we have the "⏳" messageId, edit it with the final
        // result so the same message transitions from "working..." to the answer.
        // On any update failure, fall through to a fresh postMessage so the user
        // never goes without the final answer. (Long-result case never reaches
        // here — prepared.attachments is non-empty above whenever the original
        // body exceeded the cap, so updateMessage only ever sees safe-length text.)
        let posted = false;
        if (!USE_EPHEMERAL_PROGRESS && ctx.progressMessageId) {
          try {
            await spacesAppFetch("/chat/updateMessage", {
              messageId: ctx.progressMessageId,
              markdownText: prepared.text,
              userId: ctx.spacesAppUserId,
              metadata: convMetadata,
            }, token);
            log.info(`Updated placeholder ${ctx.progressMessageId} with final result for ${ctx.agentSlug}`);
            posted = true;
          } catch (err) {
            log.warn("Failed to update placeholder with final result — falling back to fresh post", { error: errMsg(err) });
          }
        }
        if (!posted) {
          log.info(`Posting result: channelId=${ctx.channelId} conversationId=${ctx.conversationId} resultLen=${prepared.text.length} userId=${ctx.spacesAppUserId}`);
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            // Channel-bound, thread-less runs (API/event-triggered) carry an
            // empty conversationId. Sending "" explicitly fails Spaces'
            // ChannelValidationSchema (conversationId is .min(1).optional() —
            // "" is a string, not undefined, so it trips .min(1) → 400
            // "Validation error"). Omit it when empty so Spaces treats the post
            // as a top-level channel message and creates a fresh thread.
            ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
            markdownText: prepared.text,
            userId: ctx.spacesAppUserId,
            metadata: convMetadata,
          }, token);
          log.info(`Agent ${ctx.agentSlug}: replied in thread ${ctx.conversationId}`);
        }
      }

      // ── /goal relooper hook ─────────────────────────────────────────────
      // Only fires in conversation mode (we're inside the `else` branch from
      // line 1932), and only on successful turns. If an ActiveGoal exists for
      // this conversation, the relooper records the turn, asks the boss judge
      // whether the goal is met, and either terminates or refires claw with
      // the stashed runPayload + relooper task template.
      //
      // Copilot-mode agents (Xyne Doctor, PR Rules Miner, etc.) terminate via
      // the `respond-to-user` tool — claw sends `result: ""` and the actual
      // turn content in `pendingResponses`. Fall back to those when result is
      // empty so the goalkeeper still runs for copilot agents.
      const turnText =
        (typeof payload.result === "string" && payload.result.trim().length > 0)
          ? payload.result
          : ((payload.pendingResponses ?? [])
              .map((r) => r.message ?? "")
              .join("\n\n")
              .trim());
      if (payload.status === "completed" && turnText.length > 0) {
        try {
          // Surface attachment metadata (filename + mime + size only — NOT
          // the base64 data) to the boss judge so artefact goals like
          // "produce an HTML report" don't get false-failed on the judge's
          // text-only view of the turn. Computing here keeps the per-attachment
          // base64 work out of the judge path.
          const turnAttachments = (payload.attachments ?? []).map((a) => ({
            fileName: a.fileName,
            mimeType: a.mimeType,
            sizeBytes: typeof a.data === "string"
              // base64 → bytes: ceil(len * 3/4), minus padding "="s
              ? Math.max(0, Math.floor(a.data.length * 3 / 4) - (a.data.match(/=+$/)?.[0]?.length ?? 0))
              : 0,
          }));
          const decision = await recordTurnAndDecide({
            conversationId: ctx.conversationId,
            lastTurnResult: turnText,
            ...(turnAttachments.length > 0 ? { attachmentsThisTurn: turnAttachments } : {}),
          });
          if (decision.kind === "terminated") {
            await spacesAppFetch("/chat/postMessage", {
              channelId: ctx.channelId,
              conversationId: ctx.conversationId,
              markdownText: decision.replyToUser,
              userId: ctx.spacesAppUserId,
              metadata: { contentFormat: "markdown" },
            }, token).catch(() => {});
            log.info(`[goal] terminated for conv ${ctx.conversationId}: ${decision.reason}`);
          } else if (decision.kind === "continue") {
            // Per-turn "Turn N/M — reason" rides the ephemeral progress spinner
            // (same surface as tool calls), not a new chat message — only the
            // terminal outcome above is posted permanently.
            await postGoalPhase(
              { conversationId: ctx.conversationId, channelId: ctx.channelId, agentSlug: ctx.agentSlug, spacesAppUserId: ctx.spacesAppUserId, appToken: token },
              decision.replyToUser,
            );
            // Refire claw's /run with the stashed dispatch payload, overriding
            // the task with the relooper template. claw mints a fresh
            // sessionId; the result callback will route back here and feed the
            // next iteration. No await on the actual run completion — claw
            // ACKs immediately with the sessionId, work happens async.
            const refire: Record<string, unknown> = {
              ...(decision.runPayload as Record<string, unknown>),
              task: decision.nextTurnTask,
            };
            if (typeof refire["orgId"] !== "string" || !refire["orgId"]) {
              if (ctx.agentOrgId) {
                refire["orgId"] = ctx.agentOrgId;
              } else {
                log.warn("[goal] refire missing orgId; refusing to dispatch");
                return;
              }
            }
            const refireUserId = refire["userId"];
            if (typeof refireUserId !== "string" || !refireUserId) {
              log.warn("[goal] refire missing userId; refusing to dispatch");
              return;
            }
            const runUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run`;
            void fetch(runUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
                "x-user-id": refireUserId,
              },
              body: JSON.stringify(refire),
            }).catch((err) => {
              log.warn("[goal] refire failed", { error: errMsg(err) });
            });
            goalContinues = true;
            log.info(`[goal] continuing for conv ${ctx.conversationId}`);
          }
        } catch (err) {
          log.warn("[goal] relooper hook errored — leaving goal in current state", {
            error: errMsg(err),
          });
        }
      }
    }

    // ── Promote-provider prompt: detect soft refusal on a kimi/spaces run ──
    // Mirrors the failure-curator "agent_unable_to_do_work" bucket but applied
    // inline here so the user gets the prompt immediately instead of after the
    // batch worker tick. Two heuristics, joined by OR:
    //   1. result matches the soft-refusal regex (polite-refusal phrasings).
    //   2. very-short completion (<250 chars) with no tools used — the agent
    //      stubbed out instead of doing the work.
    // Gated on: ctx.escalatedProvider unset (kimi/spaces was the parent
    // provider) AND no toolsUsed (a result with real tool work isn't a
    // refusal, even if it's terse). Single prompt per conversation: once
    // accepted/declined the next turn's ctx carries escalatedProvider so this
    // branch skips.
    if (
      payload.status === "completed" &&
      !ctx.escalatedProvider &&
      ctx.agentSlug &&
      ctx.agentOrgId &&
      resultWithCitations
    ) {
      const SOFT_REFUSAL_RE =
        /\b(I\s+(?:can(?:no|'|’)?t|couldn'?t|don'?t\s+(?:have|know))|unable\s+to|out\s+of\s+scope|no\s+findings|without\s+(?:more|additional)|insufficient\s+(?:data|context|information)|I\s+do(?:n'?t)?\s+have\s+access|not\s+enough\s+(?:data|context|information))\b/i;
      const toolsUsedCount = Array.isArray(payload.toolsUsed) ? payload.toolsUsed.length : 0;
      const result = resultWithCitations.trim();
      const looksSoftRefusal =
        SOFT_REFUSAL_RE.test(result) ||
        (result.length < 250 && toolsUsedCount === 0);
      if (looksSoftRefusal) {
        try {
          const agentRow = await agentRepository.findBySlug(ctx.agentSlug, ctx.agentOrgId);
          if (agentRow) {
            // Same always-on gate as the hard-failure prompt. No point
            // asking the user to escalate when the agent provider is
            // already the default.
            const alwaysOnRaw = (agentRow.config as Record<string, unknown> | null)?.["providerAlwaysOn"];
            const isAlwaysOn = alwaysOnRaw !== false;
            const agentCreds = isAlwaysOn ? [] : await agentProviderCredentialsRepository.listByAgent(agentRow.id).catch(() => []);
            const hasCreds = (p: string) => {
              const row = agentCreds.find((c) => c.provider === p);
              return !!(row?.encryptedKey && row.iv && row.authTag);
            };
            const KNOWN = new Set(["codex", "claude", "copilot", "openrouter", "litellm"]);
            const rawOrder = (agentRow.config as Record<string, unknown> | null)?.["providerOrder"];
            const order: string[] = Array.isArray(rawOrder)
              ? rawOrder.filter((p): p is string => typeof p === "string" && KNOWN.has(p))
              : [];
            const legacy = (agentRow.config as Record<string, unknown> | null)?.["provider"] as string | undefined;
            const candidate = isAlwaysOn
              ? undefined
              : (order.find(hasCreds) ?? (legacy && KNOWN.has(legacy) && hasCreds(legacy) ? legacy : undefined));
            if (candidate) {
              const flow = withSpacesAppId(buildPromoteProviderFlow(candidate, {
                agentSlug: ctx.agentSlug,
                channelId: ctx.channelId,
                conversationId: ctx.conversationId,
                userId: ctx.senderId,
                originalTask: ctx.task,
              }), ctx.spacesAppId);
              await spacesAppFetch("/chat/postMessage", {
                channelId: ctx.channelId,
                conversationId: ctx.conversationId,
                flow,
                userId: ctx.spacesAppUserId,
              }, token).catch((err) => {
                log.warn("Failed to post promote-provider prompt (soft refusal)", { error: errMsg(err) });
              });
              log.info(`Posted promote-provider prompt for conv ${ctx.conversationId} (soft refusal, provider=${candidate})`);
            }
          }
        } catch (err) {
          log.warn("promote-provider prompt (soft refusal) error (non-fatal)", { error: errMsg(err) });
        }
      }
    }

    // ── Post question buttons in thread ──
    const pendingQuestions = (payload as { pendingQuestions?: Array<{ questionId: string; questions?: import("xyne-claw-shared").UserQuestion[]; question?: string; options?: string[] }> }).pendingQuestions;
    if (pendingQuestions?.length) {
      let postedQuestionSets = 0;
      for (const q of pendingQuestions) {
        const questions = q.questions?.length ? q.questions : q.question && q.options?.length ? [{ id: "q1", question: q.question, type: "single_choice" as const, options: q.options }] : undefined;
        if (!questions) continue;
        const posted = await renderUiWidget(sessionId, {
          id: `question:${q.questionId}`,
          type: "question",
          operation: "create",
          payload: { questionId: q.questionId, questions },
        }, ctx.conversationId, ctx.agentSlug, ctx);
        if (posted) postedQuestionSets += 1;
      }
      log.info(`Delivered ${postedQuestionSets} question set fallback(s) in thread ${ctx.conversationId}`);
    }

    // ── Post /goal suggestion FlowUI card in thread ──
    // Set by the suggest-goal tool in claw when the agent has
    // config.suggestGoal=true. Renders a one-button FlowUI card — tapping
    // hits /claw/api/v1/flow/action with actionType="start-goal" which
    // dispatches the same flow as a user typing /goal <condition>.
    // Condition rides in flowJSON.data (not the rendered rationale) so
    // multi-paragraph goals don't bloat the user-visible message. The card
    // collapses to a confirmation line after tap via replaceFlowCardWithText.
    const goalSuggestion = payload.pendingGoalSuggestion;
    if (goalSuggestion && goalSuggestion.condition?.trim() && goalSuggestion.rationale?.trim()) {
      const safeCondition = normalizeGoalCondition(goalSuggestion.condition);
      const safeRationale = goalSuggestion.rationale.replace(/\r?\n/g, " ").slice(0, 400);
      if (!safeCondition) {
        log.warn("Skipped /goal suggestion with invalid condition");
      } else {
        const goalAgentSlug = ctx.agentSlug ?? "";
        const goalSpacesAppId = ctx.spacesAppId ?? "";
        const actionNonce = crypto.randomUUID();
        const issuedAt = Date.now();
        const { signAction } = await import("./mcp.js");
        const goalActionPayload = {
          actionType: "start-goal",
          actionId: "start-goal",
          condition: safeCondition,
          agentSlug: goalAgentSlug,
          spacesAppId: goalSpacesAppId,
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          userId: ctx.senderId,
          actionNonce,
          issuedAt,
        };
        const goalFlow = withSpacesAppId(buildGoalSuggestionFlow(safeRationale, {
          condition: safeCondition,
          agentSlug: goalAgentSlug,
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          userId: ctx.senderId,
        }), goalSpacesAppId);
        goalFlow.data = {
          ...(goalFlow.data ?? {}),
          actionNonce,
          issuedAt,
          signature: signAction(goalActionPayload),
        };
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          flow: goalFlow,
          userId: ctx.spacesAppUserId,
        }, token).catch((err) => {
          log.warn("Failed to post /goal suggestion FlowUI card", {
            error: errMsg(err),
          });
        });
        log.info(`Posted /goal suggestion in thread ${ctx.conversationId}`);
      }
    }

    // ── Send approval DMs for pending write actions (HITL) ──
    const pendingActionsPayload = (payload as { pendingActions?: Array<Record<string, unknown>> }).pendingActions;
    if (pendingActionsPayload?.length) {
      let approvalCardsSent = 0;
      for (const action of pendingActionsPayload) {
        // Reuse the validation computed for the footer above so the message and
        // the card can never disagree; fall back only if it wasn't classified
        // (e.g. a non-completed status path that skipped the footer).
        const targetValidation =
          pendingActionValidation.get(action) ?? (await pendingActionTargetValidation(action, ctx, token));
        if (targetValidation.error) {
          log.info(`[webhook/result] skipped write approval card tool=${String(action["tool"] ?? "")}: ${targetValidation.error}`);
          continue;
        }

        await postWriteApprovalAction({ action, ctx, token, targetValidation });
        approvalCardsSent += 1;
      }

      log.info(`Sent ${approvalCardsSent}/${pendingActionsPayload.length} write action approval(s) to ${ctx.senderId}`);
    }

    // ── Agent chaining: channel-level workflow keyed by (channelId, rootAgentSlug) ──
    // Experiment/understanding epochs are exempt: they fire dozens of times per
    // run and their result is a proof artifact, not a user turn to hand off. A
    // chain here just makes the next agent (e.g. euler-reviewer) reject every
    // epoch, once per epoch. The user drives the loop; the loop does not chain.
    if (ctx.isExperiment) {
      log.info(`Chain: skipped for experiment epoch (conversation=${ctx.conversationId})`);
    } else if (ctx.agentSlug && ctx.agentOrgId) {
      try {
        const rootAgentSlug = ctx.rootAgentSlug ?? ctx.agentSlug;
        const binding = await agentChainWorkflowRepository.findActiveWorkflowForChannel(ctx.channelId, rootAgentSlug, ctx.senderId);
        if (!binding) {
          log.info(`Chain: no active workflow bound for channel=${ctx.channelId} root=${rootAgentSlug}`);
          return;
        }

        const workflow = parseWorkflowDefinition(binding.workflow.definition);
        if (!workflow) {
          log.warn(`Chain: workflow ${binding.workflowId} has invalid definition`);
          return;
        }

        const currentDepth = ctx.chainDepth ?? 0;
        const isCycleWorkflow = hasWorkflowCycle(workflow);
        const maxDepth = isCycleWorkflow
          ? 3
          : Math.max(1, Math.min(workflow.maxDepth ?? 6, 12));
        if (currentDepth >= maxDepth) {
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            text: isCycleWorkflow
              ? `<span data-mention="" data-mention-type="user" data-user-id="${ctx.senderId}" data-username="${ctx.senderName}" class="chat-input-mention">@${ctx.senderName}</span> Agent workflow cycle limit is breached (3 turns).`
              : `<span data-mention="" data-mention-type="user" data-user-id="${ctx.senderId}" data-username="${ctx.senderName}" class="chat-input-mention">@${ctx.senderName}</span> Agent workflow reached max depth (${maxDepth}).`,
            userId: ctx.spacesAppUserId,
          }, token).catch(() => {});
          log.info(`Chain: max depth ${maxDepth} reached for workflow ${binding.workflowId} (cycle=${isCycleWorkflow})`);
          return;
        }

        const toolsUsed = (payload as { toolsUsed?: string[] }).toolsUsed ?? [];
        const resultText = payload.result ?? "";
        // Feed the judge the REAL original user request, not the interpolated
        // hand-off prompt (which `ctx.task` becomes after hop 1). On the first
        // hop ctx.rootTask is unset and ctx.task IS the original request.
        const originalTask = ctx.rootTask ?? ctx.task;
        const selected = await selectNextWorkflowEdge(workflow, ctx.agentSlug, toolsUsed, resultText, originalTask);

        if (!selected) {
          log.info(`Chain: no matching edge from ${ctx.agentSlug} in workflow ${binding.workflowId}`);
          return;
        }

        const taskTemplate = selected.edge.taskTemplate ?? selected.nextNode.taskTemplate ?? "{{result}}";
        const interpolatedTask = interpolateChainTask(taskTemplate, {
          result: resultText.slice(0, 4000),
          agentSlug: ctx.agentSlug,
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          rootAgentSlug,
        });

        const targetAgentSlug = selected.nextNode.agentSlug;
        const targetAgentRow = await agentRepository.findBySlug(targetAgentSlug, ctx.agentOrgId);
        if (!targetAgentRow?.spacesAppToken || !targetAgentRow.spacesAppId) {
          log.error(`Chain: target agent "${targetAgentSlug}" not found or not configured`);
          return;
        }

        // Hand the next agent the previous agent's FINAL output verbatim (via
        // `context`, independent of whether the task template used {{result}}),
        // plus any attachments the previous agent produced — so artifacts (CSV,
        // PDF, screenshots, …) carry across the hop instead of being dropped.
        const handoffContext =
          `--- Final output from the previous agent ("${ctx.agentSlug}") ---\n` +
          resultText.slice(0, 8000);
        const forwardedAttachments = payload.attachments ?? [];

        const runRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
          },
          body: JSON.stringify({
            userId: ctx.senderId,
            task: interpolatedTask,
            context: handoffContext,
            agentSlug: targetAgentSlug,
            orgId: targetAgentRow.orgId,
            channelId: ctx.channelId,
            ...(forwardedAttachments.length > 0 ? { attachments: forwardedAttachments } : {}),
            callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
            progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
          }),
        });

        if (!runRes.ok) { log.error(`Chain trigger HTTP ${runRes.status}`); return; }
        const runBody = (await runRes.json()) as { success: boolean; sessionId?: string; error?: string };

        if (runBody.success && runBody.sessionId && targetAgentRow.spacesAppToken && targetAgentRow.spacesAppId) {
          const targetAppToken = decryptStoredField(targetAgentRow.spacesAppToken);
          const targetContext: SessionContext = {
            mentionedUserId: targetAgentRow.spacesAppUserId ?? "",
            senderId: ctx.senderId,
            senderName: ctx.senderName,
            channelId: ctx.channelId,
            channelName: ctx.channelName,
            conversationId: ctx.conversationId,
            task: interpolatedTask,
            rootTask: originalTask,
            agentId: targetAgentRow.id,
            agentOrgId: targetAgentRow.orgId ?? null,
            agentSlug: targetAgentSlug,
            responseMode: "conversation",
            appToken: targetAppToken,
            spacesAppId: targetAgentRow.spacesAppId,
            spacesAppUserId: targetAgentRow.spacesAppUserId ?? "",
            chainDepth: currentDepth + 1,
            rootAgentSlug,
            workflowId: binding.workflowId,
            triggerSource: "spaces",
            ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
          };
          await setSession(runBody.sessionId, targetContext);
          const targetDispatchPayload = {
            userId: ctx.senderId,
            task: interpolatedTask,
            context: handoffContext,
            conversationId: ctx.conversationId,
            agentSlug: targetAgentSlug,
            orgId: targetAgentRow.orgId,
            eventType: "APP_MENTIONED",
            traceId: ctx.traceId ?? runBody.sessionId,
            ...(forwardedAttachments.length > 0 ? { attachments: forwardedAttachments } : {}),
            callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
            progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
            channelId: ctx.channelId,
          };
          await registerRunRecovery({
            rootSessionId: runBody.sessionId,
            maxRetries: CONFIG.runRecoveryMaxRetries,
            timeoutMs: CONFIG.runRecoveryTimeoutMs,
            retryBackoffMs: CONFIG.runRecoveryBackoffMs,
            dispatchPayload: targetDispatchPayload,
            sessionContext: targetContext,
          });

          log.info(`Chain: ${ctx.agentSlug} → ${targetAgentSlug} (step ${currentDepth + 1}/${maxDepth}, workflow ${binding.workflowId})`);
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            markdownText: `⛓️ **Agent workflow**: \`${ctx.agentSlug}\` → \`${targetAgentSlug}\` (step ${currentDepth + 1}/${maxDepth})`,
            userId: ctx.spacesAppUserId,
            metadata: { contentFormat: "markdown" },
          }, token).catch(() => {});
        } else if (!runBody.success) {
          log.error(`Chain: failed to trigger ${targetAgentSlug}: ${runBody.error ?? "unknown"}`);
        }
      } catch (chainErr) {
        log.error("Chain trigger failed (non-fatal):", { error: errMsg(chainErr) });
      }
    }
  } catch (err) {
    // Include enough context to diagnose env-mismatch / token / channel
    // issues from logs alone. Earlier the catch only surfaced `err.message`,
    // which didn't tell us whether the failure was openDm, postMessage,
    // updateMessage, or a token issue — and the relevant identifiers (which
    // workspace, which agent, which mode) were left implicit. Add them.
    log.error("Failed to send result", {
      error: errMsg(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 3).join(" | ") : undefined,
      sessionId,
      agentSlug: ctx?.agentSlug,
      responseMode: ctx?.responseMode,
      channelId: ctx?.channelId,
      conversationId: ctx?.conversationId,
      mentionedUserId: ctx?.mentionedUserId,
      spacesAppId: ctx?.spacesAppId,
      hasToken: Boolean(ctx?.appToken),
      resultLength: resultWithCitations.length,
    });
  }
  } finally {
    if (dedupReleaseConversationId && dedupReleaseAgentSlug) {
      try {
        const redis = redisService.getConnection();
        await redis.del(automationRunDedupKey(dedupReleaseConversationId, dedupReleaseAgentSlug));
      } catch {
        // Best-effort cleanup; the ingress key also has a TTL.
      }
    }
    if (QUEUE_ENABLED && resultConversationId && resultAgentSlug && !goalContinues && !experimentContinues && !skipQueueDrain) {
      await drainNextQueued(resultConversationId, resultAgentSlug, undefined, resultUserScope || undefined).catch(() => {});
    }
  }
});

// ── Plan card render (todo-write → ui-widget progress event) ────────────────
// Post the live todo checklist once, then updateMessage it IN PLACE on every
// subsequent todo-write. Renders are serialized per session so a burst of
// todo-writes can't double-post the card before planMessageId is stored.
const planRenderQueue = new Map<string, Promise<void>>();

async function doRenderPlanCard(
  sessionId: string,
  todos: Todo[],
  conversationId?: string | null,
  agentSlug?: string | null,
): Promise<void> {
  // Resolve via the SAME robust path every other /webhook/progress branch uses
  // (sessionId → recovery → conversationId+agentSlug conv-index), not a bare
  // getSession(sessionId). Plan mode splits work across Turn-1 and Turn-2
  // sessions and seeds planMessageId on the Turn-2 session only after dispatch;
  // the conv-index still carries planMessageId (from Turn 1 or Turn 2), so a
  // first-todo-write that races the seed still updates the SAME card instead of
  // being dropped by a momentary getSession miss.
  const ctx = await resolveSessionContext(sessionId, conversationId ?? null, agentSlug ?? null);
  if (!ctx || ctx.responseMode !== "conversation" || !ctx.channelId || !ctx.appToken) return;

  // Per-agent opt-out (agent.config.postTodos === false): suppress the live
  // plan/todo card in the Spaces thread for agents whose owner turned this off.
  // Absent/true preserves the default (post), so existing agents are unchanged.
  // This is the ONE choke point every plan ui-widget funnels through
  // (the runtime todo-write tool, run.ts onPlan, consume-claw-stream), so a
  // single guard here covers every emitter and every dispatch surface. Read
  // fresh from the agent row (a PK lookup) — mirrors how memoryEnabled is
  // consumed at the point of use, and lets a mid-run config change take effect.
  if (ctx.agentId) {
    const cfgRow = await prisma.agent
      .findUnique({ where: { id: ctx.agentId }, select: { config: true } })
      .catch(() => null);
    if ((cfgRow?.config as { postTodos?: boolean } | null)?.postTodos === false) return;
  }

  // Deterministic per-conversation plan facts, written BEFORE Turn 2 dispatched
  // (so they're present even for the first todo-write): whether the plan was
  // auto-approved (chip), and the whitelist of approved todo titles (reject
  // filter). Absent for auto-mode agents (no approval), so those are untouched.
  const execMeta = await getPlanExecMeta(
    ctx.conversationId ?? conversationId ?? "",
    ctx.agentSlug ?? agentSlug ?? "",
  ).catch(() => null);

  // Reject filter: keep ONLY todos the user approved (matched by normalized
  // title — Turn 2's model regenerates ids). A re-added rejected/hallucinated
  // todo is dropped so it can never render; falls back to unfiltered only if the
  // whitelist matched nothing (titles diverged entirely) to avoid a blank card.
  const renderTodos = execMeta?.approvedTitles?.length
    ? filterToApprovedTitles(todos, execMeta.approvedTitles)
    : todos;
  if (renderTodos.length !== todos.length) {
    clog.info(
      `[plan] reject-filter: ${todos.length} → ${renderTodos.length} todos (dropped non-approved) conv=${ctx.conversationId}`,
    );
  }

  // Snapshot exactly what this card is about to show. Nothing else records the
  // todo list, so this is what reconcileStalePlanTodos reads at run end to find
  // a step the agent left `in_progress` and never closed.
  const snapConversationId = ctx.conversationId ?? conversationId ?? "";
  const snapAgentSlug = ctx.agentSlug ?? agentSlug ?? "";
  if (snapConversationId && snapAgentSlug) {
    await setPlanLastTodos(snapConversationId, snapAgentSlug, renderTodos).catch(() => {});
  }

  // Live todo cards are always in execution (auto mode). Pick the phase so the
  // PlanNode renders the executing/done layout (buildPlanFlow maps the internal
  // Todo status → the component's exec status). Once every todo is
  // completed/failed the card flips to the terminal 'done' layout.
  const allDone =
    renderTodos.length > 0 && renderTodos.every((t) => t.status === "completed" || t.status === "failed");
  const phase = allDone ? "done" : "executing";
  // Auto-approved chip: read from the durable exec meta (deterministic; not the
  // racy Turn-2 session flag) so a trivial plan's card shows "Auto-approved" on
  // every render including the first.
  const flow = buildPlanFlow(renderTodos, {
    // Preserve the approved plan's real title/desc across Turn 2 updates instead
    // of overwriting them with the generic "Plan" (execMeta is set at approve/
    // trivial time). Falls back to "Plan" for auto-mode cards (no plan approval).
    title: execMeta?.title?.trim() || "Plan",
    ...(execMeta?.desc ? { desc: execMeta.desc } : {}),
    // Preserve the detailed markdown plan across every live todo-write render so
    // the expanded view keeps its document as the plan executes.
    ...(execMeta?.document ? { document: execMeta.document } : {}),
    phase,
    ...(execMeta?.autoApproved ? { autoApproved: true } : {}),
    ...(execMeta?.approvedByName ? { approvedBy: execMeta.approvedByName } : {}),
    // Preserve the ONE-TIME approve timestamp across every live update (never
    // re-stamped per render), so the audit footer's "· <time>" stays stable.
    ...(execMeta?.approvedAt ? { approvedAt: execMeta.approvedAt } : {}),
  });
  if (!ctx.planMessageId) {
    // postMessage takes the partial `flow` field; chatController wraps it.
    // Include conversationId so the card lands IN THE THREAD (channelId alone
    // posts to the channel root) — mirrors the result-handler reply targeting.
    const resp = (await spacesAppFetch(
      "/chat/postMessage",
      { channelId: ctx.channelId, conversationId: ctx.conversationId, flow, userId: ctx.spacesAppUserId },
      ctx.appToken,
    )) as { messageId?: string; id?: string; data?: { messageId?: string; id?: string } };
    const messageId = resp?.messageId ?? resp?.id ?? resp?.data?.messageId ?? resp?.data?.id;
    if (messageId) await setSession(sessionId, { ...ctx, planMessageId: messageId });
  } else {
    // updateMessage takes the full `flowJSON` field; needs channelId for
    // validateChannelAccessForPost.
    await spacesAppFetch(
      "/chat/updateMessage",
      { messageId: ctx.planMessageId, flowJSON: flow, userId: ctx.spacesAppUserId, channelId: ctx.channelId },
      ctx.appToken,
    );
  }
}

function renderPlanCard(
  sessionId: string,
  todos: Todo[],
  conversationId?: string | null,
  agentSlug?: string | null,
): Promise<void> {
  const prev = planRenderQueue.get(sessionId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => doRenderPlanCard(sessionId, todos, conversationId, agentSlug));
  planRenderQueue.set(sessionId, next);
  void next.finally(() => {
    if (planRenderQueue.get(sessionId) === next) planRenderQueue.delete(sessionId);
  });
  return next;
}

/**
 * Run-end reconciliation for the live plan card.
 *
 * A todo only leaves `in_progress` when the NEXT todo-write arrives. If the run
 * ends without one — the model forgot to close the last step, or the run died
 * mid-step — the card keeps rendering that row as `running`, so the user watches
 * a spinner that can never resolve on a run that is definitively over.
 *
 * Those rows are reset to `pending`, NOT `completed`. The run ended without ever
 * telling us the step succeeded, so marking it done would be inventing a result,
 * and a false ✓ is the one outcome the user can't tell apart from a real one.
 * `pending` also deliberately keeps the card out of the terminal 'done' phase
 * (which needs every todo completed/failed), so the header stays "Approved"
 * rather than claiming "Completed" over work that never finished.
 *
 * `failed` was the other candidate and is worse: it asserts the step broke,
 * which is equally unverified, and it reads as an error the user should act on.
 * Not-confirmed is the honest state, and `pending` is the only status that says
 * that without also making a claim.
 */
async function reconcileStalePlanTodos(
  sessionId: string,
  conversationId: string | null,
  agentSlug: string | null,
): Promise<void> {
  if (!conversationId || !agentSlug) return;
  // Drain any todo-write render still queued for this session BEFORE reading the
  // snapshot. Reading first would capture the previous render's list and then
  // re-render it on top of the newer one, reverting a status the agent did
  // legitimately write in its final tick.
  await (planRenderQueue.get(sessionId) ?? Promise.resolve()).catch(() => {});
  const last = await getPlanLastTodos(conversationId, agentSlug).catch(() => null);
  if (!last?.length) return;
  const stalled = last.filter((t) => t.status === "in_progress").length;
  if (stalled === 0) {
    // Card already settled itself — drop the snapshot so it can't be re-applied
    // to a later run in this thread.
    await clearPlanLastTodos(conversationId, agentSlug).catch(() => {});
    return;
  }
  const reconciled: Todo[] = last.map((t) =>
    t.status === "in_progress" ? { ...t, status: "pending" as const } : t,
  );
  clog.info(
    `[plan] run ended with ${stalled} step(s) still in_progress — resetting to pending conv=${conversationId} agent=${agentSlug}`,
  );
  // Goes through the SAME serialized queue as every todo-write render, so it
  // lands after any render still in flight instead of racing it.
  await renderPlanCard(sessionId, reconciled, conversationId, agentSlug);
  await clearPlanLastTodos(conversationId, agentSlug).catch(() => {});
}

// ── PR card render (create/merge PR subagent tool → kind:"pr" progress) ─────
// A github/bitbucket/gitlab subagent's create_pull_request / merge_pull_request
// tool fires a kind:"pr" progress event carrying a canonical, provider-neutral
// PR fact. We post ONE card per PR (keyed by a deterministic screenId) the first
// time, then updateMessage the SAME card in place as its status advances. Only
// conversation mode (a Spaces thread) has a surface — DM/approval runs are
// skipped. Renders are serialized per session so two PR events can't race the
// message-id write. Best-effort; never blocks the /progress ack.
interface PrProgressInput {
  provider: PrProvider;
  status: PrStatus;
  title: string;
  url?: string;
  desc?: string;
  ticketId?: string;
  number?: string | number;
  repo?: string;
}

const PR_PROVIDERS = new Set<PrProvider>(["github", "bitbucket", "gitlab", "other"]);
const PR_STATUSES = new Set<PrStatus>(["created", "merged", "reverted", "deleted", "declined"]);

/** Validate + coerce the untrusted wire `pr` payload into a typed fact, or null. */
function coercePrInput(raw: unknown): PrProgressInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const { provider, status, title } = o as { provider?: unknown; status?: unknown; title?: unknown };
  if (typeof provider !== "string" || !PR_PROVIDERS.has(provider as PrProvider)) return null;
  if (typeof status !== "string" || !PR_STATUSES.has(status as PrStatus)) return null;
  if (typeof title !== "string" || !title.trim()) return null;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const out: PrProgressInput = {
    provider: provider as PrProvider,
    status: status as PrStatus,
    title: title.trim(),
  };
  const url = str(o["url"]);
  if (url) out.url = url;
  const desc = str(o["desc"]);
  if (desc) out.desc = desc;
  const ticketId = str(o["ticketId"]);
  if (ticketId) out.ticketId = ticketId;
  const repo = str(o["repo"]);
  if (repo) out.repo = repo;
  const number = o["number"];
  if (typeof number === "string" && number.trim()) out.number = number.trim();
  else if (typeof number === "number" && Number.isFinite(number)) out.number = number;
  return out;
}

const prRenderQueue = new Map<string, Promise<void>>();

async function doRenderPrCard(
  sessionId: string,
  pr: PrProgressInput,
  conversationId?: string | null,
  agentSlug?: string | null,
): Promise<void> {
  // Same robust resolution every /webhook/progress branch uses (sessionId →
  // recovery → conv-index), so a refired run that minted a fresh sessionId still
  // lands the card in the right thread.
  const ctx = await resolveSessionContext(sessionId, conversationId ?? null, agentSlug ?? null);
  if (!ctx || ctx.responseMode !== "conversation" || !ctx.channelId || !ctx.appToken) {
    clog.warn(
      `[pr-card] skipping render for ${sessionId}: ctx=${ctx ? "yes" : "MISSING"} ` +
        `responseMode=${ctx?.responseMode ?? "?"} channelId=${ctx?.channelId ? "yes" : "MISSING"} ` +
        `appToken=${ctx?.appToken ? "yes" : "MISSING"} (conv=${conversationId ?? "?"} agent=${agentSlug ?? "?"})`,
    );
    return;
  }

  // Deterministic screenId keyed on PR identity — same PR ⇒ same card across
  // status transitions (created → merged / …). Must match buildPrFlow's own
  // derivation, so pass it explicitly to both the id map and the builder.
  const identity: { provider: PrProvider; repo?: string; number?: string | number; url?: string } = {
    provider: pr.provider,
  };
  if (pr.repo) identity.repo = pr.repo;
  if (pr.number !== undefined) identity.number = pr.number;
  if (pr.url) identity.url = pr.url;
  const screenId = prScreenId(identity);

  const flow = buildPrFlow(
    {
      provider: pr.provider,
      status: pr.status,
      title: pr.title,
      ...(pr.url ? { url: pr.url } : {}),
      ...(pr.desc ? { desc: pr.desc } : {}),
      ...(pr.ticketId ? { ticketId: pr.ticketId } : {}),
    },
    {
      screenId,
      data: {
        agentSlug: ctx.agentSlug,
        conversationId: ctx.conversationId,
        channelId: ctx.channelId,
      },
    },
  );

  const existing = ctx.prMessageIds?.[screenId];
  let renderedMessageId: string | undefined = existing;
  if (!existing) {
    clog.info(
      `[pr-card] posting NEW card screenId=${screenId} provider=${pr.provider} status=${pr.status} conv=${ctx.conversationId}`,
    );
    // postMessage takes the partial `flow` field; chatController wraps it.
    // conversationId lands the card IN THE THREAD (channelId alone hits root).
    const resp = (await spacesAppFetch(
      "/chat/postMessage",
      { channelId: ctx.channelId, conversationId: ctx.conversationId, flow, userId: ctx.spacesAppUserId },
      ctx.appToken,
    )) as { messageId?: string; id?: string; data?: { messageId?: string; id?: string } };
    const messageId = resp?.messageId ?? resp?.id ?? resp?.data?.messageId ?? resp?.data?.id;
    if (messageId) {
      renderedMessageId = messageId;
      clog.info(`[pr-card] posted card screenId=${screenId} messageId=${messageId}`);
      // Merge into the FRESHEST session so we don't clobber a concurrently-set
      // planMessageId or another PR's id.
      const fresh = (await getSession(sessionId).catch(() => null)) ?? ctx;
      await setSession(sessionId, {
        ...fresh,
        prMessageIds: { ...(fresh.prMessageIds ?? {}), [screenId]: messageId },
      }).catch(() => {});
    } else {
      clog.warn(`[pr-card] postMessage returned no messageId for screenId=${screenId} — resp=${JSON.stringify(resp)?.slice(0, 200)}`);
    }
  } else {
    clog.info(`[pr-card] updating card in place screenId=${screenId} messageId=${existing} → status=${pr.status}`);
    // updateMessage takes the full `flowJSON` field; needs channelId for
    // validateChannelAccessForPost.
    await spacesAppFetch(
      "/chat/updateMessage",
      { messageId: existing, flowJSON: flow, userId: ctx.spacesAppUserId, channelId: ctx.channelId },
      ctx.appToken,
    );
  }

  // ── Durable binding (COMPLEMENTS the Redis fast path above) ───────────────
  // Persist where this PR card lives + the agent that posted it, keyed by the
  // deterministic screenId and (for webhook lookup) the normalized PR URL. An
  // inbound Bitbucket webhook that fires after this session's SessionContext is
  // gone reads this to post a fresh status card. Best-effort — a binding failure
  // must never break the render, and a missing URL just means the webhook can't
  // find it (we log so that's visible). We store the card-rebuild fields in
  // `data` so the webhook renders an identical card with the new status.
  try {
    // Empty-after-normalize (e.g. a protocol-only URL) MUST be stored as null,
    // never "" — a webhook lookup by a real URL could never match "", and an ""
    // key could spuriously collide across PRs.
    const normalizedUrl = pr.url ? normalizePrUrl(pr.url) : "";
    const externalKey = normalizedUrl || null;
    if (!externalKey) {
      clog.warn(
        `[pr-card] binding has no usable PR url (screenId=${screenId}) — webhook status updates won't find this card`,
      );
    }
    const bindingData: Record<string, unknown> = { provider: pr.provider, title: pr.title };
    if (pr.url) bindingData["url"] = pr.url;
    if (pr.ticketId) bindingData["ticketId"] = pr.ticketId;
    if (pr.desc) bindingData["desc"] = pr.desc;
    if (pr.repo) bindingData["repo"] = pr.repo;
    if (pr.number !== undefined) bindingData["number"] = pr.number;
    await upsertWidgetBinding({
      orgId: ctx.agentOrgId ?? "",
      kind: "pr",
      screenId,
      externalKey,
      conversationId: ctx.conversationId,
      channelId: ctx.channelId,
      messageId: renderedMessageId ?? null,
      spacesAppId: ctx.spacesAppId,
      spacesAppUserId: ctx.spacesAppUserId,
      agentSlug: ctx.agentSlug ?? null,
      status: pr.status,
      data: bindingData,
    });
  } catch (e) {
    clog.warn(
      `[pr-card] upsertWidgetBinding failed for screenId=${screenId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

function renderPrCard(
  sessionId: string,
  pr: PrProgressInput,
  conversationId?: string | null,
  agentSlug?: string | null,
): Promise<void> {
  const prev = prRenderQueue.get(sessionId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => doRenderPrCard(sessionId, pr, conversationId, agentSlug));
  prRenderQueue.set(sessionId, next);
  void next.finally(() => {
    if (prRenderQueue.get(sessionId) === next) prRenderQueue.delete(sessionId);
  });
  return next;
}

// ── POST /webhook/pr-event — inbound git-host PR status change (S2S) ────────
//
// The MAIN backend receives + HMAC-verifies the Bitbucket webhook and runs its
// ticket-status sync, then forwards a normalized PR fact HERE (fire-and-forget,
// x-s2s-key). We look up the durable AgentWidgetBinding for this PR by its
// normalized URL and — only if an agent originally posted a card for it — post a
// FRESH status card into the SAME thread as that agent's bot. No binding ⇒ this
// PR wasn't created by an agent in a Spaces thread ⇒ 200 no-op (mirrors the
// backend's "not created by Xyne → ignore"). Dedupe on the last-rendered status
// so provider re-delivery (or an in-session merge already rendered live) never
// double-posts. Serialized per PR URL. Best-effort; the ack is immediate.
interface PrEventInput {
  provider: PrProvider;
  status: PrStatus;
  prUrl: string;
  number?: string | number;
  repo?: string;
}

function coercePrEventInput(raw: unknown): PrEventInput | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const provider = o["provider"];
  const status = o["status"];
  const prUrl = o["prUrl"] ?? o["url"];
  if (typeof provider !== "string" || !PR_PROVIDERS.has(provider as PrProvider)) return null;
  if (typeof status !== "string" || !PR_STATUSES.has(status as PrStatus)) return null;
  if (typeof prUrl !== "string" || !prUrl.trim()) return null;
  const out: PrEventInput = {
    provider: provider as PrProvider,
    status: status as PrStatus,
    prUrl: prUrl.trim(),
  };
  const repo = o["repo"];
  if (typeof repo === "string" && repo.trim()) out.repo = repo.trim();
  const number = o["number"];
  if (typeof number === "string" && number.trim()) out.number = number.trim();
  else if (typeof number === "number" && Number.isFinite(number)) out.number = number;
  return out;
}

async function postWebhookPrStatusCard(ev: PrEventInput): Promise<{ posted: boolean; reason?: string }> {
  const binding = await findPrBindingByUrl(ev.prUrl);
  if (!binding) return { posted: false, reason: "no-binding" };
  if (binding.status === ev.status) return { posted: false, reason: "dedup-same-status" };

  const cardData = readPrBindingData(binding);
  if (!cardData) return { posted: false, reason: "binding-missing-card-data" };

  const agentRow = await agentRepository.findBySpacesAppId(binding.spacesAppId);
  if (!agentRow?.spacesAppToken) return { posted: false, reason: "agent-unresolved" };
  // Defense-in-depth org isolation: the agent resolved from the binding's OWN
  // spacesAppId must belong to the binding's org. They agree by construction
  // (both captured from one SessionContext at card-creation), so a mismatch
  // means corrupted/tampered state — never post another org's bot into this
  // thread. Only enforced when both orgs are known (a binding written when
  // ctx.agentOrgId was absent stores ""), so a legit empty-org binding still
  // renders.
  if (binding.orgId && agentRow.orgId && binding.orgId !== agentRow.orgId) {
    clog.warn(
      `[webhook/pr-event] org mismatch binding.org=${binding.orgId} agent.org=${agentRow.orgId} (spacesAppId=${binding.spacesAppId}) — skipping`,
    );
    return { posted: false, reason: "org-mismatch" };
  }
  const appToken = decryptStoredField(agentRow.spacesAppToken);
  const userId = binding.spacesAppUserId || agentRow.spacesAppUserId || "";
  if (!userId) return { posted: false, reason: "no-bot-user" };

  // A distinct screenId per status so each webhook status card is its OWN
  // artifact in the thread (a NEW card per status change), never reconciling
  // onto the agent's original created card.
  const screenId = `${binding.screenId}-${ev.status}`;
  const flow = buildPrFlow(
    {
      provider: cardData.provider as PrProvider,
      status: ev.status,
      title: cardData.title,
      ...(cardData.url ? { url: cardData.url } : {}),
      ...(cardData.desc ? { desc: cardData.desc } : {}),
      ...(cardData.ticketId ? { ticketId: cardData.ticketId } : {}),
    },
    {
      screenId,
      data: {
        ...(binding.agentSlug ? { agentSlug: binding.agentSlug } : {}),
        conversationId: binding.conversationId,
        channelId: binding.channelId,
        source: "webhook",
      },
    },
  );

  clog.info(
    `[webhook/pr-event] posting status card screenId=${screenId} status=${ev.status} conv=${binding.conversationId}`,
  );
  const resp = (await spacesAppFetch(
    "/chat/postMessage",
    { channelId: binding.channelId, conversationId: binding.conversationId, flow, userId },
    appToken,
  )) as { messageId?: string; id?: string; data?: { messageId?: string; id?: string } };
  const messageId = resp?.messageId ?? resp?.id ?? resp?.data?.messageId ?? resp?.data?.id;

  // Record the new status so a re-delivered webhook is a no-op. Best-effort: if
  // this write fails a re-delivery could post a duplicate card (acceptable — far
  // better than losing the card by marking status BEFORE the post succeeds), so
  // log rather than swallow, to surface a persistent failure.
  await setWidgetBindingStatus(binding.id, ev.status, messageId).catch((e) =>
    clog.warn(
      `[webhook/pr-event] setWidgetBindingStatus failed (binding=${binding.id} status=${ev.status}):`,
      e instanceof Error ? e.message : e,
    ),
  );
  return { posted: true };
}

const prEventQueue = new Map<string, Promise<unknown>>();

router.post("/pr-event", requireStrictS2S, async (req: Request, res: Response) => {
  // Ack immediately — never block the caller (the backend webhook handler).
  res.json({ success: true });

  const ev = coercePrEventInput(req.body);
  if (!ev) {
    clog.warn(`[webhook/pr-event] rejected payload: ${JSON.stringify(req.body)?.slice(0, 300)}`);
    return;
  }

  // Serialize per PR URL so two rapid events for the same PR can't race the
  // status write (and thus the dedup check).
  const key = normalizePrUrl(ev.prUrl);
  const prev = prEventQueue.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    try {
      const r = await postWebhookPrStatusCard(ev);
      clog.info(
        `[webhook/pr-event] provider=${ev.provider} status=${ev.status} url=${key} → ${r.posted ? "POSTED" : `skipped:${r.reason}`}`,
      );
    } catch (e) {
      clog.warn(`[webhook/pr-event] failed url=${key}:`, e instanceof Error ? e.message : e);
    }
  });
  prEventQueue.set(key, next);
  void next.finally(() => {
    if (prEventQueue.get(key) === next) prEventQueue.delete(key);
  });
});

// ── Unified tool-authored UI widgets ───────────────────────────────────────
//
// The claw runtime transports typed domain payloads only. This is the single
// choke point that resolves Spaces routing, signs interactive actions, builds
// Flow JSON, and chooses create vs update behavior. A future widget adds one
// shared union variant and one branch here; HTTP/SSE plumbing stays unchanged.
const UI_WIDGET_DELIVERY_TTL_SECONDS = 24 * 60 * 60;
const UI_WIDGET_CLAIM_TTL_SECONDS = 30;

function uiWidgetDeliveryKey(sessionId: string, widgetId: string): string {
  return `ui-widget-delivery:${sessionId}:${widgetId}`;
}

async function acquireCreateWidget(sessionId: string, widgetId: string): Promise<string | null> {
  const redis = redisService.getConnection();
  const key = uiWidgetDeliveryKey(sessionId, widgetId);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const token = crypto.randomUUID();
    const acquired = await redis.set(key, `posting:${token}`, "EX", UI_WIDGET_CLAIM_TTL_SECONDS, "NX");
    if (acquired === "OK") return token;
    const state = await redis.get(key);
    if (state === "delivered") return null;
    // A final-callback fallback can race the live event. Wait for the first
    // renderer to commit instead of posting a duplicate card.
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for widget delivery claim (${widgetId})`);
}

async function finishCreateWidget(sessionId: string, widgetId: string, token: string, delivered: boolean): Promise<void> {
  const redis = redisService.getConnection();
  const key = uiWidgetDeliveryKey(sessionId, widgetId);
  const current = await redis.get(key);
  if (current !== `posting:${token}`) return;
  if (delivered) {
    await redis.set(key, "delivered", "EX", UI_WIDGET_DELIVERY_TTL_SECONDS);
  } else {
    await redis.del(key);
  }
}

async function renderUiWidget(
  sessionId: string,
  widget: UiWidget,
  conversationId?: string | null,
  agentSlug?: string | null,
  knownContext?: SessionContext,
): Promise<boolean> {
  if (widget.type === "plan") {
    await renderPlanCard(sessionId, widget.payload.todos, conversationId, agentSlug);
    return true;
  }

  const claim = await acquireCreateWidget(sessionId, widget.id);
  if (!claim) return false;
  let delivered = false;
  try {
    const ctx = knownContext ?? await resolveSessionContext(sessionId, conversationId ?? null, agentSlug ?? null);
    if (!ctx || !ctx.channelId || !ctx.appToken) return false;
    // Static/live artifacts historically render only for conversation replies;
    // clarification questions also support approval-mode agent runs.
    if (widget.type !== "question" && ctx.responseMode !== "conversation") return false;
    const log = createLogger("webhook/ui-widget", ctx.traceId ?? sessionId.slice(0, 8));
    let flow;

    switch (widget.type) {
      case "question": {
        const { questionId, questions } = widget.payload;
        if (!questionId || questions.length === 0) return false;
        const { signAction } = await import("./mcp.js");
        flow = withSpacesAppId(buildUserQuestionFlow(questions, {
          questionId,
          agentSlug: ctx.agentSlug ?? "",
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          userId: ctx.senderId,
        }), ctx.spacesAppId);
        flow.data = {
          ...(flow.data ?? {}),
          signature: signAction({
            actionType: "user-answer",
            questionId,
            userId: ctx.senderId,
            agentSlug: ctx.agentSlug ?? "",
            spacesAppId: ctx.spacesAppId ?? "",
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
          }),
        };
        break;
      }
      case "code":
        if (!widget.payload.code.trim()) return false;
        flow = withSpacesAppId(buildCodeFlow(widget.payload.code, widget.payload.language), ctx.spacesAppId);
        break;
      case "diff":
        if (!widget.payload.path.trim() || !widget.payload.patch.trim()) return false;
        flow = withSpacesAppId(buildDiffFlow(widget.payload.path.trim(), widget.payload.patch), ctx.spacesAppId);
        break;
      case "chart":
        flow = withSpacesAppId(buildChartFlow(widget.payload), ctx.spacesAppId);
        break;
    }

    await spacesAppFetch("/chat/postMessage", {
      channelId: ctx.channelId,
      conversationId: ctx.conversationId,
      flow,
      userId: ctx.spacesAppUserId,
    }, ctx.appToken);
    delivered = true;
    log.info(`Posted ${widget.type} UI widget ${widget.id} in thread ${ctx.conversationId}`);
    return true;
  } finally {
    await finishCreateWidget(sessionId, widget.id, claim, delivered).catch(() => {});
  }
}

// ── POST /webhook/progress — live tool-call update from xyne-claw ───────────
//
// xyne-claw POSTs here on every tool_execution_start (throttled to 10s).
// We look up the session, then call updateMessage on the progress placeholder.

router.post("/progress", requireStrictS2S, async (req: Request, res: Response) => {
  const { sessionId, toolLabel, toolInvocation, sandboxPreviewUrl, sandboxCodePreviewUrl, sandboxId, conversationId, agentSlug } = req.body as {
    sessionId?: string;
    toolLabel?: string;
    toolInvocation?: unknown;
    sandboxPreviewUrl?: string;
    sandboxCodePreviewUrl?: string;
    sandboxId?: string;
    // Conversation identity claw ships on progress callbacks that need ctx
    // (sandbox-preview announce, label updates), mirroring /result. Lets the
    // conv-keyed fallback fire when a refired run minted a fresh sessionId.
    conversationId?: string | null;
    agentSlug?: string | null;
  };

  // Acknowledge immediately — we never block xyne-claw
  res.json({ success: true });

  // Keep the mid-run message-queue slot alive: a progress callback proves this
  // conversation's run is still active, so refresh the busy TTL. This is what
  // prevents a long run from TTL-expiring its slot and letting a second message
  // acquire concurrently (and a late finalizer from releasing the wrong slot).
  if (QUEUE_ENABLED && conversationId && agentSlug) {
    // A twin's busy marker is PER-USER, so a plain refreshSlot(conv, agent) would
    // PEXPIRE the wrong (unscoped) key and let the real per-user marker TTL-expire
    // → a queued same-owner tag could then SET NX its way in as a second
    // concurrent run (the exact slot-theft this closes). Resolve the owner from
    // the session; if that lookup fails, SKIP the refresh entirely rather than
    // touch the unscoped key (a missed refresh only shortens the TTL — safe; a
    // wrong-key refresh reintroduces the concurrency bug).
    if (agentSlug === "digital-twin") {
      const ctx = sessionId ? await getSession(sessionId).catch(() => null) : null;
      if (ctx?.mentionedUserId) {
        await refreshSlot(conversationId, agentSlug, undefined, ctx.mentionedUserId).catch(() => {});
        if (sessionId) await attachSlotSession(conversationId, agentSlug, sessionId, ctx.mentionedUserId).catch(() => {});
      }
    } else {
      await refreshSlot(conversationId, agentSlug).catch(() => {});
      if (sessionId) await attachSlotSession(conversationId, agentSlug, sessionId).catch(() => {});
    }
  }

  if (!sessionId) return;

  const body = req.body as Record<string, unknown>;
  let widget: UiWidget | null = isUiWidget(body["widget"]) ? body["widget"] : null;

  // Rolling-deploy compatibility: accept the widget-specific progress shapes
  // emitted by older claw pods and normalize them into the unified contract.
  // New widget types never add another transport branch here.
  if (!widget && body["kind"] === "plan" && Array.isArray(body["todos"])) {
    widget = { id: "plan", type: "plan", operation: "upsert", payload: { todos: body["todos"] as Todo[] } };
  } else if (!widget && body["kind"] === "code" && typeof body["code"] === "string") {
    widget = {
      id: `legacy-code:${crypto.randomUUID()}`,
      type: "code",
      operation: "create",
      payload: { code: body["code"], ...(typeof body["language"] === "string" ? { language: body["language"] } : {}) },
    };
  } else if (!widget && body["kind"] === "diff" && typeof body["path"] === "string" && typeof body["patch"] === "string") {
    widget = {
      id: `legacy-diff:${crypto.randomUUID()}`,
      type: "diff",
      operation: "create",
      payload: { path: body["path"], patch: body["patch"] },
    };
  } else if (!widget && body["kind"] === "chart") {
    const caption = typeof body["caption"] === "string" && body["caption"].trim() ? body["caption"].trim() : undefined;
    if ((body["type"] === "line" || body["type"] === "area") && Array.isArray(body["series"])) {
      const series = body["series"].map((row) => row as { x: string; y: number; series?: string });
      widget = {
        id: `legacy-chart:${crypto.randomUUID()}`,
        type: "chart",
        operation: "create",
        payload: { type: body["type"], series, ...(caption ? { caption } : {}) },
      };
    } else if ((body["type"] === "bar" || body["type"] === "pie" || body["type"] === "donut") && Array.isArray(body["points"])) {
      const points = body["points"].map((point) => point as { label: string; value: number });
      widget = {
        id: `legacy-chart:${crypto.randomUUID()}`,
        type: "chart",
        operation: "create",
        payload: { type: body["type"], points, ...(caption ? { caption } : {}) },
      };
    }
  }

  if (widget && !isUiWidget(widget)) widget = null;
  if (widget) {
    void touchRunRecovery(sessionId).catch(() => {});
    void renderUiWidget(sessionId, widget, conversationId, agentSlug).catch((err) =>
      clog.warn(`[webhook/progress] ${widget?.type ?? "unknown"} widget failed for ${sessionId}:`, err instanceof Error ? err.message : err),
    );
    return;
  }

  // PR card: a create/merge pull-request subagent tool fires kind:"pr" with a
  // canonical, provider-neutral PR fact. Post (first time) or update-in-place the
  // PR card in the thread. Serialized per session; best-effort — never blocks.
  if ((req.body as { kind?: string }).kind === "pr") {
    void touchRunRecovery(sessionId).catch(() => {});
    const rawPr = (req.body as { pr?: unknown }).pr;
    const pr = coercePrInput(rawPr);
    if (pr) {
      clog.info(
        `[webhook/progress] kind:pr received sessionId=${sessionId} provider=${pr.provider} status=${pr.status} number=${pr.number ?? "?"} repo=${pr.repo ?? "?"}`,
      );
      renderPrCard(sessionId, pr, conversationId, agentSlug).catch((e) =>
        clog.warn(`[webhook/progress] renderPrCard failed for ${sessionId}:`, e instanceof Error ? e.message : e),
      );
    } else {
      clog.warn(
        `[webhook/progress] kind:pr REJECTED by coercePrInput sessionId=${sessionId} raw=${JSON.stringify(rawPr)?.slice(0, 300)}`,
      );
    }
    return;
  }

  await touchRunRecovery(sessionId).catch((err) => {
    clog.warn(`[webhook/progress] touchRunRecovery failed for ${sessionId}:`, err instanceof Error ? err.message : err);
  });

  // Incremental tool streaming — fires on every tool_execution_end
  if (toolInvocation) {
    agentRunRepository.appendToolInvocation(sessionId, toolInvocation).catch((e) => {
      clog.warn(`[webhook/progress] appendToolInvocation failed for ${sessionId}:`, e instanceof Error ? e.message : e);
    });
    // Live tap: fan this tool call out to v3 viewers (the durable copy is the
    // appendToolInvocation above). Resolve ctx — getSession is a Redis read —
    // only when the feature is on. Best-effort; never blocks the ack.
    if (CONFIG.liveToolCallsEnabled) {
      resolveSessionContext(sessionId, conversationId, agentSlug)
        .then((ctx) => {
          if (ctx && ctx.responseMode === "conversation" && ctx.conversationId) {
            publishLiveEvent(ctx.conversationId, {
              type: "invocation",
              conversationId: ctx.conversationId,
              agentSlug: ctx.agentSlug,
              userId: ctx.senderId,
              toolInvocation,
              ...(ctx.triggerSource ? { triggerSource: ctx.triggerSource } : {}),
              ts: Date.now(),
            });
          }
        })
        .catch(() => {});
    }
    return;
  }

  // One-shot sandbox preview announce — claw fires this the first time a kata
  // session is acquired, so the user gets a clickable noVNC link in the channel
  // while the agent is still working. claw-side guards against re-emit, but we
  // also check the in-memory Set here in case run-recovery re-delivers.
  if (sandboxPreviewUrl && sandboxId) {
    if (announcedSandboxPreviews.has(sessionId)) return;
    rememberAnnouncedPreview(sessionId);
    const ctx = await resolveSessionContext(sessionId, conversationId, agentSlug).catch(() => null);
    if (!ctx || ctx.responseMode !== "conversation") return;
    const log = createLogger("webhook/progress", ctx.traceId ?? sessionId.slice(0, 8));
    try {
      await spacesAppFetch("/chat/postMessage", {
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        markdownText: `🖥️ **Live preview** — agent is working in this room. Anyone in this channel can watch (and drive) chromium over noVNC.\n\n👉 ${sandboxPreviewUrl}${sandboxCodePreviewUrl ? `\n\nCode Changes available at ${sandboxCodePreviewUrl}/` : ""}`,
        userId: ctx.spacesAppUserId,
        metadata: { contentFormat: "markdown" },
      }, ctx.appToken);
      log.info(`Sandbox preview announced: ${sandboxPreviewUrl} (sandboxId=${sandboxId})`);
    } catch (err) {
      log.warn("Failed to announce sandbox preview", { error: errMsg(err) });
    }
    return;
  }

  if (!toolLabel) return;

  // Record progress for the Agent Control Center (fire-and-forget)
  agentRunRepository.updateProgress(sessionId, toolLabel).catch(() => {});

  const ctx = await resolveSessionContext(sessionId, conversationId, agentSlug).catch(() => null);
  if (!ctx) return;
  // Only publish progress for conversation mode (DM / app-mention) — approval mode has no live surface.
  if (ctx.responseMode !== "conversation") return;

  // Live tap: fan the progress label out to v3 viewers (drives the spinner chip).
  if (CONFIG.liveToolCallsEnabled && ctx.conversationId) {
    publishLiveEvent(ctx.conversationId, {
      type: "label",
      conversationId: ctx.conversationId,
      agentSlug: ctx.agentSlug,
      userId: ctx.senderId,
      toolLabel,
      ts: Date.now(),
    });
  }

  const log = createLogger("webhook/progress", ctx.traceId ?? sessionId.slice(0, 8));

  // Spaces-side progress needs a real Spaces surface. Two cases produce
  // thousands of guaranteed-4xx calls a day (prod 2026-08-11):
  //  - digital-twin: the shared twin app user isn't a participant of most
  //    channels its runs fire in → 403 "does not have access" per tool step.
  //    Twin activity has its own draft/DM surface; it never needs the spinner.
  //  - claw-only conversations (agent-chat/v3): ctx.conversationId is a
  //    claw-auth UUID with no Spaces row → 404 "Conversation not found".
  //    Spaces-origin runs always carry the channelId from the webhook payload,
  //    so a missing channelId marks a conversation Spaces can't resolve.
  // The v3 live tap above already delivered the label to claw's own UI.
  const spacesProgressDeliverable = ctx.agentSlug !== "digital-twin" && Boolean(ctx.channelId);
  if (!spacesProgressDeliverable) return;

  try {
    if (USE_EPHEMERAL_PROGRESS) {
      await spacesAppFetch("/chat/agentProgress", {
        conversationId: ctx.conversationId,
        channelId: ctx.channelId,
        agentSlug: ctx.agentSlug,
        userId: ctx.spacesAppUserId,
        toolLabel,
        status: "working",
      }, ctx.appToken);
      log.info(`Progress (ephemeral): ${toolLabel} → conv=${ctx.conversationId}`);
    } else if (ctx.progressMessageId) {
      await spacesAppFetch("/chat/updateMessage", {
        messageId: ctx.progressMessageId,
        markdownText: `⏳ ${toolLabel}`,
        userId: ctx.spacesAppUserId,
      }, ctx.appToken);
      log.info(`Progress (placeholder): ${toolLabel} → messageId=${ctx.progressMessageId}`);
    }
    // else: placeholder mode with no placeholderId (initial post failed) — silently skip
  } catch (err) {
    log.warn("Failed to publish agent progress signal", { error: errMsg(err) });
  }
});

// Register the agent-specific webhook route (AFTER /result to avoid param catch).
// `verifySpacesSignature` HMAC-checks the body using the agent's per-app
// signing secret stored in agents.signingSecret and always fails closed.
//
// The bare-path `/webhook` (no agent slug) used to fall through to a
// default-agent dispatch — verified dead in 7d of prod logs (0 hits across
// all 46 active agents) and no code anywhere builds that URL, so the route
// is deleted to remove the only path that bypassed signature verification.
//
// NOTE: Spaces' FlowController also POSTs to the webhookUrl (which points here)
// when a user clicks a Flow UI button. It identifies itself via the header
// `X-Xyne-Event: flow_action`. We detect that header and proxy the request
// to the dedicated flow-action handler rather than running the USER_MENTIONED
// event path. This avoids any DB changes to installed_apps.webhookUrl while
// keeping the two concerns properly separated.
async function proxyFlowAction(req: Request, res: Response, headers: Record<string, string>): Promise<void> {
  let proxyRes: Response | undefined;
  try {
    const sigHeader = req.headers["x-xyne-signature"];
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    proxyRes = (await fetch(`${CONFIG.internalUrl}/claw/api/v1/flow/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        ...(typeof sigHeader === "string" ? { "x-xyne-signature": sigHeader } : {}),
        ...headers,
      },
      body: rawBody ?? JSON.stringify(req.body),
    })) as unknown as Response;
  } catch (err) {
    clog.error(`[webhook/flow-action-proxy] fetch failed: ${errMsg(err)}`);
    res.status(502).json({ type: "error", message: "flow-action proxy failed" });
    return;
  }
  const text = await (proxyRes as unknown as { text: () => Promise<string> }).text();
  res.status((proxyRes as unknown as { status: number }).status).type("application/json").send(text);
}

router.post("/app/:spacesAppId", async (req: Request, res: Response): Promise<void> => {
  const spacesAppId = req.params["spacesAppId"];
  if (typeof spacesAppId !== "string" || !spacesAppId) {
    res.status(400).json({ success: false, error: "spacesAppId is required" });
    return;
  }

  const isAutomationRequest = s2sKeyMatches(req.headers["x-s2s-key"]);

  // TEMPORARY (2026-08-10): s2s-authenticated callers that don't sign yet
  // (SDLC surface's ClawAgentService) are let through with a loud warning
  // instead of a 401. Scope is deliberately narrow: the s2s key must match
  // AND the signature header must be entirely absent — a present-but-invalid
  // signature still rejects, and non-s2s callers are unchanged. Remove once
  // every s2s caller signs (the SDLC team is adding X-Xyne-Signature).
  const unsignedS2S = isAutomationRequest && !req.headers["x-xyne-signature"];
  if (unsignedS2S) {
    clog.warn(`[webhook/app] UNSIGNED s2s request allowed spacesAppId=${spacesAppId} — caller must add X-Xyne-Signature; this bypass is temporary`);
  } else {
    let verified = false;
    await verifySpacesSignature(req, res, () => {
      verified = true;
    });
    if (!verified || res.headersSent) return;
  }

  if (isAutomationRequest) {
    const agent = await agentRepository.findBySpacesAppId(spacesAppId);
    if (!agent) {
      clog.warn(`[webhook/app-automation] agent app miss spacesAppId=${spacesAppId} orgId=none`);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    await handleAutomationWebhook(req, res, agent.slug, agent.orgId);
    return;
  }

  if (req.headers["x-xyne-event"] === "flow_action") {
    await proxyFlowAction(req, res, { "x-spaces-app-id": spacesAppId });
    return;
  }

  return handleWebhook(req, res);
});

router.post("/:agentSlug", async (req: Request, res: Response): Promise<void> => {
  const agentSlug = req.params["agentSlug"];
  if (typeof agentSlug !== "string" || !agentSlug) {
    res.status(400).json({ success: false, error: "agentSlug is required" });
    return;
  }
  clog.warn(`[webhook] legacy slug webhook route hit agentSlug=${agentSlug}`);

  const isAutomationRequest = s2sKeyMatches(req.headers["x-s2s-key"]);

  // TEMPORARY (2026-08-10): same unsigned-s2s bypass as /app/:spacesAppId —
  // warn and allow ONLY when the s2s key matches and the signature header is
  // entirely absent. Remove once every s2s caller signs.
  const unsignedS2S = isAutomationRequest && !req.headers["x-xyne-signature"];
  if (unsignedS2S) {
    clog.warn(`[webhook] UNSIGNED s2s request allowed agentSlug=${agentSlug} — caller must add X-Xyne-Signature; this bypass is temporary`);
  } else {
    let verified = false;
    await verifySpacesSignature(req, res, () => {
      verified = true;
    });
    if (!verified || res.headersSent) return;
  }

  if (isAutomationRequest) {
    await handleAutomationWebhook(req, res, agentSlug);
    return;
  }

  if (req.headers["x-xyne-event"] === "flow_action") {
    // Proxy to the flow-action handler (same process, different route). Forward
    // the original raw bytes plus the Spaces signature and route identity so
    // /flow/action can re-verify the HMAC itself.
    await proxyFlowAction(req, res, { "x-agent-slug": agentSlug });
    return;
  }
  return handleWebhook(req, res);
});

export { router as webhookRouter };
