import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response } from "express";
import { s2sKeyMatches } from "./require-auth.js";

function requesterKey(req: Request): string {
  const header = req.headers?.["x-user-id"];
  const userId = Array.isArray(header) ? header[0] : header;
  if (userId && userId.trim()) return `user:${userId.trim()}`;
  const sessionUserId = (req as Request & { session?: { userId?: string } }).session?.userId;
  if (sessionUserId && sessionUserId.trim()) return `user:${sessionUserId.trim()}`;
  return ipKeyGenerator(req.ip ?? "unknown");
}

function isInternalCaller(req: Request, _res: Response): boolean {
  return s2sKeyMatches(req.headers?.["x-s2s-key"]);
}

export function createRequesterLimiter(options: { windowMs: number; max: number }): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    keyGenerator: requesterKey,
    skip: isInternalCaller,
    message: {
      success: false,
      error: "Too many requests. Please slow down and try again shortly.",
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export const apiLimiter: RateLimitRequestHandler = createRequesterLimiter({ windowMs: 60 * 1000, max: 600 });

export const publicShareLimiter: RateLimitRequestHandler = createRequesterLimiter({ windowMs: 60 * 1000, max: 60 });

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
