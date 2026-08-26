import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { CONFIG } from "../config.js";
import { ensureUserExists, resolveClawUserIdForSpacesIdentity } from "../lib/users-jit.js";
import { checkResultCallbackToken } from "../lib/session-tokens.js";
import { verify as verifyCliToken } from "../lib/cli-tokens.js";
import type { VerifiedCliToken } from "../lib/cli-tokens.js";
import { prisma } from "../db.js";

import { createLogger } from "../logger.js";
const log = createLogger("require-auth");

// Track which Response objects were authenticated via a CLI/service access token.
// Used by requireNoAccessToken to reject access-token callers from routes that
// do not enforce scopes. Intentionally NOT exposed outside this module.
const accessTokenRegistry = new WeakMap<Response, VerifiedCliToken>();

/**
 * Attach phase-1 org context to the request as headers, right after `x-user-id`
 * is set. Read-only: looks up the user's `orgId` and their `OrgMember.role` and
 * stamps `x-org-id` / `x-user-role` for downstream handlers (getTenantContext).
 *
 * Non-breaking and best-effort: if the user has no org yet (should not happen
 * post-backfill — JIT attaches new users to the default org, see users-jit.ts)
 * or the lookup fails, we simply leave the headers unset. Nothing downstream
 * requires them this phase.
 *
 * Called only after the caller's identity is authenticated: browser-cookie auth
 * derives `userId` from Spaces, and S2S callers may pin `x-user-id` after the
 * shared key has been validated.
 */
async function attachOrgContext(req: Request, userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { orgId: true },
    });
    if (!user?.orgId) return;

    req.headers["x-org-id"] = user.orgId;

    const member = await prisma.orgMember.findUnique({
      where: { userId_orgId: { userId, orgId: user.orgId } },
      select: { role: true },
    });
    if (member?.role) req.headers["x-user-role"] = member.role;
  } catch (err) {
    log.warn(`[require-auth] attachOrgContext(${userId}) failed:`, err instanceof Error ? err.message : err);
  }
}

interface SpacesMeResponse {
  success?: boolean;
  user?: { id?: string; workspaceId?: string; memberId?: string };
}

interface VerifiedSpacesIdentity {
  userId: string;
  workspaceId?: string;
  orgMemberId?: string;
}

/**
 * Constant-time S2S key comparison. A plain `===` short-circuits on the first
 * differing byte, leaking key bytes via response timing to an attacker who can
 * measure it. Compare lengths first (length isn't secret; timingSafeEqual throws
 * on mismatch) then do the constant-time check. Mirrors xyne-claw's auth.ts.
 */
/**
 * Strip inbound org-context headers so a client can NEVER inject them. `x-org-id`
 * and `x-user-role` are derived SERVER-SIDE (by `attachOrgContext` on the verified
 * cookie session); if a request arrives carrying them, they're spoof attempts.
 * Removing them at entry makes the org context fail-CLOSED — a failed/absent
 * attach yields an EMPTY org (→ getOrgId undefined → safe no-match) rather than
 * an attacker-chosen org. (x-user-id is left intact: the S2S contract legitimately
 * sets it, and the cookie path overwrites it from the verified session.)
 */
function stripClientOrgHeaders(req: Request): void {
  delete req.headers["x-org-id"];
  delete req.headers["x-user-role"];
}

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
const SPACES_IDENTITY = Symbol("spacesIdentity");

async function resolveSpacesIdentityFromSpaces(req: Request): Promise<VerifiedSpacesIdentity | undefined> {
  const cached = (req as unknown as Record<symbol, VerifiedSpacesIdentity | null | undefined>)[SPACES_IDENTITY];
  if (cached !== undefined) return cached ?? undefined;
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    (req as unknown as Record<symbol, VerifiedSpacesIdentity | null>)[SPACES_IDENTITY] = null;
    return undefined;
  }

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

  if (!res.ok) {
    (req as unknown as Record<symbol, VerifiedSpacesIdentity | null>)[SPACES_IDENTITY] = null;
    return undefined;
  }

  const body = (await res.json().catch(() => null)) as SpacesMeResponse | null;
  const userId = body?.user?.id;
  const identity = typeof userId === "string" && userId.trim()
    ? {
        userId: userId.trim(),
        ...(typeof body?.user?.workspaceId === "string" && body.user.workspaceId.trim()
          ? { workspaceId: body.user.workspaceId.trim() }
          : {}),
        ...(typeof body?.user?.memberId === "string" && body.user.memberId.trim()
          ? { orgMemberId: body.user.memberId.trim() }
          : {}),
      }
    : undefined;
  (req as unknown as Record<symbol, VerifiedSpacesIdentity | null>)[SPACES_IDENTITY] = identity ?? null;
  return identity;
}

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim();
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Normalize the backwards-compatible Spaces S2S contract at the boundary.
 * Older callers put the raw workspace user id in `x-user-id`; newer callers
 * may additionally send `x-spaces-user-id` and workspace context. Downstream
 * Claw code must always see the canonical id in `x-user-id`.
 */
