import { isAgentOwnedRun } from "../lib/agent-owned-runs.js";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { errMsg } from "../lib/errors.js";
import { isAgentInvocableBy } from "xyne-claw-shared";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { existsSync, readdirSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { agentRepository, chatMessageRepository, userRepository, agentRunRepository, chatAttachmentRepository, userAgentConfigRepository, userProviderCredentialsRepository, userSubagentConfigRepository, agentProviderCredentialsRepository } from "../repositories/index.js";
import { getValidClaudeBearer } from "../lib/claude-oauth-refresh.js";
import { prisma } from "../db.js";
import { cancelRunRecovery } from "../queue/run-recovery-worker.js";
import { decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { KNOWN_PROVIDERS, buildProviderConfig, agentCredRefreshTarget, userCredRefreshTarget, agentDefaultSpeed, providerConfigForSpeed, applyFastModeModels } from "../lib/agent-provider-config.js";
import { resolveFastMode } from "../lib/fast-mode.js";
import { extractFollowUpSuggestionsFromInvocations } from "../lib/follow-up-suggestions.js";
import { getRequesterId, getOrgId, getAgentEditAccess, isClawAdmin } from "../middleware/agent-acl.js";
import { matchesAuthenticatedUserId, getRequesterAliases } from "../middleware/pin-user-id-param.js";
import { resolveClawUserIdForSpacesIdentity } from "../lib/users-jit.js";
import { uploadChatAttachments } from "../services/chatAttachmentService.js";
import { gcsService } from "../services/storageService.js";
import type { SpacesAuthContext } from "../mcp/servers/xyne-spaces-client.js";
import {
  buildAttachedContextPayload,
  normalizeAttachedContext,
  searchContextItems,
  type ContextSearchType,
} from "../services/agentChatContextService.js";
import { appendCitations, collectCitationIconUrls } from "../lib/citations.js";
import { getSpacesAuthForUser, getWorkspaceIdForUser } from "../lib/spaces-db.js";
import { consumeClawStream } from "../lib/consume-claw-stream.js";
import { cancelRunSession } from "../lib/experiment.js";
import { redisService } from "../redis.js";
import { subscribeLive, publishLiveEvent, type LiveEvent } from "../lib/live-conversation-bus.js";
import { pushDelta, endDeltaCoalescer, liveUserIdForSession } from "../lib/live-delta-coalescer.js";
import { resolveSdlcRepositoryForUser } from "../lib/sdlc-repository-context.js";

import { attachArtifactToSessionApp } from "../lib/artifact-app-session.js";
import { createLogger } from "../logger.js";
const log = createLogger("agent-chat");

function withoutFollowUpRecorderInvocations(value: unknown[]): unknown[] {
  return value.filter((item) => {
    if (!item || typeof item !== "object") return true;
    const invocation = item as { toolName?: string; args?: unknown };
    if (invocation.toolName === "internal-follow-up-diagnostics") return false;
    if (invocation.toolName !== "ask-user-question") return true;
    return !invocation.args || typeof invocation.args !== "object" ||
      (invocation.args as { purpose?: string }).purpose !== "follow_up_suggestions";
  });
}

// Match the SLIDE_JSON_START/END markers emitted by create-ppt / edit-ppt so
// we can persist the slide JSON on the attachment's metadata for the viewer.
const SLIDE_JSON_RE = /SLIDE_JSON_START\s*([\s\S]+?)\s*SLIDE_JSON_END/;
const SESSION_LOCKED_MESSAGE = "Still finishing your previous answer - try again in a few seconds.";

function isSessionLockedError(error: unknown): boolean {
  return error === "session_locked" || error === "sessionLocked";
}

function widgetErrorContent(error: unknown, fallback: string): string {
  return isSessionLockedError(error) ? SESSION_LOCKED_MESSAGE : fallback;
}

/**
 * Coerce a pi-coding-agent tool result into plain text. The persisted shape is
 * often a JSON-encoded string wrapping the MCP envelope
 * `{ content: [{ type: "text", text }] }`; handle that by trying JSON.parse
 * when the string starts with `{`/`[`.
 */
function toolResultText(result: unknown): string {
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === "object") {
          const nested = toolResultText(parsed);
          if (nested) return nested;
        }
      } catch {
        /* fall through to raw string */
      }
    }
    return result;
  }
  if (!result || typeof result !== "object") return "";
  const obj = result as Record<string, unknown>;

  if (Array.isArray(obj["content"])) {
    const parts: string[] = [];
    for (const entry of obj["content"] as Array<Record<string, unknown>>) {
      if (entry?.["type"] === "text" && typeof entry["text"] === "string") {
        parts.push(entry["text"]);
      }
    }
    if (parts.length) return parts.join("\n");
  }
  if (typeof obj["text"] === "string") return obj["text"];
  return "";
}

/**
 * Scan a list of tool invocations (from xyne-claw's callback) for the ppt
 * slide JSON and index it by filename. Looks at results from create-ppt /
 * edit-ppt, expects a `<safeTitle>.pptx` filename on the same tool call.
 */
function extractSlideJsonByFilename(toolInvocations: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (!Array.isArray(toolInvocations)) return map;

  for (const inv of toolInvocations as Array<Record<string, unknown>>) {
    const toolName = String(inv["toolName"] ?? "");
    if (toolName !== "create-ppt" && toolName !== "edit-ppt") continue;

    const text = toolResultText(inv["result"]);
    if (!text) continue;

    const m = text.match(SLIDE_JSON_RE);
    if (!m?.[1]) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue;
    }

    // Filename appears on the preceding "Rendered and attached X" line. If we
    // can't find one, skip — we can't associate the JSON to an attachment.
    const nameMatch = text.match(/Rendered and attached\s+(\S+\.pptx)/i);
    if (!nameMatch?.[1]) continue;
    map.set(nameMatch[1], parsed);
  }

  return map;
}

const router = Router();
const internalRouter = Router();

// Placeholder shown to an admin viewing another user's run in place of a tool
// RESULT body. We keep toolName/args/status/timing so the admin can audit WHAT
// ran, but withhold the returned content (a tool's result carries the user's
// private Spaces data — message/DM/channel text). See the All Runs ACL.
const REDACTED_TOOL_RESULT = "[result hidden — another user's run]";

/**
 * An awakened run (heartbeat / reflex) is owned by the agent's own bot
 * identity, not by a person, so there is no user privacy for the cross-user
 * redaction to protect — and an admin needs to read exactly what it did.
 * See lib/agent-owned-runs.ts.
 */
function shouldRedactRun(crossUser: boolean, runUserId: string | null | undefined, requesterIds: string | string[], triggerSource?: string | null): boolean {
  if (!crossUser) return false;
  const mine = Array.isArray(requesterIds)
    ? !!runUserId && requesterIds.includes(runUserId)
    : runUserId === requesterIds;
  if (mine) return false;
  return !isAgentOwnedRun(triggerSource);
}

/**
 * Strip RESULT bodies from a run's tool invocations while preserving every
 * other field (name, args, isError, status, subagent nesting). Used when an
 * admin inspects a run they don't own.
 */
function redactToolResults(invocations: unknown[]): unknown[] {
  return invocations.map((inv) =>
    inv && typeof inv === "object" && "result" in inv
      ? { ...(inv as Record<string, unknown>), result: REDACTED_TOOL_RESULT }
      : inv,
  );
}

/**
 * Deeply replace every `result` field's value with the placeholder, anywhere in
 * a debug-artifact tree, preserving all other keys (toolName, args, input,
 * userId, sessionId, timing). Shape-agnostic on purpose — xyne-claw's snapshot
 * structure isn't typed here, so we redact by key rather than by known path,
 * which fails safe if the shape changes. Used for the deep "Debug" drawer when
 * an admin inspects another user's (non-private) run.
 */
function redactResultKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactResultKeysDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k === "result" ? REDACTED_TOOL_RESULT : redactResultKeysDeep(v);
    }
    return out;
  }
  return value;
}

// Debug artifacts are no longer read off the local filesystem — they live on
// xyne-claw's PVC and are served via its S2S `/internal/sessions/:convId/debug`
// endpoint, which claw-auth proxies (see the debug route below). The old
// local-disk resolver/readers were removed; they only ever resolved in the dev
// monorepo and 404'd in prod.

// In-flight SSE streams keyed by callbackId
interface CallbackAttachment {
  fileName: string;
  mimeType: string;
  data: string;
  metadata?: Record<string, unknown>;
}
interface PendingStream {
  sendEvent: (event: string, data: unknown) => void;
  resolve: (result: {
    content: string;
    status: "completed" | "failed" | "cancelled";
    errorCode?: string | undefined;
    pendingActions?: Array<Record<string, unknown>>;
    /** True when the callback handler already persisted the assistant message
     *  (and attachments) — the SSE pod must NOT write a second row. */
    persisted?: boolean;
    /** Canonical attachment rows persisted by the callback handler, for the
     *  SSE `done` event. */
    persistedAttachments?: PersistedAttachment[];
  }) => void;
  setClosed: () => void;
  /** Pre-created assistant ChatMessage row for this turn. Branching requires
   *  the assistant id BEFORE /run so it can be used as the PI session branch
   *  suffix and as `AgentRun.chatMessageId` at finalize time. Also enables
   *  the callback handler to UPDATE the placeholder instead of creating a new
   *  row, so the assistant id stays stable across the stream lifecycle. */
  assistantMessageId?: string;
  /** Persisted user message id for this turn (when the user message was
   *  created up-front in the branching path). Echoed in the `done` event so
   *  the frontend can swap its optimistic id for the real one. */
  userMessageId?: string;
  /** Parent ref the assistant placeholder was created under. Echoed in `done`
   *  so the frontend can stitch the optimistic message into the tree. */
  assistantParentId?: string;
  /** Whether this subscriber may receive `debug` frames.
   *
   *  The debug frame carries the agent's full system prompt, instructions and
   *  tool-use policy. The stored-history endpoint already withholds it from
   *  callers without elevated access; the live stream did not, so the same
   *  content was readable by any user who could start a run. Resolved once when
   *  the stream is opened — the callback handler that forwards frames runs on
   *  an S2S request from xyne-claw and has no end-user identity of its own. */
  allowDebug?: boolean;
}
const pendingStreams = new Map<string, PendingStream>();

// The live delta coalescer + liveUserIdForSession live in ../lib/live-delta-coalescer.js
// so run-stream.ts (Spaces AI) can share the exact same machinery — see the import
// at the top of this file.

// Branching helpers live in routes/lib/branching.ts so they can be shared
// with /run/stream (the Ask AI v2 entrypoint). Import the names this file
// uses; the original inline definitions have been removed.
import {
  branchPiConversationId,
  piSessionStoreKey,
  resolvePiConversationIdForPath,
  cloneBranchSession,
} from "./lib/branching.js";

interface PersistedAttachment {
  id: string;
  mimeType: string;
  originalFilename: string;
  size: number;
}

/* ─────────────────────────────────────────────────────────────────────
   Cross-pod event bus (Redis pub/sub).

   claw-auth runs many replicas. The browser's SSE stream lives in ONE
   pod's pendingStreams map, but xyne-claw's /progress and /callback
   POSTs are load-balanced across ALL pods via the k8s Service — so most
   of the time they land on a pod that doesn't hold the stream. Before
   this bus, that meant: progress events silently dropped, and (worse)
   the final result never resolved the stream, so the assistant message
   was never persisted — the message showed in /debug (agentRun.finalize
   runs pod-independently in the callback) but not in the chat UI
   (chat_messages row was only written by the SSE pod). Prod example:
   chat-03451ed9… on 2026-06-11.

   Fix is two-part:
   1. DURABILITY: the callback handler persists the assistant message
      itself (pod-independent, Redis SETNX idempotency guard).
   2. LIVENESS: handlers first try the local map, then publish to this
      channel; every pod subscribes and forwards to its local stream if
      it has one. Self-delivery is a no-op (entry already deleted).
   Redis being down degrades to liveness loss only — the message is
   still persisted and shows on the next /messages fetch.
   ───────────────────────────────────────────────────────────────────── */
const CHAT_EVENTS_CHANNEL = "agent-chat:events";

type ChatBusEvent =
  | { kind: "progress"; callbackId: string; events: Array<{ event: string; data: unknown }> }
  | {
      kind: "result";
      callbackId: string;
      conversationId: string;
      content: string;
      status: "completed" | "failed" | "cancelled";
      errorCode?: string;
      sessionId?: string;
      pendingActions?: Array<Record<string, unknown>>;
      persisted: boolean;
      persistedAttachments?: PersistedAttachment[];
    };

let _chatSubscriberReady = false;
function ensureChatEventsSubscriber(): void {
  if (_chatSubscriberReady) return;
  _chatSubscriberReady = true;
  const sub = redisService.getConnection().duplicate();
  sub.subscribe(CHAT_EVENTS_CHANNEL).catch((err) => {
    _chatSubscriberReady = false;
    log.error("[agent-chat] events subscribe failed (cross-pod SSE forwarding off):", err instanceof Error ? err.message : err);
  });
  sub.on("message", (_ch: string, raw: string) => {
    let msg: ChatBusEvent;
    try { msg = JSON.parse(raw) as ChatBusEvent; } catch { return; }
    const stream = pendingStreams.get(msg.callbackId);
    if (!stream) return; // stream lives on another pod (or already resolved)
    if (msg.kind === "progress") {
      // Same withholding as the same-pod path above: the pod that owns the
      // subscriber is the only one that knows whether it may see `debug`.
      for (const e of msg.events) {
        if (e.event === "debug" && !stream.allowDebug) continue;
        stream.sendEvent(e.event, e.data);
      }
      return;
    }
    stream.sendEvent("debug_artifacts_ready", {
      ...(msg.sessionId ? { sessionId: msg.sessionId } : {}),
      conversationId: msg.conversationId,
    });
    pendingStreams.delete(msg.callbackId);
    stream.resolve({
      content: msg.content,
      status: msg.status,
      ...(msg.errorCode ? { errorCode: msg.errorCode } : {}),
      ...(msg.pendingActions?.length ? { pendingActions: msg.pendingActions } : {}),
      persisted: msg.persisted,
      ...(msg.persistedAttachments?.length ? { persistedAttachments: msg.persistedAttachments } : {}),
    });
  });
}

function publishChatEvent(event: ChatBusEvent): void {
  ensureChatEventsSubscriber();
  redisService.getConnection()
    .publish(CHAT_EVENTS_CHANNEL, JSON.stringify(event))
    .catch((err) => log.warn("[agent-chat] events publish failed:", err instanceof Error ? err.message : err));
}

/**
 * Persist the assistant message + tool-generated attachments for a finished
 * run. Called from the /callback handler (pod-independent — this is the
 * DURABLE write; the SSE stream is only the live mirror). Idempotent across
 * pods/retries via Redis SETNX on the sessionId: claw retries the callback up
 * to 3× and the SSE pod historically also wrote this row, so exactly-once
 * needs a cross-pod guard, not a local flag.
 *
 * Returns null when another pod/attempt already persisted this session's
 * message (guard lost), or the persisted rows when this call won.
 */
async function persistAssistantResult(args: {
  conversationId: string;
  agentSlug: string;
  userId: string;
  content: string;
  status: "completed" | "failed" | "cancelled";
  orgId: string;
  attachments?: CallbackAttachment[];
  toolInvocations?: unknown;
  sessionId?: string;
  /** Branching: when set, UPDATE this pre-created assistant placeholder row
   *  instead of creating a new one. The placeholder is reserved at /chat
   *  time so its id can drive PI session branching and AgentRun linkage. */
  assistantMessageId?: string;
}): Promise<{ messageId: string; persistedAttachments: PersistedAttachment[] } | null> {
  if (args.sessionId) {
    const guard = await redisService.getConnection()
      .set(`agent-chat:msg-persisted:${args.sessionId}`, "1", "EX", 86_400, "NX")
      .catch(() => "OK" as const); // Redis down → fail open to persisting (dupes beat data loss)
    if (guard !== "OK") return null; // someone else already persisted
  }

  const assistantMsg = args.assistantMessageId
    ? await chatMessageRepository.update(args.assistantMessageId, {
        content: args.content,
        status: args.status,
      }).catch(() => null)
    : await chatMessageRepository.create({
        conversationId: args.conversationId,
        agentSlug: args.agentSlug,
        userId: args.userId,
        role: "assistant",
        content: args.content,
        status: args.status,
        orgId: args.orgId,
      });
  // If the placeholder was already swept (rare race) or update threw, fall
  // back to creating a fresh row so the assistant text isn't lost.
  const finalAssistantMsg = assistantMsg ?? await chatMessageRepository.create({
    conversationId: args.conversationId,
    agentSlug: args.agentSlug,
    userId: args.userId,
    role: "assistant",
    content: args.content,
    status: args.status,
    orgId: args.orgId,
  });

  // Persist any tool-generated attachments (e.g. create-ppt .pptx) into GCS
  // and the ChatAttachment table so the UI can render a download card /
  // preview. Slide JSON (when present in the tool result) is stashed on the
  // row's metadata for the PPT viewer.
  const persistedAttachments: PersistedAttachment[] = [];
  if (args.attachments?.length) {
    // Prefer metadata carried on the attachment itself (immune to the 10KB
    // truncation pi-coding-agent applies to toolInvocations[].result).
    // Fall back to scanning the (potentially truncated) invocations.
    const fallbackSlides = extractSlideJsonByFilename(args.toolInvocations);
    const year = new Date().getUTCFullYear();
    const month = String(new Date().getUTCMonth() + 1).padStart(2, "0");

    for (const att of args.attachments) {
      try {
        const buffer = Buffer.from(att.data, "base64");
        const safeName = att.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 200);
        const destPath = `chat-attachments/${args.userId}/${year}/${month}/${Date.now()}-${randomUUID()}-${safeName}`;
        await gcsService.uploadFile(buffer, destPath, att.mimeType);

        const inlineMeta = att.metadata && typeof att.metadata === "object" ? att.metadata : undefined;
        const fallbackSlide = fallbackSlides.get(att.fileName);
        let attachmentMetadata: Record<string, unknown> | undefined =
          inlineMeta && Object.keys(inlineMeta).length > 0
            ? inlineMeta
            : fallbackSlide
              ? { slideJson: fallbackSlide }
              : undefined;

        // A conversation owns ONE app: the first generated artifact creates it,
        // every later one becomes a version of it. Done here rather than in the
        // tool because the tool runs in xyne-claw with no database. The ids are
        // stamped onto the manifest so the chat card can address the app (and
        // its version history) instead of only the raw attachment.
        const reactArtifact = attachmentMetadata?.["reactArtifact"];
        if (reactArtifact && typeof reactArtifact === "object") {
          const session = await attachArtifactToSessionApp({
            conversationId: args.conversationId,
            userId: args.userId,
            payload: buffer,
          });
          if (session) {
            attachmentMetadata = {
              ...attachmentMetadata,
              reactArtifact: {
                ...(reactArtifact as Record<string, unknown>),
                appId: session.appId,
                versionId: session.versionId,
                versionNumber: session.versionNumber,
              },
            };
          }
        }

        const row = await prisma.chatAttachment.create({
          data: {
            chatMessageId: finalAssistantMsg.id,
            uploaderUserId: args.userId,
            url: destPath,
            originalFilename: att.fileName,
            mimeType: att.mimeType,
            size: buffer.length,
            ...(attachmentMetadata ? { metadata: attachmentMetadata as import("@prisma/client").Prisma.InputJsonValue } : {}),
          },
        });
        persistedAttachments.push({
          id: row.id,
          mimeType: row.mimeType,
          originalFilename: row.originalFilename,
          size: row.size,
        });
      } catch (e) {
        log.error("[agent-chat] failed to persist assistant attachment:", e);
      }
    }
  }

  return { messageId: finalAssistantMsg.id, persistedAttachments };
}

