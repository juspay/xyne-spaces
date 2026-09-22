import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import { s2sKeyMatches } from "./require-auth.js";

/**
 * A stable per-caller identifier taken from the session cookie.
 *
 * The limiter is mounted at the API root, which is BEFORE any auth middleware
 * runs, so `x-user-id` is not set yet: http/routes.ts strips the inbound header
 * for every non-S2S caller and only requireAuth puts it back. Reading it there
 * always found nothing and fell through to the IP, and behind a load balancer
 * that is one bucket for every signed-in person in the company.
 *
 * The cookie is the one caller identity available synchronously at that point,
 * with no /me round trip. It is not proof of identity, and it does not need to
 * be: this only decides which counter to increment, and every route still
 * authenticates for real downstream. Hashed so a live session id never becomes
 * a store key or turns up in a log line.
 */
function sessionKey(req: Request): string | null {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  for (const name of ["user_session_id", "xyne_last_workspace"]) {
    const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(raw);
    const value = match?.[1]?.trim();
    if (value) return createHash("sha256").update(`${name}:${value}`).digest("hex").slice(0, 24);
  }
  return null;
}

function requesterKey(req: Request): string {
  const header = req.headers?.["x-user-id"];
  const userId = Array.isArray(header) ? header[0] : header;
  if (userId && userId.trim()) return `user:${userId.trim()}`;
  const sessionUserId = (req as Request & { session?: { userId?: string } }).session?.userId;
  if (sessionUserId && sessionUserId.trim()) return `user:${sessionUserId.trim()}`;
  const cookie = sessionKey(req);
  if (cookie) return `sess:${cookie}`;
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