async function canonicalizeS2SIdentity(req: Request): Promise<string | undefined> {
  const explicitSpacesUserId = headerValue(req, "x-spaces-user-id");
  const suppliedUserId = explicitSpacesUserId ?? headerValue(req, "x-user-id");
  if (!suppliedUserId) return undefined;

  const workspaceId = headerValue(req, "x-spaces-workspace-id") ?? headerValue(req, "x-workspace-id");
  await ensureUserExists(suppliedUserId, "require-auth").catch((err) => {
    log.warn(`[require-auth] ensureUserExists(${suppliedUserId}) for S2S failed:`, err instanceof Error ? err.message : err);
  });
  const clawUserId = await resolveClawUserIdForSpacesIdentity(suppliedUserId, workspaceId).catch((err) => {
    log.warn(`[require-auth] resolveClawUserIdForSpacesIdentity(${suppliedUserId}) for S2S failed:`, err instanceof Error ? err.message : err);
    return undefined;
  });
  if (!clawUserId) return undefined;

  req.headers["x-user-id"] = clawUserId;
  // Do not manufacture a raw Spaces id when a Claw-internal caller supplied
  // an already-canonical id. Keep it only when the source identity is known.
  if (explicitSpacesUserId || clawUserId !== suppliedUserId) {
    req.headers["x-spaces-user-id"] = suppliedUserId;
  }
  if (workspaceId) req.headers["x-spaces-workspace-id"] = workspaceId;
  return clawUserId;
}

