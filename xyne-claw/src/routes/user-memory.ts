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
import type { UserMemoryDistillRequest, UserMemoryRecord } from "xyne-claw-shared";

import { createLogger } from "../logger.js";
const log = createLogger("user-memory");

export const userMemoryRouter = Router();

userMemoryRouter.post("/internal/user-memory/distill", validateS2SKey, async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Partial<UserMemoryDistillRequest>;
    if (!body.userId || !body.window?.from || !body.window?.to || !Array.isArray(body.records)) {
      res.status(400).json({ success: false, error: "Missing userId, window.from/to, or records[]" });
      return;
    }

    // Light shape filter — drop anything that doesn't have the minimum fields
    // the curator prompt depends on. Cheap defense against a malformed batch.
    const records: UserMemoryRecord[] = body.records
      .filter((r): r is UserMemoryRecord =>
        !!r && typeof r === "object" &&
        typeof (r as UserMemoryRecord).id === "string" &&
        (["message", "call", "canvas", "mention_reply"] as const).includes((r as UserMemoryRecord).type) &&
        typeof (r as UserMemoryRecord).ts === "string" &&
        typeof (r as UserMemoryRecord).text === "string",
      );

    if (records.length === 0) {
      res.json({ success: true, candidates: [] });
      return;
    }

    // Existing memories are optional context so the curator can update instead
    // of duplicate. Shape-filter defensively; a malformed entry just drops.
    const existingMemories = Array.isArray(body.existingMemories)
      ? body.existingMemories.filter(
          (m): m is NonNullable<UserMemoryDistillRequest["existingMemories"]>[number] =>
            !!m && typeof m === "object" &&
            typeof (m as { id?: unknown }).id === "string" &&
            typeof (m as { subsystem?: unknown }).subsystem === "string" &&
            typeof (m as { text?: unknown }).text === "string",
        )
      : [];

    const candidates = await distillUserMemory(
      body.userId,
      { from: body.window.from, to: body.window.to },
      records,
      existingMemories,
    );
    res.json({ success: true, candidates });
  } catch (err) {
    log.error(`[user-memory-route] distill failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
  }
});
