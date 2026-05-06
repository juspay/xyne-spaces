import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";

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
}

const pendingStreams = new Map<string, PendingStream>();

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
publicRouter.post("/", async (req: Request, res: Response) => {
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
      __persistedByCaller,
    } = req.body as Record<string, unknown>;

    if (!task || typeof task !== "string") {
      res.status(400).json({ success: false, error: "task is required" });
      return;
    }

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ success: false, error: "userId is required" });
      return;
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
      });

      setTimeout(() => {
        if (pendingStreams.has(streamId)) {
          pendingStreams.delete(streamId);
          reject(new Error("Agent timed out"));
        }
      }, 30 * 60 * 1000);
    });

    res.write(`event: meta\ndata: ${JSON.stringify({ streamId })}\n\n`);

    const internalCallbackUrl = `${CONFIG.selfUrl}/claw/api/v1/internal/run-stream/${streamId}/callback`;
    const internalProgressUrl = `${CONFIG.selfUrl}/claw/api/v1/internal/run-stream/${streamId}/progress`;

    const runRes = await fetch(`${CONFIG.selfUrl}/claw/api/v1/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        userName,
        userEmail,
        task,
        agentSlug,
        provider,
        conversationId,
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
        __persistedByCaller,
      }),
    });

    const runBody = (await runRes.json()) as {
      success: boolean;
      sessionId?: string;
      error?: string;
    };

    if (!runBody.success) {
      pendingStreams.delete(streamId);
      res.write(`event: error\ndata: ${JSON.stringify({ error: runBody.error || "Failed to start agent" })}\n\n`);
      res.end();
      return;
    }

    res.write(`event: run\ndata: ${JSON.stringify({ sessionId: runBody.sessionId })}\n\n`);

    req.on("close", () => {
      pendingStreams.get(streamId)?.setClosed();
    });

    const result = await resultPromise;

    if (!res.writableEnded && !res.destroyed) {
      res.write(`event: done\ndata: ${JSON.stringify({
        content: result.content,
        status: result.status,
        ...(result.pendingActions?.length ? { pendingActions: result.pendingActions } : {}),
        ...(result.attachments?.length ? { attachments: result.attachments } : {}),
      })}\n\n`);
      res.end();
    }

  } catch (err) {
    console.error(`[run-stream] Error:`, err);
    pendingStreams.delete(streamId);
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

  if (!stream) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }

  try {
    const body = req.body as Record<string, unknown>;

    const content = (body.result as string) || (body.error as string) || "";
    const status = normalizeRunStatus(body.status);
    const pendingActions = Array.isArray(body.pendingActions) ? body.pendingActions : undefined;
    const callbackAttachments = Array.isArray(body.attachments) ? body.attachments as StreamAttachment[] : undefined;
    const toolInvocations = body.toolInvocations;

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

    const sessionId = body.sessionId as string | undefined;
    if (sessionId) {
      try {
        const forwardPayload = {
          ...body,
          ...(allAttachments.length > 0 ? { attachments: allAttachments } : {}),
        };
        const resultUrl = `${CONFIG.selfUrl}/claw/api/v1/sessions/${sessionId}/result`;
        const forwardRes = await fetch(resultUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(forwardPayload),
        });
        if (!forwardRes.ok) {
          console.error(`[run-stream] Failed to forward callback: ${forwardRes.status}`);
        }
      } catch (forwardErr) {
        console.error(`[run-stream] Failed to forward callback:`, forwardErr instanceof Error ? forwardErr.message : String(forwardErr));
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[run-stream] callback error:", err);
    res.status(500).json({ error: "Failed to process callback" });
  }
});

export { publicRouter as runStreamRouter, internalRouter as runStreamInternalRouter };