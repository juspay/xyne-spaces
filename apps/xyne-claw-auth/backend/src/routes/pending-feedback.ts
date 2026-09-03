/**
 * Pending feedback — Redis-backed ephemeral store.
 *
 * POST /pending-feedback     — store a feedback request (called by the
 *                              collect-feedback tool).
 * GET  /pending-feedback/:id — retrieve one (called by flow-action).
 *
 * Auth: strict S2S only (also enforced at the mount in main.ts). The feedback
 * id is the only lookup key, so — exactly like pending-questions — we never
 * allow the cookie fallback that would let any logged-in user who learned an id
 * read or overwrite someone else's pending feedback request.
 */

import { Router, type Request, type Response } from "express";
import { asyncHandler, ok, badRequest, notFound } from "../lib/http.js";
import { redisService } from "../redis.js";
import { requireStrictS2S } from "../middleware/require-auth.js";

import { createLogger } from "../logger.js";
const log = createLogger("pending-feedback");

const router = Router();
const PREFIX = "pending-feedback:";
const TTL = 86400; // 24 hours

export interface FeedbackOptionRecord {
  label: string;
  value: string;
  sentiment?: "up" | "down";
}

export interface StoredFeedback {
  feedbackId: string;
  sessionId: string;
  userId: string;
  agentSlug: string;
  channelId: string;
  conversationId: string;
  prompt: string;
  options: FeedbackOptionRecord[];
}

export async function getFeedback(feedbackId: string): Promise<StoredFeedback | null> {
  const redis = redisService.getConnection();
  const raw = await redis.get(`${PREFIX}${feedbackId}`);
  if (!raw) return null;
  return JSON.parse(raw) as StoredFeedback;
}

/** Atomically fetch-and-remove a pending feedback request (getdel), so a card
 *  can only be answered once even under a double click. */
export async function consumeFeedback(feedbackId: string): Promise<StoredFeedback | null> {
  const redis = redisService.getConnection();
  const raw = await redis.getdel(`${PREFIX}${feedbackId}`);
  if (!raw) return null;
  return JSON.parse(raw) as StoredFeedback;
}

function normalizeOptions(input: unknown): FeedbackOptionRecord[] {
  if (!Array.isArray(input)) return [];
  const out: FeedbackOptionRecord[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const label = typeof record["label"] === "string" ? record["label"] : "";
    const value = typeof record["value"] === "string" ? record["value"] : "";
    if (!label || !value) continue;
    const sentiment = record["sentiment"] === "up" || record["sentiment"] === "down"
      ? (record["sentiment"] as "up" | "down")
      : undefined;
    out.push(sentiment ? { label, value, sentiment } : { label, value });
  }
  return out;
}

// POST / — store a pending feedback request
router.post("/", requireStrictS2S, asyncHandler(async (req: Request, res: Response) => {
  const { feedbackId, sessionId, userId, agentSlug, channelId, conversationId, prompt, options } =
    req.body as Record<string, unknown>;

  const normalizedOptions = normalizeOptions(options);
  if (
    typeof feedbackId !== "string" || !feedbackId ||
    typeof sessionId !== "string" || !sessionId ||
    typeof prompt !== "string" || !prompt ||
    normalizedOptions.length < 2
  ) {
    throw badRequest("feedbackId, sessionId, prompt and at least 2 options are required");
  }

  const data: StoredFeedback = {
    feedbackId,
    sessionId,
    userId: typeof userId === "string" ? userId : "",
    agentSlug: typeof agentSlug === "string" ? agentSlug : "",
    channelId: typeof channelId === "string" ? channelId : "",
    conversationId: typeof conversationId === "string" ? conversationId : "",
    prompt,
    options: normalizedOptions,
  };

  const redis = redisService.getConnection();
  await redis.set(`${PREFIX}${feedbackId}`, JSON.stringify(data), "EX", TTL);

  log.info(`[pending-feedback] Stored feedback request ${feedbackId} (${normalizedOptions.length} options)`);
  ok(res);
}));

// GET /:id — retrieve a pending feedback request
router.get("/:id", requireStrictS2S, asyncHandler(async (req: Request, res: Response) => {
  const feedbackId = (req.params as { id: string }).id;
  const data = await getFeedback(feedbackId);
  if (!data) {
    throw notFound("Feedback request not found or expired");
  }
  ok(res, data);
}));

export { router as pendingFeedbackRouter };