/**
 * Express middleware that verifies the caller's identity.
 *
 * Accepts auth via (in priority order):
 * 1. Spaces backend auth middleware via /api/auth/me (cookie-based)
 * 2. CLI/service access token via `Authorization: Bearer xyne_cli_...` or
 *    `xyne_svc_...` when CLI_TOKENS_ENABLED is on
 * 3. `x-s2s-key` header — service-to-service calls (must match CONFIG.xyneClawS2sKey)
 *
 * On success, ensures `req.headers["x-user-id"]` is set so downstream code works unchanged.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  stripClientOrgHeaders(req);
  // 1. Verify browser cookies through Spaces backend auth middleware.
  const spacesIdentity = await resolveSpacesIdentityFromSpaces(req).catch(() => undefined);
  const userId = spacesIdentity?.userId;
  if (userId) {
    // JIT-mirror the user row from Spaces if we've never seen them. Lets a
    // brand-new Spaces user hit any claw-auth route without first POSTing
    // /users from the SPA. Silent no-op if SPACES_DB_URL is unset or the
    // user row already exists.
    await ensureUserExists(userId, "require-auth").catch((err) => {
      log.warn(`[require-auth] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
    });
    // /auth/me has already authenticated the cookie and selected its active
    // workspace. Use that verified value—not the inbound header—to resolve the
    // workspace-scoped source identity to the canonical Claw user.
    const clawUserId = await resolveClawUserIdForSpacesIdentity(userId, spacesIdentity.workspaceId).catch((err) => {
      log.warn(`[require-auth] resolveClawUserIdForSpacesIdentity(${userId}) failed:`, err instanceof Error ? err.message : err);
      return undefined;
    });
    req.headers["x-spaces-user-id"] = userId;
    if (spacesIdentity.workspaceId) req.headers["x-spaces-workspace-id"] = spacesIdentity.workspaceId;
    if (spacesIdentity.orgMemberId) req.headers["x-spaces-org-member-id"] = spacesIdentity.orgMemberId;
    req.headers["x-user-id"] = clawUserId ?? userId;
    // Phase-1 org context (additive; requireAuth only).
    await attachOrgContext(req, clawUserId ?? userId);
    next();
    return;
  }

  // 2. CLI/service bearer token. Identity is derived only from the hashed token row;
  // any inbound x-user-id is overwritten here.
  if (CONFIG.cliTokensEnabled) {
    const token = await verifyCliToken(bearerToken(req)).catch((err) => {
      log.warn("[require-auth] CLI token verification failed:", err instanceof Error ? err.message : err);
      return null;
    });
    if (token) {
      req.headers["x-user-id"] = token.userId;
      req.headers["x-org-id"] = token.orgId;
      // Route-level policy (e.g. service-token scope enforcement in /run)
      // needs the verified token record, not just the identity headers.
      // (locals always exists under Express; test doubles may omit it.)
      res.locals = res.locals ?? {};
      res.locals["accessToken"] = token;
      accessTokenRegistry.set(res, token);
      next();
      return;
    }
  }

  // 3. Service-to-service: x-s2s-key header
  const s2sKey = req.headers["x-s2s-key"] as string | undefined;
  if (s2sKeyMatches(s2sKey)) {
    const pinnedUserId = await canonicalizeS2SIdentity(req);
    if (pinnedUserId) {
      await attachOrgContext(req, pinnedUserId);
    }
    next();
    return;
  }

  // 4. No valid auth
  res.status(401).json({ success: false, error: "Authentication required" });
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  stripClientOrgHeaders(req);
  try {
    const userId = await resolveUserIdFromSpaces(req).catch(() => undefined);
    if (userId) {
      await ensureUserExists(userId, "require-auth").catch((err) => {
        log.warn(`[optional-auth] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
      });
      req.headers["x-user-id"] = userId;
      await attachOrgContext(req, userId);
    } else {
      const pinnedUserId = typeof req.headers["x-user-id"] === "string" ? req.headers["x-user-id"].trim() : "";
      if (pinnedUserId) await attachOrgContext(req, pinnedUserId);
    }
  } catch (err) {
    log.warn("[optional-auth] identity resolution failed:", err instanceof Error ? err.message : err);
  }
  next();
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
  stripClientOrgHeaders(req);
  const s2sKey = req.headers["x-s2s-key"] as string | undefined;
  if (s2sKeyMatches(s2sKey)) {
    const pinnedUserId = await canonicalizeS2SIdentity(req);
    if (pinnedUserId) {
      await attachOrgContext(req, pinnedUserId);
    }
    next();
    return;
  }

  const spacesIdentity = await resolveSpacesIdentityFromSpaces(req).catch(() => undefined);
  const userId = spacesIdentity?.userId;
  if (userId) {
    await ensureUserExists(userId, "require-auth").catch((err) => {
      log.warn(`[require-auth/s2s] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
    });
    const clawUserId = await resolveClawUserIdForSpacesIdentity(userId, spacesIdentity.workspaceId).catch((err) => {
      log.warn(`[require-auth/s2s] resolveClawUserIdForSpacesIdentity(${userId}) failed:`, err instanceof Error ? err.message : err);
      return undefined;
    });
    req.headers["x-spaces-user-id"] = userId;
    if (spacesIdentity.workspaceId) req.headers["x-spaces-workspace-id"] = spacesIdentity.workspaceId;
    if (spacesIdentity.orgMemberId) req.headers["x-spaces-org-member-id"] = spacesIdentity.orgMemberId;
    req.headers["x-user-id"] = clawUserId ?? userId;
    await attachOrgContext(req, clawUserId ?? userId);
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
 * Strict S2S using the Spaces↔claw-auth shared `INTERNAL_S2S_KEY` (the key the
 * Spaces backend uses for its own `/api/internal` routes and that claw-auth
 * sends when calling Spaces). Use this — NOT requireStrictS2S — for endpoints
 * whose caller is the Spaces backend rather than the claw runtime, since Spaces
 * does not hold `XYNE_CLAW_S2S_KEY`. Constant-time; fails closed when unset.
 */
