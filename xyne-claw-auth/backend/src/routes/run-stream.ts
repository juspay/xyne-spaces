import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";
import { requireAuth } from "../middleware/require-auth.js";
import { getRequesterId } from "../middleware/agent-acl.js";
import { prisma } from "../db.js";
import { chatMessageRepository, agentRunRepository, chatAttachmentRepository } from "../repositories/index.js";
import { gcsService } from "../services/gcsService.js";
import { appendCitations, hydrateInvocationIcons } from "../lib/citations.js";
import { consumeClawStream } from "../lib/consume-claw-stream.js";
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
    pendingActions?: Array<Record<string, unknown>> | undefined;
    attachments?: StreamAttachment[] | undefined;
    toolInvocations?: unknown;
  }) => void;
  reject: (error: Error) => void;
  setClosed: () => void;
  cookieHeader: string | undefined;
}

interface StreamMeta {
  userId: string;
  agentSlug: string;
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
}

type StreamBusEvent =
  | { kind: "progress"; streamId: string; events: Array<{ event: string; data: unknown }> }
  | {
      kind: "result";
      streamId: string;
      conversationId: string;
      content: string;
      status: "completed" | "failed" | "cancelled";
      sessionId?: string;
      pendingActions?: Array<Record<string, unknown>>;
      attachments?: StreamAttachment[];
      toolInvocations?: unknown;
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
      for (const e of msg.events) stream.sendEvent(e.event, e.data);
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
      ...(msg.pendingActions?.length ? { pendingActions: msg.pendingActions } : {}),
      ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
      ...(msg.toolInvocations !== undefined ? { toolInvocations: msg.toolInvocations } : {}),
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
async function persistRunStreamResult(args: {
  conversationId: string;
  agentSlug: string;
  userId: string;
  content: string;
  status: "completed" | "failed" | "cancelled";
  attachments?: StreamAttachment[];
  sessionId?: string;
  /** Branching: when set, UPDATE this pre-created assistant placeholder row
   *  instead of creating a new one. The placeholder id is reserved at
   *  POST /run/stream so it can drive PI session branching, AgentRun.chatMessageId
   *  linkage, and the SSE `done` payload's stable id. */
  assistantMessageId?: string;
}): Promise<{ messageId: string; persistedAttachments: PersistedAttachment[] } | null> {
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
        .update(args.assistantMessageId, { content: args.content, status: args.status })
        .catch(async (err: unknown) => {
          log.warn(
            `[run-stream] placeholder update failed (${err instanceof Error ? err.message : String(err)}); creating fresh row`,
          );
          return chatMessageRepository.create({
            conversationId: args.conversationId,
            agentSlug: args.agentSlug,
            userId: args.userId,
            role: "assistant",
            content: args.content,
            status: args.status,
          });
        })
    : await chatMessageRepository.create({
        conversationId: args.conversationId,
        agentSlug: args.agentSlug,
        userId: args.userId,
        role: "assistant",
        content: args.content,
        status: args.status,
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
        const row = await prisma.chatAttachment.create({
          data: {
            chatMessageId: assistantMsg.id,
            uploaderUserId: args.userId,
            storageProvider: "gcs",
            url: destPath,
            originalFilename: att.fileName,
            mimeType: att.mimeType,
            size: buffer.length,
          },
        });
        persistedAttachments.push({
          id: row.id,
          mimeType: row.mimeType,
          originalFilename: row.originalFilename,
          size: row.size,
        });
      } catch (attErr) {
        log.error(`[run-stream] Failed to persist attachment ${att.fileName}:`, attErr instanceof Error ? attErr.message : String(attErr));
      }
    }
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
publicRouter.post("/", requireAuth, async (req: Request, res: Response) => {
  const streamId = randomUUID();

  try {
    const {
      userId,
      userName,
      userEmail,
      task,
      agentSlug,
      provider,
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
      agentConfig,
      additionalInstructions,
      // Branching: same semantics as the /agent-chat/:slug/chat route.
      isRegenerate,
      isEditUserMessage,
      parentUserMessageId,
      parentAssistantMessageId,
      editedUserMessageId,
    } = req.body as Record<string, unknown>;

    if (!task || typeof task !== "string") {
      res.status(400).json({ success: false, error: "task is required" });
      return;
    }

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ success: false, error: "userId is required" });
      return;
    }

    const sessionUserId = req.headers["x-user-id"];
    if (typeof sessionUserId === "string" && sessionUserId && sessionUserId !== userId) {
      res.status(403).json({ success: false, error: "Body userId does not match authenticated session" });
      return;
    }

    const slug = typeof agentSlug === "string" && agentSlug ? agentSlug : "assistant";
    const convId = typeof conversationId === "string" && conversationId ? conversationId : `chat-${randomUUID()}`;

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
    const existingMessages: ChatTreeMessage[] = convId
      ? (await chatMessageRepository.findByConversation(convId)).map((m) => ({
          id: m.id,
          role: m.role,
          parentId: (m as { parentId?: string | null }).parentId ?? null,
          createdAt: m.createdAt,
        }))
      : [];

    let assistantParentId: string | null = null;
    let createdUserMessageId: string | undefined;
    let piConversationId: string = convId;
    let cloneSourcePiConversationId: string | null = null;
    let cloneBranchMode: "lastUser" | "beforeLastUser" = "lastUser";
    let userMsg: Awaited<ReturnType<typeof chatMessageRepository.create>> | undefined;

    if (isRegenerateFlag && parentUserMessageIdStr) {
      const userMsgRow = existingMessages.find((m) => m.id === parentUserMessageIdStr && m.role === "user");
      if (!userMsgRow) {
        res.status(400).json({ success: false, error: "Invalid parentUserMessageId for regenerate" });
        return;
      }
      assistantParentId = parentUserMessageIdStr;
      // Resolve from the existing ASSISTANT being regenerated (when the caller
      // provided it), so the path actually reaches its branch suffix — see
      // /agent-chat for the long-form rationale.
      const existingAssistantId = parentAssistantMessageIdStr
        && existingMessages.some((m) => m.id === parentAssistantMessageIdStr && m.role === "assistant" && m.parentId === parentUserMessageIdStr)
        ? parentAssistantMessageIdStr
        : null;
      cloneSourcePiConversationId = resolvePiConversationIdForPath(
        existingMessages,
        existingAssistantId ?? parentUserMessageIdStr,
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

      if (convId && userId) {
        try {
          userMsg = await chatMessageRepository.create({
            conversationId: convId,
            agentSlug: slug,
            userId,
            role: "user",
            content: task.trim(),
            parentId: requestedParent?.id ?? null,
          });
          createdUserMessageId = userMsg.id;
          assistantParentId = userMsg.id;
        } catch (msgErr) {
          log.warn("[run-stream] Failed to persist edit-user message:", msgErr instanceof Error ? msgErr.message : String(msgErr));
        }
      }
    } else {
      // Normal send (also covers "first turn" where existingMessages is empty).
      const requestedParent = parentAssistantMessageIdStr
        ? existingMessages.find((m) => m.id === parentAssistantMessageIdStr && m.role === "assistant")
        : undefined;
      const lastAssistantMsg = [...existingMessages].reverse().find((m) => m.role === "assistant");
      const userParentId = requestedParent?.id ?? lastAssistantMsg?.id ?? null;
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
          });
          createdUserMessageId = userMsg.id;
          assistantParentId = userMsg.id;
        } catch (msgErr) {
          log.warn("[run-stream] Failed to persist user message:", msgErr instanceof Error ? msgErr.message : String(msgErr));
        }
      }
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
        });
      } catch (msgErr) {
        log.warn("[run-stream] Failed to pre-create assistant placeholder:", msgErr instanceof Error ? msgErr.message : String(msgErr));
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
        } catch (attErr) {
          log.warn(`[run-stream] Failed to persist user attachment ${att.fileName}:`, attErr instanceof Error ? attErr.message : String(attErr));
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
          log.warn("[run-stream] Failed to link user attachments to message:", linkErr instanceof Error ? linkErr.message : String(linkErr));
        }
      }
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
              fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
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
          queryErr instanceof Error ? queryErr.message : String(queryErr),
        );
      }
    }
    const mergedAttachments: Array<{ fileName: string; mimeType: string; data: string }> = [
      ...priorAttachments,
      ...(incomingAttachments ?? []),
    ];

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // This pod now holds a live SSE stream — make sure it's subscribed to
    // the cross-pod event bus so progress/callback POSTs that land on OTHER
    // replicas get forwarded back here. Idempotent; safe to call repeatedly.
    ensureStreamEventsSubscriber();

    const resultPromise = new Promise<{
      content: string;
      status: "completed" | "failed" | "cancelled";
      pendingActions?: Array<Record<string, unknown>> | undefined;
      attachments?: StreamAttachment[] | undefined;
      toolInvocations?: unknown;
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
      conversationId: convId,
      task: task.trim(),
      ...(assistantMsg ? { assistantMessageId: assistantMsg.id } : {}),
      ...(createdUserMessageId ? { userMessageId: createdUserMessageId } : {}),
      assistantParentId,
    });

    res.write(`event: meta\ndata: ${JSON.stringify({ streamId, conversationId: convId })}\n\n`);

    // assistantMessageId on the callback URL so cross-pod callbacks can
    // resolve the placeholder without depending on local pendingStreams.
    const internalCallbackUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run-stream/${streamId}/callback` +
      (assistantMsg ? `?assistantMessageId=${encodeURIComponent(assistantMsg.id)}` : "");
    const internalProgressUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run-stream/${streamId}/progress`;

    const runRequestBody: Record<string, unknown> = {
      userId,
      userName,
      userEmail,
      task,
      agentSlug: slug,
      provider,
      conversationId: convId,
      ...(piConversationId !== convId ? { piSessionConversationId: piConversationId } : {}),
      ...(isRegenerateFlag ? { isRegenerate: true } : {}),
      callbackUrl: internalCallbackUrl,
      progressUrl: internalProgressUrl,
      channelId,
      canvasIds,
      ticketIds,
      callIds,
      attachedContext,
      attachments: mergedAttachments.length > 0 ? mergedAttachments : attachments,
      contextFiles,
      providerConfigs,
      subagentProviders,
      researchContext,
      webSearchEnabled,
      deepResearchEnabled,
      agentConfig,
      additionalInstructions,
      __persistedByCaller: true,
    };

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
      pendingStreams.get(streamId)?.setClosed();
      if (upstreamAbort.signal.aborted) return;
      setTimeout(() => {
        if (!upstreamAbort.signal.aborted) upstreamAbort.abort();
      }, UPSTREAM_ABORT_GRACE_MS);
    });

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
        task,
        runRequestBody,
        cookie: req.headers["cookie"] as string | undefined,
        xUserId: req.headers["x-user-id"] as string | undefined,
        internalCallbackUrl,
        res,
        upstreamSignal: upstreamAbort.signal,
      });
      const result = await resultPromise;
      if (!res.writableEnded && !res.destroyed) {
        res.write(`event: done\ndata: ${JSON.stringify({
          content: result.content,
          status: result.status,
          conversationId: convId,
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
      const errContent = runBody.error ?? "Failed to start agent";
      try {
        if (assistantMsg) {
          await chatMessageRepository.update(assistantMsg.id, { content: errContent, status: "failed" });
        } else {
          await chatMessageRepository.create({ conversationId: convId, agentSlug: slug, userId, role: "assistant", content: errContent, status: "failed" });
        }
      } catch (msgErr) {
        log.warn("[run-stream] Failed to persist error assistant message:", msgErr instanceof Error ? msgErr.message : String(msgErr));
      }

      res.write(`event: error\ndata: ${JSON.stringify({ error: errContent })}\n\n`);
      res.end();
      return;
    }

    res.write(`event: run\ndata: ${JSON.stringify({ sessionId: runBody.sessionId, conversationId: convId })}\n\n`);

    // Track AgentRun (same as agent-chat)
    if (runBody.sessionId) {
      agentRunRepository.start({
        sessionId: runBody.sessionId,
        userId,
        agentSlug: slug,
        triggerSource: "chat",
        task: task.trim(),
        conversationId: convId,
      }).catch((e: unknown) => log.warn("[run-stream] AgentRun.start failed:", e instanceof Error ? e.message : String(e)));
    }

    const result = await resultPromise;

    if (!res.writableEnded && !res.destroyed) {
      res.write(`event: done\ndata: ${JSON.stringify({
        content: result.content,
        status: result.status,
        conversationId: convId,
        // Branching: stable ids + parent so the client can swap optimistic
        // ids and stitch the message into the persisted tree.
        ...(assistantMsg ? { id: assistantMsg.id } : {}),
        ...(createdUserMessageId ? { userMessageId: createdUserMessageId } : {}),
        ...(assistantParentId ? { parentId: assistantParentId } : {}),
        ...(result.pendingActions?.length ? { pendingActions: result.pendingActions } : {}),
        ...(result.attachments?.length ? { attachments: result.attachments } : {}),
      })}\n\n`);
      res.end();
    }

  } catch (err) {
    log.error(`[run-stream] Error:`, err);
    pendingStreams.delete(streamId);
    streamMeta.delete(streamId);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: "Internal server error" });
    } else if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" })}\n\n`);
      res.end();
    }
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
publicRouter.post("/cancel", requireAuth, async (req: Request, res: Response): Promise<void> => {
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
      if (inv) {
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
    } else if (body.attachment) {
      events.push({ event: "attachment", data: body.attachment });
    } else if (body.debugEvent) {
      events.push({ event: "debug", data: { debugEvent: body.debugEvent } });
    }

    if (events.length > 0) {
      const localStream = pendingStreams.get(streamId);
      if (localStream) {
        for (const e of events) localStream.sendEvent(e.event, e.data);
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

    const rawResult = (body.result as string) || (body.error as string) || "";
    const status = normalizeRunStatus(body.status);
    const pendingActions = Array.isArray(body.pendingActions) ? body.pendingActions : undefined;
    const callbackAttachments = Array.isArray(body.attachments) ? body.attachments as StreamAttachment[] : undefined;
    const toolInvocations = body.toolInvocations;
    const llmCitations = body.llmCitations;
    const provider = typeof body.provider === "string" ? body.provider : undefined;
    const model = typeof body.model === "string" ? body.model : undefined;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;

    // Append LLM-provided citations (same logic as agent-chat.ts)
    const content = status === "completed" && rawResult
      ? appendCitations(rawResult, toolInvocations, { baseUrl: CONFIG.spacesAppUrl, includeCitations: true }, llmCitations)
      : rawResult;

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
      if (bodyUserId && bodyConvId && bodyAgentSlug) {
        meta = { userId: bodyUserId, conversationId: bodyConvId, agentSlug: bodyAgentSlug, task: "" };
      } else if (sessionId) {
        try {
          const run = await agentRunRepository.findBySessionId(sessionId);
          if (run) {
            meta = {
              userId: run.userId,
              conversationId: run.conversationId ?? bodyConvId ?? "",
              agentSlug: run.agentSlug,
              task: run.task ?? "",
            };
          }
        } catch (lookupErr) {
          log.warn(`[run-stream] agent_run lookup failed for sessionId=${sessionId}:`, lookupErr instanceof Error ? lookupErr.message : String(lookupErr));
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
        await persistRunStreamResult({
          conversationId: meta.conversationId,
          agentSlug: meta.agentSlug,
          userId: meta.userId,
          content,
          status,
          ...(callbackAttachments?.length ? { attachments: callbackAttachments } : {}),
          ...(sessionId ? { sessionId } : {}),
          ...(assistantMessageId ? { assistantMessageId } : {}),
        });
      } catch (msgErr) {
        log.warn(`[run-stream] Failed to persist assistant message:`, msgErr instanceof Error ? msgErr.message : String(msgErr));
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
          error: status !== "completed" ? content : null,
          ...(provider ? { provider } : {}),
          ...(model ? { model } : {}),
          toolsUsed: (body.toolsUsed as string[]) ?? [],
          // Branching: link run → assistant message so /messages can pair
          // them by id instead of by chronology (which breaks once a user
          // message has multiple assistant siblings).
          ...(assistantMessageId ? { chatMessageId: assistantMessageId } : {}),
          ...(toolInvocations ? { toolInvocations } : {}),
        });
      } catch (finalizeErr) {
        log.warn(`[run-stream] Failed to finalize agent run:`, finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr));
      }
    }

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
        pendingActions,
        attachments: callbackAttachments && callbackAttachments.length > 0 ? callbackAttachments : undefined,
        toolInvocations,
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
        ...(sessionId ? { sessionId } : {}),
        ...(pendingActions?.length ? { pendingActions } : {}),
        ...(callbackAttachments?.length ? { attachments: callbackAttachments } : {}),
        ...(toolInvocations !== undefined ? { toolInvocations } : {}),
      });
    } else {
      log.warn(`[run-stream] callback streamId=${streamId} resolved without local stream or conversationId — no SSE done frame will be sent`);
    }
  } catch (err) {
    log.error("[run-stream] callback error:", err);
  }
});

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
  task: string;
  runRequestBody: Record<string, unknown>;
  cookie: string | undefined;
  xUserId: string | undefined;
  internalCallbackUrl: string;
  res: Response;
  upstreamSignal?: AbortSignal;
}

