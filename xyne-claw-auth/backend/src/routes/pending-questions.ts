/**
 * Pending questions — Redis-backed ephemeral store.
 *
 * POST /pending-questions  — store a question (called by ask-user-question tool)
 * GET  /pending-questions/:id — retrieve a question (called by app-callback)
 */

import { Router, type Request, type Response } from "express";
import { redisService } from "../redis.js";

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
router.post("/", async (req: Request, res: Response) => {
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

    console.log(`[pending-questions] Stored question ${questionId}: "${question}" (${options.length} options)`);
    res.json({ success: true });
  } catch (err) {
    console.error("[pending-questions] Store error:", err);
    res.status(500).json({ success: false, error: "Failed to store question" });
  }
});

// GET /:id — retrieve a pending question
router.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const data = await getQuestion(req.params.id);
    if (!data) {
      res.status(404).json({ success: false, error: "Question not found or expired" });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error("[pending-questions] Get error:", err);
    res.status(500).json({ success: false, error: "Failed to retrieve question" });
  }
});

export { router as pendingQuestionsRouter };
