import type { Request, Response, NextFunction } from "express";
import { verifySessionToken, type SessionTokenPayload } from "../lib/session-tokens.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: { userId: string; sessionId: string; agentSlug?: string };
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
    console.warn(`[session-token] reject: ${result} path=${req.path}`);
    res.status(401).json({ success: false, error: "Invalid or expired session token" });
    return;
  }

  const urlSessionId = (req.params as { sessionId?: string }).sessionId;
  if (urlSessionId && urlSessionId !== result.sid) {
    console.warn(`[session-token] sid mismatch token=${result.sid} url=${urlSessionId}`);
    res.status(403).json({ success: false, error: "Session token does not match URL session id" });
    return;
  }

  const session: SessionTokenPayload = result;
  req.session = {
    userId: session.uid,
    sessionId: session.sid,
    ...(session.aslug ? { agentSlug: session.aslug } : {}),
  };
  next();
}