async function runViaSseTransport(opts: RunViaSseOpts): Promise<void> {
  const { streamId, convId, slug, userId, task, runRequestBody, cookie, xUserId, internalCallbackUrl, res, upstreamSignal } = opts;
  const stream = pendingStreams.get(streamId);
  if (!stream) {
    throw new Error(`pendingStream ${streamId} missing before SSE consume started`);
  }

  let sessionIdFromStarted: string | undefined;
  let agentRunStarted = false;
  const startAgentRunOnce = (sessionId: string) => {
    if (agentRunStarted) return;
    agentRunStarted = true;
    agentRunRepository.start({
      sessionId,
      userId,
      agentSlug: slug,
      triggerSource: "chat",
      task: task.trim(),
      conversationId: convId,
    }).catch((e: unknown) => log.warn("[run-stream/sse] AgentRun.start failed:", e instanceof Error ? e.message : String(e)));
  };

  const consumeResult = await consumeClawStream({
    url: `${CONFIG.internalUrl}/claw/api/v1/internal/run`,
    body: runRequestBody,
    ...(CONFIG.xyneClawS2sKey ? { s2sKey: CONFIG.xyneClawS2sKey } : {}),
    extraHeaders: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(xUserId ? { "x-user-id": xUserId } : {}),
    },
    ...(upstreamSignal ? { signal: upstreamSignal } : {}),
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
        startAgentRunOnce(sessionId);
      },
      onInvocation: (sessionId, toolInvocation) => {
        stream.sendEvent("invocation", toolInvocation);
        agentRunRepository.appendToolInvocation(sessionId, toolInvocation as Record<string, unknown>).catch(() => {});
      },
      onReasoning: (_sid, delta) => {
        stream.sendEvent("reasoning", { delta });
      },
      onTextDelta: (_sid, delta) => {
        stream.sendEvent("delta", { content: delta });
      },
      onAttachment: (_sid, attachment) => {
        stream.sendEvent("attachment", attachment);
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
        }).catch((err) => log.warn(`[run-stream/sse] sandbox replay failed: ${err instanceof Error ? err.message : String(err)}`));
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
      },
      onDebug: (_sid, debugEvent) => {
        stream.sendEvent("debug", { debugEvent });
      },
      onCancelled: (_sid, reason) => {
        // Early cancel signal — fire-and-forget to the frontend so its typing
        // indicator drops the moment claw observes the abort, without waiting
        // for the cancelled done frame (which is delayed by partial-state
        // collection + the /callback replay). The cancelled done still
        // follows and resolves the resultPromise normally.
        stream.sendEvent("cancelled", { reason: reason ?? "cancelled" });
      },
    },
  });

  if (!consumeResult.result) {
    throw new Error("Claw SSE stream ended without a done frame");
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
      ...(r["toolsUsed"] ? { toolsUsed: r["toolsUsed"] } : {}),
      ...((r["meta"] as Record<string, unknown> | undefined) ?? {}),
    }),
  });
  if (!cbRes.ok) {
    const text = await cbRes.text().catch(() => "");
    log.warn(`[run-stream/sse] /callback returned ${cbRes.status}: ${text.slice(0, 300)}`);
  }
}

export { publicRouter as runStreamRouter, internalRouter as runStreamInternalRouter };
