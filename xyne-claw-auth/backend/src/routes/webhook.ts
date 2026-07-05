/**
 * Webhook handler for Xyne Spaces app events.
 *
 * POST /webhook       — receives USER_MENTIONED events, starts xyne-claw for the mentioned user
 * POST /webhook/result — callback from xyne-claw, sends result to mentioned user's DM with approve/decline
 */

import { Router, type Request, type Response } from "express";
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
} from "../repositories/index.js";
import { extractCodexBearer } from "../lib/codex-creds.js";
import { extractClaudeBearer } from "../lib/claude-creds.js";
import { getValidClaudeBearer } from "../lib/claude-oauth-refresh.js";
import { getValidCodexBearer } from "../lib/codex-oauth-refresh.js";
import { resolveAgentProviderConfigs, resolveSubagentProviderMode } from "../lib/agent-provider-config.js";
import { expandSpacesMentions, resolveUnboundMentions } from "../lib/mention-transform.js";
import { buildSpacesMentionLookups, buildSpacesMentionLookupsDb } from "../lib/mention-lookups.js";
import { mintSessionToken } from "../lib/session-tokens.js";
import { verifySpacesSignature } from "../middleware/verify-spaces-signature.js";
import { parseSlashCommand } from "../lib/parseSlashCommand.js";
import { handleSlashCommandBeforeRun, persistGoalStart, recordTurnAndDecide } from "../services/goalRelooper.js";
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
  getRecoveryContextForSession,
  type RecoverySessionContext,
} from "../queue/run-recovery-worker.js";
import { appendCitations } from "../lib/citations.js";
import { getSpacesAuthForUser, spacesDbAvailable, getSpacesUserWorkspaceId } from "../lib/spaces-db.js";
import { ensureUserExists } from "../lib/users-jit.js";
import { requireStrictS2S, s2sKeyMatches, requireResultToken } from "../middleware/require-auth.js";
import { renderAttachmentsToPdf } from "../lib/result-pdf.js";
import { renderMarkdownToHtml } from "../lib/result-html.js";
import JSZip from "jszip";
import { buildWriteApprovalFlow, buildTwinApprovalFlow, buildUserQuestionFlow, buildPromoteProviderFlow, buildGoalSuggestionFlow } from "xyne-claw-shared";

const clog = createLogger("webhook");

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

// ── Redis-backed session context store ──────────────────────────────

export interface SessionContext {
  mentionedUserId: string;
  senderId: string;
  senderName: string;
  channelId: string;
  channelName: string;
  conversationId: string;
  task: string;
  /**
   * The ORIGINAL user request that kicked off this run/chain. For a first-touch
   * run this equals `task`; across chain hops `task` becomes the interpolated
   * hand-off prompt while `rootTask` stays the human's actual ask. The chain
   * judge is fed this (not the stale interpolated task) so it can reason about
   * whether the user's request is satisfied.
   */
  rootTask?: string;
  agentSlug?: string | undefined;
  responseMode: "conversation" | "approval";
  appToken: string;
  spacesAppId: string;
  spacesAppUserId: string;
  traceId?: string;
  provider?: string;
  /** Current chain depth — incremented each time a chain fires. Used with maxDepth. */
  chainDepth?: number;
  /** Entry-point agent for this chain run. Used to resolve channel-level workflow binding. */
  rootAgentSlug?: string;
  /** Resolved workflow ID for this chain run (if any). */
  workflowId?: string;
  /**
   * MessageId of the "⏳ Working on it…" placeholder we posted at webhook-arrival
   * time. Used ONLY when USE_EPHEMERAL_PROGRESS=false — we edit this message
   * in-place as tools run, and replace its content with the final agent
   * response in the result handler. Undefined under the ephemeral path.
   */
  progressMessageId?: string;
  /**
   * Auto-draft forward URL. Present only when this run was triggered by the
   * Spaces email auto-draft (a synthetic APP_MENTIONED, not a real mention).
   * /webhook/result persists as usual, then forwards the result here (the
   * Spaces autodraft-callback) and skips the bot DM; the start placeholder is
   * skipped too. Absent for normal mentions.
   */
  resultForwardUrl?: string;
  /**
   * When true, the result-forward branch resolves the agent's plain `@Name`
   * mentions into clickable/notifying Spaces mentions (name→userId via
   * user-search, then HTML-span expansion) BEFORE forwarding. Set by the Spaces
   * automation path (handleAutomationWebhook), where there is no human session —
   * resolution uses the agent's bot token (`appToken`). Left unset for the email
   * auto-draft forward, which must NOT inject mention spans into a draft body.
   */
  resolveMentions?: boolean;
  /**
   * Workspace ID of the mentioned user for Digital Twin (USER_MENTIONED)
   * flows. Captured at webhook-receive time via getSpacesAuthForUser and
   * threaded all the way to the Flow UI data context so flow-action.ts can
   * forward it to Spaces' /api/internal/postAsUser — which REQUIRES
   * workspaceId to mint a JWT for the user. Without this, the Twin's
   * response generates fine but can never post.
   */
  workspaceId?: string;
  /**
   * Conversation-scoped "the user opted in to the agent's premium provider"
   * flag. Set by:
   *   1. `/upgrade` slash-command in the user's task (immediate auto-escalate)
   *   2. User clicking "Yes" on the FlowUI escalation prompt after a kimi
   *      failure or soft refusal (see flow-action.ts promote-provider branch)
   * When set, the resolution chain in handleWebhook uses this provider instead
   * of falling through to spaces/LiteLLM. Persists for the lifetime of the
   * conversation (Redis SESSION_TTL = 24h, keyed by convKey). Clearing it
   * requires the user to start a new conversation.
   */
  escalatedProvider?: string;
}

const SESSION_TTL = 86400;
const SESSION_PREFIX = "session:";
// Conversation-keyed index — see setSession comment.
const CONV_PREFIX = "session-by-conv:";

function convKey(conversationId: string, agentSlug: string): string {
  return `${CONV_PREFIX}${conversationId}:${agentSlug}`;
}

/**
 * Persist the session context under TWO Redis keys:
 *   1. `session:<sessionId>` — the original per-run key. Hot path; expires
 *      naturally with the run.
 *   2. `session-by-conv:<conversationId>:<agentSlug>` — durable index that
 *      survives sessionId churn across /goal turns, chain hops, run-recovery
 *      refires, and scheduled-job re-triggers. Catches the case where a
 *      refire path (e.g. goalRelooper's `void fetch(...)`) doesn't register
 *      the freshly-minted sessionId back to claw-auth, leaving Turn 2's
 *      result orphaned. With this index the /result handler can fall back
 *      to (conv, slug) lookup using the conversationId + agentSlug that
 *      claw already sends in its callback payload.
 *
 * If the context lacks conversationId or agentSlug we only write the per-
 * session key — those identifiers are required to make the conv index
 * usable, and the original behaviour is the safe default.
 */
export async function setSession(sessionId: string, ctx: SessionContext): Promise<void> {
  const redis = redisService.getConnection();
  const json = JSON.stringify(ctx);
  await redis.set(`${SESSION_PREFIX}${sessionId}`, json, "EX", SESSION_TTL);
  if (ctx.conversationId && ctx.agentSlug) {
    await redis.set(convKey(ctx.conversationId, ctx.agentSlug), json, "EX", SESSION_TTL);
  }
}