function normalizeRunStatus(status: unknown): "completed" | "failed" | "cancelled" {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

async function resolveCallbackOrgId(req: Request, sessionId?: string, userId?: string): Promise<string | undefined> {
  const headerOrgId = getOrgId(req);
  if (headerOrgId) return headerOrgId;
  if (sessionId) {
    const run = await agentRunRepository.findBySessionId(sessionId).catch(() => null);
    if (run?.orgId) return run.orgId;
  }
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } }).catch(() => null);
    if (user?.orgId) return user.orgId;
  }
  return undefined;
}

function getCookieValue(req: Request, name: string): string | undefined {
  const cookie = req.headers["cookie"] ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function extractSpacesUserToken(req: Request): string | undefined {
  const bodyToken = (req.body as { userToken?: string } | undefined)?.userToken;
  if (bodyToken) return bodyToken;

  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

  const lastWorkspace = getCookieValue(req, "xyne_last_workspace");
  if (lastWorkspace) {
    const workspaceToken = getCookieValue(req, `xyne_ws_${lastWorkspace}_token`);
    if (workspaceToken) return workspaceToken;
  }

  const legacy = getCookieValue(req, "google_access_token");
  if (legacy && legacy.split(".").length === 3) return legacy;

  return undefined;
}

function extractSpacesSessionId(req: Request): string | undefined {
  const header = req.headers["x-session-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return getCookieValue(req, "xyne_session") ?? getCookieValue(req, "user_session_id");
}

function extractSpacesWorkspaceId(req: Request): string | undefined {
  const verifiedHeader = req.headers["x-spaces-workspace-id"];
  if (typeof verifiedHeader === "string" && verifiedHeader.trim()) return verifiedHeader.trim();
  const header = req.headers["x-workspace-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return getCookieValue(req, "xyne_last_workspace");
}

async function resolveSpacesAuth(req: Request, userId: string): Promise<SpacesAuthContext | undefined> {
  // `userId` is canonical Claw identity. Spaces DB reads must use the raw
  // workspace membership identity retained by requireAuth.
  const spacesUserIdHeader = req.headers["x-spaces-user-id"];
  const spacesUserId = typeof spacesUserIdHeader === "string" && spacesUserIdHeader.trim()
    ? spacesUserIdHeader.trim()
    : userId;
  const verifiedWorkspaceId = extractSpacesWorkspaceId(req);
  // Prefer the live Spaces DB read when SPACES_DB_URL is configured — the
  // userMcpConnection cache below goes stale every time Spaces' middleware
  // refreshes the user's JWT, and that drift is the dominant 401 root cause.
  const live = await getSpacesAuthForUser(spacesUserId, "agent-chat", verifiedWorkspaceId);
  if (live) {
    return {
      token: live.token,
      baseUrl: CONFIG.spacesInternalUrl,
      sessionId: live.sessionId,
      workspaceId: live.workspaceId,
    };
  }

  try {
    // Legacy rows may be keyed by the raw Spaces id under the same caller.
    const connection = await prisma.userMcpConnection.findFirst({
      where: { userId: { in: getRequesterAliases(req) }, mcpServer: { type: "xyne-spaces" } },
    });

    if (connection) {
      const decrypted = decrypt(
        connection.encryptedCreds,
        connection.iv,
        connection.authTag,
        CONFIG.encryptionKey,
      );
      const credentials = JSON.parse(decrypted) as Record<string, unknown>;
      const tokenRaw = credentials["token"];
      const urlRaw = credentials["url"];
      const sessionIdRaw = credentials["sessionId"];
      const workspaceIdRaw = credentials["workspaceId"];

      const token = typeof tokenRaw === "string" ? tokenRaw.trim() : "";
      if (token) {
        const baseUrl = typeof urlRaw === "string" && urlRaw.trim() ? urlRaw.trim() : CONFIG.spacesInternalUrl;
        const sessionId = typeof sessionIdRaw === "string" && sessionIdRaw.trim() ? sessionIdRaw.trim() : undefined;
        const workspaceIdFromCreds = typeof workspaceIdRaw === "string" && workspaceIdRaw.trim() ? workspaceIdRaw.trim() : undefined;
        const workspaceId = verifiedWorkspaceId
          ?? workspaceIdFromCreds
          ?? await getWorkspaceIdForUser(spacesUserId, "agent-chat").catch(() => null)
          ?? undefined;
        if (!workspaceIdFromCreds && workspaceId) {
          log.info(`[agent-chat] resolved workspaceId=${workspaceId} from user row for cached Spaces auth userId=${userId}`);
        }
        return {
          token,
          baseUrl,
          ...(sessionId ? { sessionId } : {}),
          ...(workspaceId ? { workspaceId } : {}),
        };
      }
    }
  } catch (err) {
    log.error("[agent-chat] failed to load xyne-spaces MCP credentials:", err);
  }

  const token = extractSpacesUserToken(req);
  if (!token) return undefined;
  const sessionId = extractSpacesSessionId(req);
  const workspaceIdFromRequest = verifiedWorkspaceId;
  const workspaceId = workspaceIdFromRequest ?? await getWorkspaceIdForUser(spacesUserId, "agent-chat").catch(() => null) ?? undefined;
  if (!workspaceIdFromRequest && workspaceId) {
    log.info(`[agent-chat] resolved workspaceId=${workspaceId} from user row for request Spaces auth userId=${userId}`);
  }
  return {
    token,
    baseUrl: CONFIG.spacesInternalUrl,
    ...(sessionId ? { sessionId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  };
}

// Multer for attachment uploads (memory buffers → GCS)
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 }, // 25MB/file, 10 files + 10 thumbnails
});

// POST /agents/:slug/chat/attachments/upload — upload files to GCS, return IDs
router.post(
  "/:slug/chat/attachments/upload",
  uploadMiddleware.fields([
    { name: "files", maxCount: 10 },
    { name: "thumbnails", maxCount: 10 },
  ]) as unknown as RequestHandler<{ slug: string }>,
  async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
    try {
      const userId = getRequesterId(req) ?? (req.body as { userId?: string }).userId;
      if (!userId) {
        res.status(400).json({ success: false, error: "userId or x-user-id header required" });
        return;
      }

      const filesMap = req.files as Record<string, Express.Multer.File[] | undefined> | undefined;
      const files = filesMap?.["files"] ?? [];
      const thumbnails = filesMap?.["thumbnails"];
      if (files.length === 0) {
        res.status(400).json({ success: false, error: "No files uploaded" });
        return;
      }

      let fileMetadata: Array<{ hasThumbnail?: boolean; width?: number; height?: number }> = [];
      const rawMeta = (req.body as { fileMetadata?: string }).fileMetadata;
      if (rawMeta) {
        try {
          const parsed = JSON.parse(rawMeta) as unknown;
          if (Array.isArray(parsed)) fileMetadata = parsed as typeof fileMetadata;
        } catch {
          /* ignore malformed metadata */
        }
      }

      const results = await uploadChatAttachments(files, thumbnails, fileMetadata, userId);
      // Hide internal GCS path from client
      const safe = results.map(({ url: _url, thumbnailUrl: _tu, ...rest }) => rest);
      res.json({ success: true, data: safe });
    } catch (err) {
      log.error("[agent-chat] upload error:", err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Upload failed" });
    }
  },
);

// GET /agents/attachments/:id/download — stream the full file
router.get("/attachments/:id/download", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id header is required" }); return; }

    const att = await chatAttachmentRepository.findById(req.params.id);
    if (!att) { res.status(404).json({ success: false, error: "Attachment not found" }); return; }

    // uploaderUserId may hold either verified representation of the caller —
    // legacy rows predate canonicalization, so compare against both.
    const allowed = matchesAuthenticatedUserId(req, att.uploaderUserId) || await isClawAdmin(requesterId);
    if (!allowed) { res.status(403).json({ success: false, error: "Forbidden" }); return; }

    res.setHeader("Content-Type", att.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(att.originalFilename)}"`);
    if (att.size) res.setHeader("Content-Length", String(att.size));
    res.setHeader("Cache-Control", "private, max-age=3600");
    // Attachments are untrusted (agent- or user-authored). Served inline from
    // OUR origin, an HTML file's scripts would otherwise run with the app's
    // cookies/session — classic stored XSS. `CSP: sandbox` makes the browser
    // treat the document as a unique origin with scripts disabled wherever
    // it's viewed (new tab included), matching the in-page sandboxed iframe.
    // Scoped to HTML/SVG/XML — the script-capable types; images/PDFs keep
    // native rendering.
    // `allow-same-origin` (WITHOUT allow-scripts) keeps the document readable
    // for the in-page themed preview; script execution stays fully blocked.
    if (/html|svg|xml/i.test(att.mimeType)) {
      res.setHeader("Content-Security-Policy", "sandbox allow-same-origin");
    }

    const stream = gcsService.createReadStream(att.url);
    stream.on("error", (err) => {
      log.error("[agent-chat] download stream error:", err);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
  } catch (err) {
    log.error("[agent-chat] download error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/attachments/:id/slide-json — slide JSON for the PPT viewer
router.get("/attachments/:id/slide-json", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id header is required" }); return; }

    const att = await chatAttachmentRepository.findById(req.params.id);
    if (!att) { res.status(404).json({ success: false, error: "Attachment not found" }); return; }

    const allowed = matchesAuthenticatedUserId(req, att.uploaderUserId) || await isClawAdmin(requesterId);
    if (!allowed) { res.status(403).json({ success: false, error: "Forbidden" }); return; }

    const metadata = (att as unknown as { metadata?: Record<string, unknown> | null }).metadata;
    const slideJson = metadata && typeof metadata === "object" ? metadata["slideJson"] : undefined;
    if (!slideJson) {
      res.status(404).json({ success: false, error: "No slide JSON available for this attachment" });
      return;
    }
    res.json({ success: true, data: slideJson });
  } catch (err) {
    log.error("[agent-chat] slide-json error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/attachments/:id/thumbnail — serve thumbnail if present
router.get("/attachments/:id/thumbnail", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id header is required" }); return; }

    const att = await chatAttachmentRepository.findById(req.params.id);
    if (!att) { res.status(404).json({ success: false, error: "Attachment not found" }); return; }

    const allowed = matchesAuthenticatedUserId(req, att.uploaderUserId) || await isClawAdmin(requesterId);
    if (!allowed) { res.status(403).json({ success: false, error: "Forbidden" }); return; }

    if (!att.thumbnailUrl) { res.status(404).json({ success: false, error: "No thumbnail" }); return; }

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    const stream = gcsService.createReadStream(att.thumbnailUrl);
    stream.on("error", () => { if (!res.headersSent) res.status(500).end(); else res.end(); });
    stream.pipe(res);
  } catch (err) {
    log.error("[agent-chat] thumbnail error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/attachments/:id/stream — range-aware streaming for video/audio
router.get("/attachments/:id/stream", async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) { res.status(401).json({ success: false, error: "x-user-id header is required" }); return; }

    const att = await chatAttachmentRepository.findById(req.params.id);
    if (!att) { res.status(404).json({ success: false, error: "Attachment not found" }); return; }

    const allowed = matchesAuthenticatedUserId(req, att.uploaderUserId) || await isClawAdmin(requesterId);
    if (!allowed) { res.status(403).json({ success: false, error: "Forbidden" }); return; }

    const total = att.size;
    const range = req.headers["range"];

    if (!range) {
      res.writeHead(200, {
        "Content-Length": String(total),
        "Content-Type": att.mimeType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      });
      gcsService.createReadStream(att.url).pipe(res);
      return;
    }

    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) { res.status(416).end(); return; }
    const start = match[1] ? Number(match[1]) : 0;
    const maxChunk = 1024 * 1024; // 1MB
    const requestedEnd = match[2] ? Number(match[2]) : total - 1;
    const end = Math.min(requestedEnd, start + maxChunk - 1, total - 1);

    if (start > end || start >= total) {
      res.writeHead(416, { "Content-Range": `bytes */${total}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
      "Content-Type": att.mimeType,
    });
    gcsService.createReadStream(att.url, { start, end }).pipe(res);
  } catch (err) {
    log.error("[agent-chat] stream error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/:slug/context/search — typeahead for attach-context picker
router.get("/:slug/context/search", async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "x-user-id header is required" });
      return;
    }

    const agent = await agentRepository.findBySlugVisibleTo(req.params.slug, getOrgId(req), getRequesterId(req));
    if (!agent) {
      log.warn(`[agent-chat/context-search] agent org-scoped miss slug=${req.params.slug} orgId=${getOrgId(req) ?? "none"} userId=${userId}`);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }

    const rawType = String(req.query["type"] ?? "all").trim() as ContextSearchType;
    if (rawType !== "all" && rawType !== "channel" && rawType !== "ticket" && rawType !== "canvas" && rawType !== "call" && rawType !== "repository") {
      res.status(400).json({ success: false, error: "type must be one of all|channel|ticket|canvas|call|repository" });
      return;
    }
    if (rawType === "repository" && req.params.slug !== "sdlc-agent") {
      res.status(400).json({ success: false, error: "Repository context is only available for the SDLC Assistant" });
      return;
    }

    const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
    const rawLimit = Number(req.query["limit"]);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, Math.floor(rawLimit))) : 20;

    const spacesAuth = await resolveSpacesAuth(req, userId);
    if (!spacesAuth) {
      res.status(401).json({ success: false, error: "Spaces credentials not found. Connect xyne-spaces MCP or provide user token." });
      return;
    }

    const items = await searchContextItems(rawType, q, limit, spacesAuth);
    res.json({ items });
  } catch (err) {
    log.error("[agent-chat] context search error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Platform fallback for the model picker: list models off claw's platform
// LiteLLM key (S2S — the key never leaves claw). Fail-soft: any failure yields
// an empty list so the picker hides instead of erroring the chat page.
async function listPlatformModels(): Promise<{
  success: true;
  data: Array<{ id: string; name: string }>;
  defaultModel: string | null;
  pinProvider: "spaces";
}> {
  const empty = { success: true as const, data: [], defaultModel: null, pinProvider: "spaces" as const };
  if (!CONFIG.xyneClawS2sKey) return empty;
  try {
    const url = `${CONFIG.xyneClawUrl.replace(/\/$/, "")}/internal/litellm/models`;
    const upstream = await fetch(url, {
      headers: { "x-s2s-key": CONFIG.xyneClawS2sKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      log.error(`[agent-chat] platform models via claw failed: ${upstream.status} ${text.slice(0, 200)}`);
      return empty;
    }
    const payload = (await upstream.json()) as { data?: Array<{ id?: string; name?: string }>; defaultModel?: string | null };
    const data = (payload.data ?? [])
      .filter((m): m is { id: string; name?: string } => Boolean(m.id))
      .map((m) => ({ id: m.id, name: m.name ?? m.id }));
    return { success: true, data, defaultModel: payload.defaultModel ?? null, pinProvider: "spaces" };
  } catch (err) {
    log.error("[agent-chat] platform models via claw error:", err);
    return empty;
  }
}

// GET /:slug/litellm-models — models the agent's shared LiteLLM credential can
// access, for the per-chat model switcher. Any authenticated chat participant
// may call this (the router is mounted under requireAuth): it lists models off
// the AGENT's admin-set key so any user can switch the model for the current
// chat via providerOverride — the key itself is never exposed. Returns an empty
// list (not an error) when the agent has no litellm credential so the UI can
// simply hide the picker. `defaultModel` is the agent's configured model, used
// to preselect the dropdown.
router.get("/:slug/litellm-models", async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "x-user-id header is required" });
      return;
    }
    const agent = await agentRepository.findBySlugVisibleTo(req.params.slug, getOrgId(req), getRequesterId(req));
    if (!agent) {
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const cred = await agentProviderCredentialsRepository.findByAgentAndProvider(agent.id, "litellm").catch(() => null);
    const hasCred = Boolean(cred?.encryptedKey && cred?.iv && cred?.authTag);

    // The picker follows the agent's provider ORDER: whichever of spaces /
    // litellm would serve a no-pin run supplies both the model list and the
    // "Recommended" default, so the label always matches what actually runs.
    //   [spaces, litellm…]    → platform list; default = modelSettings.model
    //                           (the agent's Spaces model) ?? platform default
    //   [litellm, …] + cred   → the credential's list; default = cred.model
    //   no order + cred       → litellm (bare-credential fallback, mirrors
    //                           resolveAgentProviderConfigs)
    //   otherwise             → spaces (keyless platform default, via claw —
    //                           LITELLM_API_KEY stays on the claw pod, same
    //                           pattern as entity-llm). pinProvider tells the
    //                           composer which providerOverride a pick rides.
    const agentCfg = (agent.config ?? {}) as Record<string, unknown>;
    const rawOrder = agentCfg["providerOrder"];
    const order = Array.isArray(rawOrder) ? rawOrder.filter((e): e is string => typeof e === "string") : [];
    const relevant = order.filter((e) => e === "spaces" || (e === "litellm" && hasCred));
    // No order → the platform default serves (strict ranking: a credential
    // that was saved but never selected as a provider never routes a run).
    // Legacy config.provider = "litellm" still counts as an explicit selection.
    const legacyProvider = typeof agentCfg["provider"] === "string" ? agentCfg["provider"] : undefined;
    const primary = relevant[0] ?? (order.length === 0 && legacyProvider === "litellm" && hasCred ? "litellm" : "spaces");

    if (primary === "spaces" || !cred?.encryptedKey || !cred.iv || !cred.authTag) {
      const platform = await listPlatformModels();
      const ms = agentCfg["modelSettings"] as Record<string, unknown> | undefined;
      const rawSpacesModel = ms?.["model"];
      const spacesModel = typeof rawSpacesModel === "string" && rawSpacesModel.trim() ? rawSpacesModel.trim() : null;
      res.json({ ...platform, defaultModel: spacesModel ?? platform.defaultModel });
      return;
    }
    const apiKey = decrypt(cred.encryptedKey, cred.iv, cred.authTag, CONFIG.encryptionKey);
    const root = (cred.baseUrl || CONFIG.litellmBaseUrl).replace(/\/+$/, "");
    const upstream = await fetch(`${root}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": "xyne-claw-auth" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      res.status(502).json({ success: false, error: `Models endpoint ${upstream.status}: ${text.slice(0, 200)}` });
      return;
    }
    const payload = (await upstream.json()) as { data?: Array<{ id?: string }> };
    const models = (payload.data ?? [])
      .filter((m): m is { id: string } => Boolean(m.id))
      .map((m) => ({ id: m.id, name: m.id }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, data: models, defaultModel: cred.model ?? null, pinProvider: "litellm" });
  } catch (err) {
    log.error("[agent-chat] litellm-models error:", err);
    // fetch() network failures bury the real reason (ENOTFOUND, ECONNREFUSED)
    // in err.cause — surface it so a prod 500 body is diagnosable on sight.
    const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : "";
    const message = err instanceof Error ? err.message : "Failed to fetch models";
    res.status(500).json({ success: false, error: `${message}${cause}` });
  }
});

// POST /agents/:slug/chat — send a message, stream progress via SSE, return result
router.post("/:slug/chat", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const { slug } = req.params;
    const {
      message,
      conversationId: existingConvId,
      attachmentIds,
      attachedContext,
      providerOverride,
      isRegenerate,
      isEditUserMessage,
      parentUserMessageId,
      parentAssistantMessageId,
      editedUserMessageId,
      disableTools,
      additionalInstructions,
      studioMode,
      designArtifactAttachmentId,
      designSelection,
      researchContext,
      speed: rawSpeed,
      thinkingLevel: rawThinkingLevel,
    } = req.body as {
      message?: string;
      conversationId?: string;
      attachmentIds?: string[];
      attachedContext?: unknown;
      providerOverride?: { provider?: string; model?: string };
      /** Branching: regenerate the assistant reply for `parentUserMessageId` as
       *  a sibling of the existing assistant. */
      isRegenerate?: boolean;
      /** Branching: edit the latest visible user message — creates a sibling
       *  user node under `parentAssistantMessageId` and runs a new turn. */
      isEditUserMessage?: boolean;
      /** Branching: the user message the regenerate is replaying from. */
      parentUserMessageId?: string;
      /** Branching: the assistant message the new user/regenerate branches under. */
      parentAssistantMessageId?: string;
      /** Branching: the user message being replaced by the edit-user branch. */
      editedUserMessageId?: string;
      disableTools?: boolean;
      additionalInstructions?: string;
      studioMode?: "design";
      designArtifactAttachmentId?: string;
      designSelection?: unknown;
      researchContext?: { type?: unknown; id?: unknown; name?: unknown } | null;
      /** Per-message provider fast mode (composer toggle). Rides the agent's
       *  modelSettings.speed for this run only — same credential, same model,
       *  Anthropic's faster tier. Omitted = agent default. */
      speed?: "standard" | "fast";
      /** Per-message thinking level (the composer's model menu). Rides the
       *  agent's modelSettings.thinkingLevel for this run only. */
      thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
    };
    const userId = getRequesterId(req) ?? (req.body as { userId?: string }).userId;
    const speedOverride: "standard" | "fast" | undefined =
      rawSpeed === "fast" || rawSpeed === "standard" ? rawSpeed : undefined;
    if (rawSpeed !== undefined && !speedOverride) {
      res.status(400).json({ success: false, error: 'speed must be "standard" or "fast"' });
      return;
    }
    const CHAT_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;
    const thinkingOverride = typeof rawThinkingLevel === "string" && (CHAT_THINKING_LEVELS as readonly string[]).includes(rawThinkingLevel)
      ? rawThinkingLevel as (typeof CHAT_THINKING_LEVELS)[number]
      : undefined;
    if (rawThinkingLevel !== undefined && !thinkingOverride) {
      res.status(400).json({ success: false, error: `thinkingLevel must be one of: ${CHAT_THINKING_LEVELS.join(", ")}` });
      return;
    }

    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ success: false, error: "message is required" });
      return;
    }
    if (!userId) {
      res.status(400).json({ success: false, error: "userId or x-user-id header required" });
      return;
    }
    if (studioMode !== undefined && studioMode !== "design") {
      res.status(400).json({ success: false, error: "Unknown studioMode" });
      return;
    }
    if (
      designArtifactAttachmentId !== undefined &&
      (studioMode !== "design" || typeof designArtifactAttachmentId !== "string" || designArtifactAttachmentId.length > 200)
    ) {
      res.status(400).json({ success: false, error: "Invalid Design Studio artifact" });
      return;
    }

    const normalizedDesignSelection = (() => {
      if (studioMode !== "design" || !designSelection || typeof designSelection !== "object") return null;
      const value = designSelection as Record<string, unknown>;
      const scope = value["scope"];
      const selector = value["selector"];
      const tagName = value["tagName"];
      if (
        (scope !== "element" && scope !== "component" && scope !== "design-system") ||
        typeof selector !== "string" || !selector.trim() || selector.length > 600 ||
        typeof tagName !== "string" || !tagName.trim() || tagName.length > 80
      ) return null;
      const strings = (input: unknown, limit: number, itemLimit: number): string[] =>
        Array.isArray(input)
          ? input.filter((item): item is string => typeof item === "string").slice(0, limit).map((item) => item.slice(0, itemLimit))
          : [];
      const styles = Object.fromEntries(
        Object.entries(value["styles"] && typeof value["styles"] === "object" ? value["styles"] as Record<string, unknown> : {})
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .slice(0, 30)
          .map(([key, styleValue]) => [key.slice(0, 80), styleValue.slice(0, 240)]),
      );
      return {
        scope,
        selector: selector.trim(),
        tagName: tagName.trim(),
        label: typeof value["label"] === "string" ? value["label"].slice(0, 240) : tagName.trim(),
        id: typeof value["id"] === "string" ? value["id"].slice(0, 160) : undefined,
        classes: strings(value["classes"], 16, 120),
        text: typeof value["text"] === "string" ? value["text"].slice(0, 1200) : "",
        ancestors: strings(value["ancestors"], 6, 600),
        styles,
      };
    })();

    const designSelectionInstruction = normalizedDesignSelection
      ? [
          "## Design Studio selection (captured by the preview inspector)",
          `- Edit scope: ${normalizedDesignSelection.scope}`,
          `- Stable selector: ${normalizedDesignSelection.selector}`,
          `- Node: ${normalizedDesignSelection.tagName}`,
          `- Label: ${normalizedDesignSelection.label}`,
          ...(normalizedDesignSelection.id ? [`- ID: ${normalizedDesignSelection.id}`] : []),
          ...(normalizedDesignSelection.classes.length ? [`- Classes: ${normalizedDesignSelection.classes.join(" ")}`] : []),
          ...(normalizedDesignSelection.ancestors.length ? [`- Ancestors: ${normalizedDesignSelection.ancestors.join(" -> ")}`] : []),
          ...(normalizedDesignSelection.text ? [`- Current text: ${normalizedDesignSelection.text}`] : []),
          `- Computed styles: ${JSON.stringify(normalizedDesignSelection.styles)}`,
          "Apply the user's instruction to this exact node. For component scope, update the reusable component/pattern behind it. " +
            "For design-system scope, update shared tokens/rules and every semantically matching instance; do not merely patch one inline style.",
        ].join("\n")
      : "";

    const agent = await agentRepository.findBySlugVisibleTo(slug, getOrgId(req), userId);
    if (!agent) {
      log.warn(`[agent-chat/chat] agent org-scoped miss slug=${slug} orgId=${getOrgId(req) ?? "none"} userId=${userId}`);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    // Invocation whitelist — dashboard chat surface. Same rule as every other
    // entry point; refused like a disabled/absent agent.
    if (!isAgentInvocableBy(agent.config as Record<string, unknown> | null, userId)) {
      log.warn(`[agent-chat/chat] invocation denied (not whitelisted) slug=${slug} userId=${userId}`);
      res.status(403).json({ success: false, error: `agent "${slug}" is restricted — you don't have access to it` });
      return;
    }
    const conversationId = existingConvId ?? `chat-${randomUUID()}`;

    const sdlcResolution = slug === "sdlc-agent"
      ? await resolveSdlcRepositoryForUser(userId, researchContext, conversationId)
      : { ok: true as const, repository: undefined };
    if (!sdlcResolution.ok) {
      res.status(sdlcResolution.status).json({ success: false, error: sdlcResolution.error });
      return;
    }

    // Eval runs pin the generation LLM per request. Validate up-front (clean
    // 400) — once the SSE stream opens we can only fail mid-stream.
    const OVERRIDABLE = new Set(["spaces", "copilot", "claude", "codex", "litellm"]);
    const override = providerOverride?.provider && OVERRIDABLE.has(providerOverride.provider) ? providerOverride : undefined;
    if (providerOverride?.provider && !override) {
      res.status(400).json({ success: false, error: `Unknown provider override "${providerOverride.provider}"` });
      return;
    }
    // Personal-cred providers (copilot/claude/codex) require the USER's own key.
    // "litellm" is exempt: it rides the AGENT's shared LiteLLM credential (admin-
    // set), so any chat participant may switch among that key's models for the
    // current chat without connecting a personal key. "spaces" is the keyless
    // platform default. The litellm agent cred is validated below (its config
    // must exist in providerConfigs, else the override no-ops).
    if (override?.provider && override.provider !== "spaces" && override.provider !== "litellm") {
      const cred = await userProviderCredentialsRepository.findByUserAndProvider(userId, override.provider).catch(() => null);
      if (!cred?.encryptedKey) {
        res.status(400).json({ success: false, error: `No ${override.provider} credentials for this user — connect it in Settings first` });
        return;
      }
    }

    const normalized = normalizeAttachedContext(attachedContext);
    if (normalized.error) {
      res.status(400).json({ success: false, error: normalized.error });
      return;
    }
    const attachedContextItems = normalized.items;
    const spacesAuth = attachedContextItems.length > 0 ? await resolveSpacesAuth(req, userId) : undefined;
    if (attachedContextItems.length > 0 && !spacesAuth) {
      res.status(401).json({ success: false, error: "Spaces credentials not found for attached context" });
      return;
    }

    // Branching-aware turn setup. Three flows:
    //   1. Regenerate     — skip user create, branch off the existing user.
    //   2. Edit-user      — create a sibling user under the same assistant
    //                       parent, branch the PI session BEFORE that user.
    //   3. Normal send    — create a user under the latest visible assistant,
    //                       resolve the PI session for the selected path.
    // In all three a placeholder assistant row is pre-created (running) so its
    // id can:
    //   • drive the PI session branch suffix (so cloned context stays sibling-isolated)
    //   • be linked to AgentRun.chatMessageId at finalize (so the messages
    //     endpoint can pair runs ↔ assistant messages once branching produces
    //     multiple siblings under the same user parent).
    const existingMessages = existingConvId
      ? (await chatMessageRepository.findByConversation(conversationId)).map((m) => ({
          id: m.id,
          role: m.role,
          parentId: (m as { parentId?: string | null }).parentId ?? null,
          createdAt: m.createdAt,
        }))
      : [];

    let assistantParentId: string | null = null;
    let createdUserMessageId: string | undefined;
    let piConversationId: string = conversationId;
    let cloneSourcePiConversationId: string | null = null;
    let cloneBranchMode: "lastUser" | "beforeLastUser" = "lastUser";
    let hydratedAttachments: Array<{ fileName: string; mimeType: string; data: string }> = [];
    let designArtifactAttachment: { fileName: string; mimeType: string; data: string } | null = null;

    if (studioMode === "design" && designArtifactAttachmentId) {
      const [artifact] = await chatAttachmentRepository.findManyByIdsForUser([designArtifactAttachmentId], userId);
      if (!artifact || (!artifact.mimeType.toLowerCase().includes("html") && !artifact.originalFilename.toLowerCase().endsWith(".html"))) {
        res.status(400).json({ success: false, error: "Design Studio artifact is unavailable" });
        return;
      }
      if (artifact.size > 10 * 1024 * 1024) {
        res.status(400).json({ success: false, error: "Design Studio artifact exceeds the 10 MB HTML limit" });
        return;
      }
      const buf = await gcsService.getFileBuffer(artifact.url);
      designArtifactAttachment = {
        fileName: artifact.originalFilename,
        mimeType: "text/html",
        data: buf.toString("base64"),
      };
    }

    if (isRegenerate && parentUserMessageId) {
      const userMsgRow = existingMessages.find((m) => m.id === parentUserMessageId && m.role === "user");
      if (!userMsgRow) {
        res.status(400).json({ success: false, error: "Invalid parentUserMessageId for regenerate" });
        return;
      }
      assistantParentId = parentUserMessageId;
      // Resolve the source PI session from the ASSISTANT being regenerated
      // (when the caller provided it), not the parent user. Reason: a path
      // that ends on a user message can't identify the branch the user lives
      // in — the branch suffix is the user's assistant CHILD's id, not an
      // ancestor's. Without this, regenerating after edit-user clones from
      // the original conversation's session, so the new turn replays the
      // original user message (and we see all user variants together).
      const existingAssistantId = parentAssistantMessageId
        && existingMessages.some((m) => m.id === parentAssistantMessageId && m.role === "assistant" && m.parentId === parentUserMessageId)
        ? parentAssistantMessageId
        : null;
      cloneSourcePiConversationId = resolvePiConversationIdForPath(
        existingMessages,
        existingAssistantId ?? parentUserMessageId,
        conversationId,
      );
      // Clone the session ending BEFORE the user message we're replaying.
      // PI's runTask always appends `task` as a fresh user entry; if we
      // included the original user msg in the clone (the old "lastUser"
      // mode), the LLM would see TWO consecutive identical user messages
      // and respond as if the user repeated themselves. Symptom: the input
      // panel shows the regen prompt duplicated. The branch lives at a
      // distinct piConversationId, so the original user msg is preserved
      // on its own branch — we just don't carry it into the new one.
      cloneBranchMode = "beforeLastUser";
    } else if (isEditUserMessage && editedUserMessageId) {
      const requestedParent = parentAssistantMessageId
        ? existingMessages.find((m) => m.id === parentAssistantMessageId && m.role === "assistant")
        : undefined;
      const editedUserMsg = existingMessages.find((m) => m.id === editedUserMessageId && m.role === "user");
      if (!editedUserMsg || (editedUserMsg.parentId ?? null) !== (requestedParent?.id ?? null)) {
        res.status(400).json({ success: false, error: "Invalid edited user branch" });
        return;
      }
      cloneSourcePiConversationId = resolvePiConversationIdForPath(
        existingMessages,
        editedUserMessageId,
        conversationId,
      );
      cloneBranchMode = "beforeLastUser";

      const userMsg = await chatMessageRepository.create({
        conversationId, agentSlug: slug, userId, role: "user", content: message.trim(),
        parentId: requestedParent?.id ?? null,
        orgId: agent.orgId,
        ...(attachedContextItems.length > 0 ? { attachedContext: attachedContextItems } : {}),
      });
      createdUserMessageId = userMsg.id;
      assistantParentId = userMsg.id;
    } else {
      const requestedParent = parentAssistantMessageId
        ? existingMessages.find((m) => m.id === parentAssistantMessageId && m.role === "assistant")
        : undefined;
      const lastAssistantMsg = [...existingMessages].reverse().find((m) => m.role === "assistant");
      const userParentId = requestedParent?.id ?? lastAssistantMsg?.id ?? null;
      piConversationId = resolvePiConversationIdForPath(existingMessages, userParentId, conversationId);

      const userMsg = await chatMessageRepository.create({
        conversationId, agentSlug: slug, userId, role: "user", content: message.trim(),
        parentId: userParentId,
        orgId: agent.orgId,
        ...(attachedContextItems.length > 0 ? { attachedContext: attachedContextItems } : {}),
      });
      createdUserMessageId = userMsg.id;
      assistantParentId = userMsg.id;

      if (attachmentIds?.length) {
        await chatAttachmentRepository.linkToMessage(attachmentIds, userMsg.id, userId);
        const rows = await chatAttachmentRepository.findManyByIdsForUser(attachmentIds, userId);
        // Fetch bytes from GCS and encode base64 for /run
        hydratedAttachments = await Promise.all(rows.map(async (r) => {
          const buf = await gcsService.getFileBuffer(r.url);
          return { fileName: r.originalFilename, mimeType: r.mimeType, data: buf.toString("base64") };
        }));
      }
    }

    // A delivered design belongs to the previous assistant message, so never
    // relink it to this new user turn. Rehydrate a user-owned HTML copy only
    // for the run input; this keeps revisions working after sandbox expiry.
    if (
      designArtifactAttachment &&
      !hydratedAttachments.some((attachment) => attachment.fileName === designArtifactAttachment.fileName)
    ) {
      hydratedAttachments.push(designArtifactAttachment);
    }

    // Pre-create the running assistant placeholder. Its id powers PI session
    // branching, AgentRun linkage, and the SSE `done` payload.
    const assistantMsg = await chatMessageRepository.create({
      conversationId, agentSlug: slug, userId, role: "assistant", content: "", status: "running",
      parentId: assistantParentId,
      orgId: agent.orgId,
    });

    // If this turn requires a branched PI session, clone it now (S2S to claw).
    if (cloneSourcePiConversationId) {
      piConversationId = branchPiConversationId(conversationId, assistantMsg.id);
      const cloneSourceSessionKey = piSessionStoreKey(cloneSourcePiConversationId, slug);
      const cloneTargetSessionKey = piSessionStoreKey(piConversationId, slug);
      log.info(
        `[agent-chat] branch clone start conv=${conversationId} agent=${slug} mode=${cloneBranchMode} source=${cloneSourceSessionKey} target=${cloneTargetSessionKey}`,
      );
      const cloneRes = await cloneBranchSession({
        sourceConversationId: cloneSourceSessionKey,
        targetConversationId: cloneTargetSessionKey,
        branchMode: cloneBranchMode,
      }).catch((err) => {
        log.error("[agent-chat] branch clone threw:", err instanceof Error ? err.message : err);
        return { success: false, error: "Failed to create branch session" } as const;
      });
      log.info(`[agent-chat] branch clone result success=${cloneRes.success}`);
      if (!cloneRes.success) {
        const errContent = cloneRes.error ?? "Failed to create branch session";
        await chatMessageRepository.update(assistantMsg.id, { content: errContent, status: "failed" });
        res.status(500).json({ success: false, error: errContent });
        return;
      }
    }

    const user = await userRepository.findById(userId);
    let resolvedContext: { promptPrefix?: string; contextFiles: Array<{ path: string; content: string }> } = { contextFiles: [] };
    if (attachedContextItems.length > 0) {
      try {
        resolvedContext = await buildAttachedContextPayload(attachedContextItems, spacesAuth);
      } catch (err) {
        log.error("[agent-chat] attached context resolve error:", err);
      }
    }

    // Set up SSE
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable proxy buffering (istio/nginx)
    });

    // Whether this subscriber may receive `debug` frames. Same predicate the
    // stored-history endpoint uses for `debugEvents`, so a caller sees the same
    // debug content live as it would on replay. Resolved here, before the SSE
    // promise, because the callback that forwards frames arrives on a separate
    // S2S request with no end-user identity of its own.
    const debugIsAdmin = await isClawAdmin(userId);
    const debugEditAccess = debugIsAdmin ? null : await getAgentEditAccess(userId, slug, getOrgId(req));
    const allowDebug = debugIsAdmin || Boolean(debugEditAccess?.canEdit);

    // Send conversationId immediately
    res.write(`event: meta\ndata: ${JSON.stringify({ conversationId })}\n\n`);

    // Heartbeat: every LB/proxy hop kills idle SSE connections, and tool-heavy
    // runs (/design sandbox creation, long generations) go 60s+ with no events
    // — the browser then freezes on the last event with no error while the run
    // continues server-side (prod 2026-08-08). SSE comment frames are invisible
    // to EventSource parsers, so this keeps every hop's idle timer at zero with
    // no client change. res "close" fires on ALL end paths (server res.end()
    // and client disconnect), so the interval can never leak.
    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        try { res.write(":hb\n\n"); } catch { /* client gone; close handler clears */ }
      }
    }, 15_000);
    res.on("close", () => clearInterval(heartbeat));

    const callbackId = randomUUID();

    // Create promise for final result
    const resultPromise = new Promise<{
      content: string;
      status: "completed" | "failed" | "cancelled";
      errorCode?: string | undefined;
      pendingActions?: Array<Record<string, unknown>>;
      persisted?: boolean;
      persistedAttachments?: PersistedAttachment[];
    }>((resolve) => {
      let closed = false;
      // This pod now holds a live SSE stream — make sure it's listening on the
      // cross-pod event bus so progress/result callbacks that land on OTHER
      // pods get forwarded here.
      ensureChatEventsSubscriber();
      pendingStreams.set(callbackId, {
        sendEvent: (event, data) => {
          if (closed) return;
          try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
        },
        resolve,
        setClosed: () => { closed = true; },
        assistantMessageId: assistantMsg.id,
        allowDebug,
        ...(createdUserMessageId ? { userMessageId: createdUserMessageId } : {}),
        ...(assistantParentId ? { assistantParentId } : {}),
      });

      // Safety-net timeout for the SSE wait. Real runs usually finish in < 2 min,
      // but heavy agents (deep subagent chains, slow tools) can take longer —
      // this is only a cap for when xyne-claw never posts back at all.
      setTimeout(() => {
        if (pendingStreams.has(callbackId)) {
          pendingStreams.delete(callbackId);
          resolve({ content: "Agent timed out", status: "failed" });
        }
      }, 30 * 60 * 1000); // 30 minutes
    });

    // Call /run.
    //
    // assistantMessageId is threaded on the URL (not just in pendingStreams)
    // so the callback handler — which lands on whichever claw-auth pod the k8s
    // Service routes it to, NOT necessarily the SSE-owning pod — can finalize
    // the same row that was pre-created here. Without it, the cross-pod
    // callback would create a NEW row and the pre-created placeholder would
    // dangle in "running" forever.
    const callbackUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/agent-chat/${slug}/chat/${conversationId}/callback?callbackId=${callbackId}&assistantMessageId=${assistantMsg.id}`;
    // assistantMessageId also threaded here so the /progress webhook (which may
    // land on another pod) can debounce-persist partial assistant content onto
    // the pre-created placeholder row — so a reload mid-run shows the answer-so-far.
    const progressUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/agent-chat/${slug}/chat/${conversationId}/progress?callbackId=${callbackId}&assistantMessageId=${assistantMsg.id}`;

    // Resolve provider + credentials with the same 3-layer chain as webhook:
    //   1. user's personal provider (userAgentConfig + userProviderCredentials)
    //   2. agent-level shared provider (agent.config.provider + agentProviderCredentials)
    //   3. "spaces" / LiteLLM platform default
    const userAgentConfig = await userAgentConfigRepository.findByUserAndAgent(userId, agent.orgId, slug).catch(() => null);
    const rawPersonalProvider = userAgentConfig?.provider;
    // "spaces" is the platform-default sentinel, not a real personal credential —
    // saving it should not override the agent-level providerOrder/credentials.
    const personalProvider = rawPersonalProvider && rawPersonalProvider !== "spaces"
      ? rawPersonalProvider
      : undefined;
    // Effective speed for THIS run: the composer toggle wins, else the agent
    // default. Fast mode may resolve against its own provider profile
    // (config.fastModeProfile) — same credential keys, possibly different
    // providers/models. See lib/agent-provider-config.ts.
    const effectiveSpeed = speedOverride ?? agentDefaultSpeed(agent.config);
    const speedConfig = providerConfigForSpeed(agent.config, effectiveSpeed);
    const agentLevelProvider = speedConfig["provider"] as string | undefined;
    const rawProviderOrder = speedConfig["providerOrder"];
    const agentProviderOrder: string[] = Array.isArray(rawProviderOrder)
      ? rawProviderOrder.filter((p): p is string => typeof p === "string" && KNOWN_PROVIDERS.has(p))
      : [];
    const userProvider = personalProvider ?? agentLevelProvider;

    const allCreds = await userProviderCredentialsRepository.listByUser(userId).catch(() => []);
    const agentCreds = await agentProviderCredentialsRepository.listByAgent(agent.id).catch(() => []);
    const subagentConfigs = await userSubagentConfigRepository.listByUser(userId).catch(() => []);
    const subagentProviders: Record<string, string> = {};
    for (const s of subagentConfigs) subagentProviders[s.subagentName] = s.provider;

    // buildProviderConfig + KNOWN_PROVIDERS come from the shared resolver module
    // (lib/agent-provider-config.ts) — one source of truth for the per-provider
    // default models + OAuth-bundle extraction, so adding a provider is a
    // one-place change (this used to be an inline `buildCfg` copy).
    const providerConfigs: Record<string, { apiKey: string; model: string; baseUrl?: string; authType?: string; reasoningEffort?: string }> = {};
    const providerScope: Record<string, "user" | "agent"> = {};
    // User-level wins.
    for (const row of allCreds) {
      const cfg = buildProviderConfig(row.provider, row);
      if (cfg) { providerConfigs[row.provider] = cfg; providerScope[row.provider] = "user"; }
    }
    // Agent-level fills in only what the user hasn't configured personally.
    for (const row of agentCreds) {
      if (providerConfigs[row.provider]) continue;
      const cfg = buildProviderConfig(row.provider, row);
      if (cfg) { providerConfigs[row.provider] = cfg; providerScope[row.provider] = "agent"; }
    }
    applyFastModeModels(providerConfigs, agent.config, effectiveSpeed);

    // Refresh Claude OAuth before use (short-lived token; see webhook.ts for the
    // rationale). Mutates the resolved config's apiKey and persists the rotated
    // token to the owning cred row. Pass-through for api_key / bare-token creds.
    const claudeCfg = providerConfigs["claude"];
    if (claudeCfg && claudeCfg.authType === "oauth_token") {
      const scope = providerScope["claude"];
      const credRow = scope === "agent"
        ? agentCreds.find((c) => c.provider === "claude")
        : allCreds.find((c) => c.provider === "claude");
      const ownerId = scope === "agent" ? agent.id : userId;
      if (credRow) {
        // Rows in either scope may be bindings to a shared org credential —
        // the refresh then targets the shared row (see agentCredRefreshTarget).
        const target = scope === "agent"
          ? agentCredRefreshTarget(agent.id, "claude", credRow as { sharedCredentialId?: string | null })
          : userCredRefreshTarget(userId, "claude", credRow as { sharedCredentialId?: string | null });
        try {
          claudeCfg.apiKey = await getValidClaudeBearer(target.credKey, credRow, target.persist);
        } catch (err) {
          log.warn("[agent-chat] Claude OAuth refresh failed — credential likely needs reconnect:", err instanceof Error ? err.message : err);
        }
      }
    }

    // Resolution: personal user provider always wins. Otherwise providerOrder
    // (canonical) takes over, with legacy config.provider as fallback for
    // agents that haven't migrated yet.
    // STRICT RANKING — top first. "spaces" is keyless and can always serve,
    // so an explicit spaces entry wins over lower-ranked saved credentials
    // (mirrors resolveAgentProviderConfigs).
    let resolvedParentProvider = personalProvider;
    if (!resolvedParentProvider && agentProviderOrder.length > 0) {
      resolvedParentProvider = agentProviderOrder.find((p) => p === "spaces" || providerConfigs[p]) ?? agentProviderOrder[0];
    }
    if (!resolvedParentProvider && agentLevelProvider) {
      resolvedParentProvider = agentLevelProvider;
    }
    let runtimeProviderOrder: string[] = agentProviderOrder.length > 0
      ? agentProviderOrder
      : (resolvedParentProvider ? [resolvedParentProvider] : []);

    // Apply the eval provider/model pin. "spaces" rides claw's per-agent
    // modelSettings override (agent-model-settings.ts); personal providers pin
    // their config's model. providerOrder is cleared so a quota fallback can't
    // silently swap providers mid-eval.
    let runAgentConfig = agent?.config as Record<string, unknown> | undefined;
    if (sdlcResolution.repository) {
      runAgentConfig = {
        ...(runAgentConfig ?? {}),
        sdlcContext: sdlcResolution.repository.agentContext,
      };
    }
    if (override?.provider) {
      if (override.provider === "spaces") {
        resolvedParentProvider = "spaces";
        if (override.model?.trim()) {
          runAgentConfig = {
            ...(runAgentConfig ?? {}),
            modelSettings: {
              ...((runAgentConfig?.["modelSettings"] as Record<string, unknown> | undefined) ?? {}),
              model: override.model.trim(),
            },
          };
        }
        runtimeProviderOrder = [];
      } else {
        // Pin the override provider only if we actually hold its credential.
        // litellm's cred is the AGENT's shared key (already in providerConfigs
        // for any user); personal providers are the user's own. Without the
        // cred, ignore the override and fall through to normal resolution
        // rather than forcing a provider claw can't serve (which would silently
        // drop to the platform default).
        const cfg = providerConfigs[override.provider];
        if (cfg) {
          resolvedParentProvider = override.provider;
          if (override.model?.trim()) providerConfigs[override.provider] = { ...cfg, model: override.model.trim() };
          runtimeProviderOrder = [];
        } else if (override.provider === "litellm" && override.model?.trim()) {
          // No agent litellm credential — the pick came off the platform
          // allowed-model list (litellm-models' claw fallback). Apply it as a
          // "spaces" pin so it still takes effect instead of silently no-oping.
          resolvedParentProvider = "spaces";
          runAgentConfig = {
            ...(runAgentConfig ?? {}),
            modelSettings: {
              ...((runAgentConfig?.["modelSettings"] as Record<string, unknown> | undefined) ?? {}),
              model: override.model.trim(),
            },
          };
          runtimeProviderOrder = [];
        }
      }
    }

    // Per-message fast-mode / thinking overrides win over the agent's saved
    // modelSettings for this run only (not persisted to the agent). The
    // thinking pick also outranks the fast profile's thinking override —
    // claw overlays fastModeProfile.modelSettings over modelSettings on fast
    // runs, so mirror the choice into the profile too when one exists.
    if (speedOverride || thinkingOverride) {
      runAgentConfig = {
        ...(runAgentConfig ?? {}),
        modelSettings: {
          ...((runAgentConfig?.["modelSettings"] as Record<string, unknown> | undefined) ?? {}),
          ...(speedOverride ? { speed: speedOverride } : {}),
          ...(thinkingOverride ? { thinkingLevel: thinkingOverride } : {}),
        },
      };
      const profile = runAgentConfig["fastModeProfile"];
      if (thinkingOverride && profile && typeof profile === "object" && !Array.isArray(profile)
          && (profile as Record<string, unknown>)["modelSettings"]) {
        runAgentConfig["fastModeProfile"] = {
          ...(profile as Record<string, unknown>),
          modelSettings: {
            ...((profile as Record<string, unknown>)["modelSettings"] as Record<string, unknown>),
            thinkingLevel: thinkingOverride,
          },
        };
      }
    }
    const effectiveAgentConfig = disableTools
      ? {
          ...(runAgentConfig ?? {}),
          tools: { subagents: [], direct: [], custom: [], gateway: [] },
          toolPermissions: {},
        }
      : runAgentConfig;
    const fastModeEnabled = await resolveFastMode(conversationId, slug, effectiveAgentConfig);

    const forwardBody: Record<string, unknown> = {
      userId,
      userName: user?.name,
      userEmail: user?.email,
      task: studioMode === "design" ? `/design ${message.trim()}` : message.trim(),
      conversationId,
      orgId: agent.orgId,
      ...(piConversationId !== conversationId ? { piSessionConversationId: piConversationId } : {}),
      ...(isRegenerate ? { isRegenerate: true } : {}),
      agentSlug: slug,
      __persistedByCaller: true,
      ...(resolvedParentProvider ? { provider: resolvedParentProvider } : {}),
      ...(runtimeProviderOrder.length > 1 ? { providerOrder: runtimeProviderOrder } : {}),
      ...(Object.keys(subagentProviders).length > 0 ? { subagentProviders } : {}),
      ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
      callbackUrl,
      progressUrl,
      ...(resolvedContext.promptPrefix ? { context: resolvedContext.promptPrefix } : {}),
      ...(resolvedContext.contextFiles.length > 0 ? { contextFiles: resolvedContext.contextFiles } : {}),
      ...(attachedContextItems.length > 0 ? { attachedContext: attachedContextItems } : {}),
      ...(hydratedAttachments.length ? { attachments: hydratedAttachments } : {}),
      ...(additionalInstructions && additionalInstructions.trim()
        ? { additionalInstructions: additionalInstructions.trim() }
        : {}),
      ...(designSelectionInstruction
        ? {
            additionalInstructions: [additionalInstructions?.trim(), designSelectionInstruction]
              .filter(Boolean)
              .join("\n\n"),
          }
        : {}),
      ...(researchContext ? { researchContext } : {}),
      // Ship the agent's JSONB config so xyne-claw can enable per-agent
      // features that read from it: memoryEnabled, toolPermissions,
      // skillTriggers, promptInjections, custom-tool config values.
      // Without this, those features silently default to "off" on V2
      // dashboard chat (same bug existed for webhook + scheduled jobs).
      ...(effectiveAgentConfig ? { agentConfig: effectiveAgentConfig } : {}),
      fastMode: fastModeEnabled,
    };

    // SSE consumer path. We send Accept: text/event-stream so the /run proxy
    // routes us through SSE pass-through (one ordered TCP connection from
    // claw → claw-auth) instead of falling back to the legacy POST bridge,
    // which would translate each SSE frame back into the localhost
    // /agent-chat/.../progress POSTs you're seeing in the logs. Each SSE
    // frame is dispatched into the same pendingStreams.sendEvent / repo /
    // redis publishes the legacy /progress handler runs (kept inline below),
    // so frontend behavior is unchanged byte-for-byte. On done, we POST the
    // final payload into our own /callback handler — same trick as
    // run-stream.ts — so all the finalize + persistAssistantResult + resolve
    // wiring stays in one place.
    let runBody: { success: boolean; sessionId?: string; error?: string; deferred?: boolean };
    if (CONFIG.clawSseTransport) {
      runBody = await runAgentChatViaSse({
        forwardBody,
        callbackId,
        slug,
        conversationId,
        callbackUrl,
        assistantMessageId: assistantMsg.id,
      });
    } else {
      const runRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        },
        body: JSON.stringify(forwardBody),
      });
      runBody = (await runRes.json()) as { success: boolean; sessionId?: string; error?: string };
    }

    // Track run for Agent Control Center
    if (runBody.success && runBody.sessionId) {
      res.write(`event: run\ndata: ${JSON.stringify({ sessionId: runBody.sessionId })}\n\n`);
      agentRunRepository.start({
        sessionId: runBody.sessionId,
        userId,
        agentSlug: slug,
        orgId: agent.orgId,
        triggerSource: "chat",
        task: message.trim(),
        conversationId,
        fastMode: fastModeEnabled,
      }).catch((e) => log.warn("[agent-chat] AgentRun.start failed:", e instanceof Error ? e.message : e));
      redisService.getConnection()
        .publish("cc:events", JSON.stringify({ type: "agent_start", sessionId: runBody.sessionId, agentSlug: slug }))
        .catch(() => {});
    }

    // Deferred = this run was skipped because another worker already owns the
    // conversation (duplicate/retried dispatch). The owning run is still in
    // flight and delivers the answer via the live-bus into its OWN message, so
    // we must NOT write a "failed" error bubble here. Drop this redundant run's
    // placeholder and end the stream quietly; the frontend reconciles on its
    // next /messages fetch (and via `event: superseded` for live removal).
    if (!runBody.success && runBody.deferred) {
      pendingStreams.delete(callbackId);
      await chatMessageRepository.deleteById(assistantMsg.id).catch(() => {});
      log.info(`[agent-chat] deferred run (conversation already locked) — dropped duplicate placeholder ${assistantMsg.id}, conv=${conversationId}`);
      res.write(`event: superseded\ndata: ${JSON.stringify({ id: assistantMsg.id })}\n\n`);
      res.end();
      return;
    }

    if (!runBody.success) {
      pendingStreams.delete(callbackId);
      const errContent = widgetErrorContent(runBody.error, runBody.error ?? "Failed to start agent");
      // Update the pre-created placeholder rather than creating a second
      // assistant row — keeps the assistant id stable for the frontend.
      await chatMessageRepository.update(assistantMsg.id, { content: errContent, status: "failed" });
      res.write(`event: done\ndata: ${JSON.stringify({
        id: assistantMsg.id,
        userMessageId: createdUserMessageId,
        role: "assistant",
        content: errContent,
        status: "failed",
        ...(runBody.error ? { errorCode: runBody.error } : {}),
        parentId: assistantParentId,
      })}\n\n`);
      res.end();
      return;
    }

    // Keep backend processing alive even if the client disconnects (e.g. user
    // clicked Stop and aborted the fetch). We still persist the final message/run.
    req.on("close", () => {
      pendingStreams.get(callbackId)?.setClosed();
    });

    // Wait for result
    const result = await resultPromise;

    // Durability now lives in the /callback handler (pod-independent persist
    // with a cross-pod idempotency guard). This path only writes a row for
    // resolutions that never went through the callback — the 30-min safety
    // timeout and dispatch failures — where `persisted` is unset. With
    // branching, the assistant row is pre-created, so we UPDATE rather than
    // create in the fallback to keep the assistant id stable.
    const persistedAttachments: PersistedAttachment[] = result.persistedAttachments ?? [];
    if (!result.persisted) {
      await chatMessageRepository.update(assistantMsg.id, { content: result.content, status: result.status });
    }

    // Send final result and close. pendingActions flow through so the chat UI
    // can render Approve/Decline buttons per write-tool that needs sign-off.
    const pendingActionsForClient = (result as { pendingActions?: Array<Record<string, unknown>> }).pendingActions ?? [];
    if (!res.writableEnded && !res.destroyed) {
      res.write(`event: done\ndata: ${JSON.stringify({
        id: assistantMsg.id,
        userMessageId: createdUserMessageId,
        role: "assistant",
        content: result.content,
        status: result.status,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        parentId: assistantParentId,
        ...(pendingActionsForClient.length ? { pendingActions: pendingActionsForClient } : {}),
        ...(persistedAttachments.length ? { attachments: persistedAttachments } : {}),
      })}\n\n`);
      res.end();
    }
  } catch (err) {
    log.error("[agent-chat] send error:", err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Internal server error" });
    } else {
      res.end();
    }
  }
});

