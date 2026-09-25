import { Router, type Request, type Response } from "express";
import { errMsg } from "../lib/errors.js";
import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";
import { requireAuth, requireNoAccessToken, requireResultToken } from "../middleware/require-auth.js";
import { getRequesterId, getAgentEditAccess, isClawAdmin } from "../middleware/agent-acl.js";
import { prisma } from "../db.js";
import { chatMessageRepository, agentRunRepository, chatAttachmentRepository, userAgentConfigRepository } from "../repositories/index.js";
import { awaitTurnHandoff, isTurnControlCommand } from "../lib/run-turn-handoff.js";
import { dispatchLocalHarnessRun, localHarnessProviderLabel, pinnedModelForProvider, resolveLocalHarnessTarget, resolveLocalHarnessTargetForProvider, resolveLocalSandbox } from "../lib/local-harness.js";
import { isLocalHarnessProvider, IMMEDIATE_TASK_COMMAND_RE, parseLocalSandboxCommand } from "xyne-claw-shared";
import { planServerContinuation } from "../lib/local-harness-continuation.js";
import { applyAiScreenCommand } from "../lib/ai-screen-commands.js";
import { parseSlashCommand } from "../lib/parseSlashCommand.js";
import { localHarnessSessionRepository } from "../repositories/localHarnessSessionRepository.js";
import {
  localFolderUnavailableMessage,
  splitLocalFolderContext,
  toLocalFolderWorkspace,
  type LocalFolderContextItem,
} from "../lib/local-folder-context.js";
import { gcsService } from "../services/storageService.js";
import { maybeGenerateConversationTitle } from "../services/chatTitleClient.js";
import { appendCitations, hydrateInvocationIcons } from "../lib/citations.js";
import { resolveAgentProviderConfigs, agentDefaultSpeed, parseFastModeProfile } from "../lib/agent-provider-config.js";
import { resolveFastMode } from "../lib/fast-mode.js";
import { resolveSdlcHubContextForUser, resolveSdlcRepositoryForUser } from "../lib/sdlc-repository-context.js";
import {
  buildFollowUpConversationHistory,
  buildLateFollowUpInvocations,
  extractLateFollowUpSessionId,
  extractFollowUpSuggestions,
  isInternalFollowUpInvocation,
  parseLateFollowUpCallback,
} from "../lib/follow-up-suggestions.js";
import { consumeClawStream } from "../lib/consume-claw-stream.js";
import { mintChatSessionId, beginChatRun, failChatRun } from "../lib/chat-run-record.js";
import { recordUploadedArtifacts } from "../lib/conversation-artifact-signals.js";
import { attachArtifactToSessionApp } from "../lib/artifact-app-session.js";
import { recordDeliveredArtifacts } from "../lib/delivered-artifacts.js";
import { publishLiveEvent } from "../lib/live-conversation-bus.js";
import { pushDelta, endDeltaCoalescer } from "../lib/live-delta-coalescer.js";
import { redisService } from "../redis.js";
import {
  branchPiConversationId,
  piSessionStoreKey,
  resolvePiConversationIdForPath,
  cloneBranchSession,
  type ChatTreeMessage,
} from "./lib/branching.js";

import { createLogger } from "../logger.js";
const log = createLogger("run-stream");
const SESSION_LOCKED_MESSAGE = "Still finishing your previous answer - try again in a few seconds.";

const publicRouter = Router();
const internalRouter = Router();

interface StreamAttachment {
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
    pendingActions?: Array<Record<string, unknown>> | undefined;
    attachments?: StreamAttachment[] | undefined;
    toolInvocations?: unknown;
    followUpSuggestions?: string[] | undefined;
    followUpsPending?: boolean | undefined;
    clawRunOrigin?: Record<string, unknown> | undefined;
  }) => void;
  reject: (error: Error) => void;
  setClosed: () => void;
  cookieHeader: string | undefined;
  /** Whether this subscriber may receive `debug` frames. Debug frames carry the
   *  full system prompt / instructions / tool policy (WAPT PY-JP-012), so they
   *  must only reach the agent's owner/editors or a Claw admin. Resolved once
   *  when the SSE opens — the internal /progress POST that forwards frames has
   *  no end-user identity of its own. */
  allowDebug: boolean;
}

interface StreamMeta {
  userId: string;
  agentSlug: string;
  orgId: string;
  conversationId: string;
  task: string;
  /** Branching: pre-created assistant placeholder id. The callback UPDATEs
   *  this row instead of creating a new one (so the assistant id is stable
   *  across the stream lifecycle), and the AgentRun is linked to it via
   *  chatMessageId for branch-safe run ↔ message pairing. */
  assistantMessageId?: string;
  /** Branching: pre-created user message id, when run-stream owned its
   *  creation (the standard flow). Echoed on the SSE `done` event so the
   *  client can swap its optimistic id for the real one. */
  userMessageId?: string;
  /** Branching: tree parent the assistant placeholder hangs off — echoed on
   *  the `done` event so the client can stitch the optimistic message into
   *  the persisted tree. */
  assistantParentId?: string | null;
}

const pendingStreams = new Map<string, PendingStream>();
const streamMeta = new Map<string, StreamMeta>();

function normalizeRunStatus(status: unknown): "completed" | "failed" | "cancelled" {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

function isSessionLockedError(error: unknown): boolean {
  return error === "session_locked" || error === "sessionLocked";
}

function widgetErrorContent(error: unknown, fallback: string): string {
  return isSessionLockedError(error) ? SESSION_LOCKED_MESSAGE : fallback;
}

// `session_locked` is an internal HA signal (another worker owns the
// conversation lock, or claw fail-closed because the lock service was briefly
// unreachable). It is NOT an answer. The legacy webhook path drops it silently
// (webhook.ts), but the SSE path streamed the raw token straight through as the
// assistant reply (prod 2026-07-07: users saw the literal "session_locked" in
// the askN sidebar). We rewrite it to this friendly, retryable message. Keep in
// sync with the `session_locked` entry in dashboard askAIErrorMapping.ts.
const SESSION_LOCKED_USER_MESSAGE =
  "This conversation is still processing your previous message. Please wait a moment, then send it again.";

/* ─────────────────────────────────────────────────────────────────────
   Cross-pod event bus (Redis pub/sub) — same pattern as agent-chat.ts.

   xyne-claw-auth runs many replicas. The browser's SSE stream lives in
   ONE pod's pendingStreams map, but xyne-claw's /progress and /callback
   POSTs are load-balanced across ALL pods via the k8s Service. Before
   this bus, a callback that landed on a non-owning pod returned
   404 "Stream not found" — claw's sendCallback treats 404 as
   non-retryable, so the final result was dropped, no assistant message
   was persisted, and the agent_run never finalized. Prod example:
   conv chat-4020bf6c… on 2026-06-18.

   Fix is two-part (mirrors agent-chat):
   1. DURABILITY: /callback persists the assistant message + finalizes
      agent_run on whichever pod receives the POST. A Redis SETNX on
      sessionId makes this exactly-once across claw's 3 retries.
   2. LIVENESS: handlers first try the local pendingStreams map, then
      publish onto this channel; every pod subscribes and forwards to
      its local stream if it has one. Self-delivery is a no-op (the
      entry is deleted before publishing).
   Redis being down degrades to liveness loss only — the message is
   still persisted and shows on the next /messages fetch.
   ───────────────────────────────────────────────────────────────────── */
const STREAM_EVENTS_CHANNEL = "run-stream:events";
const STREAM_PERSIST_KEY_PREFIX = "run-stream:msg-persisted:";

interface PersistedAttachment {
  id: string;
  mimeType: string;
  originalFilename: string;
  size: number;
  /** Allowlisted subset of ChatAttachment.metadata — see persistRunStreamResult. */
  metadata?: { reactArtifact: unknown };
}

type StreamBusEvent =
  | { kind: "progress"; streamId: string; events: Array<{ event: string; data: unknown }> }
  | {
      kind: "result";
      streamId: string;
      conversationId: string;
      content: string;
      status: "completed" | "failed" | "cancelled";
      errorCode?: string;
      sessionId?: string;
      pendingActions?: Array<Record<string, unknown>>;
      attachments?: StreamAttachment[];
      toolInvocations?: unknown;
      followUpSuggestions?: string[];
      followUpsPending?: boolean;
    };

let _streamSubReady = false;
function ensureStreamEventsSubscriber(): void {
  if (_streamSubReady) return;
  _streamSubReady = true;
  const sub = redisService.getConnection().duplicate();
  sub.subscribe(STREAM_EVENTS_CHANNEL).catch((err) => {
    _streamSubReady = false;
    log.error("[run-stream] events subscribe failed (cross-pod SSE forwarding off):", err instanceof Error ? err.message : err);
  });
  sub.on("message", (_ch: string, raw: string) => {
    let msg: StreamBusEvent;
    try { msg = JSON.parse(raw) as StreamBusEvent; } catch { return; }
    const stream = pendingStreams.get(msg.streamId);
    if (!stream) return; // stream lives on another pod (or already resolved)
    if (msg.kind === "progress") {
      for (const e of msg.events) {
        if (e.event === "debug" && !stream.allowDebug) continue;
        stream.sendEvent(e.event, e.data);
      }
      return;
    }
    // result
    stream.sendEvent("debug_artifacts_ready", {
      ...(msg.sessionId ? { sessionId: msg.sessionId } : {}),
      conversationId: msg.conversationId,
    });
    pendingStreams.delete(msg.streamId);
    streamMeta.delete(msg.streamId);
    stream.resolve({
      content: msg.content,
      status: msg.status,
      ...(msg.errorCode ? { errorCode: msg.errorCode } : {}),
      ...(msg.pendingActions?.length ? { pendingActions: msg.pendingActions } : {}),
      ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
      ...(msg.toolInvocations !== undefined ? { toolInvocations: msg.toolInvocations } : {}),
      ...(msg.followUpSuggestions?.length ? { followUpSuggestions: msg.followUpSuggestions } : {}),
      ...(msg.followUpsPending === true ? { followUpsPending: true } : {}),
    });
  });
}

function publishStreamEvent(event: StreamBusEvent): void {
  ensureStreamEventsSubscriber();
  redisService.getConnection()
    .publish(STREAM_EVENTS_CHANNEL, JSON.stringify(event))
    .catch((err) => log.warn("[run-stream] events publish failed:", err instanceof Error ? err.message : err));
}

/**
 * Persist the assistant message + tool-generated attachments for a finished
 * run. Called from the /callback handler (pod-independent). Idempotent
 * across claw's callback retries and across pods via a Redis SETNX on
 * sessionId — Redis down fails open (dupes beat data loss).
 *
 * Returns null when another retry/pod already persisted; the persisted rows
 * when this call won the guard.
 */
export async function persistRunStreamResult(args: {
  conversationId: string;
  agentSlug: string;
  userId: string;
  content: string;
  status: "completed" | "failed" | "cancelled";
  orgId: string;
  attachments?: StreamAttachment[];
  sessionId?: string;
  pendingActions?: Array<Record<string, unknown>>;
  /** Branching: when set, UPDATE this pre-created assistant placeholder row
   *  instead of creating a new one. The placeholder id is reserved at
   *  POST /run/stream so it can drive PI session branching, AgentRun.chatMessageId
   *  linkage, and the SSE `done` payload's stable id. */
  assistantMessageId?: string;
  runProvider?: string;
}): Promise<{ messageId: string; persistedAttachments: PersistedAttachment[] } | null> {
  const runProviderField = args.runProvider ? { runProvider: args.runProvider } : {};
  // A run that produced no text did not succeed, whatever it reported. Saying
  // "completed" with an empty body leaves the reader staring at a blank turn
  // with nothing to act on — the budget rejections read exactly like that.
  if (args.status === "completed" && !args.content.trim() && !args.pendingActions?.length) {
    args = {
      ...args,
      status: "failed",
      content: "The model returned nothing for this turn. Check the run's debug view for why.",
    };
    log.warn(`[run-stream] empty completed result for session=${args.sessionId ?? "?"} — recorded as failed`);
  }
  if (args.sessionId) {
    const guard = await redisService.getConnection()
      .set(`${STREAM_PERSIST_KEY_PREFIX}${args.sessionId}`, "1", "EX", 86_400, "NX")
      .catch(() => "OK" as const);
    if (guard !== "OK") return null;
  }

  // Branching: prefer updating the placeholder (keeps id stable across the
  // stream lifecycle). Fall back to CREATE when no placeholder id was
  // provided (callers that pre-date branching) or when the placeholder row
  // was swept between dispatch and finalize.
  const assistantMsg = args.assistantMessageId
    ? await chatMessageRepository
        .update(args.assistantMessageId, { content: args.content, status: args.status, ...(args.pendingActions?.length ? { pendingActions: args.pendingActions } : {}), ...runProviderField })
        .catch(async (err: unknown) => {
          log.warn(
            `[run-stream] placeholder update failed (${errMsg(err)}); creating fresh row`,
          );
          return chatMessageRepository.create({
            conversationId: args.conversationId,
            agentSlug: args.agentSlug,
            userId: args.userId,
            role: "assistant",
            content: args.content,
            status: args.status,
            orgId: args.orgId,
            ...(args.pendingActions?.length ? { pendingActions: args.pendingActions } : {}),
            ...runProviderField,
          });
        })
    : await chatMessageRepository.create({
        conversationId: args.conversationId,
        agentSlug: args.agentSlug,
        userId: args.userId,
        role: "assistant",
        content: args.content,
        status: args.status,
        orgId: args.orgId,
        ...(args.pendingActions?.length ? { pendingActions: args.pendingActions } : {}),
        ...runProviderField,
        ...(await chatMessageRepository.latestMessageId(args.conversationId, args.agentSlug)
          .then((id) => (id ? { parentId: id } : {}))
          .catch(() => ({}))),
      });

  const persistedAttachments: PersistedAttachment[] = [];
  if (args.attachments?.length) {
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    for (const att of args.attachments) {
      try {
        const buffer = Buffer.from(att.data, "base64");
        const safeName = att.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 200);
        const destPath = `chat-attachments/${args.userId}/${year}/${month}/${Date.now()}-${randomUUID()}-${safeName}`;
        await gcsService.uploadFile(buffer, destPath, att.mimeType);
        // Tool-supplied metadata (e.g. create-react-artifact's manifest) rides
        // the attachment rather than the tool-result text, which pi truncates.
        // Without persisting it here the artifact would survive a reload only
        // via the /agents/:convId/messages path and be missing from this run.
        let attachmentMetadata = att.metadata as Record<string, unknown> | undefined;

        // A conversation owns ONE app. This mirrors the identical hook in
        // agent-chat.ts's persistAssistantResult: the dashboard's AI screen
        // streams through THIS path, not /agent-chat, so scoping only that one
        // left every AI-screen artifact unversioned and unowned.
        const sessionArtifact = attachmentMetadata?.["reactArtifact"];
        if (sessionArtifact && typeof sessionArtifact === "object") {
          const session = await attachArtifactToSessionApp({
            conversationId: args.conversationId,
            userId: args.userId,
            payload: buffer,
          });
          if (session) {
            attachmentMetadata = {
              ...attachmentMetadata,
              reactArtifact: {
                ...(sessionArtifact as Record<string, unknown>),
                appId: session.appId,
                versionId: session.versionId,
                versionNumber: session.versionNumber,
              },
            };
          }
        }

        const hasMetadata = attachmentMetadata && Object.keys(attachmentMetadata).length > 0;
        const row = await prisma.chatAttachment.create({
          data: {
            chatMessageId: assistantMsg.id,
            uploaderUserId: args.userId,
            storageProvider: "gcs",
            url: destPath,
            originalFilename: att.fileName,
            mimeType: att.mimeType,
            size: buffer.length,
            ...(hasMetadata ? { metadata: attachmentMetadata as import("@prisma/client").Prisma.InputJsonValue } : {}),
          },
        });
        // Only `reactArtifact` goes back over the wire — the same allowlist the
        // message-history serializer applies, so `url` never reaches a client.
        // Read the STAMPED metadata, not att.metadata: the session ids were just
        // added, and the card rendering this stream needs them immediately.
        const reactArtifact = attachmentMetadata?.["reactArtifact"];
        persistedAttachments.push({
          id: row.id,
          mimeType: row.mimeType,
          originalFilename: row.originalFilename,
          size: row.size,
          ...(reactArtifact ? { metadata: { reactArtifact } } : {}),
        });
      } catch (attErr) {
        log.error(`[run-stream] Failed to persist attachment ${att.fileName}:`, errMsg(attErr));
      }
    }
  }

  if (args.status === "completed") {
    void maybeGenerateConversationTitle({
      conversationId: args.conversationId,
      agentSlug: args.agentSlug,
      userId: args.userId,
      orgId: args.orgId,
      assistantReply: args.content,
    }).catch((err) => log.warn("[run-stream] chat title generation failed:", errMsg(err)));
  }

  return { messageId: assistantMsg.id, persistedAttachments };
}