async function getSession(sessionId: string): Promise<SessionContext | null> {
  const redis = redisService.getConnection();
  const raw = await redis.get(`${SESSION_PREFIX}${sessionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionContext;
}

/**
 * Conversation-keyed context lookup. Returns the most recently saved context
 * for `(conversationId, agentSlug)` — exactly what /result needs when claw
 * minted a new sessionId via a refire path and claw-auth never registered it.
 * Exported so flow-action.ts can read+merge before flipping
 * `escalatedProvider` (promote-provider branch).
 */
export async function getSessionByConv(
  conversationId: string,
  agentSlug: string,
): Promise<SessionContext | null> {
  const redis = redisService.getConnection();
  const raw = await redis.get(convKey(conversationId, agentSlug));
  if (!raw) return null;
  return JSON.parse(raw) as SessionContext;
}

/**
 * Single source of truth for "given a callback, find the context that started
 * the run." Tries, in order:
 *   1. the sessionId index            — the normal hot path
 *   2. the durable run-recovery row   — survives a claw-auth restart
 *   3. the (conversationId, agentSlug) index — survives a claw refire that
 *      minted a brand-new sessionId claw-auth never registered (goal turns,
 *      chain hops, run-recovery, scheduled re-triggers)
 * On a conv-index hit we backfill the sessionId index so subsequent callbacks
 * for the same run resolve via the fast path.
 */
async function resolveSessionContext(
  sessionId: string,
  conversationId?: string | null,
  agentSlug?: string | null,
): Promise<SessionContext | null> {
  let ctx = sessionId ? await getSession(sessionId) : null;
  if (!ctx && sessionId) ctx = await getRecoveryContextForSession(sessionId);
  if (!ctx && conversationId && agentSlug) {
    ctx = await getSessionByConv(conversationId, agentSlug);
    if (ctx && sessionId) await setSession(sessionId, ctx);
  }
  return ctx;
}

async function deleteSession(sessionId: string): Promise<void> {
  const redis = redisService.getConnection();
  // Read the row before deleting so we can also drop the conv index.
  const raw = await redis.get(`${SESSION_PREFIX}${sessionId}`);
  await redis.del(`${SESSION_PREFIX}${sessionId}`);
  if (raw) {
    try {
      const ctx = JSON.parse(raw) as SessionContext;
      if (ctx.conversationId && ctx.agentSlug) {
        await redis.del(convKey(ctx.conversationId, ctx.agentSlug));
      }
    } catch { /* malformed — nothing to clean up */ }
  }
}

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

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Spaces backend caps `Message.content` at 10,000 chars (enforced in its
 * messageRepository.create — `validateString(..., 'content', 10000)`).
 * Posting longer text returns an opaque 500, not 413, so the user sees
 * nothing. We mirror the same 9,500-char buffer the Spaces team uses
 * elsewhere (notificationService.MAX_MESSAGE_LENGTH = 9500) and convert
 * anything longer into a PDF attachment.
 */
const MAX_MESSAGE_CHARS = 9500;

/**
 * Spaces' multipart `/files/filesUpload` endpoint is fronted by multer with
 * `files: 10` per request (see `backend/src/middleware/upload.ts:8`). Any
 * count above that triggers a 500 "Too many files". Threshold matches that
 * server-side limit exactly — anything ≤10 passes through untouched.
 *
 * When an agent emits more than this (typically sandbox/playwright runs
 * with many screenshots), we bundle ALL of them into one PDF via
 * `renderAttachmentsToPdf` and send that single PDF as the only attachment.
 * Result: never lose an over-quota delivery; the chat thread stays under
 * the multer cap; the user can still browse the originals via the bundle.
 */
const MAX_ATTACHMENTS_PER_MESSAGE = 10;

interface OutgoingAttachment {
  data: string;       // base64
  mimeType: string;
  fileName: string;
}

function isImageAttachment(a: OutgoingAttachment): boolean {
  return a.mimeType.toLowerCase().startsWith("image/");
}

/**
 * Bundle attachments into a single .zip, preserving their real bytes. Unlike
 * the PDF gallery (which can only embed images and silently drops everything
 * else), a zip works for ANY file type — PDFs, CSVs, docx, etc. Filenames are
 * de-duplicated so two files sharing a name don't clobber each other.
 */
async function zipAttachmentsToBuffer(attachments: OutgoingAttachment[]): Promise<Buffer> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const a of attachments) {
    let name = a.fileName?.trim() || "file";
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let i = 2;
      while (used.has(`${base}-${i}${ext}`)) i++;
      name = `${base}-${i}${ext}`;
    }
    used.add(name);
    zip.file(name, Buffer.from(a.data, "base64"));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Prepare an agent-result message for posting to Spaces:
 *
 *   - If the text body exceeds the 10K Spaces cap, render the FULL body
 *     into a PDF, attach it, and replace the chat body with a short
 *     stub + a preview of the first ~600 chars so the thread isn't empty.
 *   - If the total attachment count exceeds the Spaces cap, slice to the
 *     first N and annotate the body.
 *
 * Returns `{ text, attachments }` ready to feed into either the JSON or
 * multipart post path. Callers should switch to the multipart path
 * whenever `attachments.length > 0` after this returns.
 */
async function prepareAgentResultForPosting(
  rawText: string,
  rawAttachments: OutgoingAttachment[] | undefined,
  meta: {
    agentSlug?: string;
    /** Spaces session token of the human who triggered the agent. When
     *  present we use it to resolve plain `@Name` mentions against
     *  `/api/users/search` BEFORE running the bracketed-form expander —
     *  so an LLM that emitted bare `@Anirudh Naruka` (without the
     *  required `[userId]`) still produces a clickable, notifying tag.
     *  When absent (no user context — e.g. cron-triggered runs), we
     *  skip resolution and behave as today. */
    senderSpacesToken?: string;
    senderSpacesSessionId?: string;
    /** Workspace scope for the user-search call. Required when senderSpacesToken
     *  is set — otherwise the search isn't workspace-scoped and could leak. */
    senderWorkspaceId?: string;
    /** The agent's own workspace — used to scope name resolution for headless
     *  runs (no human sender), derived from the agent's app user. */
    agentWorkspaceId?: string;
  } = {},
): Promise<{ text: string; attachments: OutgoingAttachment[] }> {
  // Resolve unbracketed `@Name` (e.g. the LLM wrote `@Anirudh Naruka`) →
  // `@Name[userId]` via Spaces' user-search, using the triggering human's
  // session token (reliably available — getSpacesAuthForUser refreshes an
  // expired JWT). Limit=2 → ambiguous names are left as-is (no false pings).
  // Then the HTML expander below lifts the bracketed form into the mention span.
  // Resolve via the human's session token when we have one; otherwise fall back
  // to the direct-DB reader (headless runs — event triggers, cron, automations —
  // have only the agent's app token, which Spaces' user endpoints reject with a
  // 401, so without this their `@Name` mentions stayed dead text).
  let resolved = rawText;
  const lookups = meta.senderSpacesToken
    ? buildSpacesMentionLookups({
        token: meta.senderSpacesToken,
        ...(meta.senderSpacesSessionId ? { sessionId: meta.senderSpacesSessionId } : {}),
        ...(meta.senderWorkspaceId ? { workspaceId: meta.senderWorkspaceId } : {}),
      })
    : spacesDbAvailable()
      ? buildSpacesMentionLookupsDb(meta.agentWorkspaceId)
      : null;
  if (lookups) {
    resolved = await resolveUnboundMentions(resolved, lookups);
  }

  // Then: expand mention shorthand (e.g. `@Name[userId]`) into the HTML span
  // Spaces needs to render a clickable, notifying mention. Done here so every
  // postMessage/updateMessage/multipart caller below gets the same treatment.
  // Idempotent on already-expanded HTML.
  let text = expandSpacesMentions(resolved);
  let attachments: OutgoingAttachment[] = rawAttachments ? [...rawAttachments] : [];

  // Track the length-fallback attachment separately so the attachment-bundle
  // step below doesn't accidentally fold it into the bundle. It's the agent's
  // PRIMARY response and should stay a standalone attachment.
  let lengthAttachment: OutgoingAttachment | null = null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  // 1) Body too long → render full body to a standalone HTML attachment,
  //    replace body with stub. HTML (vs the old PDF walker) lets the browser
  //    own layout: tables, code blocks, nested lists render correctly with
  //    no custom walker, and we reuse the same template as create-html-report
  //    so length-fallback artifacts look identical to deliberate reports.
  if (text.length > MAX_MESSAGE_CHARS) {
    const htmlBuffer = await renderMarkdownToHtml(text, {
      title: "Agent Response",
      subtitle: [
        meta.agentSlug ? `Agent: ${meta.agentSlug}` : null,
        `Generated: ${new Date().toISOString()}`,
        `Length: ${text.length.toLocaleString()} chars`,
      ].filter(Boolean).join("  ·  "),
    });
    lengthAttachment = {
      data: htmlBuffer.toString("base64"),
      mimeType: "text/html",
      fileName: `agent-response-${stamp}.html`,
    };
    const preview = text.slice(0, 600).replace(/\s+$/, "");
    text =
      `_Response was ${text.length.toLocaleString()} characters — over the ` +
      `${MAX_MESSAGE_CHARS.toLocaleString()}-char Spaces limit. Full answer ` +
      `attached as an HTML file (open in any browser)._\n\n${preview}${text.length > 600 ? "…" : ""}`;
  }

  // 2) Too many original attachments → bundle to fit under Spaces' 10-file
  //    multer cap WITHOUT dropping any bytes:
  //      • Screenshots (image/*) → one browsable PDF gallery (only images
  //        embed cleanly; this is the "screenshots can live in the HTML/PDF"
  //        path).
  //      • Everything else (PDF, CSV, docx, …) → one .zip, so the real bytes
  //        survive. The old all-into-PDF path silently dropped non-image files
  //        (they only got a filename listing), which is the breakage we're
  //        fixing.
  //    Worst case this yields 2 bundle files (gallery + zip), both under cap.
  //    Length-HTML (if any) is kept separate and re-prepended after this step.
  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    const originalCount = attachments.length;
    const screenshots = attachments.filter(isImageAttachment);
    const others = attachments.filter((a) => !isImageAttachment(a));
    const bundled: OutgoingAttachment[] = [];

    if (screenshots.length > 0) {
      const galleryBuffer = await renderAttachmentsToPdf(screenshots, {
        title: "Screenshots",
        subtitle: [
          meta.agentSlug ? `Agent: ${meta.agentSlug}` : null,
          `Generated: ${new Date().toISOString()}`,
          `Count: ${screenshots.length} image(s)`,
        ].filter(Boolean).join("  ·  "),
      });
      bundled.push({
        data: galleryBuffer.toString("base64"),
        mimeType: "application/pdf",
        fileName: `screenshots-${screenshots.length}-${stamp}.pdf`,
      });
    }

    if (others.length > 0) {
      const zipBuffer = await zipAttachmentsToBuffer(others);
      bundled.push({
        data: zipBuffer.toString("base64"),
        mimeType: "application/zip",
        fileName: `attachments-${others.length}-files-${stamp}.zip`,
      });
    }

    attachments = bundled;
    const parts: string[] = [];
    if (screenshots.length > 0) parts.push(`${screenshots.length} screenshot(s) bundled as a PDF`);
    if (others.length > 0) parts.push(`${others.length} file(s) zipped`);
    text +=
      `\n\n_${originalCount} attachments exceeded Spaces' ${MAX_ATTACHMENTS_PER_MESSAGE}-file ` +
      `per-message limit — ${parts.join(" and ")}._`;
  }

  // 3) Re-prepend the length-PDF so it sits as the first attachment.
  const finalAttachments = lengthAttachment ? [lengthAttachment, ...attachments] : attachments;

  return { text, attachments: finalAttachments };
}

/**
 * Retry the given async fetch operation once on 5xx responses. Spaces
 * occasionally throws transient `500 Internal server error` on
 * /chat/postMessage (observed in prod ~5x/day) — a single 2-second backoff
 * recovers most of them. 4xx errors are NOT retried — they're caller bugs
 * that won't fix themselves.
 *
 * `fn` must throw an Error whose message starts with "Spaces app API NNN:"
 * — the format used by spacesAppFetch / spacesAppFetchMultipart below.
 */
async function withSpaces5xxRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /^Spaces app API (\d{3})/.exec(msg)?.[1];
    if (!status || Number(status) < 500) throw err;
    clog.warn(`[spaces-retry] ${label} got ${status} — retrying once after 2s`);
    await new Promise((r) => setTimeout(r, 2000));
    return await fn();
  }
}

