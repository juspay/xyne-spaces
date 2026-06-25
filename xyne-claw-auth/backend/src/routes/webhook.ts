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
} from "../repositories/index.js";
import { extractCodexBearer } from "../lib/codex-creds.js";
import { expandSpacesMentions, resolveUnboundMentions } from "../lib/mention-transform.js";
import { verifySpacesSignature } from "../middleware/verify-spaces-signature.js";
import { parseSlashCommand } from "../lib/parseSlashCommand.js";
import { handleSlashCommandBeforeRun, persistGoalStart, recordTurnAndDecide } from "../services/goalRelooper.js";
import { createTraceId, createLogger } from "../logger.js";
import { decrypt } from "../crypto.js";
import { prisma } from "../db.js";
import { redisService } from "../redis.js";
import { UNREGISTERED_USER_TEMPLATE } from "../constants.js";
import {
  registerRunRecovery,
  touchRunRecovery,
  handleRunCompletion,
  getRecoveryContextForSession,
} from "../queue/run-recovery-worker.js";
import { appendCitations, appendClawCitationTokens } from "../lib/citations.js";
import { getSpacesAuthForUser } from "../lib/spaces-db.js";
import { ensureUserExists } from "../lib/users-jit.js";
import { requireS2S } from "../middleware/require-auth.js";
import { renderAttachmentsToPdf } from "../lib/result-pdf.js";
import { renderMarkdownToHtml } from "../lib/result-html.js";
import JSZip from "jszip";

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
      console.warn(`[chain-judge] xyne-claw returned ${res.status}, defaulting to continue`);
      return "continue";
    }

    const data = (await res.json()) as { success: boolean; data?: { action: string; reason: string } };
    if (data.success && data.data) {
      console.log(`[chain-judge] ${sourceAgent} → ${targetAgent}: ${data.data.action} (${data.data.reason})`);
      return data.data.action === "stop" ? "stop" : "continue";
    }

    return "continue";
  } catch (err) {
    console.warn(`[chain-judge] Failed, defaulting to continue:`, err instanceof Error ? err.message : err);
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
   * Workspace ID of the mentioned user for Digital Twin (USER_MENTIONED)
   * flows. Captured at webhook-receive time via getSpacesAuthForUser and
   * threaded all the way to the Approve-button context so app-callback can
   * forward it to Spaces' /api/internal/postAsUser — which REQUIRES
   * workspaceId to mint a JWT for the user. Without this, the Twin's
   * response generates fine but can never post.
   */
  workspaceId?: string;
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
 */
async function getSessionByConv(
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
  } = {},
): Promise<{ text: string; attachments: OutgoingAttachment[] }> {
  // First: resolve unbracketed `@Name` and `@email` mentions to
  // `@Name[userId]` via Spaces' user-search and python-query endpoints —
  // but only when we have the triggering human's session token. Limit=2
  // on both so we can detect ambiguity and skip those (no false-pings).
  let resolved = rawText;
  if (meta.senderSpacesToken) {
    const baseHeaders: Record<string, string> = {
      Authorization: `Bearer ${meta.senderSpacesToken}`,
    };
    if (meta.senderSpacesSessionId) {
      baseHeaders["x-session-id"] = meta.senderSpacesSessionId;
      baseHeaders["Cookie"] = `xyne_session=${meta.senderSpacesSessionId}; user_session_id=${meta.senderSpacesSessionId}`;
    }
    if (meta.senderWorkspaceId) baseHeaders["x-workspace-id"] = meta.senderWorkspaceId;

    resolved = await resolveUnboundMentions(rawText, {
      // Name lookup → `/api/users/search` (name.startsWith, name-only).
      byName: async (name) => {
        const qs = new URLSearchParams({ q: name, limit: "2" });
        const url = `${CONFIG.spacesInternalUrl}/api/users/search?${qs.toString()}`;
        try {
          const res = await fetch(url, { headers: baseHeaders, signal: AbortSignal.timeout(5_000) });
          if (!res.ok) return [];
          const body = (await res.json()) as { data?: Array<{ id: string; name: string }> };
          return body.data ?? [];
        } catch {
          return [];
        }
      },
      // Email lookup → `/api/query` (python query gateway). Goes through
      // UsersACL → workspaceId-scoped. The search endpoint above only does
      // name.startsWith and would miss emails entirely.
      byEmail: async (email) => {
        const url = `${CONFIG.spacesInternalUrl}/api/query`;
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { ...baseHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "user",
              operation: "findMany",
              where: { email: { equals: email, mode: "insensitive" } },
              take: 2,
            }),
            signal: AbortSignal.timeout(5_000),
          });
          if (!res.ok) return [];
          const body = (await res.json()) as { data?: Array<{ id: string; name: string; email: string }> };
          return (body.data ?? []).map((u) => ({ id: u.id, name: u.name }));
        } catch {
          return [];
        }
      },
    });
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
    console.warn(`[spaces-retry] ${label} got ${status} — retrying once after 2s`);
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

    const lines = items.map(
      (m) => `[${new Date(m.createdAt).toISOString()}] ${m.userId}: ${m.cleanContent}`,
    );
    return `Thread history (oldest → newest):\n${lines.join("\n")}`;
  } catch (err) {
    console.warn("[webhook] Failed to fetch conversation history:", err);
    return undefined;
  }
}

