/**
 * Internal curator endpoint — called by claw-auth at batch-approval time.
 *
 * Why on claw, not claw-auth: LITELLM_API_KEY lives on claw (the agent
 * runtime). Running the curator here keeps that credential scoped to one
 * pod and preserves the "all LLM calls happen on claw" invariant.
 *
 * S2S-protected via the existing x-s2s-key middleware.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { classifyIngestSubsystem, distillSession, distillLargeTranscript } from "../curator.js";
import { parseSession } from "../session-parsers/index.js";
import type { SessionTranscriptForCurator } from "xyne-claw-shared";

import { createLogger } from "../logger.js";
const log = createLogger("curator");

export const curatorRouter = Router();

curatorRouter.post("/internal/curator/classify-subsystem", validateS2SKey, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      sessionId?: string;
      agentSlug?: string;
      agentName?: string;
      task?: string;
      transcript?: string;
      taxonomy?: Array<{ name?: unknown; memoryCount?: unknown }>;
    };
    if (!body.sessionId || !body.agentSlug || typeof body.transcript !== "string") {
      res.status(400).json({ success: false, error: "Missing required fields: sessionId, agentSlug, transcript" });
      return;
    }
    const subsystem = await classifyIngestSubsystem({
      sessionId: body.sessionId,
      agentSlug: body.agentSlug,
      agentName: typeof body.agentName === "string" ? body.agentName : body.agentSlug,
      task: typeof body.task === "string" ? body.task : "",
      transcript: body.transcript,
      taxonomy: Array.isArray(body.taxonomy)
        ? body.taxonomy.flatMap((entry) =>
            typeof entry?.name === "string"
              ? [{ name: entry.name, memoryCount: typeof entry.memoryCount === "number" ? entry.memoryCount : 0 }]
              : [],
          )
        : [],
    });
    res.json({ success: true, subsystem });
  } catch (err) {
    log.error(`[curator-route] classify-subsystem failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});

curatorRouter.post("/internal/curator/distill", validateS2SKey, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Partial<SessionTranscriptForCurator> & { bankId?: string };

    // Minimum validation — anything else flagged at the LLM/validation layer.
    if (!body.sessionId || !body.agentSlug || !body.userId || typeof body.task !== "string") {
      res.status(400).json({
        success: false,
        error: "Missing required fields: sessionId, agentSlug, userId, task",
      });
      return;
    }

    const transcript: SessionTranscriptForCurator = {
      sessionId: body.sessionId,
      agentSlug: body.agentSlug,
      userId: body.userId,
      task: body.task,
      result: typeof body.result === "string" ? body.result : "",
      toolsUsed: Array.isArray(body.toolsUsed) ? body.toolsUsed.filter((t): t is string => typeof t === "string") : [],
      ...(typeof body.transcript === "string" ? { transcript: body.transcript } : {}),
    };

    const updates = await distillSession(transcript, body.bankId);
    res.json({ success: true, updates });
  } catch (err) {
    log.error(`[curator-route] distill failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Internal error",
    });
  }
});

/**
 * Distill an uploaded session file (Claude, OpenCode, or Codex) into subsystem-update candidates.
 *
 * Body: { sessionId, agentSlug, userId, filename, rawSession }
 *   rawSession — the raw uploaded export (Claude Code JSONL or claude.ai JSON).
 *
 * We parse + normalize on claw (same pod as the curator/LLM key), then run the
 * map-reduce distill (distillLargeTranscript). Returns the same
 * { success, updates } shape as /internal/curator/distill; claw-auth persists
 * the updates as PendingMemoryReview rows behind the admin HITL gate.
 *
 * S2S-protected. This can be slow (N map calls) — callers must use a long
 * timeout and run it off the user's request path.
 */
curatorRouter.post("/internal/curator/distill-session", validateS2SKey, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as {
      sessionId?: string;
      agentSlug?: string;
      userId?: string;
      filename?: string;
      source?: string;
      rawSession?: string;
      bankId?: string;
      parseOnly?: boolean;
    };

    if (!body.sessionId || !body.agentSlug || !body.userId || typeof body.rawSession !== "string") {
      res.status(400).json({
        success: false,
        error: "Missing required fields: sessionId, agentSlug, userId, rawSession",
      });
      return;
    }

    const parsed = parseSession(body.rawSession, { source: body.source, filename: body.filename });
    if (parsed.turnCount === 0) {
      res.status(422).json({
        success: false,
        error: "Could not parse any conversation turns from the uploaded session (unrecognized format).",
        meta: { format: parsed.format },
      });
      return;
    }

    const meta = {
      source: parsed.source,
      format: parsed.format,
      turnCount: parsed.turnCount,
      conversationCount: parsed.conversationCount,
      toolsUsed: parsed.toolsUsed,
      task: parsed.task,
    };
    if (body.parseOnly === true) {
      res.json({ success: true, transcript: parsed.transcript, meta });
      return;
    }

    const updates = await distillLargeTranscript({
      sessionId: body.sessionId,
      agentSlug: body.agentSlug,
      userId: body.userId,
      task: parsed.task,
      result: parsed.result,
      toolsUsed: parsed.toolsUsed,
      transcript: parsed.transcript,
    }, body.bankId);

    log.info(
      `[curator-route] distill-session done sessionId=${body.sessionId} agentSlug=${body.agentSlug} format=${parsed.format} turns=${parsed.turnCount} conversations=${parsed.conversationCount} updates=${updates.length}`,
    );

    res.json({
      success: true,
      updates,
      meta,
    });
  } catch (err) {
    log.error(`[curator-route] distill-session failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Internal error",
    });
  }
});