async function spacesAppFetchMultipart(path: string, form: FormData, appToken?: string): Promise<unknown> {
  const url = `${CONFIG.spacesInternalUrl}/api/apps${path}`;
  const token = appToken ?? "";
  if (!token) throw new Error("No app token provided");

  return withSpaces5xxRetry(`POST ${path} (multipart)`, async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        // Do NOT set Content-Type — let fetch set it with the multipart boundary
        Authorization: `Bearer ${token}`,
      },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Spaces app API ${res.status}: ${text.slice(0, 500)}`);
    }

    return res.json();
  });
}

async function spacesAppFetchGet(path: string, appToken?: string): Promise<unknown> {
  const url = `${CONFIG.spacesInternalUrl}/api/apps${path}`;
  const token = appToken ?? "";
  if (!token) throw new Error("No app token provided");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Spaces app API ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

async function spacesAppFetch(path: string, body: Record<string, unknown>, appToken?: string): Promise<unknown> {
  const url = `${CONFIG.spacesInternalUrl}/api/apps${path}`;
  const token = appToken ?? "";
  if (!token) throw new Error("No app token provided");

  return withSpaces5xxRetry(`POST ${path}`, async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Spaces app API ${res.status}: ${text.slice(0, 500)}`);
    }

    return res.json();
  });
}

function decryptStoredField(stored: string): string {
  const [ciphertext, iv, authTag] = stored.split(":");
  if (!ciphertext || !iv || !authTag) throw new Error("Invalid encrypted field format");
  return decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
}

/**
 * Digital Twin (approval mode): open a DM with the mentioned user and send the
 * agent's result as an approve/decline flow — with attachments when present.
 * Nothing is posted to the originating thread; everything goes through the DM.
 * Deletes the session on completion. Caller should `return` after invoking.
 */
async function sendDigitalTwinApprovalDm(
  ctx: SessionContext,
  resultText: string,
  attachments: Array<{ fileName: string; mimeType: string; data: string }> | undefined,
  sessionId: string,
): Promise<void> {
  const token = ctx.appToken;
  // workspaceId required by prod openDm schema. Empty fallback only to satisfy
  // types — the earlier USER_MENTIONED gate already rejected runs where we
  // couldn't resolve the workspaceId, so this should always have a real value.
  const dmResult = (await spacesAppFetch("/channel/openDm", {
    targetUserId: ctx.mentionedUserId,
    workspaceId: ctx.workspaceId ?? "",
  }, token)) as { channelId: string };

  const twinFlow = buildTwinApprovalFlow(
    resultText,
    ctx.channelId,
    ctx.conversationId,
    ctx.mentionedUserId,
    ctx.workspaceId ?? "",
    ctx.senderName,
    ctx.channelName,
    ctx.task,
    ctx.agentSlug,
    dmResult.channelId,
    CONFIG.spacesAppUrl,
  );

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

  clog.info(`[webhook/result] Digital Twin: sent approve/decline DM to ${ctx.mentionedUserId} (asked by ${ctx.senderId})`);
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
  slug: string;
  appToken: string;
  spacesAppId: string;
  spacesAppUserId: string;
  isDefault: boolean;
}

