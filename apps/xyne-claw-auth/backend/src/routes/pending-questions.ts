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
import { asyncHandler, ok, badRequest, notFound } from "../lib/http.js";
import { redisService } from "../redis.js";
import { requireStrictS2S } from "../middleware/require-auth.js";
import type { UserQuestion } from "xyne-claw-shared";

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
  questions: UserQuestion[];
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

/** Atomically fetch-and-remove a pending question (getdel). Used by the
 *  answer path so a question can't be consumed twice. */
export async function consumeQuestion(questionId: string): Promise<StoredQuestion | null> {
  const redis = redisService.getConnection();
  const raw = await redis.getdel(`${PREFIX}${questionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as StoredQuestion;
}

// POST / — store a pending question
router.post("/", requireStrictS2S, asyncHandler(async (req: Request, res: Response) => {
  const { questionId, userId, agentSlug, channelId, conversationId, questions } = req.body as {
    questionId?: string;
    userId?: string;
    agentSlug?: string;
    channelId?: string;
    conversationId?: string;
    questions?: UserQuestion[];
  };

  if (!questionId || !Array.isArray(questions) || questions.length === 0) {
    throw badRequest("questionId and questions are required");
  }

  const data: StoredQuestion = {
    questionId,
    userId: userId ?? "",
    agentSlug: agentSlug ?? "",
    channelId: channelId ?? "",
    conversationId: conversationId ?? "",
    questions,
  };

  const redis = redisService.getConnection();
  await redis.set(`${PREFIX}${questionId}`, JSON.stringify(data), "EX", TTL);

  log.info(`[pending-questions] Stored question set ${questionId} (${questions.length} questions)`);
  ok(res);
}));

// GET /:id — retrieve a pending question
router.get("/:id", requireStrictS2S, asyncHandler(async (req: Request, res: Response) => {
  const questionId = (req.params as { id: string }).id;
  const data = await getQuestion(questionId);
  if (!data) {
    throw notFound("Question not found or expired");
  }
  ok(res, data);
}));

export { router as pendingQuestionsRouter };
