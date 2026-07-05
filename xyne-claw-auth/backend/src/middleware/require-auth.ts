import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { CONFIG } from "../config.js";
import { ensureUserExists } from "../lib/users-jit.js";
import { checkResultCallbackToken } from "../lib/session-tokens.js";

import { createLogger } from "../logger.js";
const log = createLogger("require-auth");

interface SpacesMeResponse {
  success?: boolean;
  user?: { id?: string };
}

/**
 * Constant-time S2S key comparison. A plain `===` short-circuits on the first
 * differing byte, leaking key bytes via response timing to an attacker who can
 * measure it. Compare lengths first (length isn't secret; timingSafeEqual throws
 * on mismatch) then do the constant-time check. Mirrors xyne-claw's auth.ts.
 */
export function s2sKeyMatches(provided: string | string[] | undefined): boolean {
  const expected = CONFIG.xyneClawS2sKey;
  if (!expected || typeof provided !== "string") return false; // fail closed when key unset
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Memoize the Spaces /api/auth/me lookup per request. Routes now stack
// mount-level auth (main.ts) with per-route auth (defense-in-depth), and
// without this each layer would re-fetch /me for the same request.
const SPACES_USER_ID = Symbol("spacesUserId");

async function resolveUserIdFromSpaces(req: Request): Promise<string | undefined> {
  const cached = (req as unknown as Record<symbol, string | undefined>)[SPACES_USER_ID];
  if (cached !== undefined) return cached || undefined;

  const userId = await resolveUserIdFromSpacesUncached(req);
  // Store "" for a failed resolution so repeat lookups are also skipped.
  (req as unknown as Record<symbol, string | undefined>)[SPACES_USER_ID] = userId ?? "";
  return userId;
}

async function resolveUserIdFromSpacesUncached(req: Request): Promise<string | undefined> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;

  const headers: Record<string, string> = {
    cookie: cookieHeader,
  };

  const workspaceId = req.headers["x-workspace-id"];
  if (typeof workspaceId === "string" && workspaceId.trim()) {
    headers["x-workspace-id"] = workspaceId.trim();
  }

  const res = await fetch(`${CONFIG.spacesInternalUrl}/api/auth/me`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) return undefined;

  const body = (await res.json().catch(() => null)) as SpacesMeResponse | null;
  const userId = body?.user?.id;
  return typeof userId === "string" && userId.trim() ? userId.trim() : undefined;
}

/**
 * Express middleware that verifies the caller's identity.
 *
 * Accepts auth via (in priority order):
 * 1. Spaces backend auth middleware via /api/auth/me (cookie-based)
 * 2. `x-s2s-key` header — service-to-service calls (must match CONFIG.xyneClawS2sKey)
 *
 * On success, ensures `req.headers["x-user-id"]` is set so downstream code works unchanged.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // 1. Verify browser cookies through Spaces backend auth middleware.
  const userId = await resolveUserIdFromSpaces(req).catch(() => undefined);
  if (userId) {
    // JIT-mirror the user row from Spaces if we've never seen them. Lets a
    // brand-new Spaces user hit any claw-auth route without first POSTing
    // /users from the SPA. Silent no-op if SPACES_DB_URL is unset or the
    // user row already exists.
    await ensureUserExists(userId, "require-auth").catch((err) => {
      log.warn(`[require-auth] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
    });
    req.headers["x-user-id"] = userId;
    next();
    return;
  }

  // 2. Service-to-service: x-s2s-key header
  const s2sKey = req.headers["x-s2s-key"] as string | undefined;
  if (s2sKeyMatches(s2sKey)) {
    next();
    return;
  }

  // 3. No valid auth
  res.status(401).json({ success: false, error: "Authentication required" });
}

/**
 * Lightweight middleware that checks x-s2s-key for internal service callbacks.
 * Also allows valid Spaces user cookie for admin testing from browser.
 */
export async function requireS2S(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const s2sKey = req.headers["x-s2s-key"] as string | undefined;
  if (s2sKeyMatches(s2sKey)) {
    next();
    return;
  }

  const userId = await resolveUserIdFromSpaces(req).catch(() => undefined);
  if (userId) {
    await ensureUserExists(userId, "require-auth").catch((err) => {
      log.warn(`[require-auth/s2s] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
    });
    req.headers["x-user-id"] = userId;
    next();
    return;
  }

  res.status(401).json({ success: false, error: "s2s key required" });
}

/**
 * Strictest S2S middleware: ONLY accepts a valid x-s2s-key. Unlike requireS2S
 * it does NOT fall back to a Spaces user cookie, so it can't be reached by an
 * ordinary logged-in browser user.
 *
 * Use this on internal callback / data-plane routes whose only legitimate
 * caller is another service (xyne-claw posting run results, session
 * archive/restore, lock acquisition). The cookie fallback in requireS2S was
 * intended for manual admin testing but has no role check, so it effectively
 * downgraded these endpoints to "any authenticated user" — a cross-user data
 * exposure for the session/result routes.
 */
export function requireStrictS2S(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const s2sKey = req.headers["x-s2s-key"] as string | undefined;
  if (s2sKeyMatches(s2sKey)) {
    next();
    return;
  }
  res.status(401).json({ success: false, error: "s2s key required" });
}

/**
 * Per-run authentication for pod result callbacks. Layered AFTER requireStrictS2S:
 * the S2S key proves "a trusted pod sent this", this proves "for THIS run". The
 * pod attaches the run's sessionToken as `x-session-token`; we verify it binds to
 * the run's sessionId. The sessionId lives in different places per route (path
 * param vs body), so the caller supplies an extractor.
 */
export function requireResultToken(getSessionId: (req: Request) => string | string[] | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const raw = getSessionId(req);
    const sid = (Array.isArray(raw) ? raw[0] : raw) ?? "";
    const check = checkResultCallbackToken(req.headers["x-session-token"] as string | undefined, sid);
    if (!check.ok) {
      log.warn(`[result-token] rejecting result (session=${sid || "?"}): ${check.reason}`);
      res.status(401).json({ success: false, error: `session token ${check.reason}` });
      return;
    }
    next();
  };
}

/**
 * Stricter form of requireAuth: ONLY accepts verified browser-cookie auth.
 * Rejects x-s2s-key even if the key is valid.
 *
 * Use this on routes whose semantics are "act on behalf of *this specific
 * user* identified by their session". Digital Twin is the canonical case —
 * the routes write/read deeply personal data keyed off x-user-id, and an
 * S2S caller setting x-user-id to a victim ID would let an internal service
 * (or anyone holding the S2S key) impersonate any user.
 *
 * requireAuth's permissiveness is appropriate for routes that derive user
 * identity from the request body and cross-check (most existing routes do).
 * For Digital Twin we treat x-user-id as authoritative identity, so the
 * stricter middleware closes the loop.
 */
export async function requireUserAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = await resolveUserIdFromSpaces(req).catch(() => undefined);
  if (!userId) {
    res.status(401).json({ success: false, error: "User session required" });
    return;
  }
  // `ensureUserExists` keys its caller arg off SpacesAuthCaller for query
  // logging; "require-auth" covers both this and the permissive variant.
  await ensureUserExists(userId, "require-auth").catch((err) => {
    log.warn(`[require-user-auth] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
  });
  req.headers["x-user-id"] = userId;
  next();
}