async function resolveAgentByAppUserId(appUserId: string): Promise<ResolvedAgent | null> {
  const agent = await agentRepository.findByAppUserId(appUserId);

  if (agent?.spacesAppToken && agent.spacesAppId) {
    return {
      slug: agent.slug,
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

function formatActionDescription(tool: string, params: Record<string, unknown>): string {
  if (tool === "spaces-create-ticket") {
    const title = params["title"] as string ?? "";
    const desc = (params["description"] as string ?? "").slice(0, 300);
    const lines = [`**Create Ticket**`, ``, `**Title:** ${title}`];
    if (desc) lines.push(`**Description:** ${desc}${(params["description"] as string ?? "").length > 300 ? "..." : ""}`);
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

  // Fallback for unknown tools
  const entries = Object.entries(params).filter(([, v]) => v != null).slice(0, 8);
  const lines = [`**${tool}**`, ``];
  for (const [key, value] of entries) {
    const val = typeof value === "string" ? value.slice(0, 200) : JSON.stringify(value).slice(0, 200);
    lines.push(`**${key}:** ${val}`);
  }
  return lines.join("\n");
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

  // For APP_MENTIONED: the agent slug comes from the URL param (each agent has its own webhook URL)
  // For USER_MENTIONED: resolve from mentionedUserIds
  let agent: ResolvedAgent | null = null;

  // workspaceId of the mentioned user, captured at the USER_MENTIONED gate
  // and threaded through SessionContext + the Flow UI data context so
  // flow-action.ts can pass it to /api/internal/postAsUser. Spaces refuses
  // to post on the user's behalf without it.
  let twinWorkspaceId: string | undefined;

  // Set to true once we've verified this is a USER_MENTIONED on the default
  // agent (assistant) AND the mentioned user has opted into Digital Twin.
  // At /run dispatch we swap the agentSlug to "digital-twin" so the dedicated
  // Twin agent (with user-memory recall + Twin system prompt) actually
  // processes the reply. The assistant's Spaces App still owns the DM
  // channel — we only swap which agent's brain runs, not where the reply
  // posts.
  let runAsTwin = false;

  const agentSlugFromUrl = (req.params as { agentSlug?: string }).agentSlug;
  if (agentSlugFromUrl) {
    const agentRow = await agentRepository.findBySlug(agentSlugFromUrl);

    // USER_MENTIONED is **digital-twin-only**. Spaces fans the mention to
    // every agent installed in the channel; we accept it on exactly ONE
    // webhook (digital-twin) and reject on all others. This means:
    //   - The mentioned user MUST have the Digital Twin Spaces App
    //     installed in their workspace for the Twin flow to work.
    //   - Assistant, doctor-agent, pgm-agent etc. are explicitly NOT
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
      const mentionedUserIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];
      if (mentionedUserIds.length == 1) {
        const mentionedUser = await userRepository.findById(mentionedUserIds[0]!);
        if (!mentionedUser) {
          log.info(`Ignoring USER_MENTIONED — mentioned user ${mentionedUserIds[0]} not registered in claw-auth`);
          res.json({ success: true });
          return;
        }

        // Per-user opt-in gate. Digital Twin is OFF by default — only respond
        // for users who explicitly flipped `digitalTwinEnabled=true` via
        // POST /digital-twin/enable. Skipping this check is what caused the
        // prod OOM (Twin firing for every registered user, not just opted-in).
        if (!mentionedUser.digitalTwinEnabled) {
          log.info(`Ignoring USER_MENTIONED — user ${mentionedUserIds[0]} has Digital Twin disabled`);
          res.json({ success: true });
          return;
        }

        // Capture workspaceId for the Approve-button context. Without it,
        // /api/internal/postAsUser refuses to mint a JWT for the user and
        // the Twin's response never posts.
        const twinAuth = await getSpacesAuthForUser(mentionedUserIds[0]!, "webhook").catch(() => null);
        if (!twinAuth?.workspaceId) {
          log.info(`Ignoring USER_MENTIONED — could not resolve workspaceId for user ${mentionedUserIds[0]} (no active Spaces session)`);
          res.json({ success: true });
          return;
        }
        twinWorkspaceId = twinAuth.workspaceId;
        // Mark this run for Twin dispatch. We've now verified all three
        // conditions: USER_MENTIONED + default agent (assistant) + user is
        // opted in. At the /run call below we swap agentSlug → "digital-twin".
        runAsTwin = true;
      }
      else {
        log.info(`Ignoring USER_MENTIONED — expected exactly 1 mentioned user, got ${mentionedUserIds.length}`);
        res.json({ success: true });
        return;
      }
    }

    if (agentRow?.spacesAppToken && agentRow.spacesAppId) {
      agent = {
        slug: agentRow.slug,
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
    await ensureUserExists(payload.userId, "webhook").catch(() => {});
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
          error: err instanceof Error ? err.message : String(err),
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

  // ── Auto-goal: when agent.config.autoGoal === true, every non-slash
  //   message is automatically wrapped as `/goal <text>` before parsing.
  //   The user can still send explicit `/stop` or `/goal status` controls
  //   — those start with `/` so they bypass the wrap and reach the normal
  //   parser unchanged. Failure to load the config is non-fatal: we just
  //   fall through to ordinary slash-command handling.
  let autoGoalEnabled = false;
  try {
    const cfgRow = await agentRepository.findBySlug(agent.slug);
    autoGoalEnabled = ((cfgRow?.config ?? {}) as Record<string, unknown>)["autoGoal"] === true;
  } catch (err) {
    log.warn("autoGoal config lookup failed — treating as off", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const effectiveText = autoGoalEnabled && !userText.startsWith("/")
    ? `/goal ${userText}`
    : userText;

  // ── /goal slash command interception ─────────────────────────────────────
  // Recognised forms: `/goal <condition>`, `/goal status`, `/goal clear`,
  // `/stop`. Status/clear short-circuit before claw is invoked; goal-start
  // rewrites the worker's first-turn task to the relooper template and
  // stashes context for subsequent loop turns (recording happens after
  // run-dispatch below, once dispatchPayload is assembled).
  const slash = parseSlashCommand(effectiveText);

  // ── /help ── list the available slash commands, then stop.
  if (slash?.kind === "help") {
    await spacesAppFetch("/chat/postMessage", {
      channelId: payload.channelId,
      conversationId: payload.conversationId,
      markdownText: [
        "**Slash commands**",
        "- `/goal <condition>` — work autonomously until the condition is met",
        "- `/goal status` — show the active goal · `/goal clear` or `/stop` — cancel it",
        "- `/clear` — wipe this thread's context and start fresh",
        "- `/compact [focus]` — summarize & shrink the context, then continue",
        "- `/upgrade [task]` — use the premium model for this conversation",
        "- `/help` — show this list",
      ].join("\n"),
      userId: agent.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, agent.appToken).catch((err) => {
      log.warn("Failed to post /help reply", { error: err instanceof Error ? err.message : String(err) });
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
      log.warn("Failed to clear claw session", { error: err instanceof Error ? err.message : String(err) });
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
      log.warn("Failed to post /clear reply", { error: err instanceof Error ? err.message : String(err) });
    });
    return;
  }

  // ── /compact ── compact (summarize) this thread's context before the run.
  // Not a short-circuit: it dispatches a normal turn with compactBeforeRun set,
  // so the agent compacts the resumed session and replies with a summary.
  const compactBeforeRun = slash?.kind === "compact";

  // Only goal commands reach the goal relooper; clear/compact are handled here.
  const goalCommand =
    slash && (slash.kind === "goalStart" || slash.kind === "goalStatus" || slash.kind === "goalClear")
      ? slash
      : null;
  const intercept = await handleSlashCommandBeforeRun({ command: goalCommand, conversationId: payload.conversationId });
  let pendingGoalStart: { condition: string } | null = null;
  let task: string;
  if (intercept.kind === "goalStatusReply" || intercept.kind === "goalCleared") {
    await spacesAppFetch("/chat/postMessage", {
      channelId: payload.channelId,
      conversationId: payload.conversationId,
      markdownText: intercept.replyToUser,
      userId: agent.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, agent.appToken).catch((err) => {
      log.warn("Failed to post /goal control reply", { error: err instanceof Error ? err.message : String(err) });
    });
    return;
  } else if (compactBeforeRun) {
    // The run resumes the session, forces a compaction, and answers this task —
    // a short summary for the user while the context shrinks.
    task =
      slash?.kind === "compact" && slash.instructions
        ? `The user ran /compact. Summarize the conversation so far concisely, focusing on: ${slash.instructions}. Then we continue.`
        : "The user ran /compact. Give a concise summary of the conversation so far so we can continue with a smaller context.";
  } else if (intercept.kind === "goalStarted") {
    pendingGoalStart = { condition: intercept.condition };
    task = intercept.firstTurnTask;
    // Show "Starting /goal…" on the ephemeral progress spinner (same surface as
    // tool calls), not as a permanent chat message — the goal loop's meta lines
    // shouldn't clutter the thread. The terminal outcome stays a real message.
    await postGoalPhase(
      { conversationId: payload.conversationId, channelId: payload.channelId, agentSlug: agent.slug, spacesAppUserId: agent.spacesAppUserId, appToken: agent.appToken },
      intercept.replyToUser,
    );
  } else {
    task = userText;
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

  try {
    // Fetch thread history to give the agent context (exclude own messages to avoid duplication on resume)
    const history = await fetchConversationHistory(payload.conversationId, agent.appToken, agent.spacesAppUserId);

    // For USER_MENTIONED: run as the mentioned user (their tools, their twin)
    const allMentionedIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];
    const targetUserId = eventType === "USER_MENTIONED" && allMentionedIds.length > 0
      ? allMentionedIds[0]! : payload.userId;

    // Resolve agent config (skills)
    const agentRow = await agentRepository.findBySlugWithRelations(agent.slug);
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

    // Per-agent: which provider to use as the parent agent LLM.
    // "spaces" is the LiteLLM/Kimi platform sentinel, not a personal credential
    // choice — historically the GET /user-config endpoint returned `"spaces"`
    // as a default-display value, which led users to "Save" it and pin it as
    // an override that blocked agent-level providerOrder. Treat it as "no
    // personal preference" so the resolver falls through to the agent-level
    // chain. Only truthy non-"spaces" picks (codex/claude/copilot/openrouter)
    // count as a real personal override.
    const userAgentConfig = await userAgentConfigRepository.findByUserAndAgent(targetUserId, agent.slug).catch(() => null);
    const rawPersonalProvider = userAgentConfig?.provider;
    const personalProvider = rawPersonalProvider && rawPersonalProvider !== "spaces"
      ? rawPersonalProvider
      : undefined;

    // Agent-level fallback: shared keys the agent's owner/admin configured.
    // Anurag's framing: "If someone configures codex at xyne doctor level then
    // if quota is there it will use codex … If user has there own provider
    // that will take preference." Resolution chain becomes:
    //   1. personal provider (user picked in agent settings + has own creds)
    //   2. agent-level provider (agent.config.provider + agentProviderCredentials)
    //   3. "spaces" / LiteLLM platform default
    const agentLevelProvider = (agentRow?.config as Record<string, unknown> | null)?.["provider"] as string | undefined;
    // Owners can also pin an ordered preference list under config.providerOrder.
    // We use it (a) to pick which agent-level provider to bind as the parent
    // model, and (b) to thread the full fallback chain into the runtime so
    // claw can walk it on quota exhaustion instead of dropping straight to
    // LiteLLM. Validation: keep only known provider strings.
    const rawProviderOrder = (agentRow?.config as Record<string, unknown> | null)?.["providerOrder"];
    const KNOWN_PROVIDERS = new Set(["codex", "claude", "copilot", "openrouter", "spaces"]);
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

    // Shared decrypt + shape logic — used for both user-level and agent-level rows.
    type CredRow = {
      encryptedKey: string | null;
      iv: string | null;
      authTag: string | null;
      model: string | null;
      baseUrl: string | null;
      authType: string | null;
      reasoningEffort: string | null;
    };
    const buildProviderConfig = (provider: string, row: CredRow): { apiKey: string; model: string; baseUrl?: string; authType?: string; reasoningEffort?: string } | null => {
      if (!row.encryptedKey || !row.iv || !row.authTag) return null;
      try {
        const decrypted = decrypt(row.encryptedKey, row.iv, row.authTag, CONFIG.encryptionKey);
        // Codex AND Claude OAuth-mode store a JSON bundle
        // ({access_token,refresh_token,expires_at}). Pull out the bare
        // access_token so downstream sees a usable Bearer string. (Claude is
        // refreshed-before-use just after this loop; here we only need the
        // current access token, bundle or bare.)
        const apiKey =
          provider === "codex" ? extractCodexBearer(decrypted) :
          provider === "claude" ? extractClaudeBearer(decrypted) :
          decrypted;
        const defaultModel =
          provider === "copilot" ? "gpt-4o" :
          provider === "codex" ? "gpt-4.1" :
          "claude-sonnet-4-5";
        return {
          apiKey,
          model: row.model ?? defaultModel,
          ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
          ...(row.authType ? { authType: row.authType } : {}),
          ...(row.reasoningEffort ? { reasoningEffort: row.reasoningEffort } : {}),
        };
      } catch (err) {
        log.error(`Failed to decrypt ${provider} key`, { error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    };

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
        try {
          claudeCfg.apiKey = await getValidClaudeBearer(`${scope}:${ownerId}:claude`, credRow, async (enc) => {
            if (scope === "agent" && agentRow?.id) {
              await agentProviderCredentialsRepository.upsert(agentRow.id, "claude", enc);
            } else {
              await userProviderCredentialsRepository.upsert(targetUserId, "claude", enc);
            }
          });
        } catch (err) {
          // Refresh failed (expired + no/invalid refresh token). Leave the stale
          // token; the run will 401 and surface via the error path. Logged so
          // it's visible rather than a mystery empty-completion.
          log.warn("Claude OAuth refresh failed — credential likely needs reconnect", {
            scope,
            error: err instanceof Error ? err.message : String(err),
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
        try {
          codexCfg.apiKey = await getValidCodexBearer(`${scope}:${ownerId}:codex`, credRow, async (enc) => {
            if (scope === "agent" && agentRow?.id) {
              await agentProviderCredentialsRepository.upsert(agentRow.id, "codex", enc);
            } else {
              await userProviderCredentialsRepository.upsert(targetUserId, "codex", enc);
            }
          });
        } catch (err) {
          // Refresh failed (expired + no/invalid refresh token). Leave the stale
          // token; the run will 401 and surface via the error path. Logged so
          // it's visible rather than a mystery empty-completion.
          log.warn("Codex OAuth refresh failed — credential likely needs reconnect", {
            scope,
            error: err instanceof Error ? err.message : String(err),
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
      ? await getSessionByConv(payload.conversationId, agent.slug).catch(() => null)
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
          agentSlug: agent.slug,
          responseMode: "conversation",
          appToken: agent.appToken,
          spacesAppId: agent.spacesAppId,
          spacesAppUserId: agent.spacesAppUserId,
          traceId,
          rootAgentSlug: agent.slug,
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
          log.warn("Failed to post /upgrade ack", { error: err instanceof Error ? err.message : String(err) });
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
    // Prefer a live read from the Spaces DB (always fresh). Falls back to the
    // cached userMcpConnection copy when SPACES_DB_URL is unset or the user
    // has no active session row.
    const liveSpaces = await getSpacesAuthForUser(payload.userId, "webhook");
    if (liveSpaces) {
      userSpacesToken = liveSpaces.token;
      userSpacesSessionId = liveSpaces.sessionId;
      log.info(`Resolved Spaces creds from live DB for user ${payload.userId}`);
    } else {
      try {
        const conn = await prisma.userMcpConnection.findFirst({
          where: { userId: payload.userId, mcpServer: { type: "xyne-spaces" } },
        });
        if (conn) {
          const decrypted = decrypt(conn.encryptedCreds, conn.iv, conn.authTag, CONFIG.encryptionKey);
          const parsed = JSON.parse(decrypted) as { token?: string; sessionId?: string };
          if (parsed.token) userSpacesToken = parsed.token;
          if (parsed.sessionId) userSpacesSessionId = parsed.sessionId;
        }
      } catch (err) {
        log.warn(`Failed to load user Spaces token for ${payload.userId}: ${err instanceof Error ? err.message : String(err)}`);
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
    const userCookieHeader = userCookieParts.length > 0 ? userCookieParts.join("; ") : undefined;

    const inboundAttachments: Array<{ fileName: string; mimeType: string; data: string }> = [];
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
            failures.push(`${src.label}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (!downloaded) {
          log.warn(
            `Failed to download attachment ${att.attachmentId} (${att.fileName}); tried ${sources.length} source(s): ${failures.join(" | ")}`,
          );
        }
      }
    }

    // Twin dispatch: when this is a USER_MENTIONED on the default agent for
    // an opted-in user, run the dedicated "digital-twin" agent instead of
    // the assistant. assistant's Spaces App is still routing the event +
    // owning the DM channel for the reply — we only swap which agent's
    // prompt / memory / tools actually generate the response. If for any
    // reason the digital-twin agent doesn't exist (migration not applied),
    // fall back to the original slug so the flow doesn't break entirely.
    // No agent-slug swap needed for the Twin path anymore — the strict
    // gate above ensures USER_MENTIONED only reaches us via the
    // /webhook/digital-twin route, so `agent` already holds digital-twin's
    // credentials and `agent.slug === "digital-twin"`. We just use
    // `agent.slug` as the run target.
    const runAgentSlug = agent.slug;
    if (runAsTwin) {
      log.info(`USER_MENTIONED Twin dispatch — running ${agent.slug} (webhook /${agentSlugFromUrl})`);
    }

    const runUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run`;
    const runRes = await fetch(runUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({
        userId: targetUserId,
        task,
        conversationId: payload.conversationId,
        agentSlug: runAgentSlug,
        eventType,
        traceId,
        callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
        progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
        channelId: payload.channelId,
        ...(payload.projectId ? { projectId: payload.projectId } : {}),
        ...(payload.projectName ? { projectName: payload.projectName } : {}),
        ...(history
          ? {
              context: `## Thread Awareness\nYou are in a group thread in Xyne Spaces where multiple users and agents can participate. The thread history below shows messages from other participants — use it to understand context. Your own previous messages are NOT included here (they are already in your session). If you need more context, use spaces-messages or spaces-message-detail to read the full thread.\n\n**Speaker labels in the history below:**\n- \`human-user:<id>\` — a human in the thread; their words are user input.\n- \`@<agent-slug> (OTHER AI AGENT — not you; do not adopt this voice or identity)\` — another AI agent's message. When they say "I", they mean themselves, NOT you. NEVER answer in their voice, NEVER claim to be them, and NEVER paraphrase their first-person identity as your own. If asked to compare yourself to them, refer to them in the third person ("the X agent said …").\n\n${history}`
            }
          : {}),
        ...(agentSkills && agentSkills.length > 0 ? { skills: agentSkills } : {}),
        ...(resolvedParentProvider ? { provider: resolvedParentProvider } : {}),
        ...(runtimeProviderOrder.length > 1 ? { providerOrder: runtimeProviderOrder } : {}),
        ...(Object.keys(subagentProviders).length > 0 ? { subagentProviders } : {}),
        // Default provider for subagents not listed in `subagentProviders`:
        // "parent" (inherit parent's provider) or "spaces" (platform default).
        subagentProviderMode,
        ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
        ...(inboundAttachments.length > 0 ? { attachments: inboundAttachments } : {}),
        // Ship the agent's JSONB config so xyne-claw can enable per-agent
        // features that read from it: memoryEnabled (memory-search tool),
        // toolPermissions (per-tool deny/ask), skillTriggers, promptInjections,
        // and custom-tool config values (PPT_API_KEY etc). Without this,
        // those features silently default to "off"/"allow" on Spaces mentions.
        ...(agentRow?.config ? { agentConfig: agentRow.config as Record<string, unknown> } : {}),
        // `/compact` — force a one-shot compaction of the resumed session
        // before this turn so the thread continues with a smaller context.
        ...(compactBeforeRun ? { compactBeforeRun: true } : {}),
      }),
    });

    const body = (await runRes.json()) as { success: boolean; sessionId?: string };

    if (body.success && body.sessionId) {
      const mentionedUserIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];
      // Spaces email auto-draft sends a synthetic APP_MENTIONED carrying this URL
      // in metadata. When present, suppress the bot placeholder + DM and forward
      // the result to it instead (see /webhook/result).
      const resultForwardUrl =
        ((payload as { metadata?: Record<string, unknown> }).metadata?.["resultForwardUrl"] as string | undefined) || undefined;

      // Progress signal to the dashboard. Two paths, switched by flag:
      //   USE_EPHEMERAL_PROGRESS=true  → POST /chat/agentProgress (requires Spaces XYNE-12145)
      //   USE_EPHEMERAL_PROGRESS=false → POST /chat/postMessage for a "⏳ Working on it..."
      //                                  placeholder; we capture messageId and edit it later.
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
          log.warn("Failed to publish initial agent progress signal", { error: err instanceof Error ? err.message : String(err) });
        }
      }

      const sessionContext: SessionContext = {
        mentionedUserId: eventType === "USER_MENTIONED" ? (mentionedUserIds[0] ?? agent.spacesAppUserId) : agent.spacesAppUserId,
        senderId: payload.userId,
        senderName: payload.senderName ?? payload.userId,
        channelId: payload.channelId,
        channelName: payload.channelName ?? payload.channelId,
        conversationId: payload.conversationId,
        task,
        agentSlug: agent.slug,
        responseMode: eventType === "USER_MENTIONED" ? "approval" as const : "conversation" as const,
        appToken: agent.appToken,
        spacesAppId: agent.spacesAppId,
        spacesAppUserId: agent.spacesAppUserId,
        traceId,
        rootAgentSlug: agent.slug,
        ...(resolvedParentProvider ? { provider: resolvedParentProvider } : {}),
        ...(escalatedProvider ? { escalatedProvider } : {}),
        ...(progressMessageId ? { progressMessageId } : {}),
        ...(twinWorkspaceId ? { workspaceId: twinWorkspaceId } : {}),
        ...(resultForwardUrl ? { resultForwardUrl } : {}),
      };

      await setSession(body.sessionId, sessionContext);

      const dispatchPayload = {
        userId: targetUserId,
        task,
        conversationId: payload.conversationId,
        agentSlug: agent.slug,
        eventType,
        traceId,
        callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
        progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
        channelId: payload.channelId,
        ...(payload.projectId ? { projectId: payload.projectId } : {}),
        ...(payload.projectName ? { projectName: payload.projectName } : {}),
        ...(history ? { context: `## Thread Awareness\nYou are in a group thread in Xyne Spaces where multiple users and agents can participate. The thread history below shows messages from other participants — use it to understand context. Your own previous messages are NOT included here (they are already in your session). If you need more context, use spaces-messages or spaces-message-detail to read the full thread.\n\n**Speaker labels in the history below:**\n- \`human-user:<id>\` — a human in the thread; their words are user input.\n- \`@<agent-slug> (OTHER AI AGENT — not you; do not adopt this voice or identity)\` — another AI agent's message. When they say "I", they mean themselves, NOT you. NEVER answer in their voice, NEVER claim to be them, and NEVER paraphrase their first-person identity as your own. If asked to compare yourself to them, refer to them in the third person ("the X agent said …").\n\n${history}` } : {}),
        ...(agentSkills && agentSkills.length > 0 ? { skills: agentSkills } : {}),
        ...(resolvedParentProvider ? { provider: resolvedParentProvider } : {}),
        ...(runtimeProviderOrder.length > 1 ? { providerOrder: runtimeProviderOrder } : {}),
        ...(Object.keys(subagentProviders).length > 0 ? { subagentProviders } : {}),
        // Default provider for subagents not listed in `subagentProviders`:
        // "parent" (inherit parent's provider) or "spaces" (platform default).
        subagentProviderMode,
        ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
        ...(inboundAttachments.length > 0 ? { attachments: inboundAttachments } : {}),
        // Same agentConfig pass-through as the primary /run dispatch above —
        // run-recovery retries must see memoryEnabled/skillTriggers/etc.
        ...(agentRow?.config ? { agentConfig: agentRow.config as Record<string, unknown> } : {}),
        ...(compactBeforeRun ? { compactBeforeRun: true } : {}),
      };

      await registerRunRecovery({
        rootSessionId: body.sessionId,
        maxRetries: CONFIG.runRecoveryMaxRetries,
        timeoutMs: CONFIG.runRecoveryTimeoutMs,
        retryBackoffMs: CONFIG.runRecoveryBackoffMs,
        dispatchPayload,
        sessionContext,
      });

      // /goal turn-0 persistence: same dispatchPayload is replayed by the
      // relooper for each subsequent turn (task is overwritten with the
      // relooper template each loop).
      if (pendingGoalStart) {
        await persistGoalStart({
          conversationId: payload.conversationId,
          channelId: payload.channelId ?? null,
          ...(twinWorkspaceId ? { workspaceId: twinWorkspaceId } : {}),
          userId: targetUserId,
          agentSlug: agent.slug,
          condition: pendingGoalStart.condition,
          // dispatchPayload is JSON-safe by construction (strings / arrays /
          // plain objects only); the cast satisfies Prisma's InputJsonValue
          // brand which doesn't accept Record<string, unknown> directly.
          runPayload: JSON.parse(JSON.stringify(dispatchPayload)),
        }).catch((err) => {
          log.warn("Failed to persist /goal start — loop will not auto-continue", { error: err instanceof Error ? err.message : String(err) });
        });
      }

      // AgentRun + user ChatMessage writes are owned by the /run handler this
      // webhook just called (routes/run.ts:351-373). Doing them again here
      // would race the /run insert and fail the unique constraint on
      // AgentRun.sessionId for every webhook hit — historical bug, ~216/day
      // in prod logs before this dedupe. Leave it to /run.

      log.info(`Forwarded to xyne-claw, sessionId=${body.sessionId}`);
    }
  } catch (err) {
    log.error("Error forwarding:", { error: err instanceof Error ? err.message : String(err) });
  }
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
async function handleAutomationWebhook(req: Request, res: Response, pathAgentSlug: string): Promise<void> {
  const payload = req.body as {
    sessionId?: string;
    agentSlug?: string;
    task?: string;
    userId?: string;
    callbackUrl?: string;
    context?: string;
    conversationId?: string | null;
    channelId?: string | null;
    channelName?: string | null;
    workspaceId?: string | null;
  };

  const { sessionId, task, userId, callbackUrl, context } = payload;
  const agentSlug = pathAgentSlug;
  if (payload.agentSlug && payload.agentSlug !== pathAgentSlug) {
    res.status(400).json({ success: false, error: `body agentSlug does not match path agent "${pathAgentSlug}"` });
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

  // Agent existence + enabled check. Without this, spaces fires the run and
  // only finds out it was rejected when the (never-arriving) callback never
  // fires — turning a bad-slug typo into a silent hang on the automation side.
  const agent = await agentRepository.findBySlug(agentSlug);
  if (!agent) {
    res.status(404).json({ success: false, error: `agent "${agentSlug}" not found` });
    return;
  }
  if (!agent.enabled) {
    res.status(403).json({ success: false, error: `agent "${agentSlug}" is disabled` });
    return;
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
    callbackUrl &&
    agent.spacesAppUserId &&
    agent.spacesAppToken &&
    agent.spacesAppId,
  );
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
      agentSlug: agent.slug,
      responseMode: "conversation",
      appToken,
      spacesAppId: agent.spacesAppId!,
      spacesAppUserId: agent.spacesAppUserId!,
      rootAgentSlug: agent.slug,
      // Forward the resolved result to the automation's original callback (so
      // step-1.output.result carries clickable mentions) instead of posting a
      // bot message, and turn on mention resolution for that forward.
      resultForwardUrl: callbackUrl!,
      resolveMentions: true,
    };
    await setSession(sessionId!, sessionContext);
  }

  // Create the AgentRun row up front so the v3 Control Center sees the run
  // start, the same way the user-facing /run path does. Without this, runs
  // initiated by spaces automations would only appear in CC after the
  // /webhook/result callback fired, which can be minutes later for slow runs.
  try {
    await agentRunRepository.start({
      sessionId: sessionId!,
      userId: userId!,
      agentSlug,
      triggerSource: "api",
      task: task!,
      ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
      ...(payload.channelId ? { channelId: payload.channelId } : {}),
    });
  } catch (err) {
    // Non-fatal: if the AgentRun row collides on sessionId (retry from the
    // automation engine), we still want to forward the run. The run rows
    // get reconciled by /webhook/result's update.
    clog.warn(`[webhook] AgentRun.start non-fatal failure for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Proxy to claw-pod's internal /run. When interposing (see above) we route
  // claw's callback through claw-auth's own /webhook/result so we can resolve
  // mentions before forwarding to the automation's callback. That endpoint is
  // requireResultToken-gated, so we mint a per-run token and pass it; claw
  // echoes it as `x-session-token` on the callback. When NOT interposing we
  // pass the automation's callbackUrl straight through, as before.
  const clawCallbackUrl = interpose ? `${CONFIG.internalUrl}/claw/api/v1/webhook/result` : callbackUrl;
  const resultToken = interpose
    ? mintSessionToken({ sessionId: sessionId!, userId: userId!, agentSlug, ttlSeconds: 3600 })
    : undefined;

  // Resolve the agent's configured provider so an automation run uses the same
  // (premium) model a human chat would — not the platform default. Headless:
  // agent-level creds only, honoring the agent's providerAlwaysOn policy.
  // [AUTODBG] instrument the whole dispatch window — automations were observed
  // stalling silently right after [agent-run] start (no forward, no error).
  clog.info(`[webhook] AUTODBG ${sessionId}: after AgentRun.start — resolving provider configs (agent=${agentSlug}, interpose=${interpose})`);
  const __t0 = process.hrtime.bigint();
  let providerConfigs: Awaited<ReturnType<typeof resolveAgentProviderConfigs>>["providerConfigs"] = {};
  let providerOrder: Awaited<ReturnType<typeof resolveAgentProviderConfigs>>["providerOrder"] = [];
  try {
    ({ providerConfigs, providerOrder } = await resolveAgentProviderConfigs(agent));
  } catch (provErr) {
    clog.error(`[webhook] AUTODBG ${sessionId}: resolveAgentProviderConfigs THREW: ${provErr instanceof Error ? provErr.stack || provErr.message : String(provErr)}`);
    res.status(502).json({ success: false, error: "provider config resolution failed" });
    return;
  }
  const __provMs = Number((process.hrtime.bigint() - __t0) / 1_000_000n);
  clog.info(`[webhook] AUTODBG ${sessionId}: provider configs resolved in ${__provMs}ms (configs=${Object.keys(providerConfigs).length}, order=${providerOrder.length}) — forwarding to ${CONFIG.internalUrl}/claw/api/v1/internal/run`);

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
        task,
        userId,
        eventType: "automation",
        callbackUrl: clawCallbackUrl,
        ...(resultToken ? { sessionToken: resultToken } : {}),
        ...(agent.config ? { agentConfig: agent.config as Record<string, unknown> } : {}),
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
    clog.error(`[webhook] AUTODBG forward to claw-pod failed for session ${sessionId} after ${Number((process.hrtime.bigint() - __t0) / 1_000_000n)}ms: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    res.status(502).json({ success: false, error: "failed to reach claw-pod" });
    return;
  }

  // Pass through claw-pod's response code + body so the automation engine
  // can distinguish "claw rejected" from "claw-auth rejected".
  const status = (runRes as unknown as { status: number }).status;
  const text = await (runRes as unknown as { text: () => Promise<string> }).text();
  clog.info(`[webhook] AUTODBG ${sessionId}: /internal/run responded status=${status} bodyLen=${text.length} body=${text.slice(0, 200)}`);

  // Crash/stall resilience — ONLY for interposed runs. When interposing, the
  // result routes through claw-auth's /webhook/result (so recovery's stored
  // SessionContext + exhausted-notice poster apply) and we hold the agent's app
  // identity. We key recovery off claw-auth's authoritative sessionId (it mints
  // its own; ours is ignored) so the GCS idempotency marker and the
  // progress-heartbeat → root mapping line up. If claw-pod stalls without a
  // completed-result marker, the worker replays this payload under a fresh
  // session — idempotency-keyed, so a finished run is never re-forwarded (no
  // double workflow-step advance). Non-interpose runs callback straight to the
  // automation engine, which owns its own retry; we deliberately don't layer on.
  if (interpose && status >= 200 && status < 300) {
    let runSessionId = sessionId!;
    try {
      const parsed = JSON.parse(text) as { sessionId?: string };
      if (parsed.sessionId) runSessionId = parsed.sessionId;
    } catch { /* non-JSON body — fall back to our local id */ }

    const recoveryPayload = {
      userId: userId!,
      task: task!,
      conversationId: payload.conversationId ?? "",
      agentSlug,
      eventType: "automation",
      traceId: "",
      callbackUrl: clawCallbackUrl!,
      progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
      channelId: payload.channelId ?? "",
      ...(resultToken ? { sessionToken: resultToken } : {}),
      ...(agent.config ? { agentConfig: agent.config as Record<string, unknown> } : {}),
      ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
      ...(providerOrder.length > 1 ? { providerOrder } : {}),
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
      // Carry the automation's forward target through recovery. claw calls back
      // with its own sessionId (misses the Redis session keyed by the dispatch
      // id), so /webhook/result resolves ctx from THIS recovery context. Mirror
      // the interpose session (line ~2252): forward the result to the
      // automation's callback instead of posting to a (nonexistent) channel.
      ...(interpose ? { resultForwardUrl: callbackUrl!, resolveMentions: true } : {}),
    };
    await registerRunRecovery({
      rootSessionId: runSessionId,
      maxRetries: CONFIG.runRecoveryMaxRetries,
      timeoutMs: CONFIG.runRecoveryTimeoutMs,
      retryBackoffMs: CONFIG.runRecoveryBackoffMs,
      dispatchPayload: recoveryPayload,
      sessionContext: recoveryCtx,
    }).catch((err) => {
      clog.warn(`[webhook] registerRunRecovery non-fatal for ${runSessionId}: ${err instanceof Error ? err.message : String(err)}`);
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
  payload: { sessionId?: string; status?: string; error?: string },
  result: string,
): Promise<void> {
  // The Spaces automation RUN_AGENT executor (backend/src/automations/steps/
  // run-agent.step.ts) reads the forwarded `result` field, runs JSON.parse on it
  // (parseAgentJson) and validates the parsed object against the step's
  // outputSchema. A plain-markdown result fails JSON.parse → the step treats it
  // as a validation failure and RE-RUNS the whole agent ("retrying claw agent
  // (N/3)"); the retry then self-skips (already-reviewed) and that skip — which
  // happens to be JSON — wins, so the real review is discarded. We can only fix
  // claw, so for automation callbacks we send `result` as a JSON object string
  // `{"result":"<text>"}` (mirrors claw's coerceAutomationResult). The executor
  // unwraps it (step output.result = <text>), so downstream steps/threads still
  // render plain text. Non-automation forward targets (Spaces auto-draft) keep
  // the raw text so they don't suddenly receive escaped JSON.
  const isAutomationCallback = url.includes("/automations/claw-callback/");
  const resultField = isAutomationCallback ? JSON.stringify({ result }) : result;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({
        sessionId: payload.sessionId,
        status: payload.status,
        result: resultField,
        ...(payload.error ? { error: payload.error } : {}),
      }),
    });
    if (!res.ok) clog.warn(`[webhook/result] resultForward returned ${res.status}`);
  } catch (err) {
    clog.warn(`[webhook/result] resultForward failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── POST /webhook/result — callback from xyne-claw (MUST be before /:agentSlug) ──

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
    // remaining work to a /goal autonomous loop. See start-goal handler in
    // app-callback.ts. Only present when the agent's config has
    // suggestGoal=true AND the tool was actually called this turn.
    pendingGoalSuggestion?: { condition: string; rationale: string };
    provider?: string;
    model?: string;
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
  };

  const sessionId = payload.sessionId ?? "";

  // Acknowledge immediately (per-run token already verified by
  // requireResultToken middleware).
  res.json({ success: true });

  const ctx = await resolveSessionContext(
    sessionId,
    payload.conversationId,
    payload.agentSlug,
  );

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
      clog.warn(`[webhook/result] Twin suffix lookup failed for user ${ctx.mentionedUserId}: ${err instanceof Error ? err.message : String(err)}`);
      // Non-fatal — the reply still posts, just without the user's suffix.
    }
  }

  // Per-agent citation toggle: `config.replyOptions.includeCitations === true`
  // OPTS IN to the "### Citations" section appended to the reply. Default is
  // false now — the citation block was noisy and not wanted by most agents.
  // Agents that explicitly want it (e.g. research agents) can re-enable it
  // via agent.config.replyOptions.includeCitations = true.
  let includeCitations = false;
  if (ctx?.agentSlug) {
    try {
      const agentRow = await agentRepository.findBySlug(ctx.agentSlug);
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
    }).catch(() => {});
  }

  if (payload.status === "completed") {
    await handleRunCompletion(sessionId, "completed").catch((err) => {
      clog.warn(`[webhook/result] Failed to mark ${sessionId} completed in run recovery:`, err instanceof Error ? err.message : err);
    });
  }

  if (payload.status === "failed") {
    const recoveryFailure = await handleRunCompletion(sessionId, "failed", payload.error).catch((err) => {
      clog.warn(`[webhook/result] Failed to process ${sessionId} failure in run recovery:`, err instanceof Error ? err.message : err);
      return null;
    });

    if (recoveryFailure?.retried) {
      clog.info(`[webhook/result] Session ${sessionId}: retry queued (${recoveryFailure.retriesUsed}/${recoveryFailure.maxRetries})`);
      return;
    }
  }

  if (payload.status !== "completed") {
    // Result-forward callers (Spaces auto-draft / automations) get the failure
    // via their callback and return BEFORE the bot-mention surfacing below —
    // they want the callback, not a message posted into a thread.
    if (ctx?.resultForwardUrl) {
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
    // ── Handle failure chain if configured ──
    if (payload.status === "failed" && ctx?.agentSlug) {
      try {
        const agentRow = await agentRepository.findBySlug(ctx.agentSlug);

        // Check user-level chain config first, fall back to global agent config
        const userChainRow = await userAgentConfigRepository.findByUserAndAgent(ctx.senderId, ctx.agentSlug);
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
          const failureAgentRow = await agentRepository.findBySlug(chain.onFailure.triggerAgent);
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
            await registerRunRecovery({
              rootSessionId: runBody.sessionId,
              maxRetries: CONFIG.runRecoveryMaxRetries,
              timeoutMs: CONFIG.runRecoveryTimeoutMs,
              retryBackoffMs: CONFIG.runRecoveryBackoffMs,
              dispatchPayload: {
                userId: ctx.senderId,
                task: failureTask,
                conversationId: ctx.conversationId,
                agentSlug: chain.onFailure.triggerAgent,
                eventType: "APP_MENTIONED",
                traceId: ctx.traceId ?? runBody.sessionId,
                callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
                progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
                channelId: ctx.channelId,
              },
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
      ctx.conversationId &&
      ctx.channelId
    ) {
      try {
        const agentRow = await agentRepository.findBySlug(ctx.agentSlug);
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
            const KNOWN = new Set(["codex", "claude", "copilot", "openrouter"]);
            const rawOrder = (agentRow.config as Record<string, unknown> | null)?.["providerOrder"];
            const order: string[] = Array.isArray(rawOrder)
              ? rawOrder.filter((p): p is string => typeof p === "string" && KNOWN.has(p))
              : [];
            const legacy = (agentRow.config as Record<string, unknown> | null)?.["provider"] as string | undefined;
            const candidate =
              order.find(hasCreds) ??
              (legacy && KNOWN.has(legacy) && hasCreds(legacy) ? legacy : undefined);
            if (candidate) {
              const flow = buildPromoteProviderFlow(candidate, {
                agentSlug: ctx.agentSlug,
                channelId: ctx.channelId,
                conversationId: ctx.conversationId,
                userId: ctx.senderId,
                originalTask: ctx.task,
              });
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

    // Safety net: a failed run that nothing above surfaced must still tell the
    // user — otherwise the thread goes silent and looks like the agent ignored
    // the mention. Only for conversation-mode failures with a thread to post
    // to; cancellations and approval-mode runs stay silent by design.
    if (
      payload.status === "failed" &&
      !failureSurfaced &&
      ctx?.conversationId &&
      ctx?.channelId &&
      ctx.responseMode === "conversation"
    ) {
      const rawErr = String(payload.error ?? "");
      const isQuota = /\b429\b|quota|rate.?limit|exceeded|out of credit/i.test(rawErr);
      const notice = isQuota
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
    if (resultWithCitations.trim() && ctx.conversationId && ctx.agentSlug) {
      chatMessageRepository.create({
        conversationId: ctx.conversationId,
        agentSlug: ctx.agentSlug,
        userId: ctx.senderId,
        role: "assistant",
        content: resultWithCitations,
        status: "completed",
        ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
      }).catch((e) => log.warn("Failed to save assistant ChatMessage", { error: e instanceof Error ? e.message : String(e) }));
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
        log.warn(`mention resolution failed — forwarding raw text: ${err instanceof Error ? err.message : String(err)}`);
      }
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
  if (USE_EPHEMERAL_PROGRESS) {
    spacesAppFetch("/chat/agentProgress", {
      conversationId: ctx.conversationId,
      channelId: ctx.channelId,
      agentSlug: ctx.agentSlug,
      userId: ctx.spacesAppUserId,
      status: "done",
    }, ctx.appToken).catch((err) =>
      log.warn("Failed to clear agent progress signal", { error: err instanceof Error ? err.message : String(err) }),
    );
  }

  // Persist the assistant response as a ChatMessage (transcript) — fire-and-forget
  if (resultWithCitations.trim() && ctx.conversationId && ctx.agentSlug) {
    chatMessageRepository.create({
      conversationId: ctx.conversationId,
      agentSlug: ctx.agentSlug,
      userId: ctx.senderId,
      role: "assistant",
      content: resultWithCitations,
      status: "completed",
      ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
    }).catch((e) => log.warn("Failed to save assistant ChatMessage", { error: e instanceof Error ? e.message : String(e) }));
  }

  // Notify user if result is empty (but not if copilot has pendingResponses)
  if (!resultWithCitations.trim() && !payload.pendingResponses?.length) {
    if (ctx.responseMode === "approval") {
      log.warn("Empty result in approval mode — skipping (no thread message)");
      await deleteSession(sessionId);
      return;
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
      log.error("Failed to send empty-result notice", { error: err instanceof Error ? err.message : String(err) });
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
        log.warn(`pending-response mention resolution failed — posting raw: ${err instanceof Error ? err.message : String(err)}`);
        return text;
      }
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

        const twinFlow = buildTwinApprovalFlow(
          combinedResult,
          ctx.channelId,
          ctx.conversationId,
          ctx.mentionedUserId,
          ctx.workspaceId ?? "",
          ctx.senderName,
          ctx.channelName,
          ctx.task,
          ctx.agentSlug,
          dmResult.channelId,
          CONFIG.spacesAppUrl,
        );

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
        form.append("metadata", JSON.stringify({ contentFormat: "markdown" }));
        try {
          await spacesAppFetchMultipart("/files/filesUpload", form, token);
          log.info(`Copilot: uploaded ${prepared.attachments.length} attachment(s) with response(s) in thread ${ctx.conversationId}`);
        } catch (err) {
          // Attachment upload failed — don't drop the whole reply. Post the text
          // answer via /chat/postMessage so the user still gets the response;
          // only the files couldn't be delivered. Mirrors the normal result path.
          log.warn(
            `Copilot: attachment upload failed for ${ctx.agentSlug} — falling back to text-only reply`,
            { error: err instanceof Error ? err.message : String(err) },
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
            metadata: { contentFormat: "markdown" },
          }, token);
          log.info(`Copilot: posted text-only fallback after attachment upload failure in thread ${ctx.conversationId}`);
        }
      } else {
        for (const pr of payload.pendingResponses) {
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            markdownText: await resolvePendingMentions(pr.message),
            userId: ctx.spacesAppUserId,
            metadata: { contentFormat: "markdown" },
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
      // ctx.senderId to match the user-message rows so the per-agent scope and
      // per-user ACL on read both line up.
      // `!resultWithCitations.trim()` guards against a double-save: the normal
      // save above already fires when result.text is non-empty, so only persist
      // here when it was empty (the actual Verify-Responses/copilot case).
      const pendingReply = payload.pendingResponses.map((pr) => pr.message).join("\n\n");
      if (!resultWithCitations.trim() && pendingReply.trim() && ctx.conversationId && ctx.agentSlug) {
        chatMessageRepository.create({
          conversationId: ctx.conversationId,
          agentSlug: ctx.agentSlug,
          userId: ctx.senderId,
          role: "assistant",
          content: pendingReply,
          status: "completed",
          ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
        }).catch((e) => log.warn("Failed to save pending-response assistant ChatMessage", { error: e instanceof Error ? e.message : String(e) }));
      }

      // Post pending write action approvals (e.g. spaces-memory-create) before returning
      const copilotPendingActions = (payload as { pendingActions?: Array<Record<string, unknown>> }).pendingActions;
      if (copilotPendingActions?.length) {
        for (const action of copilotPendingActions) {
          const actionDesc = formatActionDescription(action["tool"] as string, action["params"] as Record<string, unknown>);

          const writeFlow = buildWriteApprovalFlow(actionDesc, {
            serverType: action["serverType"] as string,
            tool: action["tool"] as string,
            params: action["params"] as Record<string, unknown>,
            userId: action["userId"] as string,
            signature: action["signature"] as string,
            agentSlug: ctx.agentSlug ?? "",
          });

          if (action["tool"] === "spaces-memory-create" && (action["params"] as Record<string, unknown>)?.["content"]) {
            const memParams = action["params"] as Record<string, unknown>;
            const memContent = memParams["content"] as string;
            const memDocType = (memParams["docType"] as string) ?? "fact";
            const form = new FormData();
            const blob = new Blob([memContent], { type: "text/markdown" });
            form.append("files", blob, `memory-${memDocType}-${Date.now()}.md`);
            form.append("channelId", ctx.channelId);
            form.append("conversationId", ctx.conversationId);
            form.append("userId", ctx.spacesAppUserId);
            form.append("flow", JSON.stringify(writeFlow));
            await spacesAppFetchMultipart("/files/filesUpload", form, token);
          } else {
            await spacesAppFetch("/chat/postMessage", {
              channelId: ctx.channelId,
              conversationId: ctx.conversationId,
              flow: writeFlow,
              userId: ctx.spacesAppUserId,
            }, token);
          }
        }
        log.info(`Copilot: posted ${copilotPendingActions.length} write action approval(s)`);
      }

      // Don't delete session — copilot sessions persist for multi-turn
      return;
    }

    if (ctx.responseMode === "approval") {
      // Digital Twin: everything goes through an approve/decline DM. Return
      // immediately — don't post pendingQuestions/pendingActions/chain
      // notifications to the originating thread.
      await sendDigitalTwinApprovalDm(ctx, resultWithCitations, payload.attachments, sessionId);
      return;
    } else {
      // ── Agent conversation mode: edit the progress placeholder in-place,
      // or post a new message if no placeholder exists ──
      const convMetadata = { contentFormat: "markdown" };
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
            { error: err instanceof Error ? err.message : String(err) },
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
            log.warn("Failed to update placeholder with final result — falling back to fresh post", { error: err instanceof Error ? err.message : String(err) });
          }
        }
        if (!posted) {
          log.info(`Posting result: channelId=${ctx.channelId} conversationId=${ctx.conversationId} resultLen=${prepared.text.length} userId=${ctx.spacesAppUserId}`);
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
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
            const refire = { ...decision.runPayload, task: decision.nextTurnTask };
            const runUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run`;
            void fetch(runUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
              },
              body: JSON.stringify(refire),
            }).catch((err) => {
              log.warn("[goal] refire failed", { error: err instanceof Error ? err.message : String(err) });
            });
            log.info(`[goal] continuing for conv ${ctx.conversationId}`);
          }
        } catch (err) {
          log.warn("[goal] relooper hook errored — leaving goal in current state", {
            error: err instanceof Error ? err.message : String(err),
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
          const agentRow = await agentRepository.findBySlug(ctx.agentSlug);
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
            const KNOWN = new Set(["codex", "claude", "copilot", "openrouter"]);
            const rawOrder = (agentRow.config as Record<string, unknown> | null)?.["providerOrder"];
            const order: string[] = Array.isArray(rawOrder)
              ? rawOrder.filter((p): p is string => typeof p === "string" && KNOWN.has(p))
              : [];
            const legacy = (agentRow.config as Record<string, unknown> | null)?.["provider"] as string | undefined;
            const candidate = isAlwaysOn
              ? undefined
              : (order.find(hasCreds) ?? (legacy && KNOWN.has(legacy) && hasCreds(legacy) ? legacy : undefined));
            if (candidate) {
              const flow = buildPromoteProviderFlow(candidate, {
                agentSlug: ctx.agentSlug,
                channelId: ctx.channelId,
                conversationId: ctx.conversationId,
                userId: ctx.senderId,
                originalTask: ctx.task,
              });
              await spacesAppFetch("/chat/postMessage", {
                channelId: ctx.channelId,
                conversationId: ctx.conversationId,
                flow,
                userId: ctx.spacesAppUserId,
              }, token).catch((err) => {
                log.warn("Failed to post promote-provider prompt (soft refusal)", { error: err instanceof Error ? err.message : String(err) });
              });
              log.info(`Posted promote-provider prompt for conv ${ctx.conversationId} (soft refusal, provider=${candidate})`);
            }
          }
        } catch (err) {
          log.warn("promote-provider prompt (soft refusal) error (non-fatal)", { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    // ── Post question buttons in thread ──
    const pendingQuestions = (payload as { pendingQuestions?: Array<{ questionId: string; question: string; options: string[] }> }).pendingQuestions;
    if (pendingQuestions?.length) {
      for (const q of pendingQuestions) {
        const questionFlow = buildUserQuestionFlow(q.question, q.options, {
          questionId: q.questionId,
          agentSlug: ctx.agentSlug ?? "",
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          userId: ctx.senderId,
        });
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          flow: questionFlow,
          userId: ctx.spacesAppUserId,
        }, token);
      }
      log.info(`Posted ${pendingQuestions.length} question(s) in thread ${ctx.conversationId}`);
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
      // Newline-strip + length-cap defensively: matches parseSlashCommand's
      // cap so manually-typed and button-fired goals behave identically.
      const safeCondition = goalSuggestion.condition.replace(/\r?\n/g, " ").slice(0, 2_000);
      const safeRationale = goalSuggestion.rationale.replace(/\r?\n/g, " ").slice(0, 400);
      const goalFlow = buildGoalSuggestionFlow(safeRationale, {
        condition: safeCondition,
        agentSlug: ctx.agentSlug ?? "",
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        userId: ctx.senderId,
      });
      await spacesAppFetch("/chat/postMessage", {
        channelId: ctx.channelId,
        conversationId: ctx.conversationId,
        flow: goalFlow,
        userId: ctx.spacesAppUserId,
      }, token).catch((err) => {
        log.warn("Failed to post /goal suggestion FlowUI card", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      log.info(`Posted /goal suggestion in thread ${ctx.conversationId}`);
    }

    // ── Send approval DMs for pending write actions (HITL) ──
    const pendingActionsPayload = (payload as { pendingActions?: Array<Record<string, unknown>> }).pendingActions;
    if (pendingActionsPayload?.length) {
      for (const action of pendingActionsPayload) {
        const actionDesc = formatActionDescription(action["tool"] as string, action["params"] as Record<string, unknown>);

        const writeFlow = buildWriteApprovalFlow(actionDesc, {
          serverType: action["serverType"] as string,
          tool: action["tool"] as string,
          params: action["params"] as Record<string, unknown>,
          userId: action["userId"] as string,
          signature: action["signature"] as string,
          agentSlug: ctx.agentSlug ?? "",
        });

        // Post in the same thread where the conversation happened
        if (action["tool"] === "spaces-memory-create" && (action["params"] as Record<string, unknown>)?.["content"]) {
          const memParams = action["params"] as Record<string, unknown>;
          const memContent = memParams["content"] as string;
          const memDocType = (memParams["docType"] as string) ?? "fact";
          const form = new FormData();
          const blob = new Blob([memContent], { type: "text/markdown" });
          form.append("files", blob, `memory-${memDocType}-${Date.now()}.md`);
          form.append("channelId", ctx.channelId);
          form.append("conversationId", ctx.conversationId);
          form.append("userId", ctx.spacesAppUserId);
          form.append("flow", JSON.stringify(writeFlow));
          await spacesAppFetchMultipart("/files/filesUpload", form, token);
        } else {
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            flow: writeFlow,
            userId: ctx.spacesAppUserId,
          }, token);
        }
      }

      log.info(`Sent ${pendingActionsPayload.length} write action approval(s) to ${ctx.senderId}`);
    }

    // ── Agent chaining: channel-level workflow keyed by (channelId, rootAgentSlug) ──
    if (ctx.agentSlug) {
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
        const targetAgentRow = await agentRepository.findBySlug(targetAgentSlug);
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
            agentSlug: targetAgentSlug,
            responseMode: "conversation",
            appToken: targetAppToken,
            spacesAppId: targetAgentRow.spacesAppId,
            spacesAppUserId: targetAgentRow.spacesAppUserId ?? "",
            chainDepth: currentDepth + 1,
            rootAgentSlug,
            workflowId: binding.workflowId,
            ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
          };
          await setSession(runBody.sessionId, targetContext);
          await registerRunRecovery({
            rootSessionId: runBody.sessionId,
            maxRetries: CONFIG.runRecoveryMaxRetries,
            timeoutMs: CONFIG.runRecoveryTimeoutMs,
            retryBackoffMs: CONFIG.runRecoveryBackoffMs,
            dispatchPayload: {
              userId: ctx.senderId,
              task: interpolatedTask,
              context: handoffContext,
              conversationId: ctx.conversationId,
              agentSlug: targetAgentSlug,
              eventType: "APP_MENTIONED",
              traceId: ctx.traceId ?? runBody.sessionId,
              ...(forwardedAttachments.length > 0 ? { attachments: forwardedAttachments } : {}),
              callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/result`,
              progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
              channelId: ctx.channelId,
            },
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
        log.error("Chain trigger failed (non-fatal):", { error: chainErr instanceof Error ? chainErr.message : String(chainErr) });
      }
    }
  } catch (err) {
    // Include enough context to diagnose env-mismatch / token / channel
    // issues from logs alone. Earlier the catch only surfaced `err.message`,
    // which didn't tell us whether the failure was openDm, postMessage,
    // updateMessage, or a token issue — and the relevant identifiers (which
    // workspace, which agent, which mode) were left implicit. Add them.
    log.error("Failed to send result", {
      error: err instanceof Error ? err.message : String(err),
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
});

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

  if (!sessionId) return;

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
      log.warn("Failed to announce sandbox preview", { error: err instanceof Error ? err.message : String(err) });
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
    log.warn("Failed to publish agent progress signal", { error: err instanceof Error ? err.message : String(err) });
  }
});

// Register the agent-specific webhook route (AFTER /result to avoid param catch).
// `verifySpacesSignature` HMAC-checks the body using the agent's per-app
// signing secret stored in agents.signingSecret. It fails closed by default;
// SPACES_WEBHOOK_VERIFY_MODE=warn is only an explicit rollout escape hatch.
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
router.post("/:agentSlug", async (req: Request, res: Response): Promise<void> => {
  const agentSlug = req.params["agentSlug"];
  if (typeof agentSlug !== "string" || !agentSlug) {
    res.status(400).json({ success: false, error: "agentSlug is required" });
    return;
  }

  const isAutomationRequest = s2sKeyMatches(req.headers["x-s2s-key"]);

  let verified = false;
  await verifySpacesSignature(req, res, () => {
    verified = true;
  });
  if (!verified || res.headersSent) return;

  if (isAutomationRequest) {
    await handleAutomationWebhook(req, res, agentSlug);
    return;
  }

  if (req.headers["x-xyne-event"] === "flow_action") {
    // Proxy to the flow-action handler (same process, different route)
    let proxyRes: Response | undefined;
    try {
      // Forward the ORIGINAL raw body bytes plus the Spaces signature and the
      // agent slug so /flow/action can re-verify the per-agent HMAC itself.
      // Re-serializing req.body would change the bytes and break the HMAC;
      // the signature is what binds context.userId (the clicking user) to
      // Spaces — without it, any holder of the S2S key could forge identity.
      const sigHeader = req.headers["x-xyne-signature"];
      const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
      proxyRes = (await fetch(`${CONFIG.internalUrl}/claw/api/v1/flow/action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
          ...(typeof sigHeader === "string" ? { "x-xyne-signature": sigHeader } : {}),
          "x-agent-slug": req.params["agentSlug"] ?? "",
        },
        body: rawBody ?? JSON.stringify(req.body),
      })) as unknown as Response;
    } catch (err) {
      clog.error(`[webhook/flow-action-proxy] fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      res.status(502).json({ type: "error", message: "flow-action proxy failed" });
      return;
    }
    const text = await (proxyRes as unknown as { text: () => Promise<string> }).text();
    res.status((proxyRes as unknown as { status: number }).status).type("application/json").send(text);
    return;
  }
  return handleWebhook(req, res);
});

export { router as webhookRouter };
