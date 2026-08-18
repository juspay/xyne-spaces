/**
 * S2S endpoints exposing the eval semantic judge to claw-auth.
 *
 * Same "LLM-on-claw-only" pattern as goal-judge: the LiteLLM key lives on claw,
 * so claw-auth POSTs each turn's (expected, generated) here and gets back a
 * `{ score, reasoning }`. The model list endpoint feeds claw-auth's judge model
 * picker.
 */
import { Router, type Request, type Response } from "express";
import { validateS2SKey } from "../middleware/auth.js";
import { createLogger } from "../logger.js";
import { judgeSemanticMatch, listJudgeModels } from "../eval-judge.js";
import { LITELLM } from "../config.js";

const router = Router();
const log = createLogger("eval-judge-route");

router.post("/eval-judge", validateS2SKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as {
      expected?: unknown;
      generated?: unknown;
      message?: unknown;
      prompt?: unknown;
      model?: unknown;
      copilot?: { token?: unknown; model?: unknown };
    } | undefined;

    if (!body || typeof body.expected !== "string" || typeof body.generated !== "string") {
      res.status(400).json({ success: false, error: "expected and generated must be strings" });
      return;
    }

    const result = await judgeSemanticMatch({
      expected: body.expected,
      generated: body.generated,
      message: typeof body.message === "string" ? body.message : undefined,
      prompt: typeof body.prompt === "string" ? body.prompt : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      copilot:
        body.copilot && typeof body.copilot.token === "string" && typeof body.copilot.model === "string"
          ? { token: body.copilot.token, model: body.copilot.model }
          : undefined,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    log.error(`[eval-judge-route] failed: ${err instanceof Error ? err.message : String(err)}`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
    }
  }
});

router.get("/eval-models", validateS2SKey, async (_req: Request, res: Response): Promise<void> => {
  try {
    const models = await listJudgeModels();
    // defaultModel = what an empty model resolves to (judge + extraction fallback).
    res.json({ success: true, models, defaultModel: LITELLM.fastModel });
  } catch (err) {
    log.error(`[eval-judge-route] failed: ${err instanceof Error ? err.message : String(err)}`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : "Internal error" });
    }
  }
});

export { router as evalJudgeRouter };