export function requireInternalS2S(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const provided = req.headers["x-s2s-key"];
  const expected = process.env["INTERNAL_S2S_KEY"] ?? "";
  if (expected && typeof provided === "string") {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      next();
      return;
    }
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
  stripClientOrgHeaders(req);
  const spacesIdentity = await resolveSpacesIdentityFromSpaces(req).catch(() => undefined);
  const userId = spacesIdentity?.userId;
  if (!userId) {
    res.status(401).json({ success: false, error: "User session required" });
    return;
  }
  // `ensureUserExists` keys its caller arg off SpacesAuthCaller for query
  // logging; "require-auth" covers both this and the permissive variant.
  await ensureUserExists(userId, "require-auth").catch((err) => {
    log.warn(`[require-user-auth] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
  });
  const clawUserId = await resolveClawUserIdForSpacesIdentity(userId, spacesIdentity?.workspaceId).catch((err) => {
    log.warn(`[require-user-auth] resolveClawUserIdForSpacesIdentity(${userId}) failed:`, err instanceof Error ? err.message : err);
    return undefined;
  });
  req.headers["x-spaces-user-id"] = userId;
  if (spacesIdentity?.workspaceId) req.headers["x-spaces-workspace-id"] = spacesIdentity.workspaceId;
  if (spacesIdentity?.orgMemberId) req.headers["x-spaces-org-member-id"] = spacesIdentity.orgMemberId;
  req.headers["x-user-id"] = clawUserId ?? userId;
  await attachOrgContext(req, clawUserId ?? userId);
  next();
}

/**
 * Barrier middleware: reject requests whose identity came from a CLI/service
 * access token. Mount this AFTER requireAuth on routes that should only be
 * reachable by a browser session or a validated S2S key.
 *
 * This closes the bearer-token scope-enforcement gap: requireAuth accepts
 * xyne_cli_* / xyne_svc_* tokens, but most routes do not enforce scopes.
 * Only endpoints that explicitly understand scopes (currently /run) should
 * omit this barrier.
 */
export function requireNoAccessToken(_req: Request, res: Response, next: NextFunction): void {
  const token = accessTokenRegistry.get(res);
  if (token) {
    // Actionable on purpose: this endpoint worked for token callers before the
    // scope gap was closed, so a bare "not authorized" reads as a regression.
    // Name the token, the reason, and the two supported paths forward.
    log.warn(
      `[require-auth] access-token (${token.client ?? "unknown"}) rejected on non-/run route userId=${token.userId}`,
    );
    res.status(403).json({
      success: false,
      error:
        "This endpoint does not accept CLI/service access tokens (they carry no scopes here). " +
        "Use the /run API with a service token, or call this endpoint with a signed-in browser session.",
      code: "ACCESS_TOKEN_NOT_ALLOWED",
    });
    return;
  }
  next();
}

/**
 * Scope-aware variant of the barrier for routers that have READ endpoints the
 * CLI legitimately needs. Browser sessions and S2S pass untouched (no token in
 * the registry). An access token passes ONLY when BOTH hold:
 *   1. the request is a read (GET/HEAD) — token callers can never reach the
 *      router's write handlers through this mount, and
 *   2. the token carries `scope`.
 *
 * WHY THIS EXISTS: the #81 barrier closed the scope-enforcement gap by
 * blanket-rejecting access tokens everywhere except /run — which also broke
 * the CLI's own read paths (GET /runs/light, /runs/search, /runs/:id,
 * GET /agents). Device-flow CLI tokens are MINTED with agents:read/runs:read
 * (routes/cli-auth.ts SCOPES) but no route honored them; the barrier's own
 * error text ("they carry no scopes here") described the mount, not the token.
 * This middleware makes those minted read scopes mean something while keeping
 * the write surface exactly as locked as requireNoAccessToken left it.
 */
export function allowReadAccessToken(scope: string) {
  return function allowReadAccessTokenMw(req: Request, res: Response, next: NextFunction): void {
    const token = accessTokenRegistry.get(res);
    if (!token) {
      next();
      return;
    }
    const isRead = req.method === "GET" || req.method === "HEAD";
    if (isRead && token.scopes.includes(scope)) {
      next();
      return;
    }
    log.warn(
      `[require-auth] access-token (${token.client ?? "unknown"}) rejected: ` +
        `${req.method} needs ${isRead ? `scope ${scope}` : "a browser session (writes are session-only)"} userId=${token.userId}`,
    );
    res.status(403).json({
      success: false,
      error: isRead
        ? `This token does not have the ${scope} scope.`
        : "CLI/service access tokens are read-only here; sign in with a browser session for writes.",
      code: "ACCESS_TOKEN_NOT_ALLOWED",
    });
  };
}
