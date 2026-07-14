import type { Request, Response, NextFunction } from "express";
import { verifySessionToken, type SessionTokenPayload } from "../lib/session-tokens.js";

import { createLogger } from "../logger.js";
const log = createLogger("require-session-token");

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: { userId: string; sessionId: string; agentSlug?: string; spacesAppId?: string };
    }
  }
}

export function requireSessionToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ success: false, error: "Bearer token required" });
    return;
  }
  const raw = header.slice("bearer ".length).trim();

  const result = verifySessionToken(raw);
  if (typeof result === "string") {
    log.warn(`[session-token] reject: ${result} path=${req.path}`);
    res.status(401).json({ success: false, error: "Invalid or expired session token" });
    return;
  }

  const urlSessionId = (req.params as { sessionId?: string }).sessionId;
  if (urlSessionId && urlSessionId !== result.sid) {
    log.warn(`[session-token] sid mismatch token=${result.sid} url=${urlSessionId}`);
    res.status(403).json({ success: false, error: "Session token does not match URL session id" });
    return;
  }

  const session: SessionTokenPayload = result;
  req.session = {
    userId: session.uid,
    sessionId: session.sid,
    ...(session.aslug ? { agentSlug: session.aslug } : {}),
    ...(session.appid ? { spacesAppId: session.appid } : {}),
  };
  next();
}

/**
 * Like requireSessionToken, but additionally requires the token's `uid` to
 * match the `:userId` route param. For per-user secret endpoints (OAuth access
 * tokens) called S2S by xyne-claw: the S2S key + a caller-chosen x-user-id is
 * not enough to act as a user — the caller must present the HMAC session token
 * claw-auth itself minted for that user's run, so a leaked S2S key alone can't
 * retrieve an arbitrary victim's live OAuth token.
 */
export function requireSessionTokenForUserParam(req: Request, res: Response, next: NextFunction): void {
  requireSessionToken(req, res, () => {
    const urlUserId = (req.params as { userId?: string }).userId;
    if (!req.session || !urlUserId || req.session.userId !== urlUserId) {
      log.warn(`[session-token] uid mismatch token=${req.session?.userId ?? "(none)"} url=${urlUserId ?? "(none)"} path=${req.path}`);
      res.status(403).json({ success: false, error: "Session token does not match URL user id" });
      return;
    }
    next();
  });
}