function buildAppActionFrontmatter(
  result: string,
  channelId: string,
  conversationId: string,
  mentionedUserId: string,
  workspaceId: string,
  senderName: string,
  channelName: string,
  task: string,
): string {
  const approveId = crypto.randomUUID();
  const declineId = crypto.randomUUID();
  const callbackBase = `${CONFIG.selfUrl}/claw/api/v1/app/callback`;

  const contextHeader = `**${senderName}** mentioned you in **#${channelName}**:\n> ${task}\n\n---\n\nHere's the response I'd send on your behalf:\n\n`;

  // workspaceId is REQUIRED in the Approve context — Spaces' /api/internal/postAsUser
  // refuses to mint a JWT for the user without it, so the Twin reply
  // never posts. Captured at webhook-receive time, threaded through here.
  const frontmatter = [
    "---",
    "appActions:",
    `  - actionId: "${approveId}"`,
    `    label: "Approve"`,
    `    type: "button"`,
    `    color: "#22c55e"`,
    `    actionableUrl: "${callbackBase}"`,
    `    context:`,
    `      targetChannelId: "${channelId}"`,
    `      targetConversationId: "${conversationId}"`,
    `      mentionedUserId: "${mentionedUserId}"`,
    `      workspaceId: "${workspaceId}"`,
    `      messageContent: ${JSON.stringify(result)}`,
    `  - actionId: "${declineId}"`,
    `    label: "Decline"`,
    `    type: "button"`,
    `    color: "#ef4444"`,
    `    actionableUrl: "${callbackBase}"`,
    `    context:`,
    `      mentionedUserId: "${mentionedUserId}"`,
    "---",
    "",
    contextHeader + result,
  ];

  return frontmatter.join("\n");
}

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
  // and threaded through SessionContext + the Approve-button frontmatter so
  // app-callback can pass it to /api/internal/postAsUser. Spaces refuses to
  // post on the user's behalf without it.
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

  // ── /goal slash command interception ─────────────────────────────────────
  // Recognised forms: `/goal <condition>`, `/goal status`, `/goal clear`,
  // `/stop`. Status/clear short-circuit before claw is invoked; goal-start
  // rewrites the worker's first-turn task to the relooper template and
  // stashes context for subsequent loop turns (recording happens after
  // run-dispatch below, once dispatchPayload is assembled).
  const slash = parseSlashCommand(userText);
  const intercept = await handleSlashCommandBeforeRun({ command: slash, conversationId: payload.conversationId });
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
  } else if (intercept.kind === "goalStarted") {
    pendingGoalStart = { condition: intercept.condition };
    task = intercept.firstTurnTask;
    await spacesAppFetch("/chat/postMessage", {
      channelId: payload.channelId,
      conversationId: payload.conversationId,
      markdownText: intercept.replyToUser,
      userId: agent.spacesAppUserId,
      metadata: { contentFormat: "markdown" },
    }, agent.appToken).catch((err) => {
      log.warn("Failed to post /goal start ack", { error: err instanceof Error ? err.message : String(err) });
    });
  } else {
    task = userText;
  }

  try {
    // Fetch thread history to give the agent context (exclude own messages to avoid duplication on resume)
    const history = await fetchConversationHistory(payload.conversationId, agent.appToken, agent.spacesAppUserId);

    // For USER_MENTIONED: run as the mentioned user (their tools, their twin)
    const allMentionedIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];
    const targetUserId = eventType === "USER_MENTIONED" && allMentionedIds.length > 0
      ? allMentionedIds[0]! : payload.userId;

    // Resolve agent config (repoUrl, skills)
    const agentRow = await agentRepository.findBySlugWithRelations(agent.slug);
    const repoUrl = (agentRow?.config as Record<string, unknown> | null)?.["repoUrl"] as string | undefined;
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
        // Codex OAuth-mode stores a JSON bundle ({access_token,refresh_token,expires_at}).
        // Pull out the bare access_token so downstream sees a usable Bearer string.
        const apiKey = provider === "codex" ? extractCodexBearer(decrypted) : decrypted;
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

    // Build providerConfigs: user-level first (always wins), then agent-level
    // fills in any provider the user hasn't configured personally.
    const providerConfigs: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string; reasoningEffort?: string }> = {};
    const providerScope: Record<string, "user" | "agent"> = {};
    for (const [provider, row] of credsByProvider) {
      const cfg = buildProviderConfig(provider, row);
      if (cfg) {
        providerConfigs[provider] = cfg;
        providerScope[provider] = "user";
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

    // Resolution: personal provider (user-level) always wins. Otherwise
    // providerOrder is canonical when set — first entry with resolved creds
    // becomes the parent, and the full list is threaded to claw for
    // multi-step quota fallback. Legacy `config.provider` is kept as a
    // single-element fallback for agents that haven't migrated yet.
    let resolvedParentProvider = personalProvider;
    if (!resolvedParentProvider && agentProviderOrder.length > 0) {
      resolvedParentProvider = agentProviderOrder.find((p) => providerConfigs[p]) ?? agentProviderOrder[0];
    }
    if (!resolvedParentProvider && agentLevelProvider) {
      resolvedParentProvider = agentLevelProvider;
    }
    const runtimeProviderOrder: string[] = agentProviderOrder.length > 0
      ? agentProviderOrder
      : (resolvedParentProvider ? [resolvedParentProvider] : []);

    log.info(`Provider resolution: parent=${resolvedParentProvider ?? "spaces"} scope=${resolvedParentProvider ? (providerScope[resolvedParentProvider] ?? "fallback") : "platform"} creds=[${Object.keys(providerConfigs).join(",")}] order=[${runtimeProviderOrder.join(",")}] subagentOverrides=${JSON.stringify(subagentProviders)}`);

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

    const runUrl = `${CONFIG.internalUrl}/claw/api/v1/run`;
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
              context: `## Thread Awareness\nYou are in a group thread in Xyne Spaces where multiple users and agents can participate. The thread history below shows messages from other participants — use it to understand context. Your own previous messages are NOT included here (they are already in your session). If you need more context, use spaces-messages or spaces-message-detail to read the full thread.\n\n${history}`
            }
          : {}),
        ...(repoUrl ? { repoUrl } : {}),
        ...(agentSkills && agentSkills.length > 0 ? { skills: agentSkills } : {}),
        ...(resolvedParentProvider ? { provider: resolvedParentProvider } : {}),
        ...(runtimeProviderOrder.length > 1 ? { providerOrder: runtimeProviderOrder } : {}),
        ...(Object.keys(subagentProviders).length > 0 ? { subagentProviders } : {}),
        ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
        ...(inboundAttachments.length > 0 ? { attachments: inboundAttachments } : {}),
        // Ship the agent's JSONB config so xyne-claw can enable per-agent
        // features that read from it: memoryEnabled (memory-search tool),
        // toolPermissions (per-tool deny/ask), skillTriggers, promptInjections,
        // and custom-tool config values (PPT_API_KEY etc). Without this,
        // those features silently default to "off"/"allow" on Spaces mentions.
        ...(agentRow?.config ? { agentConfig: agentRow.config as Record<string, unknown> } : {}),
      }),
    });

    const body = (await runRes.json()) as { success: boolean; sessionId?: string };

    if (body.success && body.sessionId) {
      const mentionedUserIds = (payload as { mentionedUserIds?: string[] }).mentionedUserIds ?? [];

      // Progress signal to the dashboard. Two paths, switched by flag:
      //   USE_EPHEMERAL_PROGRESS=true  → POST /chat/agentProgress (requires Spaces XYNE-12145)
      //   USE_EPHEMERAL_PROGRESS=false → POST /chat/postMessage for a "⏳ Working on it..."
      //                                  placeholder; we capture messageId and edit it later.
      let progressMessageId: string | undefined;
      if (eventType !== "USER_MENTIONED") {
        try {
          if (USE_EPHEMERAL_PROGRESS) {
            await spacesAppFetch("/chat/agentProgress", {
              conversationId: payload.conversationId,
              channelId: payload.channelId,
              agentSlug: agent.slug,
              userId: agent.spacesAppUserId,
              sessionId: body.sessionId,
              toolLabel: "Working on it...",
              status: "working",
              triggeredByUserId: payload.userId,
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
        ...(progressMessageId ? { progressMessageId } : {}),
        ...(twinWorkspaceId ? { workspaceId: twinWorkspaceId } : {}),
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
        ...(history ? { context: `## Thread Awareness\nYou are in a group thread in Xyne Spaces where multiple users and agents can participate. The thread history below shows messages from other participants — use it to understand context. Your own previous messages are NOT included here (they are already in your session). If you need more context, use spaces-messages or spaces-message-detail to read the full thread.\n\n${history}` } : {}),
        ...(repoUrl ? { repoUrl } : {}),
        ...(agentSkills && agentSkills.length > 0 ? { skills: agentSkills } : {}),
        ...(resolvedParentProvider ? { provider: resolvedParentProvider } : {}),
        ...(runtimeProviderOrder.length > 1 ? { providerOrder: runtimeProviderOrder } : {}),
        ...(Object.keys(subagentProviders).length > 0 ? { subagentProviders } : {}),
        ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
        ...(inboundAttachments.length > 0 ? { attachments: inboundAttachments } : {}),
        // Same agentConfig pass-through as the primary /run dispatch above —
        // run-recovery retries must see memoryEnabled/skillTriggers/etc.
        ...(agentRow?.config ? { agentConfig: agentRow.config as Record<string, unknown> } : {}),
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

// ── POST /webhook — S2S entrypoint for external systems (xyne-spaces automations) ──
//
// Why this route exists, and why we don't reuse `/run`:
//   - `POST /claw/api/v1/run` (run.ts:243) is the user-facing dispatcher — it
//     reads cookies via `requireAuth`, only opens the S2S backdoor for testing,
//     and runs ~230 lines of attached-context / mention-expansion / chat-message
//     bookkeeping the spaces automation engine doesn't need (and shouldn't
//     trigger). Routing automations through it conflates two clients.
//   - `POST /:agentSlug` (this file, ~2680) is the public mention-webhook —
//     verifies a per-agent HMAC and resolves identity from a spaces userId
//     payload. Wrong shape for the automation engine, which is sending
//     `{sessionId, agentSlug, task, userId, callbackUrl, context?}` already.
// So we accept exactly the shape spaces is sending today (claw-client.ts:97),
// validate, record the run for Control Center, and proxy to claw-pod's /run.
//
// Auth: x-s2s-key matching CONFIG.xyneClawS2sKey. Same XYNE_CLAW_S2S_KEY env
// var that spaces already sets — see xyne-spaces/backend/src/config/env.ts:270.

router.post("/", requireS2S, async (req: Request, res: Response) => {
  const payload = req.body as {
    sessionId?: string;
    agentSlug?: string;
    task?: string;
    userId?: string;
    callbackUrl?: string;
    context?: string;
    conversationId?: string | null;
    channelId?: string | null;
  };

  const { sessionId, agentSlug, task, userId, callbackUrl, context } = payload;

  // Field validation — fail fast with specific errors so the spaces side can
  // surface the actual problem instead of a generic 500 from claw-pod.
  const missing: string[] = [];
  if (!sessionId) missing.push("sessionId");
  if (!agentSlug) missing.push("agentSlug");
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
  const agent = await agentRepository.findBySlug(agentSlug!);
  if (!agent) {
    res.status(404).json({ success: false, error: `agent "${agentSlug}" not found` });
    return;
  }
  if (!agent.enabled) {
    res.status(403).json({ success: false, error: `agent "${agentSlug}" is disabled` });
    return;
  }

  // Create the AgentRun row up front so the v3 Control Center sees the run
  // start, the same way the user-facing /run path does. Without this, runs
  // initiated by spaces automations would only appear in CC after the
  // /webhook/result callback fired, which can be minutes later for slow runs.
  try {
    await agentRunRepository.start({
      sessionId: sessionId!,
      userId: userId!,
      agentSlug: agentSlug!,
      triggerSource: "api",
      task: task!,
      ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
      ...(payload.channelId ? { channelId: payload.channelId } : {}),
    });
  } catch (err) {
    // Non-fatal: if the AgentRun row collides on sessionId (retry from the
    // automation engine), we still want to forward the run. The run rows
    // get reconciled by /webhook/result's update.
    console.warn(`[webhook] AgentRun.start non-fatal failure for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Proxy to claw-pod's internal /run. We pass through callbackUrl as-is —
  // claw-pod will POST the final result to that URL directly when the agent
  // completes, NOT route it back through us. (run.ts in claw-pod calls
  // sendCallback(callbackUrl, ...) at line ~1049.)
  let runRes: Response | undefined;
  try {
    runRes = (await fetch(`${CONFIG.internalUrl}/claw/api/v1/run`, {
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
        callbackUrl,
        ...(context ? { context } : {}),
      }),
    })) as unknown as Response;
  } catch (err) {
    console.error(`[webhook] forward to claw-pod failed for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
    res.status(502).json({ success: false, error: "failed to reach claw-pod" });
    return;
  }

  // Pass through claw-pod's response code + body so the automation engine
  // can distinguish "claw rejected" from "claw-auth rejected".
  const text = await (runRes as unknown as { text: () => Promise<string> }).text();
  res.status((runRes as unknown as { status: number }).status).type("application/json").send(text);
});

// ── POST /webhook/result — callback from xyne-claw (MUST be before /:agentSlug) ──

router.post("/result", requireS2S, async (req: Request, res: Response) => {
  const payload = req.body as {
    sessionId?: string;
    userId?: string;
    status?: string;
    result?: string;
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
    provider?: string;
    // Conversation identity claw ships on every callback (see
    // xyne-claw/src/routes/run.ts:1040-1046). Used by the conv-keyed
    // fallback below — needed because /goal refires (and other code paths
    // that re-dispatch /run) mint a fresh sessionId that claw-auth never
    // registered, so the per-sessionId lookup misses.
    conversationId?: string | null;
    agentSlug?: string | null;
  };

  const sessionId = payload.sessionId ?? "";

  // Acknowledge immediately
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
      console.warn(`[webhook/result] Twin suffix lookup failed for user ${ctx.mentionedUserId}: ${err instanceof Error ? err.message : String(err)}`);
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

  // Append `[clf-<toolCallId>#<chunkIndex>]` tokens from each
  // ToolInvocation.citations so Desk's DraftSourcesPanel can resolve clickable
  // sources (e.g. Grafana). The autodraft path stores this as the assistant
  // ChatMessage getConversationInsight reads back. Gated by
  // CLAW_INLINE_CITATIONS (default off) — see config.ts.
  if (CONFIG.clawInlineCitations) {
    resultWithCitations = appendClawCitationTokens(resultWithCitations, payload.toolInvocations);
  }

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

  // Finalize the AgentRun record (fire-and-forget)
  if (sessionId) {
    const status = payload.status === "completed" ? "completed" : "failed";
    agentRunRepository.finalize(sessionId, {
      status,
      result: payload.result !== undefined ? resultWithCitations : null,
      error: payload.error ?? null,
      toolsUsed: payload.toolsUsed ?? [],
      ...(payload.toolInvocations !== undefined ? { toolInvocations: payload.toolInvocations } : {}),
      ...(payload.tokenUsage ? { tokenUsage: payload.tokenUsage } : {}),
      ...(payload.latency ? { latency: payload.latency } : {}),
    }).catch(() => {});
  }

  if (payload.status === "completed") {
    await handleRunCompletion(sessionId, "completed").catch((err) => {
      console.warn(`[webhook/result] Failed to mark ${sessionId} completed in run recovery:`, err instanceof Error ? err.message : err);
    });
  }

  if (payload.status === "failed") {
    const recoveryFailure = await handleRunCompletion(sessionId, "failed", payload.error).catch((err) => {
      console.warn(`[webhook/result] Failed to process ${sessionId} failure in run recovery:`, err instanceof Error ? err.message : err);
      return null;
    });

    if (recoveryFailure?.retried) {
      console.log(`[webhook/result] Session ${sessionId}: retry queued (${recoveryFailure.retriesUsed}/${recoveryFailure.maxRetries})`);
      return;
    }
  }

  if (payload.status !== "completed") {
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
        }

        if (chain?.onFailure?.triggerAgent) {
          const runUrl = `${CONFIG.internalUrl}/claw/api/v1/run`;
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
          if (!runRes.ok) {
            console.error(`[webhook/result] Failure chain trigger HTTP ${runRes.status}`);
            if (USE_EPHEMERAL_PROGRESS) {
              spacesAppFetch("/chat/agentProgress", {
                conversationId: ctx.conversationId,
                channelId: ctx.channelId,
                agentSlug: ctx.agentSlug,
                userId: ctx.spacesAppUserId,
                ...(sessionId ? { sessionId } : {}),
                status: "done",
              }, ctx.appToken).catch((err) =>
                console.warn("[webhook/result] Failed to clear progress on chain-trigger failure:", err instanceof Error ? err.message : err),
              );
            }
            return;
          }
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
          console.log(`[webhook/result] Failure chain: ${ctx.agentSlug} → ${chain.onFailure.triggerAgent}`);
        }
      } catch (chainErr) {
        console.error("[webhook/result] Failure chain error (non-fatal):", chainErr);
      }
    }
    if (USE_EPHEMERAL_PROGRESS && ctx) {
      spacesAppFetch("/chat/agentProgress", {
        conversationId: ctx.conversationId,
        channelId: ctx.channelId,
        agentSlug: ctx.agentSlug,
        userId: ctx.spacesAppUserId,
        ...(sessionId ? { sessionId } : {}),
        status: "done",
      }, ctx.appToken).catch((err) =>
        console.warn("[webhook/result] Failed to clear progress on non-complete:", err instanceof Error ? err.message : err),
      );
    }
    return;
  }

  if (!ctx) {
    console.warn(`[webhook/result] No session context for ${sessionId}`);
    return;
  }

  const log = createLogger("webhook/result", ctx.traceId ?? sessionId.slice(0, 8));
  log.info(`status=${payload.status}, resultLength=${resultWithCitations.length}`);

  // Clear the ephemeral agent progress signal — dashboard drops the spinner.
  // Only fires in the ephemeral path; the placeholder path clears naturally
  // when we edit the "⏳" message with the final result below.
  if (USE_EPHEMERAL_PROGRESS) {
    await spacesAppFetch("/chat/agentProgress", {
      conversationId: ctx.conversationId,
      channelId: ctx.channelId,
      agentSlug: ctx.agentSlug,
      userId: ctx.spacesAppUserId,
      ...(sessionId ? { sessionId } : {}),
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
    }).catch((e) => log.warn("Failed to save assistant ChatMessage", { error: e instanceof Error ? e.message : String(e) }));
  }

  // Notify user if result is empty (but not if copilot has pendingResponses)
  if (!resultWithCitations.trim() && !payload.pendingResponses?.length) {
    if (ctx.responseMode === "approval") {
      log.warn("Empty result in approval mode — skipping (no thread message)");
      await deleteSession(sessionId);
      return;
    }

    log.warn("Empty result — notifying user");
    try {
      const token = ctx.appToken;
      const sorryText = "Sorry, I wasn't able to produce a response. Please try sending your message again.";
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

        const messageContent = buildAppActionFrontmatter(
          combinedResult,
          ctx.channelId,
          ctx.conversationId,
          ctx.mentionedUserId,
          ctx.workspaceId ?? "",
          ctx.senderName,
          ctx.channelName,
          ctx.task,
        );

        const metadata = { hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" };
        await spacesAppFetch("/chat/postMessage", {
          channelId: dmResult.channelId,
          markdownText: messageContent,
          userId: ctx.spacesAppUserId,
          metadata,
        }, token);

        log.info(`Digital Twin (copilot): sent approve/decline DM to ${ctx.mentionedUserId}`);
        await deleteSession(sessionId);
        return;
      }

      if (payload.attachments?.length) {
        const form = new FormData();
        for (const att of payload.attachments) {
          const buffer = Buffer.from(att.data, "base64");
          const blob = new Blob([buffer], { type: att.mimeType });
          form.append("files", blob, att.fileName);
        }
        form.append("channelId", ctx.channelId);
        form.append("conversationId", ctx.conversationId);
        form.append("userId", ctx.spacesAppUserId);
        form.append("markdownText", payload.pendingResponses.map((pr) => pr.message).join("\n\n"));
        form.append("metadata", JSON.stringify({ contentFormat: "markdown" }));
        await spacesAppFetchMultipart("/files/filesUpload", form, token);
        log.info(`Copilot: uploaded ${payload.attachments.length} attachment(s) with response(s) in thread ${ctx.conversationId}`);
      } else {
        for (const pr of payload.pendingResponses) {
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            markdownText: pr.message,
            userId: ctx.spacesAppUserId,
            metadata: { contentFormat: "markdown" },
          }, token);
        }
        log.info(`Copilot: posted ${payload.pendingResponses.length} response(s) in thread ${ctx.conversationId}`);
      }

      // Post pending write action approvals (e.g. spaces-memory-create) before returning
      const copilotPendingActions = (payload as { pendingActions?: Array<Record<string, unknown>> }).pendingActions;
      if (copilotPendingActions?.length) {
        for (const action of copilotPendingActions) {
          const actionDesc = formatActionDescription(action["tool"] as string, action["params"] as Record<string, unknown>);
          const approveId = crypto.randomUUID();
          const declineId = crypto.randomUUID();

          const actionMsg = [
            "---",
            "appActions:",
            `  - actionId: "${approveId}"`,
            `    label: "Approve"`,
            `    type: "button"`,
            `    color: "#22c55e"`,
            `    actionableUrl: "${CONFIG.selfUrl}/claw/api/v1/app/callback"`,
            `    context:`,
            `      actionType: "write"`,
            `      serverType: "${action["serverType"] as string}"`,
            `      tool: "${action["tool"] as string}"`,
            `      params: ${JSON.stringify(JSON.stringify(action["params"]))}`,
            `      userId: "${action["userId"] as string}"`,
            `      signature: "${action["signature"] as string}"`,
            `      agentSlug: "${ctx.agentSlug ?? ""}"`,
            `  - actionId: "${declineId}"`,
            `    label: "Decline"`,
            `    type: "button"`,
            `    color: "#ef4444"`,
            `    actionableUrl: "${CONFIG.selfUrl}/claw/api/v1/app/callback"`,
            `    context:`,
            `      userId: "${action["userId"] as string}"`,
            "---",
            "",
            `The agent wants to execute:\n\n${actionDesc}`,
          ].join("\n");

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
            form.append("markdownText", actionMsg);
            form.append("metadata", JSON.stringify({ hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" }));
            await spacesAppFetchMultipart("/files/filesUpload", form, token);
          } else {
            await spacesAppFetch("/chat/postMessage", {
              channelId: ctx.channelId,
              conversationId: ctx.conversationId,
              markdownText: actionMsg,
              userId: ctx.spacesAppUserId,
              metadata: { hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" },
            }, token);
          }
        }
        log.info(`Copilot: posted ${copilotPendingActions.length} write action approval(s)`);
      }

      // Don't delete session — copilot sessions persist for multi-turn
      return;
    }

    if (ctx.responseMode === "approval") {
      // ── Digital Twin mode: DM the mentioned user with approve/decline ──
      // workspaceId required by prod openDm schema (see comment on the
      // copilot branch above). Empty fallback only to satisfy types — the
      // earlier USER_MENTIONED gate already rejected runs where we couldn't
      // resolve the workspaceId, so this should always have a real value.
      const dmResult = (await spacesAppFetch("/channel/openDm", {
        targetUserId: ctx.mentionedUserId,
        workspaceId: ctx.workspaceId ?? "",
      }, token)) as { channelId: string };

      const messageContent = buildAppActionFrontmatter(
        resultWithCitations,
        ctx.channelId,
        ctx.conversationId,
        ctx.mentionedUserId,
        ctx.workspaceId ?? "",
        ctx.senderName,
        ctx.channelName,
        ctx.task,
      );

      const metadata = { hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" };

      if (payload.attachments?.length) {
        const form = new FormData();
        for (const att of payload.attachments) {
          const buffer = Buffer.from(att.data, "base64");
          const blob = new Blob([buffer], { type: att.mimeType });
          form.append("files", blob, att.fileName);
        }
        form.append("channelId", dmResult.channelId);
        form.append("userId", ctx.spacesAppUserId);
        form.append("markdownText", messageContent);
        form.append("metadata", JSON.stringify(metadata));

        await spacesAppFetchMultipart("/files/filesUpload", form, token);
      } else {
        await spacesAppFetch("/chat/postMessage", {
          channelId: dmResult.channelId,
          markdownText: messageContent,
          userId: ctx.spacesAppUserId,
          metadata,
        }, token);
      }

      log.info(`Digital Twin: sent approve/decline DM to ${ctx.mentionedUserId} (asked by ${ctx.senderId})`);
      await deleteSession(sessionId);
      // Return immediately — don't post pendingQuestions, pendingActions,
      // or chain notifications to the thread. Everything goes through the DM.
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
      const prepared = await prepareAgentResultForPosting(
        agentResult,
        payload.attachments as OutgoingAttachment[] | undefined,
        {
          ...(ctx.agentSlug ? { agentSlug: ctx.agentSlug } : {}),
          ...(senderAuth?.token ? { senderSpacesToken: senderAuth.token } : {}),
          ...(senderAuth?.sessionId ? { senderSpacesSessionId: senderAuth.sessionId } : {}),
          ...(senderAuth?.workspaceId ? { senderWorkspaceId: senderAuth.workspaceId } : {}),
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
        await spacesAppFetchMultipart("/files/filesUpload", form, token);
        log.info(
          `Agent ${ctx.agentSlug}: replied with ${prepared.attachments.length} attachment(s)` +
          (agentResult.length > MAX_MESSAGE_CHARS ? ` (PDF fallback, original ${agentResult.length} chars)` : ""),
        );
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
            await spacesAppFetch("/chat/postMessage", {
              channelId: ctx.channelId,
              conversationId: ctx.conversationId,
              markdownText: decision.replyToUser,
              userId: ctx.spacesAppUserId,
              metadata: { contentFormat: "markdown" },
            }, token).catch(() => {});
            // Refire claw's /run with the stashed dispatch payload, overriding
            // the task with the relooper template. claw mints a fresh
            // sessionId; the result callback will route back here and feed the
            // next iteration. No await on the actual run completion — claw
            // ACKs immediately with the sessionId, work happens async.
            const refire = { ...decision.runPayload, task: decision.nextTurnTask };
            const runUrl = `${CONFIG.internalUrl}/claw/api/v1/run`;
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

    // ── Post question buttons in thread ──
    const pendingQuestions = (payload as { pendingQuestions?: Array<{ questionId: string; question: string; options: string[] }> }).pendingQuestions;
    if (pendingQuestions?.length) {
      const OPTION_COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981"];
      for (const q of pendingQuestions) {
        const actions = q.options.map((opt, i) => [
          `  - actionId: "${crypto.randomUUID()}"`,
          `    label: "${opt.replace(/"/g, '\\"')}"`,
          `    type: "button"`,
          `    color: "${OPTION_COLORS[i % OPTION_COLORS.length]}"`,
          `    actionableUrl: "${CONFIG.selfUrl}/claw/api/v1/app/callback"`,
          `    context:`,
          `      actionType: "user-answer"`,
          `      questionId: "${q.questionId}"`,
          `      answer: "${opt.replace(/"/g, '\\"')}"`,
          `      agentSlug: "${ctx.agentSlug ?? ""}"`,
          `      channelId: "${ctx.channelId}"`,
          `      conversationId: "${ctx.conversationId}"`,
          `      userId: "${ctx.senderId}"`,
        ].join("\n"));
        const questionMsg = ["---", "appActions:", ...actions, "---", "", q.question].join("\n");
        await spacesAppFetch("/chat/postMessage", {
          channelId: ctx.channelId,
          conversationId: ctx.conversationId,
          markdownText: questionMsg,
          userId: ctx.spacesAppUserId,
          metadata: { hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" },
        }, token);
      }
      log.info(`Posted ${pendingQuestions.length} question(s) in thread ${ctx.conversationId}`);
    }

    // ── Send approval DMs for pending write actions (HITL) ──
    const pendingActionsPayload = (payload as { pendingActions?: Array<Record<string, unknown>> }).pendingActions;
    if (pendingActionsPayload?.length) {
      for (const action of pendingActionsPayload) {
        const actionDesc = formatActionDescription(action["tool"] as string, action["params"] as Record<string, unknown>);
        const approveId = crypto.randomUUID();
        const declineId = crypto.randomUUID();

        const actionMsg = [
          "---",
          "appActions:",
          `  - actionId: "${approveId}"`,
          `    label: "Approve"`,
          `    type: "button"`,
          `    color: "#22c55e"`,
          `    actionableUrl: "${CONFIG.selfUrl}/claw/api/v1/app/callback"`,
          `    context:`,
          `      actionType: "write"`,
          `      serverType: "${action["serverType"] as string}"`,
          `      tool: "${action["tool"] as string}"`,
          `      params: ${JSON.stringify(JSON.stringify(action["params"]))}`,
          `      userId: "${action["userId"] as string}"`,
          `      signature: "${action["signature"] as string}"`,
          `      agentSlug: "${ctx.agentSlug ?? ""}"`,
          `  - actionId: "${declineId}"`,
          `    label: "Decline"`,
          `    type: "button"`,
          `    color: "#ef4444"`,
          `    actionableUrl: "${CONFIG.selfUrl}/claw/api/v1/app/callback"`,
          `    context:`,
          `      userId: "${action["userId"] as string}"`,
          "---",
          "",
          `The agent wants to execute:\n\n${actionDesc}`,
        ].join("\n");

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
          form.append("markdownText", actionMsg);
          form.append("metadata", JSON.stringify({ hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" }));
          await spacesAppFetchMultipart("/files/filesUpload", form, token);
        } else {
          await spacesAppFetch("/chat/postMessage", {
            channelId: ctx.channelId,
            conversationId: ctx.conversationId,
            markdownText: actionMsg,
            userId: ctx.spacesAppUserId,
            metadata: { hasAppActions: true, appId: ctx.spacesAppId, contentFormat: "markdown" },
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

        const runRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/run`, {
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

router.post("/progress", requireS2S, async (req: Request, res: Response) => {
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
    console.warn(`[webhook/progress] touchRunRecovery failed for ${sessionId}:`, err instanceof Error ? err.message : err);
  });

  // Incremental tool streaming — fires on every tool_execution_end
  if (toolInvocation) {
    agentRunRepository.appendToolInvocation(sessionId, toolInvocation).catch((e) => {
      console.warn(`[webhook/progress] appendToolInvocation failed for ${sessionId}:`, e instanceof Error ? e.message : e);
    });
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

  const log = createLogger("webhook/progress", ctx.traceId ?? sessionId.slice(0, 8));

  try {
    if (USE_EPHEMERAL_PROGRESS) {
      await spacesAppFetch("/chat/agentProgress", {
        conversationId: ctx.conversationId,
        channelId: ctx.channelId,
        agentSlug: ctx.agentSlug,
        userId: ctx.spacesAppUserId,
        sessionId,
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
// signing secret stored in agents.signingSecret. Runs in warn-only mode
// by default (SPACES_WEBHOOK_VERIFY_MODE=warn) so unsigned legacy traffic
// still flows during backfill; flip to "enforce" once every agent has a
// secret persisted.
//
// The bare-path `/webhook` (no agent slug) used to fall through to a
// default-agent dispatch — verified dead in 7d of prod logs (0 hits across
// all 46 active agents) and no code anywhere builds that URL, so the route
// is deleted to remove the only path that bypassed signature verification.
router.post("/:agentSlug", verifySpacesSignature, handleWebhook);

export { router as webhookRouter };
