/**
 * Internal user-memory curator endpoint — called by claw-auth's backfill +
 * daily workers and the manual .md upload route.
 *
 * Pattern mirrors /internal/curator/distill: claw owns the LLM call,
 * claw-auth has the DB and the Spaces data fetch. S2S-protected.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { distillUserMemory } from "../user-memory-curator.js";
import { synthesizeMemoryFile } from "../twin-soul-synthesizer.js";
import { checkMemoryUpdate } from "../twin-soul-update-check.js";
import { applyClassifierToTrace, checkMemoryCandidates } from "../user-memory-candidate-check.js";
import { decideRespond, type RespondGateRequest } from "../twin-respond-gate.js";
import type {
  ExistingUserMemory,
  SynthesizeFileRequest,
  UserMemoryCuratorTrace,
  UserMemoryDistillRequest,
  UserMemoryRecord,
} from "xyne-claw-shared";

import { createLogger } from "../logger.js";
const log = createLogger("user-memory");

export const userMemoryRouter = Router();

// Mirrors the curator's model resolution so the minimal empty-records trace
// reports the same model the LLM path would have used.
const CURATOR_MODEL = process.env["LITELLM_MODEL"] ?? "claude-haiku-4-5-20251001";

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

userMemoryRouter.post("/internal/user-memory/distill", validateS2SKey, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Partial<UserMemoryDistillRequest>;
    if (!body.userId || !body.window?.from || !body.window?.to || !Array.isArray(body.records)) {
      res.status(400).json({ success: false, error: "Missing userId, window.from/to, or records[]" });
      return;
    }
    const includeTrace = body.includeTrace === true;

    // Light shape filter — drop anything that doesn't have the minimum fields
    // the curator prompt depends on. Cheap defense against a malformed batch.
    const records: UserMemoryRecord[] = body.records
      .filter((r): r is UserMemoryRecord =>
        !!r && typeof r === "object" &&
        typeof (r as UserMemoryRecord).id === "string" &&
        (["message", "call", "canvas", "mention_reply", "conversation"] as const).includes((r as UserMemoryRecord).type) &&
        typeof (r as UserMemoryRecord).ts === "string" &&
        typeof (r as UserMemoryRecord).text === "string",
      );

    if (records.length === 0) {
      const emptyTrace: UserMemoryCuratorTrace = {
        model: CURATOR_MODEL,
        durationMs: 0,
        prompt: "",
        promptChars: 0,
        emitted: [],
      };
      res.json({ success: true, candidates: [], ...(includeTrace ? { trace: emptyTrace } : {}) });
      return;
    }

    // Existing memories are optional context so the curator can update instead
    // of duplicate. Shape-filter defensively; a malformed entry just drops.
    const existingMemories = Array.isArray(body.existingMemories)
      ? body.existingMemories.filter(
          (m): m is ExistingUserMemory =>
            !!m && typeof m === "object" &&
            typeof (m as { id?: unknown }).id === "string" &&
            typeof (m as { subsystem?: unknown }).subsystem === "string" &&
            typeof (m as { text?: unknown }).text === "string",
        )
      : [];

    const distilled = await distillUserMemory(
      body.userId,
      { from: body.window.from, to: body.window.to },
      records,
      existingMemories,
    );
    // R8: classifier second opinion against the user's similar stored memories.
    const { candidates, summary } = await checkMemoryCandidates(distilled.candidates, existingMemories).catch(() => ({
      candidates: distilled.candidates,
      summary: null,
    }));
    const trace = summary ? applyClassifierToTrace(distilled.trace, summary) : distilled.trace;
    res.json({ success: true, candidates, ...(includeTrace ? { trace } : {}) });
  } catch (err) {
    log.error(`[user-memory-route] distill failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});

/**
 * Soul synthesizer (Memory v2, Phase 4). Compiles ONE persona file from the
 * user's approved facts. S2S — claw-auth passes the facts + current content,
 * claw runs the LLM (LITELLM_API_KEY is here) and returns the file markdown.
 */
userMemoryRouter.post("/internal/user-memory/synthesize-file", validateS2SKey, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Partial<SynthesizeFileRequest>;
    if (!body.fileName || !Array.isArray(body.facts)) {
      res.status(400).json({ success: false, error: "Missing fileName or facts[]" });
      return;
    }
    const base = {
      fileName: body.fileName,
      description: typeof body.description === "string" ? body.description : "",
      facts: strings(body.facts),
    };
    const currentContent = typeof body.currentContent === "string" ? body.currentContent : undefined;
    const result = await synthesizeMemoryFile({
      ...base,
      maxChars: typeof body.maxChars === "number" ? body.maxChars : 20_000,
      ...(currentContent !== undefined ? { currentContent } : {}),
      ...(body.preserveEdits === true ? { preserveEdits: true } : {}),
    });
    // R10: nightly rewrites (claw-auth sends check:true) are scored before
    // claw-auth writes them; only verdict "accept" replaces the old file.
    const check =
      body.check === true && result.content
        ? await checkMemoryUpdate({
            ...base,
            ...(currentContent !== undefined ? { oldContent: currentContent } : {}),
            newContent: result.content,
          }).catch(() => null)
        : null;
    res.json({
      success: !!result.content,
      content: result.content,
      ...(result.error ? { error: result.error } : {}),
      ...(result.trace ? { trace: result.trace } : {}),
      ...(check ? { check } : {}),
    });
  } catch (err) {
    log.error(`[user-memory-route] synthesize-file failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});

/**
 * Respond/ignore gate (Memory v2, gap-2). S2S — claw-auth's webhook passes the
 * incoming mention + the user's learned patterns/stats; claw runs the LLM gate
 * and returns whether the Twin should reply. FAIL-CLOSED (stay silent) on any
 * problem — a wrong post AS the user is not recoverable.
 */
userMemoryRouter.post("/internal/user-memory/should-respond", validateS2SKey, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Partial<RespondGateRequest>;
    if (typeof body.incoming !== "string" || !body.incoming.trim()) {
      // No incoming text to judge → stay silent (fail-closed).
      res.json({ respond: false, confidence: 0, reason: "no incoming text", source: "fail-closed" });
      return;
    }
    const result = await decideRespond({
      incoming: body.incoming,
      ...(typeof body.channelName === "string" ? { channelName: body.channelName } : {}),
      ...(typeof body.channelType === "string" ? { channelType: body.channelType } : {}),
      ...(typeof body.senderName === "string" ? { senderName: body.senderName } : {}),
      patterns: strings(body.patterns),
      relevantContext: strings(body.relevantContext),
      ...(typeof body.stats === "string" ? { stats: body.stats } : {}),
      ...(body.isDirectMessage === true ? { isDirectMessage: true } : {}),
      ...(body.isThreadParticipant === true ? { isThreadParticipant: true } : {}),
      ...(body.includeTrace === true ? { includeTrace: true } : {}),
    });
    res.json(result);
  } catch (err) {
    log.error(`[user-memory-route] should-respond failed: ${err instanceof Error ? err.message : String(err)}`);
    // Fail-closed on any error — stay silent rather than post as the user.
    res.json({ respond: false, confidence: 0, reason: "gate error — stay silent", source: "fail-closed" });
  }
});
