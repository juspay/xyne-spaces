import type { Request, Response, NextFunction } from "express";
import { CONFIG } from "../config.js";
import { prisma } from "../db.js";

/**
 * Extract a cookie value by name from the Cookie header.
 */
function getCookie(req: Request, name: string): string | undefined {
  const cookie = req.headers.cookie ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Decode a JWT payload (base64url) without signature verification.
 * Returns null if the token is malformed.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (!parts[1]) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    return null;
  }
}

/**
 * Express middleware that verifies the caller's identity.
 *
 * Accepts auth via (in priority order):
 * 1. `google_access_token` cookie — JWT decoded, `sub` claim used as user ID, expiry checked
 * 2. `x-s2s-key` header — service-to-service calls (must match CONFIG.xyneClawS2sKey)
 * 3. `x-user-id` header — verified against the users table (must exist in DB)
 *
 * On success, ensures `req.headers["x-user-id"]` is set so downstream code works unchanged.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // 1. Try the Spaces authV2 cookies (browser requests via Spaces proxy).
  //    Spaces now puts the JWT in `xyne_ws_<workspaceId>_token` where
  //    workspaceId comes from the `xyne_last_workspace` cookie.
  //    `google_access_token` is kept as a backward-compat fallback but during
  //    the pending-auth window it holds a JSON blob (not a JWT), which we skip.
  const lastWorkspace = getCookie(req, "xyne_last_workspace");
  const workspaceToken = lastWorkspace ? getCookie(req, `xyne_ws_${lastWorkspace}_token`) : undefined;
  const legacyToken = getCookie(req, "google_access_token");
  // Only treat the legacy cookie as a JWT if it looks like one (3 dot-separated parts).
  // The authV2 flow stores a JSON blob (`{"user":{...},...}`) in this cookie during
  // the 10-minute pending-auth window — never use that for auth.
  const legacyJwt = legacyToken && legacyToken.split(".").length === 3 ? legacyToken : undefined;
  const token = workspaceToken ?? legacyJwt;

  if (token) {
    const payload = decodeJwtPayload(token);
    const sub = payload?.["sub"] as string | undefined;

    if (!sub) {
      res.status(401).json({ success: false, error: "Invalid auth token: missing user identity" });
      return;
    }

    // Check expiry
    const exp = payload?.["exp"] as number | undefined;
    if (exp && exp * 1000 < Date.now()) {
      res.status(401).json({ success: false, error: "Auth token expired" });
      return;
    }

    req.headers["x-user-id"] = sub;
    next();
    return;
  }

  // 2. Service-to-service: x-s2s-key header
  const s2sKey = req.headers["x-s2s-key"] as string | undefined;
  if (s2sKey && CONFIG.xyneClawS2sKey && s2sKey === CONFIG.xyneClawS2sKey) {
    next();
    return;
  }

  // 3. x-user-id header — verify the user exists in DB
  const userId = req.headers["x-user-id"];
  if (typeof userId === "string" && userId.trim()) {
    const user = await prisma.user.findUnique({ where: { id: userId.trim() } });
    if (user) {
      next();
      return;
    }
  }

  // 4. No valid auth
  res.status(401).json({ success: false, error: "Authentication required" });
}

/**
 * Lightweight middleware that only checks x-s2s-key for internal service callbacks.
 * Used on progress/callback endpoints called by xyne-claw, not browsers.
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

  // Also allow if a valid Spaces user JWT is present (admin testing from browser).
  // Prefer the authV2 workspace cookie; fall back to the legacy cookie only if
  // it looks like a JWT (skips the pending-auth JSON blob).
  const lastWorkspace = getCookie(req, "xyne_last_workspace");
  const workspaceToken = lastWorkspace ? getCookie(req, `xyne_ws_${lastWorkspace}_token`) : undefined;
  const legacy = getCookie(req, "google_access_token");
  const legacyJwt = legacy && legacy.split(".").length === 3 ? legacy : undefined;
  const token = workspaceToken ?? legacyJwt;
  if (token) {
    const payload = decodeJwtPayload(token);
    if (payload?.["sub"]) {
      next();
      return;
    }
  }

  res.status(401).json({ success: false, error: "s2s key required" });
}
