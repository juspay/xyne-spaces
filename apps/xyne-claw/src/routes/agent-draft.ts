/**
 * S2S endpoint behind the create canvas's streamed draft (called by claw-auth).
 *
 * claw-auth supplies the catalog, skills and knowledge (this service has no
 * database), and this route streams back what the draft decides. See
 * authoring/draft-orchestrator.ts for the timeline.
 */
import { Router, type Request, type Response } from "express";
import {
  frameDraftEvent,
  KEEPALIVE_FRAME,
  type AgentDraftBody,
  type ClawDraftRequest,
  type DraftField,
} from "xyne-claw-shared";
import { validateS2SKey } from "../middleware/auth.js";
import { runDraftTurn } from "../authoring/draft-orchestrator.js";
import { isDraining } from "../drain.js";
import { createLogger } from "../logger.js";

const clog = createLogger("agent-draft");
const router = Router();

const KEEPALIVE_MS = 15_000;
const FIELDS: readonly DraftField[] = [
  "name", "handle", "description", "instructions", "tools", "skills", "knowledge", "permission", "schedule",
];

const isString = (value: unknown): value is string => typeof value === "string";

/** Reject a body claw-auth should never send; anything past this point is trusted structure. */
export function parseDraftRequest(body: unknown): ClawDraftRequest | string {
  if (!body || typeof body !== "object") return "body is required";
  const b = body as Record<string, unknown>;
  if (!isString(b["draftId"]) || !isString(b["turnId"]) || !isString(b["userId"])) {
    return "draftId, turnId and userId are required";
  }
  if (!isString(b["message"]) || b["message"].trim().length === 0) return "message is required";
  if (b["message"].length > 4_000) return "message is too long";
  const canvas = b["canvas"] as Record<string, unknown> | undefined;
  if (!canvas || typeof canvas !== "object") return "canvas is required";
  const catalog = b["catalog"] as { subagents?: unknown; integrations?: unknown } | undefined;
  if (!catalog || !Array.isArray(catalog.subagents) || !Array.isArray(catalog.integrations)) {
    return "catalog is required";
  }
  const req = b as unknown as ClawDraftRequest;
  return {
    ...req,
    history: Array.isArray(req.history) ? req.history.slice(-6) : [],
    userOwned: Array.isArray(req.userOwned) ? req.userOwned.filter((f): f is DraftField => FIELDS.includes(f)) : [],
    skillCandidates: Array.isArray(req.skillCandidates) ? req.skillCandidates : [],
    knowledgeCandidates: Array.isArray(req.knowledgeCandidates) ? req.knowledgeCandidates : [],
    canvas: {
      ...req.canvas,
      capabilities: Array.isArray(req.canvas.capabilities) ? req.canvas.capabilities : [],
    },
    timezone: isString(req.timezone) && req.timezone ? req.timezone : "UTC",
    now: isString(req.now) && req.now ? req.now : new Date().toISOString(),
  };
}

router.post("/agents/draft", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  if (isDraining()) {
    res.status(503).json({ success: false, error: "draining" });
    return;
  }
  const parsed = parseDraftRequest(req.body);
  if (typeof parsed === "string") {
    res.status(400).json({ success: false, error: parsed });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Every LLM call in the turn shares this signal: a closed connection stops all of them.
  const abort = new AbortController();
  const onClose = (): void => {
    if (!res.writableEnded) abort.abort();
  };
  res.on("close", onClose);
  const keepalive = setInterval(() => {
    if (!res.writableEnded) res.write(KEEPALIVE_FRAME);
  }, KEEPALIVE_MS);

  let seq = 0;
  const emit = (body: AgentDraftBody): void => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(frameDraftEvent({ ...body, seq: seq++, turnId: parsed.turnId }));
    } catch (err) {
      clog.warn(`[agent-draft] write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  try {
    await runDraftTurn(parsed, emit, abort.signal);
  } catch (err) {
    clog.error("[agent-draft] turn failed:", err);
    emit({ event: "error", code: "internal", message: "The draft failed. Try again.", retryable: true });
  } finally {
    clearInterval(keepalive);
    res.off("close", onClose);
    if (!res.writableEnded) res.end();
  }
});

export { router as agentDraftRouter };
