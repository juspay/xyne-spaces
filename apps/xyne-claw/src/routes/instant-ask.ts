/**
 * Internal instant-ask LLM endpoint — called by claw-auth's instant KB
 * answer path (run-stream.ts).
 *
 * Why on claw, not claw-auth: LITELLM_API_KEY lives on claw (the agent
 * runtime). Keeping the completion here scopes that credential to one pod and
 * preserves the "all LLM calls happen on claw" invariant. claw-auth still owns
 * the pipeline — KB search, prompt assembly, citation shaping — and treats
 * this as a raw text completion.
 *
 * S2S-protected via the existing x-s2s-key middleware.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { frameSseEvent } from "xyne-claw-shared";
import { validateS2SKey } from "../middleware/auth.js";
import {
  completeInstantAsk,
  streamInstantAnswer,
  parseInstantAskMessages,
  InstantAskError,
} from "../instant-ask.js";

import { createLogger } from "../logger.js";
const log = createLogger("instant-ask-route");

export const instantAskRouter = Router();

instantAskRouter.post("/internal/instant/complete", validateS2SKey, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    messages?: unknown;
    purpose?: unknown;
    model?: unknown;
    jsonMode?: unknown;
    credential?: { apiKey?: unknown; baseUrl?: unknown; model?: unknown };
  };
  const purpose = typeof body.purpose === "string" ? body.purpose.slice(0, 80) : undefined;
  const model = body.model === "classify" ? "classify" as const : undefined;
  const jsonMode = body.jsonMode === true;
  const credential = body.credential
    && typeof body.credential.apiKey === "string" && body.credential.apiKey
    && typeof body.credential.baseUrl === "string" && body.credential.baseUrl
    && typeof body.credential.model === "string" && body.credential.model
    ? { apiKey: body.credential.apiKey, baseUrl: body.credential.baseUrl, model: body.credential.model }
    : undefined;

  try {
    const messages = parseInstantAskMessages(body.messages);
    const content = await completeInstantAsk(messages, purpose, {
      ...(model ? { model } : {}),
      jsonMode,
      ...(credential ? { credential } : {}),
    });
    res.json({ success: true, content });
  } catch (err) {
    const status = err instanceof InstantAskError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Internal error";
    // 4xx is a caller bug and already explicit; 5xx is worth a log line.
    if (status >= 500) log.error(`[instant-ask-route] complete failed purpose=${purpose ?? "-"}: ${message}`);
    res.status(status).json({ success: false, error: message });
  }
});

/**
 * Streaming counterpart to /internal/instant/complete — used for the ANSWER
 * call only (classify stays on the JSON endpoint above, nothing worth
 * streaming in a one-line classification blob). Emits the same
 * ClawStreamEvent wire format the main agentic /internal/run SSE endpoint
 * uses (frameSseEvent from xyne-claw-shared), so claw-auth's existing
 * consumeClawStream consumer works unchanged — only `delta`/`done`/`error`
 * frames are ever emitted here, everything else in the union is simply unused.
 */
instantAskRouter.post("/internal/instant/stream", validateS2SKey, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as {
    messages?: unknown;
    purpose?: unknown;
    sessionId?: unknown;
    credential?: { apiKey?: unknown; baseUrl?: unknown; model?: unknown };
  };
  const purpose = typeof body.purpose === "string" ? body.purpose.slice(0, 80) : undefined;
  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : `instant-stream-${Date.now()}`;
  const credential = body.credential
    && typeof body.credential.apiKey === "string" && body.credential.apiKey
    && typeof body.credential.baseUrl === "string" && body.credential.baseUrl
    && typeof body.credential.model === "string" && body.credential.model
    ? { apiKey: body.credential.apiKey, baseUrl: body.credential.baseUrl, model: body.credential.model }
    : undefined;

  let messages;
  try {
    messages = parseInstantAskMessages(body.messages);
  } catch (err) {
    const status = err instanceof InstantAskError ? err.status : 400;
    res.status(status).json({ success: false, error: err instanceof Error ? err.message : "Invalid request" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let seq = 0;
  const next = (): number => seq++;

  try {
    const full = await streamInstantAnswer(
      messages,
      (chunk) => {
        res.write(frameSseEvent({ event: "delta", seq: next(), sessionId, textDelta: chunk }));
      },
      { ...(credential ? { credential } : {}) },
    );
    res.write(frameSseEvent({ event: "done", seq: next(), sessionId, result: { status: "completed", content: full } }));
  } catch (err) {
    const status = err instanceof InstantAskError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Internal error";
    if (status >= 500) log.error(`[instant-ask-route] stream failed purpose=${purpose ?? "-"}: ${message}`);
    res.write(frameSseEvent({ event: "error", seq: next(), sessionId, error: message }));
  }
  res.end();
});
