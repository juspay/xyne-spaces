import type { Request, Response, NextFunction } from "express";

import { createLogger } from "../logger.js";
const log = createLogger("pin-user-id-param");

/** The canonical Claw identity established by requireAuth. */
export function getCanonicalRequesterId(req: Request): string | undefined {
  const userId = req.headers["x-user-id"];
  return typeof userId === "string" && userId ? userId : undefined;
}

/**
 * `requireAuth` derives both headers from a verified Spaces session (or a
 * trusted S2S request). Spaces callers still use their workspace membership ID
 * in URLs, while Claw persistence uses the canonical person ID. Treat these as
 * two representations of the same authenticated caller.
 */
export function matchesAuthenticatedUserId(req: Request, userId: string): boolean {
  const canonicalUserId = getCanonicalRequesterId(req);
  const spacesUserId = req.headers["x-spaces-user-id"];
  return userId === canonicalUserId
    || (typeof spacesUserId === "string" && !!spacesUserId && userId === spacesUserId);
}

/**
 * All ids the authenticated caller may own rows under: the canonical Claw id
 * (x-user-id) plus the current workspace's raw Spaces id (x-spaces-user-id),
 * both stamped by requireAuth from the verified session — i.e. already scoped
 * to the session's workspace context. User-owned tables can legitimately hold
 * either key (rows written before canonicalization, or via its raw fallback),
 * so reads of "my" data must accept the pair, never a single id.
 */
export function getRequesterAliases(req: Request): string[] {
  const ids = [req.headers["x-user-id"], req.headers["x-spaces-user-id"]]
    .filter((v): v is string => typeof v === "string" && !!v.trim())
    .map((v) => v.trim());
  return [...new Set(ids)];
}

export function pinUserIdParam(req: Request, res: Response, next: NextFunction): void {
  const sessionUserId = getCanonicalRequesterId(req);
  const urlUserId = (req.params as { userId?: string }).userId;

  // Fail CLOSED. A `/:userId/...` route acts on a specific user's data, so it
  // requires a pinned acting user. Previously this fell through with next()
  // when no x-user-id was set — and the S2S branch of requireAuth pins nothing,
  // so a caller holding only the S2S key could read ANY :userId's data
  // (e.g. /users/:id/oauth/google/token returned the victim's live token).
  // Now a request with no pinned user is rejected outright; legitimate S2S
  // callers (xyne-claw) must send x-user-id == the :userId they act for.
  if (!sessionUserId) {
    log.warn(`[pin-user-id] reject (no pinned user): url=${urlUserId ?? "(none)"} path=${req.path}`);
    res.status(401).json({ success: false, error: "authenticated user required" });
    return;
  }
  if (urlUserId && !matchesAuthenticatedUserId(req, urlUserId)) {
    log.warn(`[pin-user-id] reject: session=${sessionUserId} url=${urlUserId} path=${req.path}`);
    res.status(403).json({ success: false, error: "userId in URL does not match authenticated session" });
    return;
  }
  next();
}
