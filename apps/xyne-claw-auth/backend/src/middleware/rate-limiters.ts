import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request } from "express";

function requesterKey(req: Request): string {
  const userId = req.header("x-user-id");
  return userId && userId.trim() ? `user:${userId.trim()}` : ipKeyGenerator(req.ip ?? "unknown");
}

export const oauthLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: requesterKey,
  message: {
    success: false,
    error: "Too many sign-in attempts. Please wait a moment and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
