import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";
import { requireAuth } from "../middleware/require-auth.js";
import { prisma } from "../db.js";
import { chatMessageRepository, agentRunRepository, chatAttachmentRepository } from "../repositories/index.js";
import { gcsService } from "../services/gcsService.js";
import { appendCitations, appendClawCitationTokens } from "../lib/citations.js";

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
  addAttachment: (attachment: StreamAttachment) => void;
  getAttachments: () => StreamAttachment[];
  cookieHeader: string | undefined;
}

interface StreamMeta {
  userId: string;
  agentSlug: string;
  conversationId: string;
  task: string;
}

const pendingStreams = new Map<string, PendingStream>();
const streamMeta = new Map<string, StreamMeta>();

function normalizeRunStatus(status: unknown): "completed" | "failed" | "cancelled" {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
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

    // Persist user message (same pattern as /agent-chat)
    let userMsg: Awaited<ReturnType<typeof chatMessageRepository.create>> | undefined;
    if (convId && userId) {
      try {
        userMsg = await chatMessageRepository.create({
          conversationId: convId,
          agentSlug: slug,
          userId,
          role: "user",
          content: task.trim(),
        });
      } catch (msgErr) {
        console.warn("[run-stream] Failed to persist user message:", msgErr instanceof Error ? msgErr.message : String(msgErr));
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
          console.warn(`[run-stream] Failed to persist user attachment ${att.fileName}:`, attErr instanceof Error ? attErr.message : String(attErr));
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
          console.warn("[run-stream] Failed to link user attachments to message:", linkErr instanceof Error ? linkErr.message : String(linkErr));
        }
      }
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const accumulatedAttachments: StreamAttachment[] = [];

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
        addAttachment: (attachment) => {
          accumulatedAttachments.push(attachment);
        },
        getAttachments: () => accumulatedAttachments,
        cookieHeader: req.headers["cookie"] as string | undefined,
      });

      setTimeout(() => {
        if (pendingStreams.has(streamId)) {
          pendingStreams.delete(streamId);
          reject(new Error("Agent timed out"));
        }
      }, 30 * 60 * 1000);
    });

    // Store metadata for use in callback
    streamMeta.set(streamId, { userId, agentSlug: slug, conversationId: convId, task: task.trim() });

    res.write(`event: meta\ndata: ${JSON.stringify({ streamId, conversationId: convId })}\n\n`);

    const internalCallbackUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run-stream/${streamId}/callback`;
    const internalProgressUrl = `${CONFIG.internalUrl}/claw/api/v1/internal/run-stream/${streamId}/progress`;

    const runRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        ...(req.headers["cookie"] ? { Cookie: req.headers["cookie"] as string } : {}),
        ...(req.headers["x-user-id"] ? { "x-user-id": req.headers["x-user-id"] as string } : {}),
      },
      body: JSON.stringify({
        userId,
        userName,
        userEmail,
        task,
        agentSlug: slug,
        provider,
        conversationId: convId,
        callbackUrl: internalCallbackUrl,
        progressUrl: internalProgressUrl,
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
        __persistedByCaller: true,
      }),
    });

    const runBody = (await runRes.json()) as {
      success: boolean;
      sessionId?: string;
      error?: string;
    };

    if (!runBody.success) {
      pendingStreams.delete(streamId);
      streamMeta.delete(streamId);

      // Persist failed assistant message (same as agent-chat error path)
      const errContent = runBody.error ?? "Failed to start agent";
      try {
        await chatMessageRepository.create({ conversationId: convId, agentSlug: slug, userId, role: "assistant", content: errContent, status: "failed" });
      } catch (msgErr) {
        console.warn("[run-stream] Failed to persist error assistant message:", msgErr instanceof Error ? msgErr.message : String(msgErr));
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
      }).catch((e: unknown) => console.warn("[run-stream] AgentRun.start failed:", e instanceof Error ? e.message : String(e)));
    }

    req.on("close", () => {
      pendingStreams.get(streamId)?.setClosed();
    });

    const result = await resultPromise;

    if (!res.writableEnded && !res.destroyed) {
      res.write(`event: done\ndata: ${JSON.stringify({
        content: result.content,
        status: result.status,
        conversationId: convId,
        ...(result.pendingActions?.length ? { pendingActions: result.pendingActions } : {}),
        ...(result.attachments?.length ? { attachments: result.attachments } : {}),
      })}\n\n`);
      res.end();
    }

  } catch (err) {
    console.error(`[run-stream] Error:`, err);
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
 * POST /claw/api/v1/internal/run-stream/:streamId/progress
 * Internal endpoint for xyne-claw to send progress updates
 */
internalRouter.post("/:streamId/progress", (req: Request<{ streamId: string }>, res: Response) => {
  const { streamId } = req.params;
  const stream = pendingStreams.get(streamId);

  if (!stream) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }

  try {
    const body = req.body as Record<string, unknown>;

    if (body.toolExecutionStart || body.toolExecutionEnd || body.toolInvocation) {
      const inv = body.toolInvocation as Record<string, unknown> | undefined;
      if (inv) {
        stream.sendEvent("invocation", inv);
      }

      const sessionId = body.sessionId as string | undefined;
      if (sessionId && inv) {
        agentRunRepository.appendToolInvocation(sessionId, inv).catch(() => {});
      }
    } else if (body.reasoningDelta !== undefined) {
      stream.sendEvent("reasoning", { delta: body.reasoningDelta });
    } else if (body.textDelta !== undefined) {
      stream.sendEvent("delta", { content: body.textDelta });
    } else if (body.attachment) {
      const att = body.attachment as StreamAttachment | undefined;
      if (att && att.fileName && att.data) {
        stream.addAttachment(att);
      }
      stream.sendEvent("attachment", body.attachment);
    }

    const sessionId = body.sessionId as string | undefined;
    const toolLabel = body.toolLabel as string | undefined;
    if (sessionId && toolLabel) {
      agentRunRepository.updateProgress(sessionId, toolLabel).catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[run-stream] progress error:", err);
    res.status(500).json({ error: "Failed to process progress" });
  }
});

/**
 * POST /claw/api/v1/internal/run-stream/:streamId/callback
 * Internal endpoint for xyne-claw to send final result
 */
internalRouter.post("/:streamId/callback", async (req: Request<{ streamId: string }>, res: Response) => {
  const { streamId } = req.params;
  const stream = pendingStreams.get(streamId);
  const meta = streamMeta.get(streamId);

  if (!stream) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }

  try {
    const body = req.body as Record<string, unknown>;

    const rawResult = (body.result as string) || (body.error as string) || "";
    const status = normalizeRunStatus(body.status);
    const pendingActions = Array.isArray(body.pendingActions) ? body.pendingActions : undefined;
    const callbackAttachments = Array.isArray(body.attachments) ? body.attachments as StreamAttachment[] : undefined;
    const toolInvocations = body.toolInvocations;
    const llmCitations = body.llmCitations;

    // Append LLM-provided citations, then `[clf-<toolCallId>#<chunkIndex>]`
    // tokens from each ToolInvocation.citations so Desk's DraftSourcesPanel
    // can resolve clickable sources (e.g. Grafana). Gated by
    // CLAW_INLINE_CITATIONS (default off) — see config.ts.
    const withCitations = status === "completed" && rawResult
      ? appendCitations(rawResult, toolInvocations, { baseUrl: CONFIG.spacesAppUrl, includeCitations: true }, llmCitations)
      : rawResult;
    const content = CONFIG.clawInlineCitations
      ? appendClawCitationTokens(withCitations, toolInvocations)
      : withCitations;

    const progressAttachments = stream.getAttachments();
    const allAttachments: StreamAttachment[] = [
      ...(callbackAttachments || []),
      ...progressAttachments.filter(
        pa => !(callbackAttachments || []).some(ca => ca.fileName === pa.fileName),
      ),
    ];

    stream.resolve({
      content,
      status,
      pendingActions,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
      toolInvocations,
    });

    pendingStreams.delete(streamId);
    streamMeta.delete(streamId);

    // Persist assistant message and finalize AgentRun (same pattern as /agent-chat)
    if (meta && meta.conversationId && meta.userId) {
      try {
        const persistedAttachments: Array<{ id: string; mimeType: string; originalFilename: string; size: number }> = [];

        if (allAttachments.length) {
          for (const att of allAttachments) {
            try {
              const buffer = Buffer.from(att.data, "base64");
              const now = new Date();
              const year = String(now.getUTCFullYear());
              const month = String(now.getUTCMonth() + 1).padStart(2, "0");
              const safeName = att.fileName.replace(/[^\w.\-]+/g, "_").slice(0, 200);
              const destPath = `chat-attachments/${meta.userId}/${year}/${month}/${Date.now()}-${randomUUID()}-${safeName}`;

              await gcsService.uploadFile(buffer, destPath, att.mimeType);

              const row = await prisma.chatAttachment.create({
                data: {
                  uploaderUserId: meta.userId,
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
              console.error(`[run-stream] Failed to persist attachment ${att.fileName}:`, attErr instanceof Error ? attErr.message : String(attErr));
            }
          }
        }

        const assistantMsg = await chatMessageRepository.create({
          conversationId: meta.conversationId,
          agentSlug: meta.agentSlug,
          userId: meta.userId,
          role: "assistant",
          content,
          status: status === "completed" ? "completed" : "failed",
        });

        if (persistedAttachments.length) {
          await chatAttachmentRepository.linkToMessage(
            persistedAttachments.map(a => a.id),
            assistantMsg.id,
            meta.userId,
          );
        }
      } catch (msgErr) {
        console.warn(`[run-stream] Failed to persist assistant message:`, msgErr instanceof Error ? msgErr.message : String(msgErr));
      }
    }

    // Finalize AgentRun (same pattern as /agent-chat)
    const sessionId = body.sessionId as string | undefined;
    if (sessionId) {
      try {
        const finalStatus = status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed";
        await agentRunRepository.finalize(sessionId, {
          status: finalStatus,
          result: content,
          error: status !== "completed" ? content : null,
          toolsUsed: (body.toolsUsed as string[]) ?? [],
          ...(toolInvocations ? { toolInvocations } : {}),
        });
      } catch (finalizeErr) {
        console.warn(`[run-stream] Failed to finalize agent run:`, finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr));
      }

    }

    res.json({ success: true });
  } catch (err) {
    console.error("[run-stream] callback error:", err);
    res.status(500).json({ error: "Failed to process callback" });
  }
});

export { publicRouter as runStreamRouter, internalRouter as runStreamInternalRouter };