/**
 * POST /claw/api/v1/run/stream - SSE streaming endpoint for Spaces backend
 *
 * This endpoint wraps the /run endpoint and provides SSE streaming instead of webhooks.
 * Spaces backend connects via SSE, and we internally handle the webhook callbacks
 * from xyne-claw, proxying them as SSE events.
 */
publicRouter.post("/", requireAuth, requireNoAccessToken, async (req: Request, res: Response) => {
  const streamId = randomUUID();
  // Periodic keepalive on the frontend leg (Spaces backend ← claw-auth).
  // Started once the SSE response is open, stopped on disconnect and in the
  // finally below. See the setInterval site for why this is required.
  let backendKeepalive: ReturnType<typeof setInterval> | null = null;
  // Visible to the outer catch — see the identical pair in agent-chat.ts. A turn
  // that throws before dispatch owns a placeholder and a run row that must both
  // reach a terminal state instead of being stranded at "running".
  let pendingAssistantMsgId: string | undefined;
  let pendingRunSessionId: string | undefined;

  try {
    const {
      userId,
      userName,
      userEmail,
      task,
      agentSlug,
      provider,
      /** Per-run provider/model pin from the Ask AI composer's model picker.
       *  Forwarded verbatim to /internal/run, which validates it (unknown
       *  provider / missing personal cred → 400) and applies it. Deliberately
       *  NOT folded into `resolvedProvider` below: agent-level resolution wins
       *  over a body `provider`, whereas an explicit pin must win over the
       *  agent default — /run draws that distinction. */
      providerOverride,
      conversationId,
      callbackUrl: _originalCallbackUrl,
      progressUrl: _originalProgressUrl,
      channelId,
      canvasIds,
      ticketIds,
      callIds,
      attachedContext,
      attachments,
      contextFiles,
      providerConfigs,
      subagentProviders,
      researchContext,
      webSearchEnabled,
      deepResearchEnabled,
      /** Per-message provider fast mode (Spaces composer ⚡ toggle). Overrides
       *  the agent's modelSettings.speed for THIS run only; absent = agent
       *  default. Invalid values are ignored rather than 400d — this route is
       *  a pass-through for several callers. */
      speed: rawSpeed,
      /** Per-message thinking level (Spaces composer dropdown). Merged over the
       *  agent's modelSettings for this run; invalid values are ignored. */
      thinkingLevel: rawThinkingLevel,
      agentConfig,
      additionalInstructions,
      generateFollowUpSuggestions,
      // Branching: same semantics as the /agent-chat/:slug/chat route.
      isRegenerate,
      isEditUserMessage,
      parentUserMessageId,
      parentAssistantMessageId,
      editedUserMessageId,
      studioMode,
      designArtifactAttachmentId,
      designSelection,
      pageSelection,
      openItems,
      sandboxMode,
    } = req.body as Record<string, unknown> & { sandboxMode?: "local" | "remote" | "container" };

    if (!task || typeof task !== "string") {
      res.status(400).json({ success: false, error: "task is required" });
      return;
    }

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ success: false, error: "userId is required" });
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

    // What the reader has open on the surface that sent this turn. Without it a
    // question about "this page" can only be answered from the route name.
    const openItemsInstruction = (() => {
      if (!openItems || typeof openItems !== "object") return "";
      const value = openItems as { container?: unknown; items?: unknown };
      const rows = Array.isArray(value.items) ? value.items : [];
      const lines = rows
        .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
        .slice(0, 20)
        .map((row) => {
          const title = typeof row["title"] === "string" ? row["title"].slice(0, 200) : "";
          if (!title) return "";
          const kind = typeof row["kind"] === "string" ? row["kind"] : "";
          const url = typeof row["url"] === "string" ? row["url"].slice(0, 500) : "";
          const active = row["active"] === true;
          return `- ${active ? "[open now] " : ""}${title}${kind ? ` (${kind.toLowerCase()})` : ""}${url ? ` — ${url}` : ""}`;
        })
        .filter(Boolean);
      if (lines.length === 0) return "";
      const container = typeof value.container === "string" ? value.container.slice(0, 200) : "";
      const placement = (openItems as { placement?: Record<string, unknown> }).placement;
      const channelId =
        placement && typeof placement["channelId"] === "string" ? placement["channelId"] : "";
      const folderId =
        placement && typeof placement["folderId"] === "string" ? placement["folderId"] : "";
      return [
        "## Open on the user's screen",
        container ? `They are in "${container}".` : "",
        "These are the tabs they have open; the one marked [open now] is what they are looking at:",
        ...lines,
        'When they say "this page", "this doc" or "what is open", they mean that one.',
        channelId && folderId
          ? `Anything you create for them belongs here too: pass channelId="${channelId}" and ` +
            `sdlcFolderId="${folderId}" to spaces-create-canvas so it is filed in this folder ` +
            "rather than left unfiled."
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    })();

    const pageSelectionInstruction = (() => {
      if (!pageSelection || typeof pageSelection !== "object") return "";
      const value = pageSelection as Record<string, unknown>;
      const text = typeof value["text"] === "string" ? value["text"].trim().slice(0, 4000) : "";
      const url = typeof value["url"] === "string" ? value["url"].trim().slice(0, 2000) : "";
      if (!text || !url) return "";
      const title = typeof value["title"] === "string" ? value["title"].trim().slice(0, 240) : "";
      const intent = value["intent"] === "edit" ? "edit" : "ask";
      return [
        "## Page selection (captured from the workspace browser)",
        `- Page: ${title || url}`,
        `- URL: ${url}`,
        "- Selected passage:",
        text,
        intent === "edit"
          ? "The user picked this passage to change. Apply their instruction to this exact passage using the " +
            "connector tool for this document (for Google Docs, google-docs-edit), anchoring the change on this " +
            "text rather than rewriting the whole document."
          : "The user picked this passage to ask about. This is a page they were reading, not a document you can " +
            "write to, so answer about it rather than trying to edit it. Quote it back only when it helps.",
      ].join("\n");
    })();

    const compactRequested = parseSlashCommand(task)?.kind === "compact";
    const effectiveTask = studioMode === "design" && !/^\/design(?:\s|$)/i.test(task.trim())
      ? `/design ${task.trim()}`
      : applyAiScreenCommand(task).task;

    const sessionUserId = req.headers["x-user-id"];
    if (typeof sessionUserId === "string" && sessionUserId && sessionUserId !== userId) {
      res.status(403).json({ success: false, error: "Body userId does not match authenticated session" });
      return;
    }

    const slug = typeof agentSlug === "string" && agentSlug ? agentSlug : "assistant";
    const convId = typeof conversationId === "string" && conversationId ? conversationId : `chat-${randomUUID()}`;
    const requestOrgId = typeof req.headers["x-org-id"] === "string" && req.headers["x-org-id"].trim()
      ? req.headers["x-org-id"].trim()
      : undefined;
    if (!requestOrgId) {
      log.error("[run-stream] missing x-org-id; refusing global slug lookup", { slug });
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const agentRow = await prisma.agent.findUnique({
      where: { orgId_slug: { orgId: requestOrgId, slug } },
      select: {
        id: true,
        orgId: true,
        name: true,
        description: true,
        config: true,
        systemPrompt: true,
      },
    }).catch(() => null);
    if (!agentRow) {
      log.warn(`[run-stream/chat] agent org-scoped miss slug=${slug} orgId=${requestOrgId ?? "none"} userId=${userId}`);
      res.status(404).json({ success: false, error: "Agent not found" });
      return;
    }
    const orgId = agentRow.orgId;

    // Gate for `debug` SSE frames (system prompt / instructions / tool policy).
    // Same predicate the /agent-chat stream uses: only the agent's editors or a
    // Claw admin may watch a live debug trace. Resolved here (not in the
    // /progress forwarder) because that forwarder is an internal S2S POST with
    // no user identity.
    const allowDebug = (await isClawAdmin(userId))
      || Boolean((await getAgentEditAccess(userId, slug, orgId))?.canEdit);

    const sdlcResolution = await resolveSdlcRepositoryForUser(
      userId,
      researchContext && typeof researchContext === "object" && !Array.isArray(researchContext)
        ? researchContext as { type?: unknown; id?: unknown }
        : undefined,
      convId,
    );
    if (!sdlcResolution.ok) {
      res.status(sdlcResolution.status).json({ success: false, error: sdlcResolution.error });
      return;
    }
    const sdlcContext =
      sdlcResolution.repository?.agentContext ??
      (typeof channelId === "string"
        ? await resolveSdlcHubContextForUser(userId, channelId, convId)
        : undefined);

    // Resolve the agent's provider credentials so this SSE run uses the agent's
    // configured provider + model (e.g. a shared LiteLLM key) rather than the env
    // platform default. run-stream is otherwise a pass-through: the Spaces
    // backend sends provider="spaces" / no providerConfigs, which fell straight
    // to claw's env LITELLM_MODEL. Agent-level resolution (the same shared
    // resolver the headless + automation paths use). Body-supplied values win
    // only when the agent has no configured creds.
    const speedOverride = rawSpeed === "fast" || rawSpeed === "standard" ? rawSpeed : undefined;
    const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"];
    const thinkingOverride = typeof rawThinkingLevel === "string" && THINKING_LEVELS.includes(rawThinkingLevel)
      ? rawThinkingLevel
      : undefined;
    const effectiveSpeed = speedOverride ?? agentDefaultSpeed(agentRow.config);
    const resolvedProviders = await resolveAgentProviderConfigs(agentRow, { speed: effectiveSpeed }).catch(() => null);
    const resolvedProvider = resolvedProviders?.provider ?? (provider as string | undefined);
    const resolvedProviderConfigs =
      resolvedProviders && Object.keys(resolvedProviders.providerConfigs).length > 0
        ? resolvedProviders.providerConfigs
        : (providerConfigs as Record<string, unknown> | undefined);
    const resolvedProviderOrder =
      resolvedProviders && resolvedProviders.providerOrder.length > 0
        ? resolvedProviders.providerOrder
        : undefined;
    const pinnedOverride = (providerOverride ?? undefined) as { provider?: string; model?: string } | undefined;
    const harnessPinned = pinnedOverride?.provider === "local-harness";
    const serverPinned =
      !harnessPinned &&
      (pinnedOverride?.provider === "litellm" || pinnedOverride?.provider === "spaces") &&
      Boolean(pinnedOverride?.model);
    const forwardedProviderOverride = harnessPinned ? undefined : providerOverride;

    const rawPersonalProvider = CONFIG.localHarnessEnabled
      ? (await userAgentConfigRepository.findByUserAndAgent(userId, orgId, slug).catch(() => null))?.provider
      : undefined;
    const rawAgentProviderOrder = (agentRow.config as Record<string, unknown> | null)?.["providerOrder"];
    const agentConfiguredProviderOrder: string[] = Array.isArray(rawAgentProviderOrder)
      ? rawAgentProviderOrder.filter((p): p is string => typeof p === "string")
      : [];

    // Branching-aware turn setup. Mirrors /agent-chat/:slug/chat — see that
    // route for the full design rationale. Three flows:
    //   1. Regenerate  — skip user create, branch off the existing user.
    //   2. Edit-user   — create a sibling user under the same assistant
    //                    parent, branch the PI session BEFORE that user.
    //   3. Normal send — create a user under the latest visible assistant,
    //                    resolve the PI session for the selected path.
    // In all three a placeholder assistant row is pre-created (status="running")
    // so its id can drive PI session branching, AgentRun.chatMessageId
    // linkage, and the SSE `done` payload.
    const isRegenerateFlag = isRegenerate === true;
    const isEditUserMessageFlag = isEditUserMessage === true;
    const parentUserMessageIdStr = typeof parentUserMessageId === "string" ? parentUserMessageId : undefined;
    const parentAssistantMessageIdStr = typeof parentAssistantMessageId === "string" ? parentAssistantMessageId : undefined;
    const editedUserMessageIdStr = typeof editedUserMessageId === "string" ? editedUserMessageId : undefined;

    // ALWAYS fetch existing messages for any conversation that already has
    // rows. Without this, a normal v2 send had no view of prior turns and
    // parented every user message to root (parentId=null) — which then
    // cascaded into: edit-user pulling the previous assistant into the LLM
    // session (because the source resolved to convId and branchSession
    // cut at the JSONL's overall last user), regenerate replaying the prior
    // user+response pair (same reason), and v3 rendering every v2-written
    // user msg as a root sibling. Always fetching costs one query per turn
    // and matches the agent-chat behavior exactly. The query is cheap (a
    // brand-new conversation returns []), and the data is a flat list — no
    // recursive joins.
    const existingMessageRows = convId
      ? await chatMessageRepository.findByConversation(convId)
      : [];
    const existingMessages: ChatTreeMessage[] = existingMessageRows.map((m) => ({
          id: m.id,
          role: m.role,
          parentId: (m as { parentId?: string | null }).parentId ?? null,
          createdAt: m.createdAt,
        }));

    let assistantParentId: string | null = null;
    let createdUserMessageId: string | undefined;
    let piConversationId: string = convId;
    let cloneSourcePiConversationId: string | null = null;
    let cloneBranchMode: "lastUser" | "beforeLastUser" = "lastUser";
    let followUpHistoryLeafId: string | null = null;
    let userMsg: Awaited<ReturnType<typeof chatMessageRepository.create>> | undefined;

    if (isRegenerateFlag && parentUserMessageIdStr) {
      let resolvedParentUserMessageId = parentUserMessageIdStr;
      const userMsgRow = existingMessages.find((m) => m.id === parentUserMessageIdStr && m.role === "user");
      if (!userMsgRow) {
        // The client can hold an OPTIMISTIC user-message id that was never
        // swapped to the persisted one. The Ask-AI v2 stream emits `event: error`
        // WITHOUT userMessageId when a turn errors/terminates before a clean
        // `done` (see the error path below ~L901 + clawAgentService), so the
        // frontend never learns that turn's real id and regenerating it sends
        // the local optimistic id. The user row IS persisted, though (run-stream
        // writes it before dispatch), so rather than a hard 400 we fall back to
        // the LATEST persisted user message for this agent — for the linear
        // Ask-AI thread that is exactly the turn being regenerated.
        const agentMsgs = await chatMessageRepository.findByConversationAndAgent(convId, slug).catch(() => []);
        const latestUser = [...agentMsgs].reverse().find((m) => m.role === "user");
        if (!latestUser) {
          res.status(400).json({ success: false, error: "Invalid parentUserMessageId for regenerate" });
          return;
        }
        resolvedParentUserMessageId = latestUser.id;
        log.warn(`[run-stream] regenerate parentUserMessageId=${parentUserMessageIdStr} not persisted (likely an optimistic id from an errored turn); falling back to latest user message ${latestUser.id} conv=${convId} agent=${slug}`);
      }
      assistantParentId = resolvedParentUserMessageId;
      followUpHistoryLeafId = existingMessages.find(
        (message) => message.id === resolvedParentUserMessageId,
      )?.parentId ?? null;
      // Resolve from the existing ASSISTANT being regenerated (when the caller
      // provided it), so the path actually reaches its branch suffix — see
      // /agent-chat for the long-form rationale.
      const existingAssistantId = parentAssistantMessageIdStr
        && existingMessages.some((m) => m.id === parentAssistantMessageIdStr && m.role === "assistant" && m.parentId === resolvedParentUserMessageId)
        ? parentAssistantMessageIdStr
        : null;
      cloneSourcePiConversationId = resolvePiConversationIdForPath(
        existingMessages,
        existingAssistantId ?? resolvedParentUserMessageId,
        convId,
      );
      cloneBranchMode = "beforeLastUser";
    } else if (isEditUserMessageFlag && editedUserMessageIdStr) {
      const requestedParent = parentAssistantMessageIdStr
        ? existingMessages.find((m) => m.id === parentAssistantMessageIdStr && m.role === "assistant")
        : undefined;
      const editedUserMsg = existingMessages.find((m) => m.id === editedUserMessageIdStr && m.role === "user");
      if (!editedUserMsg || (editedUserMsg.parentId ?? null) !== (requestedParent?.id ?? null)) {
        res.status(400).json({ success: false, error: "Invalid edited user branch" });
        return;
      }
      cloneSourcePiConversationId = resolvePiConversationIdForPath(
        existingMessages,
        editedUserMessageIdStr,
        convId,
      );
      cloneBranchMode = "beforeLastUser";
      followUpHistoryLeafId = requestedParent?.id ?? null;

      if (convId && userId) {
        try {
          userMsg = await chatMessageRepository.create({
            conversationId: convId,
            agentSlug: slug,
            userId,
            role: "user",
            content: task.trim(),
            parentId: requestedParent?.id ?? null,
            orgId,
            ...(Array.isArray(attachedContext) && attachedContext.length > 0
              ? { attachedContext }
              : {}),
          });
          createdUserMessageId = userMsg.id;
          assistantParentId = userMsg.id;
        } catch (msgErr) {
          log.warn("[run-stream] Failed to persist edit-user message:", errMsg(msgErr));
        }
      }
    } else {
      // Normal send (also covers "first turn" where existingMessages is empty).
      const requestedParent = parentAssistantMessageIdStr
        ? existingMessages.find((m) => m.id === parentAssistantMessageIdStr && m.role === "assistant")
        : undefined;
      const lastAssistantMsg = [...existingMessages].reverse().find((m) => m.role === "assistant");
      const userParentId = requestedParent?.id ?? lastAssistantMsg?.id ?? null;
      followUpHistoryLeafId = existingMessageRows.some(
        (message) => message.id === userParentId && message.agentSlug === slug,
      )
        ? userParentId
        : [...existingMessageRows].reverse().find(
            (message) => message.role === "assistant" && message.agentSlug === slug,
          )?.id ?? null;
      piConversationId = resolvePiConversationIdForPath(existingMessages, userParentId, convId);

      if (convId && userId) {
        try {
          userMsg = await chatMessageRepository.create({
            conversationId: convId,
            agentSlug: slug,
            userId,
            role: "user",
            content: task.trim(),
            parentId: userParentId,
            orgId,
            ...(Array.isArray(attachedContext) && attachedContext.length > 0
              ? { attachedContext }
              : {}),
          });
          createdUserMessageId = userMsg.id;
          assistantParentId = userMsg.id;
        } catch (msgErr) {
          log.warn("[run-stream] Failed to persist user message:", errMsg(msgErr));
        }
      }
    }

    if (convId && userId && createdUserMessageId) {
      void maybeGenerateConversationTitle({
        conversationId: convId,
        agentSlug: slug,
        userId,
        orgId,
      }).catch((err) => log.warn("[run-stream] chat title generation failed:", errMsg(err)));
    }

    // Pre-create the running assistant placeholder. Its id powers PI session
    // branching, AgentRun linkage, and the SSE `done` payload.
    let assistantMsg: Awaited<ReturnType<typeof chatMessageRepository.create>> | undefined;
    if (convId && userId) {
      try {
        assistantMsg = await chatMessageRepository.create({
          conversationId: convId,
          agentSlug: slug,
          userId,
          role: "assistant",
          content: "",
          status: "running",
          parentId: assistantParentId,
          orgId,
        });
      } catch (msgErr) {
        log.warn("[run-stream] Failed to pre-create assistant placeholder:", errMsg(msgErr));
      }
      pendingAssistantMsgId = assistantMsg?.id;
    }

    // Record the run BEFORE dispatch, on an id we mint rather than one read back
    // from the dispatch response — see lib/chat-run-record.ts for why. Awaited
    // and fatal: a turn whose run cannot be recorded must not run.
    const runSessionId = mintChatSessionId();
    if (convId && userId && orgId) {
      try {
        await beginChatRun({
          sessionId: runSessionId,
          userId,
          agentSlug: slug,
          orgId,
          task: effectiveTask,
          conversationId: convId,
        });
        pendingRunSessionId = runSessionId;
      } catch (startErr) {
        log.error("[run-stream] AgentRun.start failed — refusing the turn:", errMsg(startErr));
        if (assistantMsg) {
          await chatMessageRepository
            .update(assistantMsg.id, {
              content: widgetErrorContent(undefined, "Could not start this run. Please try again."),
              status: "failed",
            })
            .catch(() => {});
        }
        res.status(500).json({ success: false, error: "Could not start this run" });
        return;
      }
    }

    // Branched PI session clone (regenerate / edit-user).
    if (cloneSourcePiConversationId && assistantMsg) {
      piConversationId = branchPiConversationId(convId, assistantMsg.id);
      const cloneSourceSessionKey = piSessionStoreKey(cloneSourcePiConversationId, slug);
      const cloneTargetSessionKey = piSessionStoreKey(piConversationId, slug);
      log.info(
        `[run-stream] branch clone start conv=${convId} agent=${slug} mode=${cloneBranchMode} source=${cloneSourceSessionKey} target=${cloneTargetSessionKey}`,
      );
      const cloneRes = await cloneBranchSession({
        sourceConversationId: cloneSourceSessionKey,
        targetConversationId: cloneTargetSessionKey,
        branchMode: cloneBranchMode,
      }).catch((err) => {
        log.error("[run-stream] branch clone threw:", err instanceof Error ? err.message : err);
        return { success: false, error: "Failed to create branch session" } as const;
      });
      log.info(`[run-stream] branch clone result success=${cloneRes.success}`);
      if (!cloneRes.success) {
        const errContent = cloneRes.error ?? "Failed to create branch session";
        await chatMessageRepository.update(assistantMsg.id, { content: errContent, status: "failed" }).catch(() => {});
        res.status(500).json({ success: false, error: errContent });
        return;
      }
    }

    // Persist user-uploaded attachments and link them to the user message
    // so they survive page reloads.
    const incomingAttachments = attachments as Array<{ fileName: string; mimeType: string; data: string }> | undefined;
    const persistedUserAttachmentIds: string[] = [];
    const harnessAttachments: Array<{ id: string; fileName: string; mimeType: string }> = [];
    if (incomingAttachments && incomingAttachments.length > 0 && userId) {
      const now = new Date();
      const year = String(now.getUTCFullYear());
      const month = String(now.getUTCMonth() + 1).padStart(2, "0");

      for (const att of incomingAttachments) {
        try {
          const buffer = Buffer.from(att.data, "base64");
          const safeName = att.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 200);
          const destPath = `chat-attachments/${userId}/${year}/${month}/${Date.now()}-${randomUUID()}-${safeName}`;

          await gcsService.uploadFile(buffer, destPath, att.mimeType);

          const row = await prisma.chatAttachment.create({
            data: {
              uploaderUserId: userId,
              storageProvider: "gcs",
              url: destPath,
              originalFilename: att.fileName,
              mimeType: att.mimeType,
              size: buffer.length,
            },
          });
          persistedUserAttachmentIds.push(row.id);
          harnessAttachments.push({ id: row.id, fileName: att.fileName, mimeType: att.mimeType });
        } catch (attErr) {
          log.warn(`[run-stream] Failed to persist user attachment ${att.fileName}:`, errMsg(attErr));
        }
      }

      if (persistedUserAttachmentIds.length > 0 && userMsg) {
        try {
          await chatAttachmentRepository.linkToMessage(
            persistedUserAttachmentIds,
            userMsg.id,
            userId,
          );
        } catch (linkErr) {
          log.warn("[run-stream] Failed to link user attachments to message:", errMsg(linkErr));
        }
      }

      void recordUploadedArtifacts({
        conversationId: convId,
        messageId: userMsg?.id ?? null,
        userId,
        orgId: orgId ?? null,
        uploads: harnessAttachments.map((a) => ({ id: a.id, originalFilename: a.fileName })),
      });
    }

    // Rehydrate attachments from prior turns of this conversation. Claw's
    // workspace is per-run (keyed by sessionId) and gets a FRESH directory
    // every turn — files uploaded in turn 1 are not present on disk for
    // turn 2's agent to read. GCS is the source of truth, so on every run
    // we fetch all prior user-uploaded attachments for this conversation
    // and re-supply them alongside this turn's new uploads. Claw's
    // ingestAttachments then writes the full set into the new workspace's
    // `.context/` and advertises every file under `## Attached Files`.
    //
    // Budget: each turn re-downloads from GCS and forwards over the wire to
    // claw, so unbounded accumulation would blow up latency and memory.
    // When the conversation exceeds the budget we drop OLDEST first
    // (newest-first iteration) so the most recent context survives.
    // row.size is used to gate BEFORE downloading, so oversized files don't
    // burn bandwidth just to be skipped.
    const REHYDRATE_MAX_FILES = 20;
    const REHYDRATE_MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MiB
    const REHYDRATE_MAX_PER_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB
    const priorAttachments: Array<{ fileName: string; mimeType: string; data: string }> = [];
    if (convId && userId) {
      try {
        const priorRows = await prisma.chatAttachment.findMany({
          where: {
            uploaderUserId: userId,
            storageProvider: "gcs",
            chatMessage: { conversationId: convId, agentSlug: slug, role: "user" },
            ...(persistedUserAttachmentIds.length > 0 && {
              id: { notIn: persistedUserAttachmentIds },
            }),
          },
          orderBy: { createdAt: "desc" },
        });
        let accumulatedBytes = 0;
        let droppedTooLarge = 0;
        let droppedOverBudget = 0;
        const kept: typeof priorRows = [];
        for (const row of priorRows) {
          if (row.size > REHYDRATE_MAX_PER_FILE_BYTES) {
            droppedTooLarge += 1;
            continue;
          }
          if (kept.length >= REHYDRATE_MAX_FILES) {
            droppedOverBudget += 1;
            continue;
          }
          if (accumulatedBytes + row.size > REHYDRATE_MAX_TOTAL_BYTES) {
            droppedOverBudget += 1;
            continue;
          }
          kept.push(row);
          accumulatedBytes += row.size;
        }
        // Restore chronological order so older versions of a duplicated
        // filename get overwritten by the newer one when claw writes them.
        kept.reverse();
        // A local-harness run fetches each file from the bridge by id, so the
        // device needs the ids of earlier turns' files too — without these a
        // conversation with any attachment history would both lose access to
        // those files and fail the harness-eligibility check below.
        for (const row of kept) {
          harnessAttachments.push({
            id: row.id,
            fileName: row.originalFilename,
            mimeType: row.mimeType,
          });
        }
        for (const row of kept) {
          try {
            const buf = await gcsService.getFileBuffer(row.url);
            priorAttachments.push({
              fileName: row.originalFilename,
              mimeType: row.mimeType,
              data: buf.toString("base64"),
            });
          } catch (fetchErr) {
            log.warn(
              `[run-stream] Failed to rehydrate prior attachment ${row.originalFilename} (${row.id}):`,
              errMsg(fetchErr),
            );
          }
        }
        if (droppedTooLarge > 0 || droppedOverBudget > 0) {
          log.warn(
            `[run-stream] Rehydration capped for conversation ${convId}: kept=${kept.length}, droppedTooLarge=${droppedTooLarge}, droppedOverBudget=${droppedOverBudget}, totalBytes=${accumulatedBytes}`,
          );
        }
      } catch (queryErr) {
        log.warn(
          "[run-stream] Failed to query prior conversation attachments:",
          errMsg(queryErr),
        );
      }
    }
    let designArtifactAttachment: { fileName: string; mimeType: string; data: string } | null = null;
    if (studioMode === "design" && typeof designArtifactAttachmentId === "string" && designArtifactAttachmentId) {
      const [artifact] = await chatAttachmentRepository.findManyByIdsForUser([designArtifactAttachmentId], userId);
      if (!artifact || (!artifact.mimeType.toLowerCase().includes("html") && !artifact.originalFilename.toLowerCase().endsWith(".html"))) {
        res.status(400).json({ success: false, error: "Design Studio artifact is unavailable" });
        return;
      }
      if (artifact.size > 10 * 1024 * 1024) {
        res.status(400).json({ success: false, error: "Design Studio artifact exceeds the 10 MB HTML limit" });
        return;
      }
      const designBuf = await gcsService.getFileBuffer(artifact.url);
      designArtifactAttachment = {
        fileName: artifact.originalFilename,
        mimeType: "text/html",
        data: designBuf.toString("base64"),
      };
    }

    const mergedAttachments: Array<{ fileName: string; mimeType: string; data: string }> = [
      ...priorAttachments,
      ...(incomingAttachments ?? []),
    ];
    if (
      designArtifactAttachment &&
      !mergedAttachments.some((attachment) => attachment.fileName === designArtifactAttachment.fileName)
    ) {
      mergedAttachments.push(designArtifactAttachment);
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    // Keepalive comment on the frontend leg (Spaces backend ← claw-auth).
    // claw's own 25s KEEPALIVE_FRAME is an SSE *comment*, which the claw-auth
    // consumer (consume-claw-stream.ts) parses to no event and therefore never
    // re-emits toward the backend. During a long silent tool execution nothing
    // else is written to this response either, so the backend↔claw-auth fetch
    // body goes fully idle and gets severed — by undici's bodyTimeout or an L7
    // proxy's idle-read timeout — surfacing as `[XyneAIv2] stream failed:
    // terminated` even though the run completes and persists. A 15s comment
    // keeps the socket warm under typical 30-60s idle windows; the backend's
    // SSE parser ignores comment lines, so it's a pure liveness signal.
    backendKeepalive = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        try { res.write(":ka\n\n"); } catch { /* response already torn down */ }
      }
    }, 15_000);

    // This pod now holds a live SSE stream — make sure it's subscribed to
    // the cross-pod event bus so progress/callback POSTs that land on OTHER
    // replicas get forwarded back here. Idempotent; safe to call repeatedly.
    ensureStreamEventsSubscriber();

    const resultPromise = new Promise<{
      content: string;
      status: "completed" | "failed" | "cancelled";
      errorCode?: string | undefined;
      pendingActions?: Array<Record<string, unknown>> | undefined;
      attachments?: StreamAttachment[] | undefined;
      toolInvocations?: unknown;
      followUpSuggestions?: string[] | undefined;
      followUpsPending?: boolean | undefined;
      clawRunOrigin?: Record<string, unknown> | undefined;
    }>((resolve, reject) => {
      let closed = false;
      pendingStreams.set(streamId, {
        sendEvent: (event, data) => {
          if (closed) return;
          try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          } catch {}
        },
        resolve,
        reject,
        setClosed: () => {
          closed = true;
        },
        cookieHeader: req.headers["cookie"] as string | undefined,
        allowDebug,
      });

      setTimeout(() => {
        if (pendingStreams.has(streamId)) {
          pendingStreams.delete(streamId);
          reject(new Error("Agent timed out"));
        }
      }, 30 * 60 * 1000);
    });

    // Store metadata for use in callback (fast-path lookup — the /callback
    // handler also recovers meta from the callback body + agent_runs row
    // when it lands on a non-owning pod). Branching fields let the callback
    // UPDATE the pre-created assistant placeholder + link AgentRun.chatMessageId.
    streamMeta.set(streamId, {
      userId,
      agentSlug: slug,
      orgId,
      conversationId: convId,
      task: effectiveTask,
      ...(assistantMsg ? { assistantMessageId: assistantMsg.id } : {}),
      ...(createdUserMessageId ? { userMessageId: createdUserMessageId } : {}),
      assistantParentId,
    });

    res.write(`event: meta\ndata: ${JSON.stringify({ streamId, conversationId: convId })}\n\n`);

    if (convId && userId && !isRegenerateFlag && !isEditUserMessageFlag && !isTurnControlCommand(effectiveTask)) {
      const handoff = await awaitTurnHandoff({
        conversationId: convId,
        agentSlug: slug,
        userId,
        onLabel: (label) => pendingStreams.get(streamId)?.sendEvent("label", { toolLabel: label }),
      });
      if (handoff.handedOff) {
        log.info(`[run-stream] previous turn handed off conv=${convId} reason=${handoff.reason}`);
      }
    }

    // assistantMessageId on the callback URL so cross-pod callbacks can
    // resolve the placeholder without depending on local pendingStreams.
    const internalCallbackUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run-stream/${streamId}/callback` +
      (assistantMsg ? `?assistantMessageId=${encodeURIComponent(assistantMsg.id)}` : "");
    const internalProgressUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run-stream/${streamId}/progress`;
    const incomingAgentConfig = agentConfig && typeof agentConfig === "object" && !Array.isArray(agentConfig)
      ? agentConfig as Record<string, unknown>
      : {};
    const {
      sdlcRepository: _untrustedSdlcRepository,
      sdlcContext: _untrustedSdlcContext,
      requireSdlcRepository: _untrustedSdlcRequirement,
      ...safeIncomingAgentConfig
    } = incomingAgentConfig;
    const enrichedAgentConfig: Record<string, unknown> = {
      ...safeIncomingAgentConfig,
      ...(sdlcContext ? { sdlcContext } : {}),
      followUpConversationHistory: buildFollowUpConversationHistory(
        existingMessageRows.map((message) => ({
          id: message.id,
          parentId: (message as { parentId?: string | null }).parentId ?? null,
          role: message.role,
          content: message.content,
          agentSlug: message.agentSlug,
        })),
        followUpHistoryLeafId,
        slug,
      ),
      followUpAgentContext: {
        name: agentRow.name,
        description: agentRow.description,
      },
    };
    // Fast mode: forward the agent's model settings (with the effective speed)
    // and fast-mode profile so claw applies the speed + run-setting overrides.
    // ONLY when this run is fast — this route otherwise forwards no stored
    // modelSettings, and standard runs must stay byte-identical to today.
    if (effectiveSpeed === "fast" || thinkingOverride) {
      const storedConfig = (agentRow.config as Record<string, unknown> | null) ?? {};
      const storedModelSettings = storedConfig["modelSettings"];
      // Fast runs carry the agent's full model settings (this route otherwise
      // forwards none) so the speed + fast-profile overrides apply in claw. A
      // standard run with ONLY a thinking override forwards just that field —
      // anything more would change behavior for settings this path never
      // honored before. The per-message thinking override wins over both the
      // stored value and the fast profile's override.
      enrichedAgentConfig["modelSettings"] = {
        ...(effectiveSpeed === "fast" && storedModelSettings && typeof storedModelSettings === "object" && !Array.isArray(storedModelSettings)
          ? storedModelSettings as Record<string, unknown>
          : {}),
        ...(effectiveSpeed === "fast" ? { speed: "fast" } : {}),
        ...(thinkingOverride ? { thinkingLevel: thinkingOverride } : {}),
      };
      if (effectiveSpeed === "fast") {
        const profile = parseFastModeProfile(storedConfig);
        if (storedConfig["fastModeProfile"] !== undefined && storedConfig["fastModeProfile"] !== null) {
          // Drop the profile's own thinking override when the user picked one
          // for this message — claw overlays profile.modelSettings over
          // modelSettings on fast runs, and the per-message choice must win.
          const rawProfile = storedConfig["fastModeProfile"];
          enrichedAgentConfig["fastModeProfile"] = thinkingOverride && rawProfile && typeof rawProfile === "object" && !Array.isArray(rawProfile) && (rawProfile as Record<string, unknown>)["modelSettings"]
            ? {
                ...(rawProfile as Record<string, unknown>),
                modelSettings: {
                  ...((rawProfile as Record<string, unknown>)["modelSettings"] as Record<string, unknown>),
                  thinkingLevel: thinkingOverride,
                },
              }
            : rawProfile;
        }
        log.info(`[run-stream] fast mode for ${slug} (override=${speedOverride ?? "agent-default"}, profile=${profile.providers}${thinkingOverride ? `, thinking=${thinkingOverride}` : ""})`);
      } else {
        log.info(`[run-stream] thinking override for ${slug}: ${thinkingOverride}`);
      }
    }

    const splitContext = splitLocalFolderContext(attachedContext);
    const forwardedAttachedContext = Array.isArray(attachedContext)
      ? splitContext.rest
      : attachedContext;
    let localFolderItem: LocalFolderContextItem | null = splitContext.localFolders[0] ?? null;
    if (!localFolderItem && convId) {
      const sticky = await chatMessageRepository
        .latestLocalFolderContext(convId, slug)
        .catch(() => null);
      const stickySplit = splitLocalFolderContext(sticky ? [sticky] : []);
      localFolderItem = stickySplit.localFolders[0] ?? null;
    }
    const localFolderWorkspace = localFolderItem ? toLocalFolderWorkspace(localFolderItem) : null;

    const fastModeEnabled = await resolveFastMode(
      convId,
      slug,
      enrichedAgentConfig,
    );

    const runRequestBody: Record<string, unknown> = {
      // Pre-minted and already persisted as an AgentRun row above. prepareRun
      // honours a caller-supplied sessionId on internal runs, so the row, the
      // dispatch and every later callback all key on the same id.
      sessionId: runSessionId,
      userId,
      userName,
      userEmail,
      task: effectiveTask,
      agentSlug: slug,
      orgId,
      ...(resolvedProvider ? { provider: resolvedProvider } : {}),
      ...(forwardedProviderOverride ? { providerOverride: forwardedProviderOverride } : {}),
      conversationId: convId,
      ...(piConversationId !== convId ? { piSessionConversationId: piConversationId } : {}),
      ...(isRegenerateFlag ? { isRegenerate: true } : {}),
      callbackUrl: internalCallbackUrl,
      progressUrl: internalProgressUrl,
      channelId,
      canvasIds,
      ticketIds,
      callIds,
      attachedContext: forwardedAttachedContext,
      attachments: mergedAttachments.length > 0 ? mergedAttachments : attachments,
      contextFiles,
      ...(resolvedProviderConfigs && Object.keys(resolvedProviderConfigs).length > 0 ? { providerConfigs: resolvedProviderConfigs } : {}),
      ...(resolvedProviderOrder ? { providerOrder: resolvedProviderOrder } : {}),
      subagentProviders,
      researchContext,
      webSearchEnabled,
      deepResearchEnabled,
      agentConfig: enrichedAgentConfig,
      additionalInstructions,
      ...(designSelectionInstruction || pageSelectionInstruction || openItemsInstruction
        ? {
            additionalInstructions: [
              typeof additionalInstructions === "string" ? additionalInstructions.trim() : "",
              designSelectionInstruction,
              pageSelectionInstruction,
              openItemsInstruction,
            ].filter(Boolean).join("\n\n"),
          }
        : {}),
      ...(generateFollowUpSuggestions === true ? { generateFollowUpSuggestions: true } : {}),
      __persistedByCaller: true,
      fastMode: fastModeEnabled,
    };

    try {
      const serverCatchUp = await planServerContinuation({
        conversationId: convId,
        agentSlug: slug,
        excludeMessageIds: [createdUserMessageId, assistantMsg?.id].filter((id): id is string => Boolean(id)),
      });
      if (serverCatchUp) {
        const existing = typeof runRequestBody["context"] === "string" ? (runRequestBody["context"] as string) : "";
        runRequestBody["context"] = existing ? `${existing}\n\n${serverCatchUp}` : serverCatchUp;
      }
    } catch (catchUpErr) {
      log.warn("[run-stream] server catch-up context failed:", errMsg(catchUpErr));
    }

    // Register req-close cleanup unconditionally — both transports need it so a
    // dropped frontend connection short-circuits the run. The AbortController
    // is passed into the SSE consumer so the upstream fetch to claw tears down
    // when the dashboard goes away.
    //
    // BUT — we deliberately delay the upstream abort by a short grace window.
    // When the user explicitly hits Stop, the dashboard sends a /cancel POST
    // (separate connection) AND aborts its SSE fetch in parallel. If we tore
    // upstream down the instant the SSE fetch closes, we'd race the cancelled
    // `done` frame that claw is about to emit — consume-claw-stream would
    // throw AbortError before reading it, /callback would never run, and the
    // partial chat_messages row would never be written. The grace window lets
    // the cancelled `done` flow through cleanly. After the window, we
    // force-abort so a raw disconnect (no /cancel POST) doesn't keep the
    // agent burning tokens forever.
    const UPSTREAM_ABORT_GRACE_MS = 3000;
    const upstreamAbort = new AbortController();
    req.on("close", () => {
      if (backendKeepalive) { clearInterval(backendKeepalive); backendKeepalive = null; }
      pendingStreams.get(streamId)?.setClosed();
      if (upstreamAbort.signal.aborted) return;
      setTimeout(() => {
        if (!upstreamAbort.signal.aborted) upstreamAbort.abort();
      }, UPSTREAM_ABORT_GRACE_MS);
    });

    const isTaskCommandRun = IMMEDIATE_TASK_COMMAND_RE.test(effectiveTask);
    const sandboxCommand = parseLocalSandboxCommand(effectiveTask);
    const containerSandboxMode = sandboxMode === "container";
    const deviceSandboxMode = sandboxMode === "local" || containerSandboxMode;
    const localSandboxRequested = deviceSandboxMode && Boolean(sandboxCommand);
    const designRevisionOnly = Boolean(
      localSandboxRequested &&
        designArtifactAttachment &&
        mergedAttachments.length === 1 &&
        mergedAttachments[0] === designArtifactAttachment &&
        !(Array.isArray(attachments) && attachments.length > 0),
    );
    // Attached context is resolved server-side into a prompt block. The harness
    // has no resolver of its own, so resolve it here and ship the block in the
    // envelope — otherwise a run with context could only go to the server.
    let attachedContextPrefix = '';
    let attachedContextFiles: Array<{ path: string; content: string }> = [];
    if (Array.isArray(forwardedAttachedContext) && forwardedAttachedContext.length > 0) {
      try {
        const { buildAttachedContextPayload, normalizeAttachedContext } = await import(
          "../services/agentChatContextService.js"
        );
        const { getSpacesAuthForUser } = await import("../lib/spaces-db.js");
        const auth = await getSpacesAuthForUser(userId);
        const normalized = normalizeAttachedContext(forwardedAttachedContext);
        if (auth && normalized.items.length > 0) {
          const payload = await buildAttachedContextPayload(normalized.items, auth);
          attachedContextPrefix = payload.promptPrefix ?? '';
          attachedContextFiles = payload.contextFiles ?? [];
        }
      } catch (err) {
        log.warn(`[run-stream] attached context resolution failed: ${errMsg(err)}`);
      }
    }

    const harnessInstructionBlocks = [
      typeof additionalInstructions === "string" ? additionalInstructions.trim() : "",
      designSelectionInstruction,
      pageSelectionInstruction,
      openItemsInstruction,
    ].filter(Boolean);
    const localSandboxContext = [
      attachedContextPrefix,
      designRevisionOnly && designArtifactAttachment
        ? `Current design HTML (revise this):\n\`\`\`html\n${Buffer.from(designArtifactAttachment.data, "base64").toString("utf8")}\n\`\`\``
        : "",
      ...harnessInstructionBlocks,
    ]
      .filter(Boolean)
      .join("\n\n") || null;
    const attachmentsClear =
      (mergedAttachments.length === 0 && !(Array.isArray(attachments) && attachments.length > 0)) || designRevisionOnly;
    const workspaceRun = Boolean(localFolderWorkspace) && (!isTaskCommandRun || deviceSandboxMode);
    // Uploaded files ride along in the run envelope, and attached context is
    // resolved above into the envelope's context block, so neither forces the
    // server path any more. Context files the caller supplied still do: claw
    // writes those into the run's workspace.
    const contextResolved =
      !(Array.isArray(forwardedAttachedContext) && forwardedAttachedContext.length > 0) ||
      Boolean(attachedContextPrefix) ||
      attachedContextFiles.length > 0;
    const harnessEligible =
      workspaceRun ||
      ((!isTaskCommandRun || localSandboxRequested) &&
        contextResolved &&
        !(Array.isArray(contextFiles) && contextFiles.length > 0) &&
        (attachmentsClear || harnessAttachments.length > 0));
    if (CONFIG.localHarnessEnabled && isTaskCommandRun && !localSandboxRequested) {
      log.info(
        `[run-stream] local-harness skipped for conv=${convId}: task command (sandboxMode=${sandboxMode ?? "remote"})`,
      );
    } else if (CONFIG.localHarnessEnabled && !harnessEligible) {
      log.info(`[run-stream] local-harness skipped for conv=${convId}: run carries attached context`);
    } else if (CONFIG.localHarnessEnabled && localSandboxRequested) {
      log.info(`[run-stream] local sandbox requested for conv=${convId}: command=/${sandboxCommand}`);
    }
    const pinnedHarnessProvider = harnessPinned && typeof pinnedOverride?.model === "string"
      ? pinnedOverride.model.replace(/^local-harness:/, "")
      : undefined;
    const pinnedHarnessTarget = harnessEligible && pinnedHarnessProvider && isLocalHarnessProvider(pinnedHarnessProvider)
      ? await resolveLocalHarnessTargetForProvider(userId, pinnedHarnessProvider).catch((harnessErr: unknown) => {
          log.warn("[run-stream] pinned local-harness resolution failed:", errMsg(harnessErr));
          return undefined;
        })
      : undefined;
    if (pinnedHarnessProvider && !pinnedHarnessTarget) {
      log.info(`[run-stream] pinned local-harness provider=${pinnedHarnessProvider} has no online device — falling back`);
    }

    const localTarget = pinnedHarnessTarget ?? (harnessEligible && (!serverPinned || workspaceRun)
      ? await resolveLocalHarnessTarget({
          userId,
          orgId,
          providerOrder: agentConfiguredProviderOrder,
          personalProvider: rawPersonalProvider,
        }).catch((harnessErr: unknown) => {
          log.warn("[run-stream] local-harness resolution failed — using server run:", errMsg(harnessErr));
          return undefined;
        })
      : undefined);

    const resolvedLocalSandbox = localTarget && localSandboxRequested && sandboxCommand
      ? await resolveLocalSandbox(sandboxCommand)
      : localTarget && deviceSandboxMode && !isTaskCommandRun
        ? { command: "chat", instruction: "", skills: [] }
        : undefined;
    const localSandbox = resolvedLocalSandbox && containerSandboxMode
      ? { ...resolvedLocalSandbox, container: true }
      : resolvedLocalSandbox;
    if (localTarget && localSandboxRequested && !localSandbox) {
      log.info(`[run-stream] local sandbox spec unavailable for /${sandboxCommand} conv=${convId} — using the server run`);
    }

    // A conversation attached to a local folder can only run on the desktop
    // harness — the server has no copy of the user's working tree, so falling
    // back to it would silently answer about the wrong thing.
    if (workspaceRun && localFolderWorkspace && !localTarget) {
      pendingStreams.delete(streamId);
      streamMeta.delete(streamId);
      const errContent = localFolderUnavailableMessage(localFolderWorkspace.name);
      try {
        if (assistantMsg) {
          await chatMessageRepository.update(assistantMsg.id, { content: errContent, status: "failed" });
        } else {
          await chatMessageRepository.create({ conversationId: convId, agentSlug: slug, userId, role: "assistant", content: errContent, status: "failed", orgId });
        }
      } catch (msgErr) {
        log.warn("[run-stream] Failed to persist local-folder failure message:", errMsg(msgErr));
      }
      await failChatRun(runSessionId, errContent);
      pendingRunSessionId = undefined;
      if (!res.writableEnded && !res.destroyed) {
        res.write(`event: done\ndata: ${JSON.stringify({
          content: errContent,
          status: "failed",
          conversationId: convId,
          ...(assistantMsg ? { id: assistantMsg.id } : {}),
          ...(createdUserMessageId ? { userMessageId: createdUserMessageId } : {}),
          ...(assistantParentId ? { parentId: assistantParentId } : {}),
        })}\n\n`);
        res.end();
      }
      return;
    }

    if (localTarget && (!localSandboxRequested || localSandbox || workspaceRun)) {
      if (compactRequested) {
        await localHarnessSessionRepository.clearForConversation(convId).catch(() => 0);
      }
      const dispatched = await dispatchLocalHarnessRun({
        target: localTarget,
        sessionId: runSessionId,
        userId,
        orgId,
        conversationId: convId,
        agentSlug: slug,
        agentName: agentRow.name,
        systemPrompt: agentRow.systemPrompt,
        model: pinnedModelForProvider(agentRow.config, localTarget.provider),
        task: effectiveTask,
        context: localSandboxContext,
        ...(localSandbox ? { localSandbox } : {}),
        ...(harnessAttachments.length ? { attachments: harnessAttachments } : {}),
        progressUrl: internalProgressUrl,
        callbackUrl: internalCallbackUrl,
        serverFallbackBody: runRequestBody,
        ...(workspaceRun && localFolderWorkspace ? { workspace: localFolderWorkspace, noServerFallback: true } : {}),
        continuation: {
          agentSlug: slug,
          excludeMessageIds: [createdUserMessageId, assistantMsg?.id].filter((id): id is string => Boolean(id)),
        },
      });

      const runOrigin = { kind: "local-harness" as const, provider: localTarget.provider, harnessName: localHarnessProviderLabel(localTarget.provider) };

      res.write(`event: run\ndata: ${JSON.stringify({ sessionId: dispatched.sessionId, conversationId: convId, clawRunOrigin: runOrigin })}\n\n`);

      // The row was written before dispatch; the harness run carries the same id
      // because we handed it down. Ownership of the terminal state passes to the
      // callback from here.
      pendingRunSessionId = undefined;
      pendingAssistantMsgId = undefined;

      const harnessResult = await resultPromise;

      if (!res.writableEnded && !res.destroyed) {
        res.write(`event: done\ndata: ${JSON.stringify({
          content: harnessResult.content,
          status: harnessResult.status,
          conversationId: convId,
          clawRunOrigin: harnessResult.clawRunOrigin ?? runOrigin,
          ...(harnessResult.errorCode ? { errorCode: harnessResult.errorCode } : {}),
          ...(assistantMsg ? { id: assistantMsg.id } : {}),
          ...(createdUserMessageId ? { userMessageId: createdUserMessageId } : {}),
          ...(assistantParentId ? { parentId: assistantParentId } : {}),
          ...(harnessResult.pendingActions?.length ? { pendingActions: harnessResult.pendingActions } : {}),
          ...(harnessResult.attachments?.length ? { attachments: harnessResult.attachments } : {}),
          ...(harnessResult.followUpSuggestions?.length ? { followUpSuggestions: harnessResult.followUpSuggestions } : {}),
          ...(harnessResult.followUpsPending === true ? { followUpsPending: true } : {}),
        })}\n\n`);
        res.end();
      }
      return;
    }

    // SSE transport: open /internal/run with Accept: text/event-stream and
    // consume ordered frames over a single TCP connection. Each frame is
    // dispatched into the same pendingStreams.sendEvent(...) and
    // agentRunRepository calls the legacy /progress handler runs, so the SSE
    // response we write to the FRONTEND is unchanged byte-for-byte. On `done`,
    // we POST the result into our own /callback endpoint so all the citation
    // appending, attachment persistence, AgentRun finalize, and stream.resolve
    // wiring stays in one place (the existing /callback handler).
    if (CONFIG.clawSseTransport) {
      await runViaSseTransport({
        streamId,
        convId,
        slug,
        userId,
        orgId,
        task: effectiveTask,
        runRequestBody,
        cookie: req.headers["cookie"] as string | undefined,
        xUserId: req.headers["x-user-id"] as string | undefined,
        internalCallbackUrl,
        res,
        upstreamSignal: upstreamAbort.signal,
        ...(assistantMsg ? { assistantMessageId: assistantMsg.id } : {}),
      });
      const result = await resultPromise;
      if (!res.writableEnded && !res.destroyed) {
        res.write(`event: done\ndata: ${JSON.stringify({
          content: result.content,
          status: result.status,
          conversationId: convId,
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
          // Stable ids + parent so the dashboard can swap optimistic ids and
          // stitch the new turn into the persisted tree. Missing these on
          // follow-ups left the new bot orphaned under the unsynced local
          // user id — mergeRefreshedMessages then rewrote bot.parentId to
          // the server user id, which doesn't match anything locally, so
          // resolveActivePath stopped one node short and the reply vanished
          // from the UI until reload.
          ...(assistantMsg ? { id: assistantMsg.id } : {}),
          ...(createdUserMessageId ? { userMessageId: createdUserMessageId } : {}),
          ...(assistantParentId ? { parentId: assistantParentId } : {}),
          ...(result.pendingActions?.length ? { pendingActions: result.pendingActions } : {}),
          ...(result.attachments?.length ? { attachments: result.attachments } : {}),
          ...(result.followUpSuggestions?.length ? { followUpSuggestions: result.followUpSuggestions } : {}),
          ...(result.followUpsPending === true ? { followUpsPending: true } : {}),
        })}\n\n`);
        res.end();
      }
      return;
    }

    const runRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        ...(req.headers["cookie"] ? { Cookie: req.headers["cookie"] as string } : {}),
        ...(req.headers["x-user-id"] ? { "x-user-id": req.headers["x-user-id"] as string } : {}),
      },
      body: JSON.stringify(runRequestBody),
      signal: upstreamAbort.signal,
    });

    const runBody = (await runRes.json()) as {
      success: boolean;
      sessionId?: string;
      error?: string;
    };

    if (!runBody.success) {
      pendingStreams.delete(streamId);
      streamMeta.delete(streamId);

      // Persist failed assistant message — UPDATE the placeholder when we
      // pre-created one (keeps the assistant id stable for the frontend),
      // CREATE otherwise (first-turn errors before placeholder write).
      const errContent = widgetErrorContent(runBody.error, runBody.error ?? "Failed to start agent");
      try {
        if (assistantMsg) {
          await chatMessageRepository.update(assistantMsg.id, { content: errContent, status: "failed" });
        } else {
          await chatMessageRepository.create({ conversationId: convId, agentSlug: slug, userId, role: "assistant", content: errContent, status: "failed", orgId });
        }
      } catch (msgErr) {
        log.warn("[run-stream] Failed to persist error assistant message:", errMsg(msgErr));
      }
      // Close the pre-created row. This is the dispatch-refused case that used to
      // leave the conversation with messages and no run at all.
      await failChatRun(runSessionId, runBody.error ?? "Failed to start agent");
      pendingRunSessionId = undefined;

      res.write(`event: error\ndata: ${JSON.stringify({
        error: errContent,
        ...(runBody.error ? { errorCode: runBody.error } : {}),
      })}\n\n`);
      res.end();
      return;
    }

    res.write(`event: run\ndata: ${JSON.stringify({ sessionId: runBody.sessionId, conversationId: convId })}\n\n`);

    // Row already written before dispatch; the callback owns it from here.
    if (runBody.sessionId && runBody.sessionId !== runSessionId) {
      log.error(
        `[run-stream] dispatch returned sessionId=${runBody.sessionId} but the run row is keyed on ${runSessionId} (conv=${convId})`,
      );
    }
    pendingRunSessionId = undefined;
    pendingAssistantMsgId = undefined;

    const result = await resultPromise;

    if (!res.writableEnded && !res.destroyed) {
      res.write(`event: done\ndata: ${JSON.stringify({
        content: result.content,
        status: result.status,
        conversationId: convId,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        // Branching: stable ids + parent so the client can swap optimistic
        // ids and stitch the message into the persisted tree.
        ...(assistantMsg ? { id: assistantMsg.id } : {}),
        ...(createdUserMessageId ? { userMessageId: createdUserMessageId } : {}),
        ...(assistantParentId ? { parentId: assistantParentId } : {}),
        ...(result.pendingActions?.length ? { pendingActions: result.pendingActions } : {}),
        ...(result.attachments?.length ? { attachments: result.attachments } : {}),
        ...(result.followUpSuggestions?.length ? { followUpSuggestions: result.followUpSuggestions } : {}),
        ...(result.followUpsPending === true ? { followUpsPending: true } : {}),
      })}\n\n`);
      res.end();
    }

  } catch (err) {
    log.error(`[run-stream] Error:`, err);
    // Drive the turn terminal — see the identical block in agent-chat.ts. Before
    // this, a throw in the pre-dispatch window stranded the placeholder at
    // "running" with no run row for anything to reap.
    if (pendingRunSessionId) await failChatRun(pendingRunSessionId, err);
    if (pendingAssistantMsgId) {
      await chatMessageRepository
        .update(pendingAssistantMsgId, {
          content: widgetErrorContent(undefined, "This run stopped unexpectedly."),
          status: "failed",
        })
        .catch(() => {});
    }
    pendingStreams.delete(streamId);
    streamMeta.delete(streamId);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Internal server error" });
    } else if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" })}\n\n`);
      res.end();
    }
  } finally {
    if (backendKeepalive) clearInterval(backendKeepalive);
  }
});

