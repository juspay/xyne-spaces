import type { Request, Response, NextFunction } from "express";

import { createLogger } from "../logger.js";
const log = createLogger("pin-user-id-param");

export function pinUserIdParam(req: Request, res: Response, next: NextFunction): void {
  const sessionUserId = req.headers["x-user-id"];
  const urlUserId = (req.params as { userId?: string }).userId;

  // Fail CLOSED. A `/:userId/...` route acts on a specific user's data, so it
  // requires a pinned acting user. Previously this fell through with next()
  // when no x-user-id was set — and the S2S branch of requireAuth pins nothing,
  // so a caller holding only the S2S key could read ANY :userId's data
  // (e.g. /users/:id/oauth/google/token returned the victim's live token).
  // Now a request with no pinned user is rejected outright; legitimate S2S
  // callers (xyne-claw) must send x-user-id == the :userId they act for.
  if (typeof sessionUserId !== "string" || !sessionUserId) {
    log.warn(`[pin-user-id] reject (no pinned user): url=${urlUserId ?? "(none)"} path=${req.path}`);
    res.status(401).json({ success: false, error: "authenticated user required" });
    return;
  }
  if (urlUserId && urlUserId !== sessionUserId) {
    log.warn(`[pin-user-id] reject: session=${sessionUserId} url=${urlUserId} path=${req.path}`);
    res.status(403).json({ success: false, error: "userId in URL does not match authenticated session" });
    return;
  }
  next();
}