// POST /agents/:slug/chat/cancel — cancel an in-flight chat run
router.post("/:slug/chat/cancel", async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
  try {
    const userId = getRequesterId(req) ?? (req.body as { userId?: string }).userId;
    if (!userId) {
      res.status(400).json({ success: false, error: "userId or x-user-id header required" });
      return;
    }

    const { slug } = req.params;
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId || typeof sessionId !== "string") {
      res.status(400).json({ success: false, error: "sessionId is required" });
      return;
    }

    const run = await agentRunRepository.findBySessionId(sessionId);
    // run.userId may be keyed by either verified representation of this
    // caller (canonical Claw id or raw Spaces id) — accept both, and forward
    // the run's stored owner id to preserve it across the S2S hop.
    if (!run || (run.userId !== userId && !matchesAuthenticatedUserId(req, run.userId)) || run.agentSlug !== slug) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }

    if (run.status !== "running") {
      res.json({
        success: true,
        data: { sessionId, conversationId: run.conversationId, status: run.status },
      });
      return;
    }

    // Ownership was checked above; preserve it across the S2S hop.
    try {
      await cancelRunSession(sessionId, run.userId);
    } catch (err) {
      res.status(502).json({ success: false, error: errMsg(err) });
      return;
    }

    res.json({
      success: true,
      data: { sessionId, conversationId: run.conversationId, status: "cancelled" },
    });
  } catch (err) {
    log.error("[agent-chat] cancel error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /agents/:slug/chat/:convId/regenerate — derive the inputs for a
// regenerate. Finds the latest assistant message on the current conversation
// path and returns its parent-user content + id so the client can post a
// follow-up to POST /:slug/chat with isRegenerate=true to spawn a sibling
// assistant under the same user message.
router.post("/:slug/chat/:convId/regenerate", async (req: Request<{ slug: string; convId: string }>, res: Response) => {
  try {
    const { slug, convId } = req.params;
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(400).json({ success: false, error: "userId or x-user-id header required" });
      return;
    }

    const regenAliases = new Set(getRequesterAliases(req));
    const messages = (await chatMessageRepository.findByConversationAndAgent(convId, slug)).filter(
      (m) => regenAliases.has(m.userId),
    );
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) {
      res.status(400).json({ success: false, error: "No assistant message found" });
      return;
    }
    const parentId = (lastAssistant as { parentId?: string | null }).parentId;
    if (!parentId) {
      res.status(400).json({ success: false, error: "No parent user message" });
      return;
    }
    const parentUserMsg = messages.find((m) => m.id === parentId && m.role === "user");
    if (!parentUserMsg) {
      res.status(400).json({ success: false, error: "Parent user message not found" });
      return;
    }
    res.json({
      success: true,
      data: {
        replayMessage: parentUserMsg.content,
        parentUserMessageId: parentUserMsg.id,
      },
    });
  } catch (err) {
    log.error("[agent-chat] regenerate error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /agents/:slug/chat/:convId/progress — tool progress from xyne-claw (internal, no auth)
internalRouter.post("/:slug/chat/:convId/progress", async (req: Request<{ slug: string; convId: string }>, res: Response) => {
  res.json({ success: true });

  const callbackId = req.query["callbackId"] as string | undefined;
  const { toolLabel, sessionId, toolInvocation, reasoningDelta, textDelta, attachment, debugEvent } = req.body as {
    toolLabel?: string;
    sessionId?: string;
    toolInvocation?: unknown;
    reasoningDelta?: string;
    textDelta?: string;
    attachment?: { fileName: string; mimeType: string; data: string; metadata?: Record<string, unknown> };
    debugEvent?: Record<string, unknown>;
  };

  const stream = callbackId ? pendingStreams.get(callbackId) : undefined;

  // Collect the SSE events this progress POST translates to, then deliver
  // them either to the local stream or — when the k8s Service routed this
  // POST to a pod that doesn't hold the browser's SSE (the common
  // multi-replica case; previously these were silently dropped) — fan out
  // via Redis pub/sub to whichever pod does.
  const events: Array<{ event: string; data: unknown }> = [];
  // Tier 1: live tool label on tool_execution_start.
  if (toolLabel) events.push({ event: "progress", data: { toolLabel } });
  // Tier 1 + 2: full tool invocation on tool_execution_end.
  // toolInvocation may carry parentToolCallId + subagentName for nested child rows.
  if (toolInvocation) events.push({ event: "tool", data: { toolInvocation } });
  // Tier 3: reasoning / text deltas char-by-char as they arrive from the model.
  if (typeof reasoningDelta === "string" && reasoningDelta.length > 0) events.push({ event: "reasoning", data: { delta: reasoningDelta } });
  if (typeof textDelta === "string" && textDelta.length > 0) events.push({ event: "text", data: { delta: textDelta } });
  // Stream a just-captured attachment (e.g. create-ppt PPTX) so the UI
  // renders it mid-session instead of waiting for finalize.
  if (attachment) events.push({ event: "attachment", data: { attachment } });
  if (debugEvent) events.push({ event: "debug", data: { debugEvent } });

  if (events.length > 0 && callbackId) {
    if (stream) {
      // `debug` is withheld unless the subscriber was resolved as elevated when
      // the stream opened. Filtered at delivery rather than at construction
      // because the same `events` array is also published cross-pod, where the
      // receiving pod owns the subscriber and applies this same check.
      for (const e of events) {
        if (e.event === "debug" && !stream.allowDebug) continue;
        stream.sendEvent(e.event, e.data);
      }
    } else {
      publishChatEvent({ kind: "progress", callbackId, events });
    }
  }

  if (sessionId && toolInvocation) {
    agentRunRepository.appendToolInvocation(sessionId, toolInvocation).catch(() => {});
    if (CONFIG.liveToolCallsEnabled) {
      liveUserIdForSession(sessionId)
        .then((uid) => {
          if (uid)
            publishLiveEvent(req.params.convId, {
              type: "invocation",
              conversationId: req.params.convId,
              agentSlug: req.params.slug,
              userId: uid,
              toolInvocation,
              ts: Date.now(),
            });
        })
        .catch(() => {});
    }
  }

  // Streamed attachments are UI-only: the final callback persists them to GCS
  // and the `done` event ships canonical IDs that replace the blob-backed
  // placeholders on the client.

  // Live assistant text/reasoning for VIEWERS (reloaded tabs, Spaces): coalesce
  // the deltas → one live-bus `delta` event every ~250ms + a debounced partial
  // persist. The driving tab is unaffected (its own stream already got these
  // above); applyLiveEvent's driving-tab guard prevents double-render.
  if (sessionId && CONFIG.liveToolCallsEnabled && ((typeof textDelta === "string" && textDelta) || (typeof reasoningDelta === "string" && reasoningDelta))) {
    const assistantMessageId = typeof req.query["assistantMessageId"] === "string" ? req.query["assistantMessageId"] : undefined;
    pushDelta(sessionId, req.params.convId, req.params.slug, assistantMessageId, textDelta, reasoningDelta);
  }

  if (sessionId && toolLabel) {
    agentRunRepository.updateProgress(sessionId, toolLabel).catch(() => {});
    redisService.getConnection()
      .publish("cc:events", JSON.stringify({ type: "agent_progress", sessionId, toolLabel }))
      .catch(() => {});
    if (CONFIG.liveToolCallsEnabled) {
      liveUserIdForSession(sessionId)
        .then((uid) => {
          if (uid)
            publishLiveEvent(req.params.convId, {
              type: "label",
              conversationId: req.params.convId,
              agentSlug: req.params.slug,
              userId: uid,
              toolLabel,
              ts: Date.now(),
            });
        })
        .catch(() => {});
    }
  }
});

// POST /agents/:slug/chat/:convId/callback — final result from xyne-claw (internal, no auth)
internalRouter.post("/:slug/chat/:convId/callback", async (req: Request<{ slug: string; convId: string }>, res: Response) => {
  res.json({ success: true });

  const callbackId = req.query["callbackId"] as string | undefined;
  // assistantMessageId is the pre-created placeholder row id (branching). Read
  // from query because the callback may land on a different pod than the SSE
  // owner, so pendingStreams may not have it locally.
  const queryAssistantMessageId = req.query["assistantMessageId"] as string | undefined;
  const { result: rawResult, status, error, pendingActions, pendingResponses, sessionId, userId, toolsUsed, toolInvocations, tokenUsage, attachments, llmCitations, provider, model, fastMode } = req.body as {
    result?: string;
    status?: string;
    error?: string;
    pendingActions?: Array<Record<string, unknown>>;
    pendingResponses?: Array<{ responseId?: string; message?: string }>;
    sessionId?: string;
    userId?: string;
    toolsUsed?: string[];
    toolInvocations?: unknown;
    tokenUsage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    attachments?: CallbackAttachment[];
    llmCitations?: unknown;
    provider?: string;
    model?: string;
    fastMode?: boolean;
  };
  // Terminal event — stop this session's delta coalescer FIRST so a late
  // debounced partial write can't clobber the final content persisted below.
  if (sessionId) endDeltaCoalescer(sessionId);
  // Copilot answers travel via pendingResponses (respond-to-user tool) with an
  // empty result — join them so chat consumers (incl. eval replays) see the
  // real answer instead of a blank message.
  const result =
    rawResult && rawResult.trim()
      ? rawResult
      : pendingResponses?.length
        ? pendingResponses.map((pr) => pr.message ?? "").filter(Boolean).join("\n\n")
        : rawResult;
  const callbackOrgId = await resolveCallbackOrgId(req, sessionId, userId);

  // Per-agent citation toggle (see webhook.ts for the same pattern). Reads
  // `config.replyOptions.includeCitations` on the agent row; defaults to
  // false. Agents that want the "### Citations" block must opt in by
  // setting replyOptions.includeCitations = true on their config.
  let includeCitations = false;
  try {
    const agentRow = callbackOrgId
      ? await agentRepository.findBySlugVisibleTo(req.params.slug, callbackOrgId, userId)
      : null;
    const replyOpts = (agentRow?.config as { replyOptions?: { includeCitations?: boolean } } | undefined)?.replyOptions;
    if (replyOpts && replyOpts.includeCitations === true) includeCitations = true;
  } catch {
    // Non-fatal — keep default (no citations).
  }

  const enrichedResult = status === "completed" && result
    ? appendCitations(result, toolInvocations, { baseUrl: CONFIG.spacesAppUrl, includeCitations }, llmCitations)
    : result;

  // Resolve the pre-created assistant message id for this run. We prefer the
  // URL query param (cross-pod safe), and fall back to the SSE pod's local
  // pendingStreams entry when present. Branching needs this so AgentRun is
  // linked to the EXACT assistant message that produced the run — chronology
  // pairing breaks once a user has multiple assistant siblings.
  const localStreamForId = callbackId ? pendingStreams.get(callbackId) : undefined;
  const chatMessageId = queryAssistantMessageId ?? localStreamForId?.assistantMessageId;

  // Await finalize BEFORE resolving the pending stream. The stream resolution
  // drives the SSE `done` event on the client, which triggers refreshRuns().
  // Without this await, refreshRuns would race finalize and fetch stale state
  // — stale "running" tool rows that should have been swept to completed.
  if (sessionId) {
    const finalStatus = normalizeRunStatus(status);
    try {
      await agentRunRepository.finalize(sessionId, {
        status: finalStatus,
        result: enrichedResult ?? null,
        error: error ?? null,
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        toolsUsed: toolsUsed ?? [],
        ...(chatMessageId ? { chatMessageId } : {}),
        ...(toolInvocations !== undefined ? { toolInvocations } : {}),
        ...(tokenUsage ? { tokenUsage } : {}),
        ...(fastMode !== undefined ? { fastMode } : {}),
      });
    } catch (err) {
      log.warn("[agent-chat] finalize failed:", err instanceof Error ? err.message : err);
    }
    redisService.getConnection()
      .publish("cc:events", JSON.stringify({ type: "agent_done", sessionId, status: finalStatus }))
      .catch(() => {});
  }

  // Live tap: tell /live viewers the turn finished so they refetch the canonical
  // transcript. userId comes from the callback body (the triggering user).
  if (CONFIG.liveToolCallsEnabled && userId) {
    publishLiveEvent(req.params.convId, {
      type: "done",
      conversationId: req.params.convId,
      agentSlug: req.params.slug,
      userId,
      status: normalizeRunStatus(status),
      ts: Date.now(),
    });
  }

  // DURABLE write: persist the assistant message + attachments HERE, on
  // whichever pod received the callback — not on the SSE pod. Before this,
  // persistence ran only after the SSE pod's in-memory promise resolved; with
  // multiple replicas the callback usually lands elsewhere, the promise never
  // resolved, and the message was lost from the chat UI (still visible in
  // /debug via finalize above). The SETNX guard inside makes this idempotent
  // across claw's callback retries.
  const finalContent = enrichedResult ?? widgetErrorContent(error, error ?? "No response");
  const finalStatus = normalizeRunStatus(status);
  const errorCode = typeof error === "string" ? error : undefined;
  // persistedFlag semantics: true ⇔ a chat_messages row for this result
  // durably exists (written now, or by an earlier retry that won the SETNX
  // guard). Only then may the SSE pod skip its own fallback write. A thrown
  // persist or a missing userId leaves it false so the SSE pod still writes.
  let persistedFlag = false;
  let persisted: { messageId: string; persistedAttachments: PersistedAttachment[] } | null = null;
  if (userId && callbackOrgId) {
    try {
      const agent = await agentRepository.findBySlugVisibleTo(req.params.slug, callbackOrgId, userId);
      if (!agent) {
        log.warn(`[agent-chat/result] agent org-scoped miss slug=${req.params.slug} orgId=${callbackOrgId ?? "none"} userId=${userId ?? "none"} sessionId=${req.params.convId}`);
        res.status(404).json({ success: false, error: "Agent not found" });
        return;
      }
      persisted = await persistAssistantResult({
        conversationId: req.params.convId,
        agentSlug: req.params.slug,
        userId,
        orgId: agent.orgId,
        content: finalContent,
        status: finalStatus,
        ...(attachments?.length ? { attachments } : {}),
        ...(toolInvocations !== undefined ? { toolInvocations } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(chatMessageId ? { assistantMessageId: chatMessageId } : {}),
      });
      persistedFlag = true; // non-null = written now; null = guard loss = a retry already wrote it
    } catch (err) {
      log.error("[agent-chat] callback-side persist failed (SSE pod will fall back):", err instanceof Error ? err.message : err);
    }
  } else if (userId && !callbackOrgId) {
    log.warn(`[agent-chat] callback without orgId (conv=${req.params.convId}, session=${sessionId ?? "?"}) — message persistence falls back to the SSE pod`);
  } else {
    log.warn(`[agent-chat] callback without userId (conv=${req.params.convId}) — message persistence falls back to the SSE pod`);
  }
  const persistedAttachments = persisted?.persistedAttachments ?? [];

  const resolvePayload = {
    content: finalContent,
    status: finalStatus,
    ...(errorCode ? { errorCode } : {}),
    ...(pendingActions?.length ? { pendingActions } : {}),
    persisted: persistedFlag,
    ...(persistedAttachments.length ? { persistedAttachments } : {}),
  };

  if (callbackId && pendingStreams.has(callbackId)) {
    // Stream lives on THIS pod — resolve directly.
    const stream = pendingStreams.get(callbackId)!;
    stream.sendEvent("debug_artifacts_ready", {
      ...(sessionId ? { sessionId } : {}),
      conversationId: req.params.convId,
    });
    pendingStreams.delete(callbackId);
    stream.resolve(resolvePayload);
  } else if (callbackId) {
    // Stream lives on another pod (the common multi-replica case) — fan out
    // via Redis so that pod resolves its SSE. Liveness only: the message is
    // already persisted above, so a lost publish degrades to "shows on next
    // refresh" instead of data loss.
    publishChatEvent({
      kind: "result",
      callbackId,
      conversationId: req.params.convId,
      content: finalContent,
      status: finalStatus,
      ...(errorCode ? { errorCode } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(pendingActions?.length ? { pendingActions } : {}),
      persisted: persistedFlag,
      ...(persistedAttachments.length ? { persistedAttachments } : {}),
    });
  }
});

// POST /agents/:slug/chat/:convId/fork — copy a finished conversation into a
// NEW conversation owned by the requesting user.
router.post("/:slug/chat/:convId/fork", async (req: Request<{ slug: string; convId: string }>, res: Response) => {
  try {
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    const { slug, convId } = req.params;
    const { targetConversationId } = (req.body ?? {}) as { targetConversationId?: string };
    if (!targetConversationId || typeof targetConversationId !== "string") {
      res.status(400).json({ success: false, error: "targetConversationId is required" });
      return;
    }

    const forkAliases = new Set(getRequesterAliases(req));
    const sourceMessages = (await chatMessageRepository.findByConversationAndAgent(convId, slug)).filter(
      (m) => forkAliases.has(m.userId),
    );
    if (sourceMessages.length === 0) {
      res.status(404).json({ success: false, error: "Source conversation is empty" });
      return;
    }

    // Refuse to write into a conversation that already holds messages — a
    // retried fork would otherwise duplicate the whole history.
    const existingTarget = await chatMessageRepository.findByConversationAndAgent(targetConversationId, slug);
    if (existingTarget.length > 0) {
      res.status(409).json({ success: false, error: "Target conversation already has messages" });
      return;
    }

    // Which PI session backs this conversation: the base id when the tree is
    // linear, else the deepest non-first assistant's branch suffix.
    const tree = sourceMessages.map((m) => ({
      id: m.id,
      role: m.role,
      parentId: (m as { parentId?: string | null }).parentId ?? null,
      createdAt: m.createdAt,
    }));
    const leafId = tree[tree.length - 1]?.id ?? null;
    const sourcePiConversationId = resolvePiConversationIdForPath(tree, leafId, convId);

    const cloned = await cloneBranchSession({
      sourceConversationId: piSessionStoreKey(sourcePiConversationId, slug),
      targetConversationId: piSessionStoreKey(targetConversationId, slug),
      branchMode: "full",
    });
    if (!cloned.success) {
      log.warn(`[agent-chat/fork] session clone failed ${convId} → ${targetConversationId}: ${cloned.error ?? "unknown"}`);
      res.status(502).json({ success: false, error: cloned.error ?? "Failed to clone session" });
      return;
    }

    // Copy the visible history, chained linearly so the tree stays on the
    // first-child rail — otherwise resolvePiConversationIdForPath would read
    // the fork as a branch and the follow-up would open a fresh PI session,
    // discarding the context we just cloned.
    let parentId: string | null = null;
    let copied = 0;
    for (const msg of sourceMessages) {
      const created = await chatMessageRepository.create({
        conversationId: targetConversationId,
        agentSlug: slug,
        userId,
        role: msg.role,
        content: msg.content ?? "",
        ...(msg.reasoning ? { reasoning: msg.reasoning } : {}),
        parentId,
        orgId: (msg as { orgId: string }).orgId,
      });
      parentId = created.id;
      copied += 1;
    }

    log.info(`[agent-chat/fork] ${convId} → ${targetConversationId} slug=${slug} owner=${userId} copied=${copied}`);
    res.json({ success: true, conversationId: targetConversationId, copied });
  } catch (err) {
    log.error(`[agent-chat/fork] ${req.params.convId}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    res.status(500).json({ success: false, error: "Failed to fork conversation" });
  }
});

// GET /agents/:slug/chat/:convId/messages — get conversation history
router.get("/:slug/chat/:convId/messages", async (req: Request<{ slug: string; convId: string }>, res: Response) => {
  try {
    // Get userId from request (x-user-id header for API calls, session for web)
    const userId = getRequesterId(req);
    if (!userId) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }

    // Scope to THIS agent's messages — a thread (conversationId) is shared
    // across agents (incl. a mentioned user's digital twin, same conversationId
    // but agentSlug="digital-twin"), so an unscoped read leaked the twin's
    // private messages/reasoning into the host agent's chat window.
    const allMessages = await chatMessageRepository.findByConversationAndAgent(req.params.convId, req.params.slug);

    // Per-user ACL. Sessions are now keyed by conversation+agent and SHARED
    // across every user in a thread (see buildSandboxStoreKey), so one
    // conversation contains messages from multiple users. Each user must see
    // ONLY their own messages and the assistant replies to them (assistant
    // rows are tagged with the triggering user's id). Admins see everything.
    // Filtering — rather than an owner-only 403 — is the access boundary:
    // guessing a conversation id returns only your own slice (empty if none).
    // Cross-user visibility is OPT-IN. A twin thread shares one conversationId
    // across every mentioned user, so an admin's OWN chat window would otherwise
    // render a confusing mix of other people's turns. The default (even for
    // admins) is own-turns-only; cross-user is returned ONLY when the admin
    // explicitly opened this conversation from the agent "All Runs" inspector,
    // which passes ?allRuns=1. Admins keep full cross-user access there — this
    // just stops it leaking into the normal chat view.
    const isAdmin = await isClawAdmin(userId);
    const crossUser = isAdmin && req.query["allRuns"] === "1";
    // Rows may be keyed by either verified representation of this caller
    // (canonical Claw id in x-user-id or the current workspace's raw Spaces
    // id in x-spaces-user-id) — match both so older/misscoordinated turns
    // don't vanish from the transcript.
    const userAliases = getRequesterAliases(req);
    // `userId` was required above, so the canonical id is always a valid
    // fallback when no aliases were stamped (defensive; narrowing-friendly).
    const callerMessageIds = userAliases.length > 0 ? userAliases : [userId];
    const visibleForUser = crossUser ? allMessages : allMessages.filter((m) => userAliases.includes(m.userId));
    // Hide the in-progress "running" assistant placeholder from the transcript:
    // the in-flight turn is rendered by the /live stream (snapshot `partial` +
    // `delta` events), so returning it here too would double-render it (a second
    // bubble + spurious branch pager) after a reload. It reappears here as a
    // normal message once the callback flips its status off "running".
    const messages = visibleForUser.filter((m) => !(m.role === "assistant" && m.status === "running"));

    // Fetch agent runs for this conversation to get tool invocations. Already
    // user-scoped via listByUser (admins use the conversation-wide view).
    const agentRuns = crossUser
      ? await agentRunRepository.listByConversation(req.params.convId, userId)
      : await agentRunRepository.listByUser(callerMessageIds, { conversationId: req.params.convId });

    // Strip internal GCS paths from attachment metadata before sending to client.
    // `reactArtifact` is the one metadata key allowed through: it is the small
    // manifest (title/entry/file paths/dep names) the dashboard's artifact card
    // renders from, and it carries no storage paths. Everything else — including
    // slideJson, which has its own ACL'd endpoint — stays server-side. Keep this
    // an explicit allowlist: passing `a.metadata` wholesale would leak `url`.
    const serialized = messages.map((m) => {
      const attachmentsRaw = (m as unknown as { attachments?: Array<{ id: string; mimeType: string; originalFilename: string; width: number | null; height: number | null; metadata?: Record<string, unknown> | null }> }).attachments ?? [];
      const attachments = attachmentsRaw.map((a) => {
        const reactArtifact = a.metadata && typeof a.metadata === "object" ? a.metadata["reactArtifact"] : undefined;
        return {
          id: a.id,
          mimeType: a.mimeType,
          originalFilename: a.originalFilename,
          width: a.width,
          height: a.height,
          ...(reactArtifact ? { metadata: { reactArtifact } } : {}),
        };
      });
      return { ...m, attachments };
    });

    // Pair tool invocations with the assistant message they produced.
    //
    // Branching breaks chronological pairing: under one user parent we may
    // have multiple assistant siblings (regenerate, edit-user), so the Nth
    // assistant message is no longer the Nth run. The fix is direct linkage
    // via `AgentRun.chatMessageId` (set in the chat callback when the run
    // finalizes). Chronology is kept ONLY as a fallback for legacy rows
    // written before the column existed — those don't have branches because
    // the feature is new.
    const invocationsByMsgId: Record<string, unknown[]> = {};
    const followUpsByMsgId: Record<string, string[]> = {};
    // assistantMsgId → AgentRun.sessionId. Lets the debugger filter runs by
    // the assistant message the user clicked on instead of by chronological
    // index. Under branching, the Nth visible assistant is no longer the Nth
    // run by time (siblings break ordering), so an index-based selector
    // routes to the wrong run. Built off the same chatMessageId linkage that
    // already pairs tool invocations, with the same chronological fallback
    // for legacy rows.
    const runByMsgId: Record<string, string> = {};
    // assistantMsgId → { rating, comment } for the run that produced it. Lets
    // the ask-ai v2 surfaces seed 👍/👎 thumb state on reload (ratings persist
    // to agent_runs via POST /runs/:sessionId/rate). Built off the same
    // chatMessageId linkage as runByMsgId, with the same legacy fallback.
    const ratingByMsgId: Record<string, { rating: "up" | "down" | null; comment: string | null }> = {};
    const linkedAssistantIds = new Set<string>();
    for (const run of agentRuns) {
      const linkedId = (run as { chatMessageId?: string | null }).chatMessageId;
      if (!linkedId) continue;
      if (run.sessionId) runByMsgId[linkedId] = run.sessionId;
      if (run.rating) ratingByMsgId[linkedId] = { rating: run.rating as "up" | "down", comment: run.ratingComment ?? null };
      const invocations = run.toolInvocations;
      if (Array.isArray(invocations) && (invocations as unknown[]).length > 0) {
        const followUps = extractFollowUpSuggestionsFromInvocations(invocations);
        if (followUps) followUpsByMsgId[linkedId] = followUps;
        const visibleInvocations = withoutFollowUpRecorderInvocations(invocations as unknown[]);
        if (visibleInvocations.length > 0) {
          invocationsByMsgId[linkedId] =
            shouldRedactRun(crossUser, run.userId, userAliases, run.triggerSource)
              ? redactToolResults(visibleInvocations)
              : visibleInvocations;
        }
      }
      linkedAssistantIds.add(linkedId);
    }

    // Legacy fallback. Pair all unlinked completed runs with all unlinked
    // assistant messages chronologically. Filter both lists on the SAME
    // predicate (unlinked) so the order matches. Only emit entries for runs
    // that actually have tools (skipping a no-tools row would still misalign
    // — same trap as before — so we keep the run in `unlinked` for indexing
    // and just don't write its empty list to the map).
    const unlinkedAssistantMsgs = serialized
      .filter((m) => m.role === "assistant" && !linkedAssistantIds.has(m.id))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const unlinkedCompletedRuns = agentRuns
      .filter((r) => r.completedAt && !(r as { chatMessageId?: string | null }).chatMessageId)
      .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime());
    const pairCount = Math.min(unlinkedAssistantMsgs.length, unlinkedCompletedRuns.length);
    for (let i = 0; i < pairCount; i++) {
      const msg = unlinkedAssistantMsgs[i]!;
      const run = unlinkedCompletedRuns[i]!;
      if (run.sessionId) runByMsgId[msg.id] = run.sessionId;
      if (run.rating) ratingByMsgId[msg.id] = { rating: run.rating as "up" | "down", comment: run.ratingComment ?? null };
      const invocations = run.toolInvocations;
      if (Array.isArray(invocations) && (invocations as unknown[]).length > 0) {
        const followUps = extractFollowUpSuggestionsFromInvocations(invocations);
        if (followUps) followUpsByMsgId[msg.id] = followUps;
        const visibleInvocations = withoutFollowUpRecorderInvocations(invocations as unknown[]);
        // Citations carry only their tiny `iconKey` on the wire — the heavy SVG
        // bytes are NOT stamped per citation. They ship once each in the
        // top-level `icons` map below (built from these same iconKeys), so N
        // chips sharing the Spaces mark cost one copy, not N.
        if (visibleInvocations.length > 0) {
          invocationsByMsgId[msg.id] =
            shouldRedactRun(crossUser, run.userId, userAliases, run.triggerSource)
              ? redactToolResults(visibleInvocations)
              : visibleInvocations;
        }
      }
    }

    // De-duplicated icon registry for the whole payload: unique iconKey → data:
    // SVG URI across every message's invocations. The dashboard re-attaches the
    // bytes per citation at render time (see resolveCitationIconUrl).
    const icons = collectCitationIconUrls(
      Object.values(invocationsByMsgId).flat(),
    );

    res.json({
      success: true,
      data: serialized.map((message) => ({
        ...message,
        ...(followUpsByMsgId[message.id]?.length
          ? { followUpSuggestions: followUpsByMsgId[message.id] }
          : {}),
      })),
      ...(Object.keys(invocationsByMsgId).length > 0 && { invocationsByMsgId }),
      ...(Object.keys(icons).length > 0 && { icons }),
      ...(Object.keys(runByMsgId).length > 0 && { runByMsgId }),
      ...(Object.keys(ratingByMsgId).length > 0 && { ratingByMsgId }),
    });
  } catch (err) {
    log.error("[agent-chat] messages error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/:slug/chat/:convId/live — SSE: live tool calls + progress for a
// conversation this client is VIEWING (not driving). Spaces-originated runs
// report over the callback webhook (/webhook/progress + /webhook/result), which
// publishes to Redis; this fans those events out to the v3 chat window. Joining
// mid-run is covered by an initial Postgres snapshot, since Redis pub/sub has no
// replay. ACL matches /messages: scoped by agentSlug; non-admins only get events
// for runs they triggered; tool results are redacted for admins viewing others.

/**
 * Real cancel for an in-flight chat run. The input-bar Stop button previously
 * only aborted the CLIENT fetch — the run kept burning sandbox + LLM server-
 * side by design (req close ≠ cancel). This endpoint kills the run itself:
 * recovery first (so the watchdog can't resurrect it), then the runtime's
 * per-session cancel. Ownership: the AgentRun row must belong to the caller.
 */
router.post("/:slug/chat/cancel", async (req: Request<{ slug: string }>, res: Response): Promise<void> => {
  try {
    const userId = getRequesterId(req) ?? (req.body as { userId?: string }).userId;
    const sessionId = typeof (req.body as { sessionId?: unknown }).sessionId === "string"
      ? ((req.body as { sessionId: string }).sessionId).trim()
      : "";
    if (!userId || !sessionId || sessionId.length > 200) {
      res.status(400).json({ success: false, error: "userId and sessionId are required" });
      return;
    }
    // run.userId may be keyed by either verified representation of this
    // caller — match both, and forward the stored owner id (it is the key
    // the pod's run was dispatched under).
    const run = await prisma.agentRun.findFirst({
      where: { sessionId, userId: { in: getRequesterAliases(req) } },
      select: { sessionId: true, status: true, userId: true },
    });
    if (!run) {
      res.status(404).json({ success: false, error: "Run not found" });
      return;
    }
    await cancelRunRecovery(sessionId).catch(() => {});
    const cancelRes = await fetch(
      `${CONFIG.internalUrl}/claw/api/v1/internal/run/${encodeURIComponent(sessionId)}/cancel`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
          "x-user-id": run.userId,
        },
      },
    ).catch(() => null);
    res.json({ success: true, data: { cancelled: cancelRes?.ok ?? false } });
  } catch (err) {
    log.error("[agent-chat] cancel failed", err);
    res.status(500).json({ success: false, error: "Failed to cancel run" });
  }
});

router.get("/:slug/chat/:convId/live", async (req: Request<{ slug: string; convId: string }>, res: Response) => {
  if (!CONFIG.liveToolCallsEnabled) {
    res.status(404).json({ success: false, error: "Live streaming disabled" });
    return;
  }
  const userId = getRequesterId(req);
  if (!userId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  const { slug, convId } = req.params;
  // Cross-user visibility is OPT-IN (mirrors /messages): the default live view
  // — even for admins — streams ONLY the requester's own runs, so a shared twin
  // thread doesn't leak other users' in-flight turns into the normal chat. The
  // agent "All Runs" inspector passes ?allRuns=1 for genuine cross-user viewing.
  const isAdmin = await isClawAdmin(userId);
  const crossUser = isAdmin && req.query["allRuns"] === "1";

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable proxy buffering (istio/nginx)
  });
  res.write(`event: open\ndata: ${JSON.stringify({ conversationId: convId })}\n\n`);
  // Same idle-timeout protection as the chat stream: comment-frame heartbeat.
  const liveHeartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) {
      try { res.write(":hb\n\n"); } catch { /* close handler clears */ }
    }
  }, 15_000);
  res.on("close", () => clearInterval(liveHeartbeat));
  log.info(`[agent-chat] /live connected: conv=${convId} agent=${slug} user=${userId} admin=${isAdmin}`);

  // Only cross-user (admin + All Runs) viewers receive events for other users'
  // runs; everyone else — including admins in the normal chat view — gets only
  // the runs they triggered.
  // Rows may be keyed by either verified representation of this caller
  // (canonical Claw id or the workspace's raw Spaces id) — match both.
  const liveUserAliases = getRequesterAliases(req);
  const allow = (evtUserId: string) => crossUser || liveUserAliases.includes(evtUserId);

  // 1) Snapshot from Postgres so a mid-run joiner sees tool calls already made.
  try {
    const messages = await chatMessageRepository.findByConversationAndAgent(convId, slug);
    const visible = crossUser ? messages : messages.filter((m) => liveUserAliases.includes(m.userId));
    const agentRuns = crossUser
      ? await agentRunRepository.listByConversation(convId, userId)
      : await agentRunRepository.listByUser(liveUserAliases, { conversationId: convId });

    // Pair completed runs to assistant messages by chronological index — same
    // logic as the /messages read (see its comment for why we don't pre-filter).
    const assistantMsgs = visible
      .filter((m) => m.role === "assistant")
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const completedRuns = agentRuns
      .filter((r) => r.completedAt)
      .sort((a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime());
    const invocationsByMsgId: Record<string, unknown[]> = {};
    const pairCount = Math.min(assistantMsgs.length, completedRuns.length);
    for (let i = 0; i < pairCount; i++) {
      const msg = assistantMsgs[i]!;
      const run = completedRuns[i]!;
      const invs = run.toolInvocations;
      if (Array.isArray(invs) && (invs as unknown[]).length > 0) {
        const visibleInvocations = withoutFollowUpRecorderInvocations(invs as unknown[]);
        if (visibleInvocations.length > 0) {
          invocationsByMsgId[msg.id] =
            shouldRedactRun(crossUser, run.userId, liveUserAliases, run.triggerSource)
              ? redactToolResults(visibleInvocations)
              : visibleInvocations;
        }
      }
    }

    // In-progress run (no completedAt yet) — its tool calls aren't paired to an
    // assistant message, so surface them as a flat in-progress list the client
    // renders against the streaming placeholder.
    const inProgress = agentRuns
      .filter((r) => !r.completedAt && allow(r.userId) && Array.isArray(r.toolInvocations) && (r.toolInvocations as unknown[]).length > 0)
      .flatMap((r) => {
        const visibleInvocations = withoutFollowUpRecorderInvocations(
          r.toolInvocations as unknown[],
        );
        return shouldRedactRun(crossUser, r.userId, liveUserAliases, r.triggerSource)
          ? redactToolResults(visibleInvocations)
          : visibleInvocations;
      });

    // Partial assistant answer-so-far (persisted by the /progress coalescer onto
    // the "running" placeholder row) so a mid-run joiner/reloader sees the text
    // that's already been generated, before the first live `delta` arrives.
    const runningMsg = visible.find((m) => m.role === "assistant" && m.status === "running");

    res.write(
      `event: snapshot\ndata: ${JSON.stringify({
        conversationId: convId,
        agentSlug: slug,
        invocationsByMsgId,
        inProgress,
        ...(runningMsg ? { partial: { msgId: runningMsg.id, content: runningMsg.content ?? "", reasoning: runningMsg.reasoning ?? "" } } : {}),
      })}\n\n`,
    );
  } catch (err) {
    log.warn("[agent-chat] live snapshot failed:", errMsg(err));
  }

  // 2) Subscribe to live deltas (cross-pod via Redis). Buffer-free: write as they arrive.
  const unsub = subscribeLive(convId, (evt: LiveEvent) => {
    if (evt.agentSlug && evt.agentSlug !== slug) return; // scope to this agent
    if (!allow(evt.userId)) return;
    let data: LiveEvent = evt;
    // Same rule as the stored transcript above — without this an awakened run
    // streamed its tool results pre-redacted and only became readable after it
    // completed and the viewer refetched from Postgres.
    if (evt.type === "invocation" && shouldRedactRun(crossUser, evt.userId, liveUserAliases, evt.triggerSource)) {
      data = { ...evt, toolInvocation: redactToolResults([evt.toolInvocation])[0] };
    }
    try {
      res.write(`event: ${evt.type}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* socket gone — close handler will clean up */
    }
  });

  // 3) Heartbeat to keep idle SSE alive through istio.
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* ignore */
    }
  }, 15_000);

  // 4) Cleanup on disconnect.
  req.on("close", () => {
    clearInterval(heartbeat);
    unsub();
    try {
      res.end();
    } catch {
      /* already closed */
    }
  });
});

// GET /agents/:slug/chat/:convId/debug — read filesystem-backed debugger artifacts
router.get("/:slug/chat/:convId/debug", async (req: Request<{ slug: string; convId: string }>, res: Response) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      res.status(401).json({ success: false, error: "x-user-id header is required" });
      return;
    }

    // Object-level authz: debug artifacts (prompts, tool I/O) are as sensitive
    // as the conversation itself. Verify the requester owns this conversation
    // (has chat messages or runs in it) before reading anything off disk.
    // Owner lookup serves two purposes: object-level authz below, and the
    // userId hint for xyne-claw (agent-chat session dirs are keyed
    // `<userId>_<convId>_<agentSlug>`, so GCS restore needs the owner id).
    // Sessions are conversation+agent-keyed and SHARED across users, so one
    // conversation has many users' debug snapshots. Authz: the requester must
    // have participated (any message or run) — NOT be the sole "owner". The
    // per-user CONTENT filtering happens after the fetch below.
    // Scope to THIS agent's messages (a thread is shared across agents incl.
    // digital-twin) so authz + the GCS-restore ownerId hint match this agent's
    // session key (`<userId>_<convId>_<agentSlug>`), not another agent's.
    const convMessages = await chatMessageRepository.findByConversationAndAgent(req.params.convId, req.params.slug);
    const ownerId = convMessages[0]?.userId; // first speaker — used only as the xyne-claw GCS-restore hint
    const isAdmin = await isClawAdmin(requesterId);
    const editAccess = isAdmin
      ? null
      : await getAgentEditAccess(requesterId, req.params.slug, getOrgId(req));
    const hasElevatedDebugAccess = isAdmin || Boolean(editAccess?.canEdit);
    // Rows may be keyed by either verified representation of this caller
    // (canonical Claw id or the workspace's raw Spaces id) — match both.
    const requesterAliases = getRequesterAliases(req);
    const requesterAliasSet = new Set(requesterAliases);
    if (!hasElevatedDebugAccess) {
      const hasMessage = convMessages.some((m) => requesterAliasSet.has(m.userId));
      const hasRun =
        hasMessage ||
        (await agentRunRepository.listByUser(requesterAliases, { conversationId: req.params.convId, limit: 1 })).length > 0;
      if (!hasMessage && !hasRun) {
        res.status(403).json({ success: false, error: "Not authorized to view this conversation" });
        return;
      }
    }

    // Debug artifacts live on xyne-claw's PVC, not here — claw-auth runs in a
    // separate pod and can't read that filesystem (the old local-disk lookup
    // only worked in the dev monorepo, so prod always 404'd). Proxy to
    // xyne-claw's S2S debug endpoint, which reads its own PVC and lazily
    // restores from the GCS archive if the session was evicted. Authz was
    // already enforced above.
    const upstreamUrl =
      `${CONFIG.xyneClawUrl}/internal/sessions/${encodeURIComponent(req.params.convId)}/debug` +
      `?agentSlug=${encodeURIComponent(req.params.slug)}` +
      `${ownerId ? `&userId=${encodeURIComponent(ownerId)}` : ""}`;
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(upstreamUrl, {
        headers: { ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}) },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      log.error("[agent-chat] debug proxy fetch failed:", err instanceof Error ? err.message : err);
      res.status(502).json({ success: false, error: "Failed to reach debug service" });
      return;
    }

    let body: {
      success?: boolean;
      data?: {
        conversationId?: string;
        debugDir?: string | null;
        debugSession?: { userId?: string; sessionId?: string } | null;
        debugEvents?: unknown[] | null;
        runs?: Array<{ fileName: string; data: { userId?: string; sessionId?: string; [k: string]: unknown } }>;
        subagents?: Array<{ fileName: string; data: { parentSessionId?: string } }>;
        followUpDiagnostics?: Array<{
          sessionId: string;
          startedAt: string;
          completedAt?: string;
          runStatus: string;
          outcome: string;
          enabled?: boolean;
          enabledByV2Flag?: boolean;
          answerLength?: number;
          generationInput?: string;
          conversationMessageCount?: number;
          agentContextProvided?: boolean;
          agentContextName?: string;
          agentContextDescription?: string;
          generationSource?: string;
          generationModel?: string;
          generationStartedAt?: string;
          generationCompletedAt?: string;
          generationDurationMs?: number;
          failureCode?: string;
          failureMessage?: string;
          httpStatus?: number;
          suggestionCount: number;
          persistedRecorder: boolean;
          suggestions: string[];
        }>;
      };
    };
    if (upstream.status === 404) {
      // No completed artifacts on claw's PVC yet (run still in flight, or claw's
      // incremental write hasn't landed). Synthesize an in-progress bundle from
      // the durable agent_run row(s) so the drawer shows the run's tool calls
      // (past + live) instead of 404 until completion. Flows through the SAME
      // per-user ACL/redaction below via each synth run's data.userId.
      const inProgressRuns = hasElevatedDebugAccess
        ? await agentRunRepository.listByConversation(req.params.convId, requesterId)
        : await agentRunRepository.listByUser(requesterAliases, { conversationId: req.params.convId, agentSlug: req.params.slug });
      const active = inProgressRuns.filter((r) => !r.completedAt && Array.isArray(r.toolInvocations));
      if (active.length === 0) {
        res.status(404).json({ success: false, error: "Debug artifacts not found" });
        return;
      }
      body = {
        success: true,
        data: {
          conversationId: req.params.convId,
          debugDir: null,
          debugSession: null,
          debugEvents: [],
          runs: active.map((r) => ({
            fileName: `debug-run-inprogress-${r.sessionId}.json`,
            data: {
              schemaVersion: 1,
              conversationId: req.params.convId,
              sessionId: r.sessionId,
              agentSlug: r.agentSlug,
              userId: r.userId,
              startedAt: r.startedAt,
              task: r.task,
              currentToolLabel: r.currentToolLabel,
              toolInvocations: r.toolInvocations,
              inProgress: true,
            },
          })),
          subagents: [],
        },
      };
    } else if (!upstream.ok) {
      res.status(502).json({ success: false, error: `Debug service error (${upstream.status})` });
      return;
    } else {
      body = (await upstream.json()) as typeof body;
    }

    // Per-user ACL on debug content. Each run snapshot carries the userId whose
    // CREDENTIALS executed it; subagents carry the parentSessionId of the run
    // that spawned them. A non-admin viewer sees only runs (and their tool
    // calls) executed under their own userId, and only subagents belonging to
    // those runs. Admins and agent contributors use the elevated All Runs view.
    if (!hasElevatedDebugAccess && body?.data) {
      const d = body.data;
      const ownRuns = (d.runs ?? []).filter((r) => !!r.data?.userId && requesterAliasSet.has(r.data.userId));
      const ownSessionIds = new Set(ownRuns.map((r) => r.data?.sessionId).filter(Boolean) as string[]);
      const ownSession = d.debugSession && !!d.debugSession.userId && requesterAliasSet.has(d.debugSession.userId) ? d.debugSession : null;
      if (ownSession?.sessionId) ownSessionIds.add(ownSession.sessionId);
      body.data = {
        ...d,
        debugSession: ownSession,
        debugEvents: ownSession ? d.debugEvents ?? [] : [],
        runs: ownRuns,
        subagents: (d.subagents ?? []).filter((s) => ownSessionIds.has(s.data?.parentSessionId ?? "")),
      };
    } else if (hasElevatedDebugAccess && body?.data) {
      // Elevated viewers see everything EXCEPT other users' runs that executed under a
      // USER credential (usedUserToken) — same ACL the All Runs list enforces.
      // Without this, an admin/contributor opening a shared conversation's debugger could
      // read another user's user-token tool I/O / subagents. usedUserToken
      // lives in our DB (xyne-claw's snapshots don't carry it), so map
      // sessionId → hidden here.
      // Two-layer elevated ACL on the debugger:
      //  (1) HIDE entirely — other users' runs that used a PRIVATE credential
      //      (usedUserToken), same rule as the All Runs list.
      //  (2) REDACT result bodies — other users' remaining (Spaces) runs stay
      //      visible for auditing, but their tool RESULTS carry the user's
      //      private Spaces content, so strip result values while keeping
      //      names/args. The viewer's own runs are untouched.
      // usedUserToken + ownership live in OUR DB (xyne-claw snapshots don't
      // carry usedUserToken), so resolve sessionId → {owner, hidden} here.
      const aclRuns = await agentRunRepository.listSessionAclForConversation(req.params.convId);
      const hiddenSessionIds = new Set(
        aclRuns.filter((r) => r.usedUserToken && !requesterAliasSet.has(r.userId)).map((r) => r.sessionId),
      );
      const ownerBySession = new Map(aclRuns.map((r) => [r.sessionId, r.userId]));
      // Awakened runs have no human owner, so "readable" for them means the
      // admin can read them — that IS the audit trail for an agent acting
      // unattended. See lib/agent-owned-runs.ts.
      const agentOwnedSessions = new Set(
        aclRuns.filter((r) => isAgentOwnedRun(r.triggerSource)).map((r) => r.sessionId),
      );
      const readable = (sid: string | undefined, ownerUserId?: string | null): boolean =>
        (!!ownerUserId && requesterAliasSet.has(ownerUserId)) ||
        (!!sid && (agentOwnedSessions.has(sid) || requesterAliasSet.has(ownerBySession.get(sid) ?? "")));
      const ownsSession = (sid: string | undefined): boolean =>
        !!sid && (agentOwnedSessions.has(sid) || requesterAliasSet.has(ownerBySession.get(sid) ?? ""));

      const d = body.data;
      const hideDebugSession = d.debugSession?.sessionId ? hiddenSessionIds.has(d.debugSession.sessionId) : false;
      const debugSessionOwned = readable(d.debugSession?.sessionId, d.debugSession?.userId);
      body.data = {
        ...d,
        debugSession: hideDebugSession
          ? null
          : !d.debugSession || debugSessionOwned
            ? d.debugSession ?? null
            : (redactResultKeysDeep(d.debugSession) as typeof d.debugSession),
        debugEvents: hideDebugSession
          ? []
          : !d.debugSession || debugSessionOwned
            ? d.debugEvents ?? null
            : (redactResultKeysDeep(d.debugEvents ?? []) as unknown[]),
        runs: (d.runs ?? [])
          .filter((r) => !hiddenSessionIds.has(r.data?.sessionId ?? ""))
          .map((r) =>
            readable(r.data?.sessionId, r.data?.userId)
              ? r
              : { ...r, data: redactResultKeysDeep(r.data) as typeof r.data },
          ),
        subagents: (d.subagents ?? [])
          .filter((s) => !hiddenSessionIds.has(s.data?.parentSessionId ?? ""))
          .map((s) =>
            ownsSession(s.data?.parentSessionId) ? s : { ...s, data: redactResultKeysDeep(s.data) as typeof s.data },
          ),
      };
    }
    if (body.data) {
      const diagnosticRuns = hasElevatedDebugAccess
        ? await agentRunRepository.listByConversation(req.params.convId, requesterId, { limit: 100 })
        : await agentRunRepository.listByUser(requesterAliases, {
            conversationId: req.params.convId,
            agentSlug: req.params.slug,
            limit: 100,
          });
      body.data.followUpDiagnostics = diagnosticRuns
        .filter((run) => run.agentSlug === req.params.slug)
        .map((run) => {
          const invocations = Array.isArray(run.toolInvocations)
            ? (run.toolInvocations as Array<Record<string, unknown>>)
            : [];
          const diagnostic = invocations.find(
            (item) => item["toolName"] === "internal-follow-up-diagnostics",
          );
          const diagnosticArgs = diagnostic && typeof diagnostic["args"] === "object" && diagnostic["args"]
            ? diagnostic["args"] as Record<string, unknown>
            : null;
          const recorder = invocations.find((item) => {
            if (item["toolName"] !== "ask-user-question") return false;
            const args = item["args"];
            return Boolean(args) && typeof args === "object" &&
              (args as Record<string, unknown>)["purpose"] === "follow_up_suggestions";
          });
          const recorderArgs = recorder && typeof recorder["args"] === "object" && recorder["args"]
            ? recorder["args"] as Record<string, unknown>
            : null;
          const suggestions = Array.isArray(recorderArgs?.["options"])
            ? recorderArgs["options"].filter((value): value is string => typeof value === "string")
            : [];
          const generationStartedAt = typeof diagnostic?.["startedAt"] === "string"
            ? diagnostic["startedAt"]
            : undefined;
          const generationDurationMs = typeof diagnostic?.["durationMs"] === "number"
            ? diagnostic["durationMs"]
            : undefined;
          const generationStartedMs = generationStartedAt
            ? new Date(generationStartedAt).getTime()
            : Number.NaN;
          const generationCompletedAt =
            generationStartedAt &&
            Number.isFinite(generationStartedMs) &&
            generationDurationMs !== undefined &&
            diagnostic?.["status"] !== "running"
              ? new Date(generationStartedMs + generationDurationMs).toISOString()
              : undefined;
          return {
            sessionId: run.sessionId,
            startedAt: run.startedAt.toISOString(),
            ...(run.completedAt ? { completedAt: run.completedAt.toISOString() } : {}),
            runStatus: run.status,
            outcome: typeof diagnosticArgs?.["outcome"] === "string"
              ? diagnosticArgs["outcome"]
              : recorder
                ? "generated"
                : "not_recorded",
            ...(typeof diagnosticArgs?.["enabled"] === "boolean"
              ? { enabled: diagnosticArgs["enabled"] }
              : {}),
            ...(typeof diagnosticArgs?.["enabledByV2Flag"] === "boolean"
              ? { enabledByV2Flag: diagnosticArgs["enabledByV2Flag"] }
              : {}),
            ...(typeof diagnosticArgs?.["answerLength"] === "number"
              ? { answerLength: diagnosticArgs["answerLength"] }
              : {}),
            ...(typeof diagnosticArgs?.["generationInput"] === "string"
              ? { generationInput: diagnosticArgs["generationInput"] }
              : {}),
            ...(typeof diagnosticArgs?.["conversationMessageCount"] === "number"
              ? { conversationMessageCount: diagnosticArgs["conversationMessageCount"] }
              : {}),
            ...(typeof diagnosticArgs?.["agentContextProvided"] === "boolean"
              ? { agentContextProvided: diagnosticArgs["agentContextProvided"] }
              : {}),
            ...(typeof diagnosticArgs?.["agentContextName"] === "string"
              ? { agentContextName: diagnosticArgs["agentContextName"] }
              : {}),
            ...(typeof diagnosticArgs?.["agentContextDescription"] === "string"
              ? { agentContextDescription: diagnosticArgs["agentContextDescription"] }
              : {}),
            ...(typeof diagnosticArgs?.["generationSource"] === "string"
              ? { generationSource: diagnosticArgs["generationSource"] }
              : {}),
            ...(typeof diagnosticArgs?.["generationModel"] === "string"
              ? { generationModel: diagnosticArgs["generationModel"] }
              : {}),
            ...(generationStartedAt ? { generationStartedAt } : {}),
            ...(generationCompletedAt ? { generationCompletedAt } : {}),
            ...(generationDurationMs !== undefined ? { generationDurationMs } : {}),
            ...(typeof diagnosticArgs?.["failureCode"] === "string"
              ? { failureCode: diagnosticArgs["failureCode"] }
              : {}),
            ...(typeof diagnosticArgs?.["failureMessage"] === "string"
              ? { failureMessage: diagnosticArgs["failureMessage"] }
              : {}),
            ...(typeof diagnosticArgs?.["httpStatus"] === "number"
              ? { httpStatus: diagnosticArgs["httpStatus"] }
              : {}),
            suggestionCount: suggestions.length,
            persistedRecorder: Boolean(recorder),
            suggestions,
          };
        });
    }
    res.json(body);
  } catch (err) {
    log.error("[agent-chat] debug artifacts error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// DELETE /agents/:slug/chat/:convId — delete a conversation (all its messages).
//
// Scoped to the requesting user — a user can only delete their own messages,
// so a delete on another user's conversation is a no-op (count: 0). We still
// return 200 OK in that case so the client doesn't leak information about
// other users' conversations.
router.delete("/:slug/chat/:convId", async (req: Request<{ slug: string; convId: string }>, res: Response) => {
  try {
    // For destructive operations always use the authenticated identity — never
    // accept a caller-supplied userId override (unlike read routes that follow
    // the req.query["userId"] pattern for convenience).
    const userAliases = getRequesterAliases(req);
    if (!userAliases.length) {
      res.status(400).json({ success: false, error: "userId required" });
      return;
    }
    const count = await chatMessageRepository.deleteConversation(userAliases, req.params.slug, req.params.convId);
    res.json({ success: true, data: { deleted: count } });
  } catch (err) {
    log.error("[agent-chat] delete conversation error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /agents/:slug/conversations — list user's conversations with summaries
router.get("/:slug/conversations", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    // Identity comes from the session, NOT the query param. A caller-supplied
    // ?userId previously overrode the authenticated user, letting anyone list
    // another user's conversations. Only an admin may target another user.
    const userAliases = getRequesterAliases(req);
    const callerId = userAliases[0];
    if (!callerId) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    const requestedUserId = req.query["userId"] as string | undefined;
    // Own reads span ALL verified representations of this caller — the
    // canonical Claw id (x-user-id) AND the current workspace's raw Spaces id
    // (x-spaces-user-id) — because chat rows may be keyed under either. No
    // org-wide fan-out: the alias pair is already workspace-scoped by auth.
    let userIds = userAliases;
    if (requestedUserId && !matchesAuthenticatedUserId(req, requestedUserId)) {
      if (!(await isClawAdmin(callerId))) {
        res.status(403).json({ success: false, error: "Cannot list another user's conversations" });
        return;
      }
      // Admin targeting another user: resolve the target's other
      // representation(s) within THIS request's workspace context only, so the
      // admin sees exactly the chats that user would see themselves. The
      // target may arrive in EITHER form, so resolve both directions: a raw
      // Spaces id forward to the canonical Claw id, and a canonical id
      // backward to its Spaces aliases via UserSurfaceIdentity.
      const ws = req.headers["x-spaces-workspace-id"];
      const workspaceId = typeof ws === "string" && ws.trim() ? ws.trim() : undefined;
      const targetIds = new Set<string>([requestedUserId]);
      const canonical = await resolveClawUserIdForSpacesIdentity(requestedUserId, workspaceId).catch(() => undefined);
      if (canonical) targetIds.add(canonical);
      const surfaceAliases = await prisma.userSurfaceIdentity
        .findMany({
          where: {
            surfaceId: "spaces",
            userId: canonical ?? requestedUserId,
            status: "ACTIVE",
            ...(workspaceId ? { surfaceWorkspaceId: workspaceId } : {}),
          },
          select: { surfaceUserId: true },
        })
        .catch(() => []);
      for (const alias of surfaceAliases) targetIds.add(alias.surfaceUserId);
      userIds = [...targetIds];
    }

    // Get all messages for this user+agent, grouped by conversation
    const allMessages = await chatMessageRepository.findByUserAndAgent(userIds, req.params.slug);

    // Group by conversationId, skipping artifact-app threads. Those are real,
    // durable conversations, but their prompts are written by app code on the
    // user's behalf — surfacing them here would bury the user's own chats under
    // machine-generated ones. They stay visible in the Agent Control Center via
    // triggerSource "app". The id prefix is the marker, same as "scheduled_".
    const convMap = new Map<string, typeof allMessages>();
    for (const msg of allMessages) {
      if (msg.conversationId.startsWith("app_")) continue;
      const list = convMap.get(msg.conversationId) ?? [];
      list.push(msg);
      convMap.set(msg.conversationId, list);
    }

    // Build summaries
    const conversations = [...convMap.entries()].map(([conversationId, msgs]) => {
      const firstUserMsg = msgs.find((m) => m.role === "user");
      const lastMsg = msgs[msgs.length - 1]!;
      return {
        conversationId,
        title: (firstUserMsg?.content ?? "").slice(0, 80),
        messageCount: msgs.length,
        lastMessageAt: lastMsg.createdAt,
      };
    }).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

    res.json({ success: true, data: conversations });
  } catch (err) {
    log.error("[agent-chat] conversations error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /agents/:slug/chat/approve-action
 * User clicked "Approve" on a write-tool card inside the chat UI.
 * Body: { pendingAction: { serverType, tool, params, userId, signature } }
 * Returns the tool's execution result so the UI can render it inline.
 */
router.post("/:slug/chat/approve-action", async (req: Request<{ slug: string }>, res: Response) => {
  try {
    const callerUserId = getRequesterId(req) ?? (req.body as { userId?: string }).userId;
    if (!callerUserId) {
      res.status(401).json({ success: false, error: "userId or x-user-id header required" });
      return;
    }

    const { pendingAction } = req.body as { pendingAction?: unknown };
    if (!pendingAction || typeof pendingAction !== "object") {
      res.status(400).json({ success: false, error: "pendingAction is required" });
      return;
    }

    const action = pendingAction as {
      serverType?: string; tool?: string; params?: Record<string, unknown>; userId?: string; signature?: string;
    };
    if (!action.serverType || !action.tool || !action.userId || !action.signature) {
      res.status(400).json({ success: false, error: "pendingAction must include serverType, tool, userId, signature" });
      return;
    }

    // Only the intended user can approve an action (XYNE-12145 — same rule as
    // the Spaces Flow UI flow in flow-action.ts / legacy frontmatter in app-callback.ts).
    if (callerUserId !== action.userId && !matchesAuthenticatedUserId(req, action.userId)) {
      res.status(403).json({ success: false, error: "Only the intended user can approve this action" });
      return;
    }

    const { executeWriteAction } = await import("../lib/write-actions.js");
    const result = await executeWriteAction({
      serverType: action.serverType,
      tool: action.tool,
      params: action.params ?? {},
      userId: action.userId,
      signature: action.signature,
    });

    if (!result.ok) {
      log.error(`[agent-chat] approve-action failed: ${action.tool} — ${result.error}`);
      res.status(400).json({ success: false, error: result.error ?? "Execution failed" });
      return;
    }

    log.info(`[agent-chat] approve-action ok: ${action.tool} → ${result.content.slice(0, 100)}`);
    res.json({ success: true, data: { content: result.content } });
  } catch (err) {
    log.error("[agent-chat] approve-action error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── SSE consumer for agent-chat ─────────────────────────────────────────────
//
// Drop-in replacement for the legacy `fetch /run → wait for /callback POST`
// pattern. Sends `Accept: text/event-stream` to the /run proxy so it pipes
// claw's ordered SSE response back to us, consumes each frame inline, and
// dispatches to the same pendingStreams.sendEvent / repository / redis calls
// the /progress handler runs — keeping the frontend's event names and event
// order byte-identical. On `done`, the final payload is POSTed to the
// caller's /callback endpoint so the existing finalize / persist / resolve
// wiring runs in one place (mirror of the run-stream.ts pattern).
//
// Handoff semantics: returns once we've seen the `started` frame (so the
// outer handler can write `event: run` and start the AgentRun row, exactly
// like the legacy JSON response did). The rest of the stream continues in
// the background and resolves the pendingStream via the /callback POST.
interface RunAgentChatViaSseOpts {
  forwardBody: Record<string, unknown>;
  callbackId: string;
  slug: string;
  conversationId: string;
  /** The internal /agent-chat/.../callback endpoint URL — POSTed to on `done`
   *  so the existing /callback handler runs the legacy resolve+persist path. */
  callbackUrl: string;
  /** Pre-created placeholder assistant row id — the live delta coalescer
   *  debounce-persists partial content onto it so a reload shows answer-so-far. */
  assistantMessageId?: string;
}

async function runAgentChatViaSse(
  opts: RunAgentChatViaSseOpts,
): Promise<{ success: boolean; sessionId?: string; error?: string; deferred?: boolean }> {
  const { forwardBody, callbackId, slug, conversationId, callbackUrl, assistantMessageId } = opts;
  // The triggering user — used to scope live events to /live viewers (same ACL
  // as /messages). v3-driven runs report via THIS path, not /webhook/*.
  const liveUserId = typeof forwardBody["userId"] === "string" ? (forwardBody["userId"] as string) : "";
  return new Promise((resolve) => {
    let handed = false;
    const handoff = (body: { success: boolean; sessionId?: string; error?: string; deferred?: boolean }): void => {
      if (handed) return;
      handed = true;
      resolve(body);
    };

    void (async () => {
      let capturedSessionId: string | undefined;
      try {
        const consumeResult = await consumeClawStream({
          url: `${CONFIG.internalUrl}/claw/api/v1/internal/run`,
          body: forwardBody,
          ...(CONFIG.xyneClawS2sKey ? { s2sKey: CONFIG.xyneClawS2sKey } : {}),
          onSeqGap: (expected, got) => {
            log.warn(`[agent-chat/sse] seq gap callbackId=${callbackId}: expected ${expected}, got ${got}`);
          },
          handlers: {
            onStarted: (sessionId) => {
              capturedSessionId = sessionId;
              // Unblock the outer handler — it will write `event: run` and
              // call AgentRun.start exactly like the legacy JSON-response
              // path. We do NOT push any frontend event here.
              handoff({ success: true, sessionId });
            },
            // Tier 1 + 2: full tool invocation on tool_execution_end.
            onInvocation: (sessionId, toolInvocation) => {
              pendingStreams.get(callbackId)?.sendEvent("tool", { toolInvocation });
              agentRunRepository.appendToolInvocation(sessionId, toolInvocation as Record<string, unknown>).catch(() => {});
              // Live tap: fan out to /live viewers (other tabs / shared link).
              if (CONFIG.liveToolCallsEnabled && liveUserId) {
                publishLiveEvent(conversationId, { type: "invocation", conversationId, agentSlug: slug, userId: liveUserId, toolInvocation, ts: Date.now() });
              }
            },
            // Tier 1: live tool label on tool_execution_start (and label keep-alive).
            onProgressLabel: (sessionId, payload) => {
              const toolLabel = payload?.toolLabel;
              if (toolLabel) {
                pendingStreams.get(callbackId)?.sendEvent("progress", { toolLabel });
                agentRunRepository.updateProgress(sessionId, toolLabel).catch(() => {});
                redisService.getConnection()
                  .publish("cc:events", JSON.stringify({ type: "agent_progress", sessionId, toolLabel }))
                  .catch(() => {});
                if (CONFIG.liveToolCallsEnabled && liveUserId) {
                  publishLiveEvent(conversationId, { type: "label", conversationId, agentSlug: slug, userId: liveUserId, toolLabel, ts: Date.now() });
                }
              }
            },
            onReasoning: (sid, delta) => {
              if (!delta) return;
              pendingStreams.get(callbackId)?.sendEvent("reasoning", { delta });
              // Live tap for VIEWERS (reloaded tabs / Spaces): coalesce + publish
              // reasoning to the bus + debounce-persist partial content, so a
              // viewer streams the answer instead of seeing it appear on `done`.
              if (CONFIG.liveToolCallsEnabled && sid && liveUserId) pushDelta(sid, conversationId, slug, assistantMessageId, undefined, delta, liveUserId);
            },
            onTextDelta: (sid, delta) => {
              if (!delta) return;
              pendingStreams.get(callbackId)?.sendEvent("text", { delta });
              if (CONFIG.liveToolCallsEnabled && sid && liveUserId) pushDelta(sid, conversationId, slug, assistantMessageId, delta, undefined, liveUserId);
            },
            onAttachment: (_sid, attachment) => {
              pendingStreams.get(callbackId)?.sendEvent("attachment", { attachment });
            },
            onPlan: (_sid, todos) => {
              pendingStreams.get(callbackId)?.sendEvent("plan", { todos });
            },
            onUiWidget: (_sid, widget) => {
              // Keep the existing plan event stable for current clients while
              // exposing the generic envelope for every other widget type.
              if (widget.type === "plan") {
                pendingStreams.get(callbackId)?.sendEvent("plan", { todos: widget.payload.todos });
              } else {
                pendingStreams.get(callbackId)?.sendEvent("ui-widget", { widget });
              }
            },
            onDebug: (_sid, debugEvent) => {
              // Same gate as the legacy /progress path (line ~325/1901): debug
              // frames carry the full system prompt / tool policy, so only the
              // agent's editors or a Claw admin may receive them. Without this
              // check the SSE transport (CLAW_SSE_TRANSPORT=on) re-opens PY-JP-012.
              const debugStream = pendingStreams.get(callbackId);
              if (!debugStream?.allowDebug) return;
              debugStream.sendEvent("debug", { debugEvent });
            },
            onCancelled: (_sid, reason) => {
              // Distinct cancel signal so the v3 chat UI can drop its typing
              // indicator immediately, before the cancelled `done` payload
              // arrives. Mirrors the run-stream.ts wiring.
              pendingStreams.get(callbackId)?.sendEvent("cancelled", { reason: reason ?? "cancelled" });
            },
            // No onSandboxPreview — the legacy /progress handler silently
            // drops unknown shapes, so mirror that to keep behavior identical
            // until a consumer needs it.
          },
        });

        // The stream closed cleanly (HTTP 200 — a bad status throws above) but
        // no `started` frame ever arrived. The only way claw accepts a run yet
        // emits nothing is when it SKIPS the run because another worker already
        // holds the conversation lock (duplicate/retried dispatch). That other
        // run is still in flight and WILL deliver the answer via the live-bus,
        // so this is NOT a user-facing failure — flag it `deferred` so the
        // caller drops this redundant run's placeholder instead of writing a
        // spurious "stream closed without a started frame" error bubble.
        if (!handed) {
          handoff({ success: false, deferred: true, error: "Claw SSE stream closed without a started frame" });
          return;
        }

        // Done payload — replay into the existing /callback endpoint so the
        // legacy finalize / persistAssistantResult / resolve(...) wiring runs
        // in one place. The done frame from claw IS the sendCallback body
        // verbatim (status, result, pendingActions, toolInvocations,
        // tokenUsage, attachments, llmCitations, provider, model, etc.).
        if (consumeResult.result) {
          const sid = capturedSessionId ?? (consumeResult.result["sessionId"] as string | undefined) ?? "";
          const callbackBody = { ...consumeResult.result, sessionId: sid };
          try {
            const cbRes = await fetch(`${callbackUrl}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
              },
              body: JSON.stringify(callbackBody),
            });
            if (!cbRes.ok) {
              const text = await cbRes.text().catch(() => "");
              log.warn(`[agent-chat/sse] /callback returned ${cbRes.status}: ${text.slice(0, 300)}`);
            }
          } catch (err) {
            log.error(`[agent-chat/sse] /callback POST failed (callbackId=${callbackId}): ${errMsg(err)}`);
          }
        } else {
          // No done frame ever arrived — synthesise a failed callback so the
          // outer await resultPromise unblocks and the user sees an error
          // instead of the 30-min safety-net timeout.
          try {
            await fetch(`${callbackUrl}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
              },
              body: JSON.stringify({
                sessionId: capturedSessionId ?? "",
                status: "failed",
                error: "Claw SSE stream ended without a done frame",
              }),
            });
          } catch { /* nothing else we can do */ }
        }
      } catch (err) {
        log.error(`[agent-chat/sse] consumeClawStream failed (slug=${slug}, conv=${conversationId}, callbackId=${callbackId}): ${errMsg(err)}`);
        // If we never handed off, surface the failure synchronously so the
        // outer handler can short-circuit with the proper error message.
        if (!handed) {
          handoff({ success: false, error: err instanceof Error ? err.message : "Failed to reach agent service" });
          return;
        }
        // We already returned success to the outer handler — push a synthetic
        // failed /callback so the resultPromise unblocks instead of timing out.
        try {
          await fetch(`${callbackUrl}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
            },
            body: JSON.stringify({
              sessionId: capturedSessionId ?? "",
              status: "failed",
              error: err instanceof Error ? err.message : "SSE consume failed",
            }),
          });
        } catch { /* exhausted */ }
      }
    })();
  });
}

export { router as agentChatRouter, internalRouter as agentChatInternalRouter };