/**
 * POST /claw/api/v1/run/stream/cancel
 *
 * Cancel an in-flight Ask AI v2 (run-stream) session. Mirrors the
 * agent-chat /cancel endpoint: validate ownership against agent_runs,
 * then forward to xyne-claw's internal cancel endpoint which aborts the
 * active run's AbortController. The cancelled `done` frame returned by
 * claw is what actually persists partial state — this endpoint just
 * triggers it.
 */
publicRouter.post("/cancel", requireAuth, requireNoAccessToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getRequesterId(req) ?? (req.body as { userId?: string }).userId;
    if (!userId) {
      res.status(400).json({ success: false, error: "userId or x-user-id header required" });
      return;
    }

    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId || typeof sessionId !== "string") {
      res.status(400).json({ success: false, error: "sessionId is required" });
      return;
    }

    const run = await agentRunRepository.findBySessionId(sessionId);
    if (!run || run.userId !== userId) {
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

    const cancelRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run/${encodeURIComponent(sessionId)}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        "x-user-id": userId,
      },
    });

    if (!cancelRes.ok) {
      const body = (await cancelRes.json().catch(() => ({}))) as { error?: string };
      res.status(502).json({ success: false, error: body.error ?? `Cancel failed: HTTP ${cancelRes.status}` });
      return;
    }

    res.json({
      success: true,
      data: { sessionId, conversationId: run.conversationId, status: "cancelled" },
    });
  } catch (err) {
    log.error("[run-stream] cancel error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /claw/api/v1/internal/run-stream/:streamId/progress
 * Internal endpoint for xyne-claw to send progress updates.
 *
 * Pod-independent: the SSE stream may live on a different replica than the
 * one this POST landed on. We build the SSE event list and either send it
 * to the local stream or publish it onto the run-stream:events bus for the
 * owning pod to forward. agent_run progress updates run on this pod
 * regardless — they're keyed on sessionId.
 */
internalRouter.post("/:streamId/progress", (req: Request<{ streamId: string }>, res: Response) => {
  res.json({ success: true });

  const { streamId } = req.params;

  try {
    const body = req.body as Record<string, unknown>;
    const sessionId = body.sessionId as string | undefined;
    const toolLabel = body.toolLabel as string | undefined;

    const events: Array<{ event: string; data: unknown }> = [];

    if (body.toolExecutionStart || body.toolExecutionEnd || body.toolInvocation) {
      const inv = body.toolInvocation as Record<string, unknown> | undefined;
      if (inv && !isInternalFollowUpInvocation(inv)) {
        // Hydrate the icon data: URI from each citation's iconKey for the wire
        // copy ONLY; persist the original (iconKey, no bytes) below.
        events.push({ event: "invocation", data: hydrateInvocationIcons(inv) });
      }
      if (sessionId && inv) {
        agentRunRepository.appendToolInvocation(sessionId, inv).catch(() => {});
      }
    } else if (body.reasoningDelta !== undefined) {
      events.push({ event: "reasoning", data: { delta: body.reasoningDelta } });
    } else if (body.textDelta !== undefined) {
      events.push({ event: "delta", data: { content: body.textDelta } });
    } else if (Array.isArray(body.todos)) {
      events.push({ event: "plan", data: { todos: body.todos, ...(typeof body.planTitle === "string" ? { title: body.planTitle } : {}) } });
    } else if (body.attachment) {
      events.push({ event: "attachment", data: body.attachment });
    } else if (body.debugEvent) {
      events.push({ event: "debug", data: { debugEvent: body.debugEvent } });
    }

    if (events.length > 0) {
      const localStream = pendingStreams.get(streamId);
      if (localStream) {
        for (const e of events) {
          if (e.event === "debug" && !localStream.allowDebug) continue;
          localStream.sendEvent(e.event, e.data);
        }
      } else {
        publishStreamEvent({ kind: "progress", streamId, events });
      }
    }

    if (sessionId && toolLabel) {
      agentRunRepository.updateProgress(sessionId, toolLabel).catch(() => {});
    }
  } catch (err) {
    log.error("[run-stream] progress error:", err);
  }
});

/**
 * POST /claw/api/v1/internal/run-stream/:streamId/callback
 * Internal endpoint for xyne-claw to send final result.
 *
 * Pod-independent: persistence + agent_run finalize run on whichever pod
 * receives this POST (claw's k8s Service load-balances across replicas).
 * If the browser's SSE stream lives on a different pod, the result event is
 * fanned out via the run-stream:events Redis channel so that pod can write
 * `event: done`. Redis SETNX on sessionId makes persistence idempotent
 * across claw's 3 callback retries.
 */
internalRouter.post("/:streamId/callback", async (req: Request<{ streamId: string }>, res: Response) => {
  // Ack immediately — claw's sendCallback retries on 5xx/429/408 so we want
  // to avoid double-persist races when our handler is slow.
  res.json({ success: true });

  const { streamId } = req.params;

  // Branching: assistant placeholder id is on the callback URL query (so
  // cross-pod callbacks can resolve it even when the pendingStream lives on
  // another pod). Fall back to streamMeta below.
  const queryAssistantMessageId = typeof req.query["assistantMessageId"] === "string"
    ? req.query["assistantMessageId"]
    : undefined;

  try {
    const body = req.body as Record<string, unknown>;

    const rawError = typeof body.error === "string" ? body.error : undefined;
    const errorCode = rawError;
    const rawResult = (body.result as string) || rawError || "";
    const status = normalizeRunStatus(body.status);
    // Transient session-lock failure — never surface the raw token to the user.
    const isSessionLockedFailure = status === "failed" &&
      (body.error === "session_locked" || rawResult === "session_locked");
    const pendingActions = Array.isArray(body.pendingActions) ? body.pendingActions : undefined;
    const callbackAttachments = Array.isArray(body.attachments) ? body.attachments as StreamAttachment[] : undefined;
    const toolInvocations = body.toolInvocations;
    const followUpSuggestions = status === "completed" && rawResult.trim().length > 0
      ? extractFollowUpSuggestions(body.pendingQuestions)
      : undefined;
    const followUpsPending = body["followUpsPending"] === true;
    log.info(
      `[follow-ups] callback streamId=${streamId} sessionId=${typeof body.sessionId === "string" ? body.sessionId : ""} pendingQuestions=${Array.isArray(body.pendingQuestions) ? body.pendingQuestions.length : 0} extracted=${followUpSuggestions?.length ?? 0}`,
    );
    const llmCitations = body.llmCitations;
    const provider = typeof body.provider === "string" ? body.provider : undefined;
    const model = typeof body.model === "string" ? body.model : undefined;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;

    // Append LLM-provided citations (same logic as agent-chat.ts). For a
    // session-lock failure, replace the raw token with a friendly, retryable
    // message so it never renders as the assistant's answer.
    const rawLocalHarness = body["localHarness"];
    const callbackRunOrigin = rawLocalHarness && typeof rawLocalHarness === "object" && !Array.isArray(rawLocalHarness)
      ? { kind: "local-harness", ...(rawLocalHarness as Record<string, unknown>) }
      : undefined;

    const harnessUnreachableNotice = body["localHarnessUnreachable"] === true
      ? `⚠️ I couldn't reach **${localHarnessProviderLabel(typeof body["localHarnessProvider"] === "string" ? body["localHarnessProvider"] : "your local harness")}** on your machine, and running this on Xyne's servers instead didn't start either. Open the Xyne desktop app (or turn off the local harness for this agent) and try again.`
      : undefined;

    const content = harnessUnreachableNotice
      ? harnessUnreachableNotice
      : isSessionLockedFailure
      ? SESSION_LOCKED_USER_MESSAGE
      : status === "completed" && rawResult
        ? appendCitations(rawResult, toolInvocations, { baseUrl: CONFIG.spacesAppUrl, includeCitations: true }, llmCitations)
        : widgetErrorContent(rawError, rawResult);

    // Recover stream metadata. Local map is the fast path (SSE pod, SSE
    // transport's localhost callback replay); fall back to the callback body
    // (claw includes userId/conversationId/agentSlug on every callback) so
    // persistence works on whichever pod receives this POST. Final fallback
    // is agent_runs (recovered by sessionId) for very old retries whose
    // body shape didn't include the meta — defensive only.
    let meta = streamMeta.get(streamId);
    if (!meta) {
      const bodyUserId = typeof body.userId === "string" ? body.userId : undefined;
      const bodyConvId = typeof body.conversationId === "string" ? body.conversationId : undefined;
      const bodyAgentSlug = typeof body.agentSlug === "string" ? body.agentSlug : undefined;
      const bodyOrgId = typeof body.orgId === "string" ? body.orgId : undefined;
      if (bodyUserId && bodyConvId && bodyAgentSlug && bodyOrgId) {
        meta = { userId: bodyUserId, conversationId: bodyConvId, agentSlug: bodyAgentSlug, orgId: bodyOrgId, task: "" };
      } else if (sessionId) {
        try {
          const run = await agentRunRepository.findBySessionId(sessionId);
          if (run) {
            meta = {
              userId: run.userId,
              conversationId: run.conversationId ?? bodyConvId ?? "",
              agentSlug: run.agentSlug,
              orgId: run.orgId,
              task: run.task ?? "",
            };
          }
        } catch (lookupErr) {
          log.warn(`[run-stream] agent_run lookup failed for sessionId=${sessionId}:`, errMsg(lookupErr));
        }
      }
    }

    // Branching: resolve the placeholder assistant id — query param wins
    // (cross-pod safe), streamMeta is the same-pod fast path.
    const assistantMessageId = queryAssistantMessageId ?? meta?.assistantMessageId;

    // DURABLE write: persist the assistant message + attachments here, on
    // whichever pod received the callback. SETNX guard on sessionId stops
    // claw's 3 retries (and the SSE transport's localhost replay) from
    // double-writing across pods. Branching: when an `assistantMessageId`
    // was reserved at dispatch (the standard flow now), persistRunStreamResult
    // UPDATEs that row instead of creating a new one — keeps the assistant id
    // stable so the SSE `done` payload, AgentRun.chatMessageId, and any
    // attachments all point at the same row.
    if (meta?.conversationId && meta.userId) {
      try {
        const persistedResult = await persistRunStreamResult({
          conversationId: meta.conversationId,
          agentSlug: meta.agentSlug,
          userId: meta.userId,
          orgId: meta.orgId,
          content,
          status,
          ...(callbackAttachments?.length ? { attachments: callbackAttachments } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...(assistantMessageId ? { assistantMessageId } : {}),
          ...(pendingActions?.length ? { pendingActions } : {}),
          ...(provider ? { runProvider: provider } : {}),
        });
        if (persistedResult?.persistedAttachments.length) {
          void recordDeliveredArtifacts({
            conversationId: meta.conversationId,
            userId: meta.userId,
            orgId: meta.orgId ?? null,
            messageId: persistedResult.messageId,
            task: meta.task ?? null,
            attachments: persistedResult.persistedAttachments.map((att) => ({
              id: att.id,
              originalFilename: att.originalFilename,
              mimeType: att.mimeType,
            })),
          }).catch((artifactErr: unknown) => {
            log.warn(`[run-stream] delivered-artifact record failed:`, errMsg(artifactErr));
          });
        }
      } catch (msgErr) {
        log.warn(`[run-stream] Failed to persist assistant message:`, errMsg(msgErr));
      }
    } else {
      log.warn(`[run-stream] callback streamId=${streamId} missing meta (userId/conversationId) — message persistence skipped`);
    }

    // Finalize AgentRun (same pattern as /agent-chat). Pod-independent —
    // agentRunRepository.finalize is keyed on sessionId so it's safe to
    // run from any pod.
    if (sessionId) {
      try {
        const finalStatus = status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed";
        await agentRunRepository.finalize(sessionId, {
          status: finalStatus,
          result: content,
          // Keep the raw `session_locked` token in telemetry even though the
          // user-facing `content` was rewritten to a friendly message.
          error: status !== "completed" ? (isSessionLockedFailure ? "session_locked" : (rawError ?? content)) : null,
          ...(provider ? { provider } : {}),
          ...(model ? { model } : {}),
          toolsUsed: (body.toolsUsed as string[]) ?? [],
          // Branching: link run → assistant message so /messages can pair
          // them by id instead of by chronology (which breaks once a user
          // message has multiple assistant siblings).
          ...(assistantMessageId ? { chatMessageId: assistantMessageId } : {}),
          ...(toolInvocations ? { toolInvocations } : {}),
          ...(typeof body["fastMode"] === "boolean" ? { fastMode: body["fastMode"] as boolean } : {}),
        });
      } catch (finalizeErr) {
        log.warn(`[run-stream] Failed to finalize agent run:`, errMsg(finalizeErr));
      }
    }

    // Live tap for VIEWERS: announce the run finished (AFTER the durable persist
    // above, so a viewer's /messages refetch gets the final content) and tear
    // down the delta coalescer. A late partial write is already a status-guarded
    // no-op (persistRunStreamResult flipped status off "running").
    if (CONFIG.liveToolCallsEnabled && meta?.conversationId && meta.userId) {
      publishLiveEvent(meta.conversationId, { type: "done", conversationId: meta.conversationId, agentSlug: meta.agentSlug, userId: meta.userId, status, ...(followUpsPending ? { followUpsPending: true } : {}), ts: Date.now() });
    }
    if (sessionId) endDeltaCoalescer(sessionId);

    // Resolve the SSE stream — locally if this pod owns it, otherwise fan
    // out via the cross-pod bus. The owning pod writes `event: done` and
    // closes the response.
    const localStream = pendingStreams.get(streamId);
    if (localStream) {
      localStream.sendEvent("debug_artifacts_ready", {
        ...(sessionId ? { sessionId } : {}),
        ...(meta?.conversationId ? { conversationId: meta.conversationId } : {}),
      });
      pendingStreams.delete(streamId);
      streamMeta.delete(streamId);
      localStream.resolve({
        content,
        status,
        ...(errorCode ? { errorCode } : {}),
        pendingActions,
        attachments: callbackAttachments && callbackAttachments.length > 0 ? callbackAttachments : undefined,
        toolInvocations,
        followUpSuggestions,
        ...(followUpsPending ? { followUpsPending: true } : {}),
        ...(callbackRunOrigin ? { clawRunOrigin: callbackRunOrigin } : {}),
      });
    } else if (meta?.conversationId) {
      // Stream lives on another pod (the multi-replica case that returns
      // 404 today). The persistence + finalize above are already done, so
      // this publish is liveness-only: if it drops, the user sees the
      // assistant message on next refresh instead of mid-stream.
      publishStreamEvent({
        kind: "result",
        streamId,
        conversationId: meta.conversationId,
        content,
        status,
        ...(errorCode ? { errorCode } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(pendingActions?.length ? { pendingActions } : {}),
        ...(callbackAttachments?.length ? { attachments: callbackAttachments } : {}),
        ...(toolInvocations !== undefined ? { toolInvocations } : {}),
        ...(followUpSuggestions?.length ? { followUpSuggestions } : {}),
        ...(followUpsPending ? { followUpsPending: true } : {}),
      });
    } else {
      log.warn(`[run-stream] callback streamId=${streamId} resolved without local stream or conversationId — no SSE done frame will be sent`);
    }
  } catch (err) {
    log.error("[run-stream] callback error:", err);
  }
});

/**
 * Persists contextual follow-ups that finish after the main answer callback.
 * The answer stream is already closed at this point, so conversation history
 * is the durable delivery channel; the dashboard's bounded reconciliation
 * picks up the recorder without delaying the answer.
 */
internalRouter.post(
  "/:streamId/callback/follow-ups",
  requireResultToken((req) => extractLateFollowUpSessionId(req.body)),
  async (req: Request<{ streamId: string }>, res: Response) => {
    const parsed = parseLateFollowUpCallback(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Invalid follow-up callback payload" });
      return;
    }
    const {
      sessionId,
      suggestions,
      startedAt,
      completedAt,
      answerLength,
      enabledByV2Flag,
      generationInput,
      conversationMessageCount,
      agentContextProvided,
      agentContextName,
      agentContextDescription,
      generationSource,
      generationModel,
      failureCode,
      failureMessage,
      httpStatus,
    } = parsed.data;
    const invocations = buildLateFollowUpInvocations({
      sessionId,
      suggestions,
      startedAt,
      completedAt,
      ...(answerLength !== undefined ? { answerLength } : {}),
      enabledByV2Flag,
      ...(generationInput !== undefined ? { generationInput } : {}),
      ...(conversationMessageCount !== undefined ? { conversationMessageCount } : {}),
      ...(agentContextProvided !== undefined ? { agentContextProvided } : {}),
      ...(agentContextName !== undefined ? { agentContextName } : {}),
      ...(agentContextDescription !== undefined ? { agentContextDescription } : {}),
      ...(generationSource !== undefined ? { generationSource } : {}),
      ...(generationModel !== undefined ? { generationModel } : {}),
      ...(failureCode !== undefined ? { failureCode } : {}),
      ...(failureMessage !== undefined ? { failureMessage } : {}),
      ...(httpStatus !== undefined ? { httpStatus } : {}),
    });

    try {
      const appended = invocations.map((invocation) => agentRunRepository.appendToolInvocation(sessionId, invocation));
      await agentRunRepository.flushToolInvocations(sessionId);
      await Promise.all(appended);
      log.info(`[follow-ups] persisted late suggestions streamId=${req.params.streamId} sessionId=${sessionId} count=${suggestions.length}`);
      res.json({ success: true });
    } catch (err) {
      log.warn(`[follow-ups] failed to persist late suggestions sessionId=${sessionId}:`, errMsg(err));
      res.status(500).json({ success: false, error: "Failed to persist follow-up suggestions" });
    }
  },
);

// ── SSE transport plumbing ──────────────────────────────────────────────────
// Consumes claw's SSE stream and dispatches into the same pendingStreams
// sendEvent / agentRunRepository calls the legacy /progress and /callback
// HTTP handlers run. Downstream (frontend SSE) sees the same events in the
// same order — only the wire to claw changes.

interface RunViaSseOpts {
  streamId: string;
  convId: string;
  slug: string;
  userId: string;
  orgId: string;
  task: string;
  runRequestBody: Record<string, unknown>;
  cookie: string | undefined;
  xUserId: string | undefined;
  internalCallbackUrl: string;
  res: Response;
  upstreamSignal?: AbortSignal;
  /** Pre-created placeholder assistant row id — the live coalescer debounce-
   *  persists partial content onto it so a reload shows answer-so-far. */
  assistantMessageId?: string;
}

async function runViaSseTransport(opts: RunViaSseOpts): Promise<void> {
  const { streamId, convId, slug, userId, orgId, task, runRequestBody, cookie, xUserId, internalCallbackUrl, res, upstreamSignal, assistantMessageId } = opts;
  const stream = pendingStreams.get(streamId);
  if (!stream) {
    throw new Error(`pendingStream ${streamId} missing before SSE consume started`);
  }

  const startedAt = Date.now();
  let sessionIdFromStarted: string | undefined;
  // Set when claw emitted an early `cancelled` frame (user Stop). Lets the
  // missing-done fallback below report a `cancelled` terminal state instead of
  // a misleading `failed` when the cancelled `done` didn't make it back.
  let sawCancelled = false;
  // The run row is written by the caller BEFORE this function is reached, on the
  // id carried in runRequestBody.sessionId. It used to be created here, on the
  // `started` frame — so a stream that died before `started` (claw down, or the
  // conversation already locked) recorded nothing at all.
  const expectedSessionId = typeof runRequestBody["sessionId"] === "string"
    ? (runRequestBody["sessionId"] as string)
    : undefined;

  const consumeResult = await consumeClawStream({
    url: `${CONFIG.internalUrl}/claw/api/v1/internal/run`,
    body: runRequestBody,
    ...(CONFIG.xyneClawS2sKey ? { s2sKey: CONFIG.xyneClawS2sKey } : {}),
    extraHeaders: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(xUserId ? { "x-user-id": xUserId } : {}),
    },
    ...(upstreamSignal ? { signal: upstreamSignal } : {}),
    artifactContext: {
      conversationId: convId,
      userId,
      orgId,
      messageId: assistantMessageId ?? null,
    },
    onSeqGap: (expected, got) => {
      // We still process the frame; surfacing the gap to logs is enough for
      // the first-cut migration. A future hardening pass can reconnect with
      // Last-Event-ID and replay from a producer-side ring buffer.
      log.warn(`[run-stream/sse] seq gap on stream=${streamId}: expected ${expected}, got ${got}`);
    },
    handlers: {
      onStarted: (sessionId) => {
        sessionIdFromStarted = sessionId;
        // Mirror the legacy "event: run" the outer handler writes after the
        // /internal/run JSON response — same name, same payload shape.
        res.write(`event: run\ndata: ${JSON.stringify({ sessionId, conversationId: convId })}\n\n`);
        if (expectedSessionId && sessionId !== expectedSessionId) {
          log.error(
            `[run-stream/sse] claw started sessionId=${sessionId} but the run row is keyed on ${expectedSessionId} (conv=${convId})`,
          );
        }
      },
      onInvocation: async (sessionId, toolInvocation) => {
        const internalFollowUp = isInternalFollowUpInvocation(toolInvocation);
        if (!internalFollowUp) stream.sendEvent("invocation", toolInvocation);
        agentRunRepository
          .appendToolInvocation(sessionId, toolInvocation as Record<string, unknown>)
          .catch((err) => log.warn(`[run-stream/sse] appendToolInvocation failed for ${sessionId}:`, errMsg(err)));
        // Live tap for VIEWERS (reloaded tabs / Spaces): fan tool calls to the
        // shared live-conversation-bus that GET /agent-chat/:slug/chat/:convId/live
        // reads (same convId + slug as this run — no separate viewer bus needed).
        if (CONFIG.liveToolCallsEnabled && !internalFollowUp) {
          publishLiveEvent(convId, { type: "invocation", conversationId: convId, agentSlug: slug, userId, toolInvocation, ts: Date.now() });
        }
      },
      onReasoning: (sid, delta) => {
        if (!delta) return;
        stream.sendEvent("reasoning", { delta });
        // Coalesce reasoning → live bus + partial persist (viewers stream it).
        if (CONFIG.liveToolCallsEnabled && sid) pushDelta(sid, convId, slug, assistantMessageId, undefined, delta, userId);
      },
      onTextDelta: (sid, delta) => {
        if (!delta) return;
        stream.sendEvent("delta", { content: delta });
        if (CONFIG.liveToolCallsEnabled && sid) pushDelta(sid, convId, slug, assistantMessageId, delta, undefined, userId);
      },
      onAttachment: (_sid, attachment) => {
        stream.sendEvent("attachment", attachment);
      },
      onPlan: (_sid, todos) => {
        stream.sendEvent("plan", { todos });
      },
      onUiWidget: (_sid, widget) => {
        if (widget.type === "plan") {
          stream.sendEvent("plan", { todos: widget.payload.todos });
        } else {
          stream.sendEvent("ui-widget", { widget });
        }
      },
      onSandboxPreview: (sessionId, payload) => {
        // Sandbox preview today lands on /webhook/progress which posts the
        // noVNC link as a Spaces channel message. Replaying that POST keeps
        // the Spaces-side behavior identical until that consumer migrates.
        fetch(`${CONFIG.internalUrl}/claw/api/v1/webhook/progress`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
          },
          body: JSON.stringify({ sessionId, ...payload }),
          signal: AbortSignal.timeout(5_000),
        }).catch((err) => log.warn(`[run-stream/sse] sandbox replay failed: ${errMsg(err)}`));
      },
      onProgressLabel: (sessionId, payload) => {
        // Same reasoning as onSandboxPreview — progress labels feed the Spaces
        // ephemeral progress signal via /webhook/progress.
        fetch(`${CONFIG.internalUrl}/claw/api/v1/webhook/progress`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
          },
          body: JSON.stringify({ sessionId, ...payload }),
          signal: AbortSignal.timeout(5_000),
        }).catch(() => {});
        // Live tap for VIEWERS: the current tool label.
        const toolLabel = (payload as { toolLabel?: string })?.toolLabel;
        if (CONFIG.liveToolCallsEnabled && toolLabel) publishLiveEvent(convId, { type: "label", conversationId: convId, agentSlug: slug, userId, toolLabel, ts: Date.now() });
      },
      onDebug: (_sid, debugEvent) => {
        if (!stream.allowDebug) return;
        stream.sendEvent("debug", { debugEvent });
      },
      onCancelled: (_sid, reason) => {
        // Early cancel signal — fire-and-forget to the frontend so its typing
        // indicator drops the moment claw observes the abort, without waiting
        // for the cancelled done frame (which is delayed by partial-state
        // collection + the /callback replay). The cancelled done still
        // follows and resolves the resultPromise normally.
        sawCancelled = true;
        stream.sendEvent("cancelled", { reason: reason ?? "cancelled" });
      },
    },
  });

  if (!consumeResult.result) {
    // The stream ended without a `done` frame. This is NOT a normal completion
    // — claw's finally→forceDone backstop guarantees a `done` on any clean
    // return, so a missing one means the claw→proxy stream was severed mid-run
    // (pod SIGKILL on deploy, OOM, or a transient proxy↔claw reset). The
    // /internal/run proxy launders that into a clean EOF and, on a pipe error,
    // an `error` frame we now capture as consumeResult.errorReason.
    //
    // Rather than throw here — which fires BEFORE the /callback replay below,
    // leaving the pre-created assistant placeholder stuck in `running` forever
    // and skipping AgentRun finalize — synthesise a terminal /callback (parity
    // with agent-chat.ts) so persist + finalize + resolve run and the user sees
    // a clean failed/cancelled turn. The reason is logged (below) for triage.
    const terminalStatus = sawCancelled ? "cancelled" : "failed";
    const technicalReason = consumeResult.errorReason
      ?? "Claw SSE stream ended without a done frame";
    const userFacingError = sawCancelled
      ? "The request was cancelled."
      : "The assistant was interrupted before it could finish responding. Please try again.";

    // One structured line to disambiguate deploy-SIGKILL vs OOM vs idle-timeout
    // in prod: elapsedMs clustered near a proxy timeout ⇒ transport cut;
    // broad/random with eventCount>0 ⇒ abrupt pod death mid-run; ~0 elapsed with
    // eventCount 0 / !sawStarted ⇒ died before `started`.
    log.warn(
      `[run-stream/sse] missing done frame — stream=${streamId} status=${terminalStatus} ` +
      `reason=${JSON.stringify(technicalReason)} eventCount=${consumeResult.eventCount} ` +
      `lastSeq=${consumeResult.lastSeq} lastEvent=${consumeResult.lastEventName ?? "none"} ` +
      `sawStarted=${!!sessionIdFromStarted} sawCancelled=${sawCancelled} elapsedMs=${Date.now() - startedAt}`,
    );

    try {
      const cbRes = await fetch(internalCallbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        },
        body: JSON.stringify({
          sessionId: sessionIdFromStarted ?? "",
          userId,
          conversationId: convId,
          agentSlug: slug,
          orgId,
          status: terminalStatus,
          error: userFacingError,
        }),
      });
      if (!cbRes.ok) {
        const text = await cbRes.text().catch(() => "");
        log.warn(`[run-stream/sse] failed-callback returned ${cbRes.status}: ${text.slice(0, 300)}`);
      }
    } catch (err) {
      log.error(`[run-stream/sse] failed-callback POST threw (stream=${streamId}): ${errMsg(err)}`);
    }
    return;
  }

  const sessionId = sessionIdFromStarted ?? "";

  // Replay the final payload into the existing /callback endpoint so all the
  // citation appending, attachment persistence, AgentRun finalize, and
  // stream.resolve(...) wiring runs in exactly the same place it always has.
  // The outer await resultPromise then unblocks naturally.
  const r = consumeResult.result as Record<string, unknown>;
  const cbRes = await fetch(internalCallbackUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify({
      sessionId,
      // Ship the meta explicitly so the receiving pod's /callback handler
      // can persist without falling back to an agent_runs lookup when the
      // POST load-balances away from the SSE pod.
      userId,
      conversationId: convId,
      agentSlug: slug,
      status: r["status"],
      // claw's sendCallback puts assistant text on `result` (both completed
      // and cancelled paths). `.content` is kept as a forward-compat fallback.
      result:
        (r["result"] as string | undefined)
        ?? (r["content"] as string | undefined)
        ?? "",
      ...(r["error"] ? { error: r["error"] } : {}),
      ...(r["pendingActions"] ? { pendingActions: r["pendingActions"] } : {}),
      ...(r["attachments"] ? { attachments: r["attachments"] } : {}),
      ...(r["toolInvocations"] ? { toolInvocations: r["toolInvocations"] } : {}),
      ...(r["pendingQuestions"] ? { pendingQuestions: r["pendingQuestions"] } : {}),
      ...(r["toolsUsed"] ? { toolsUsed: r["toolsUsed"] } : {}),
      ...(r["followUpsPending"] === true ? { followUpsPending: true } : {}),
      ...((r["meta"] as Record<string, unknown> | undefined) ?? {}),
    }),
  });
  if (!cbRes.ok) {
    const text = await cbRes.text().catch(() => "");
    log.warn(`[run-stream/sse] /callback returned ${cbRes.status}: ${text.slice(0, 300)}`);
  }
}

export { publicRouter as runStreamRouter, internalRouter as runStreamInternalRouter };
