import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { SERVER } from "../config.js";

import { createLogger } from "../logger.js";
const log = createLogger("auth");

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on length mismatch; compare lengths first (the
  // length itself isn't secret) and only then do the constant-time compare.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function validateS2SKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-s2s-key"];

  // Fail CLOSED. Previously an unset SERVER.s2sKey made every route public —
  // a single misconfigured deploy silently removed all authentication. Now an
  // unset key rejects every request, unconditionally — there is no insecure
  // escape hatch (boot also refuses to start without the key, see main.ts).
  if (!SERVER.s2sKey) {
    log.error("[auth] XYNE_CLAW_S2S_KEY is not configured — refusing request. Set the key.");
    res.status(503).json({ success: false, error: "Service authentication not configured" });
    return;
  }

  if (typeof key !== "string" || !constantTimeEqual(key, SERVER.s2sKey)) {
    res.status(401).json({ success: false, error: "Invalid or missing S2S key" });
    return;
  }

  next();
}
