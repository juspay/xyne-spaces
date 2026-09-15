import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response } from "express";
import { getVerifiedUserId, s2sKeyMatches } from "./require-auth.js";

function requesterKey(req: Request): string {
  // Only trust identity that an auth middleware derived from a verified
  // source (Spaces cookie, hashed CLI token, or validated S2S key) — see
  // markVerifiedUser in require-auth.ts. The raw x-user-id header is
  // client-controlled on pre-auth mounts (app-level apiLimiter) and on
  // optionalAuth'd public routes, so keying buckets on it let any caller
  // mint fresh buckets by rotating the header value. Unverified callers
  // fall back to their IP.
  const verifiedUserId = getVerifiedUserId(req);
  if (verifiedUserId && verifiedUserId.trim()) return `user:${verifiedUserId.trim()}`;
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
