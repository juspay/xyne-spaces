import type { Request, Response, NextFunction } from "express";
import { CONFIG } from "../config.js";
import { ensureUserExists } from "../lib/users-jit.js";

interface SpacesMeResponse {
  success?: boolean;
  user?: { id?: string };
}

async function resolveUserIdFromSpaces(req: Request): Promise<string | undefined> {
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
      console.warn(`[require-auth] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
    });
    req.headers["x-user-id"] = userId;
    next();
    return;
  }

  // 2. Service-to-service: x-s2s-key header
  const s2sKey = req.headers["x-s2s-key"] as string | undefined;
  if (s2sKey && CONFIG.xyneClawS2sKey && s2sKey === CONFIG.xyneClawS2sKey) {
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
  if (CONFIG.xyneClawS2sKey && s2sKey === CONFIG.xyneClawS2sKey) {
    next();
    return;
  }

  const userId = await resolveUserIdFromSpaces(req).catch(() => undefined);
  if (userId) {
    await ensureUserExists(userId, "require-auth").catch((err) => {
      console.warn(`[require-auth/s2s] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
    });
    req.headers["x-user-id"] = userId;
    next();
    return;
  }

  res.status(401).json({ success: false, error: "s2s key required" });
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
    console.warn(`[require-user-auth] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
  });
  req.headers["x-user-id"] = userId;
  next();
}
