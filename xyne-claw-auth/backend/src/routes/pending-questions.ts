/**
 * Pending questions — Redis-backed ephemeral store.
 *
 * POST /pending-questions  — store a question (called by ask-user-question tool)
 * GET  /pending-questions/:id — retrieve a question (called by flow-action / app-callback)
 *
 * Auth: strict S2S only (also enforced at the mount in main.ts). Questions
 * carry another user's prompt context, and the question ID is the only lookup
 * key — the old requireS2S cookie fallback let any logged-in user who learned
 * an ID read or overwrite someone else's pending question.
 */

import { Router, type Request, type Response } from "express";
import { redisService } from "../redis.js";
import { requireStrictS2S } from "../middleware/require-auth.js";

import { createLogger } from "../logger.js";
const log = createLogger("pending-questions");

const router = Router();
const PREFIX = "pending-question:";
const TTL = 86400; // 24 hours

export interface StoredQuestion {
  questionId: string;
  userId: string;
  agentSlug: string;
  channelId: string;
  conversationId: string;
  question: string;
  options: string[];
}

export async function getQuestion(questionId: string): Promise<StoredQuestion | null> {
  const redis = redisService.getConnection();
  const raw = await redis.get(`${PREFIX}${questionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as StoredQuestion;
}

export async function deleteQuestion(questionId: string): Promise<void> {
  const redis = redisService.getConnection();
  await redis.del(`${PREFIX}${questionId}`);
}

// POST / — store a pending question
router.post("/", requireStrictS2S, async (req: Request, res: Response) => {
  try {
    const { questionId, userId, agentSlug, channelId, conversationId, question, options } = req.body as {
      questionId?: string;
      userId?: string;
      agentSlug?: string;
      channelId?: string;
      conversationId?: string;
      question?: string;
      options?: string[];
    };

    if (!questionId || !question || !options?.length) {
      res.status(400).json({ success: false, error: "questionId, question, and options are required" });
      return;
    }

    const data: StoredQuestion = {
      questionId,
      userId: userId ?? "",
      agentSlug: agentSlug ?? "",
      channelId: channelId ?? "",
      conversationId: conversationId ?? "",
      question,
      options,
    };

    const redis = redisService.getConnection();
    await redis.set(`${PREFIX}${questionId}`, JSON.stringify(data), "EX", TTL);

    log.info(`[pending-questions] Stored question ${questionId}: "${question}" (${options.length} options)`);
    res.json({ success: true });
  } catch (err) {
    log.error("[pending-questions] Store error:", err);
    res.status(500).json({ success: false, error: "Failed to store question" });
  }
});

// GET /:id — retrieve a pending question
router.get("/:id", requireStrictS2S, async (req: Request<{ id: string }>, res: Response) => {
  try {
    const data = await getQuestion(req.params.id);
    if (!data) {
      res.status(404).json({ success: false, error: "Question not found or expired" });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    log.error("[pending-questions] Get error:", err);
    res.status(500).json({ success: false, error: "Failed to retrieve question" });
  }
});

export { router as pendingQuestionsRouter };
