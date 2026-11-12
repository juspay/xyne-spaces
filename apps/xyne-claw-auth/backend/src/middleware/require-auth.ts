import type { Request, Response, NextFunction } from "express";
import { CONFIG } from "../config.js";
import { ensureUserExists, resolveClawUserIdForSpacesIdentity } from "../lib/users-jit.js";
import { authenticateCaller } from "../lib/service-assertion.js";
import { checkResultCallbackToken, verifySessionToken } from "../lib/session-tokens.js";
import { DELEGATION_HEADER, verifySpacesDelegation } from "../lib/spaces-delegation.js";
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
 * Called only after the caller's identity is authenticated: from the Spaces
 * session, a CLI token, a Spaces delegation token or a run token.
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
 * Strip inbound org-context and Spaces-identity headers so a client can NEVER
 * inject them. `x-org-id` / `x-user-role` are derived SERVER-SIDE (by
 * `attachOrgContext` on a verified session); the `x-spaces-*` headers are stamped
 * only by VERIFIED branches below (cookie /me success, a delegation token or a run
 * token, via stampVerifiedIdentity). A client supplying any of them is attempting
 * to spoof identity/org context.
 *
 * Removing them at entry makes identity and org context fail-CLOSED: e.g. a
 * CLI/service-token request carrying a forged `x-spaces-user-id` can no longer
 * impersonate that user through matchesAuthenticatedUserId / getRequesterAliases,
 * and a failed/absent org attach yields an EMPTY org (→ getOrgId undefined → safe
 * no-match) rather than an attacker-chosen org. x-user-id is removed too: every
 * branch that authenticates a user sets it from the verified source.
 */
function stripClientOrgHeaders(req: Request): void {
  delete req.headers["x-user-id"];
  delete req.headers["x-org-id"];
  delete req.headers["x-user-role"];
  delete req.headers["x-spaces-user-id"];
  delete req.headers["x-spaces-workspace-id"];
  delete req.headers["x-spaces-org-member-id"];
}

// Memoize the Spaces /api/auth/me lookup per request. Routes now stack
// mount-level auth (main.ts) with per-route auth (defense-in-depth), and
// without this each layer would re-fetch /me for the same request.
const SPACES_IDENTITY = Symbol("spacesIdentity");

/** Identity lookups are on the hot path of every cookie-authed request, so the
 *  budget stays short. Env-tunable because the right value depends on how
 *  loaded the Spaces pods are, and raising it should not need a code change. */
const SPACES_ME_TIMEOUT_MS = Math.max(
  500,
  Number(process.env["SPACES_ME_TIMEOUT_MS"]) || 5000,
);

/** `fetch`'s Response, aliased so it isn't shadowed by Express's `Response`. */
type Response_ = Awaited<ReturnType<typeof fetch>>;

/**
 * The outcome of asking Spaces who the caller is.
 *
 * The three cases MUST stay distinct. Collapsing "we could not reach Spaces"
 * into "this caller is not authenticated" is what logs real users out: the
 * browser sees a 401 from its own origin and the dashboard's axios interceptor
 * (apps/dashboard/src/services/clients/apiClient.ts) responds by clearing auth
 * tokens and redirecting to /auth. A `/claw/*` request that merely timed out
 * would end a healthy session.
 */
type SpacesIdentity =
  | ({ kind: "user" } & VerifiedSpacesIdentity)
  /** Spaces answered, and the answer was "nobody" — a real auth failure. */
  | { kind: "anonymous" }
  /** Spaces could not be asked (timeout / network / 5xx). Says NOTHING about
   *  whether the caller is authenticated, so it must never become a 401. */
  | { kind: "unavailable"; reason: string };

async function resolveSpacesIdentity(req: Request): Promise<SpacesIdentity> {
  const cached = (req as unknown as Record<symbol, SpacesIdentity | undefined>)[SPACES_IDENTITY];
  if (cached !== undefined) return cached;

  const identity = await resolveSpacesIdentityUncached(req);
  (req as unknown as Record<symbol, SpacesIdentity | undefined>)[SPACES_IDENTITY] = identity;
  return identity;
}

async function resolveSpacesIdentityUncached(req: Request): Promise<SpacesIdentity> {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return { kind: "anonymous" };

  const headers: Record<string, string> = {
    cookie: cookieHeader,
  };

  const workspaceId = req.headers["x-workspace-id"];
  if (typeof workspaceId === "string" && workspaceId.trim()) {
    headers["x-workspace-id"] = workspaceId.trim();
  }

  let res: Response_;
  try {
    res = await fetch(`${CONFIG.spacesInternalUrl}/api/auth/me`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(SPACES_ME_TIMEOUT_MS),
    });
  } catch (err) {
    // AbortError (the timeout) or a transport failure. Previously this threw
    // into a `.catch(() => undefined)` at every call site and became a 401.
    const reason = err instanceof Error && err.name === "TimeoutError" ? "timeout" : "unreachable";
    log.warn(`[require-auth] /api/auth/me ${reason}: ${err instanceof Error ? err.message : String(err)}`);
    return { kind: "unavailable", reason };
  }

  // 401/403 is Spaces actively saying "not you" — the only non-2xx that is a
  // real authentication answer. 5xx/429 mean the auth service is degraded and
  // the caller's session is simply unknown.
  if (res.status === 401 || res.status === 403) return { kind: "anonymous" };
  if (!res.ok) {
    log.warn(`[require-auth] /api/auth/me upstream ${res.status}`);
    return { kind: "unavailable", reason: `upstream_${res.status}` };
  }

  const body = (await res.json().catch(() => null)) as SpacesMeResponse | null;
  const userId = body?.user?.id;
  if (typeof userId !== "string" || !userId.trim()) return { kind: "anonymous" };
  return {
    kind: "user",
    userId: userId.trim(),
    ...(typeof body?.user?.workspaceId === "string" && body.user.workspaceId.trim()
      ? { workspaceId: body.user.workspaceId.trim() }
      : {}),
    ...(typeof body?.user?.memberId === "string" && body.user.memberId.trim()
      ? { orgMemberId: body.user.memberId.trim() }
      : {}),
  };
}

/** Back-compat shim for call sites that only care whether a user resolved. */
async function resolveUserIdFromSpaces(req: Request): Promise<string | undefined> {
  const identity = await resolveSpacesIdentity(req);
  return identity.kind === "user" ? identity.userId : undefined;
}

/**
 * Terminal response for a request that produced no identity.
 *
 * 503 when Spaces could not be reached: the caller may well be perfectly
 * logged in, so this is a liveness failure and must not read as an auth
 * failure. `Retry-After` tells well-behaved clients to come back rather than
 * treat it as terminal.
 */
function denyUnverified(res: Response, identity: SpacesIdentity, unauthorizedMessage: string): void {
  if (identity.kind === "unavailable") {
    res.setHeader("Retry-After", "1");
    res.status(503).json({
      success: false,
      error: "Authentication service unavailable",
      code: "AUTH_UPSTREAM_UNAVAILABLE",
      reason: identity.reason,
    });
    return;
  }
  res.status(401).json({ success: false, error: unauthorizedMessage });
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
 * Stamp a VERIFIED Spaces session identity onto the request: the canonical Claw
 * id in `x-user-id`, the raw workspace identity retained on the `x-spaces-*` side
 * headers, then phase-1 org context. Call only after the cookie session has been
 * authenticated by Spaces /api/auth/me — from here on the `x-spaces-*` headers
 * are server-asserted (entry stripping removed any client-supplied copies).
 * Resolution failures degrade to the raw Spaces id rather than breaking the
 * request (historic fail-open behavior); `logPrefix` tags that warn path.
 */
async function stampVerifiedIdentity(
  req: Request,
  identity: VerifiedSpacesIdentity | undefined,
  logPrefix: string,
): Promise<void> {
  const userId = identity?.userId;
  if (!userId) return;
  // /auth/me has already authenticated the cookie and selected its active
  // workspace. Use that verified value—not the inbound header—to resolve the
  // workspace-scoped source identity to the canonical Claw user.
  const clawUserId = await resolveClawUserIdForSpacesIdentity(userId, identity?.workspaceId).catch((err) => {
    log.warn(`${logPrefix} resolveClawUserIdForSpacesIdentity(${userId}) failed:`, err instanceof Error ? err.message : err);
    return undefined;
  });
  req.headers["x-spaces-user-id"] = userId;
  if (identity?.workspaceId) req.headers["x-spaces-workspace-id"] = identity.workspaceId;
  if (identity?.orgMemberId) req.headers["x-spaces-org-member-id"] = identity.orgMemberId;
  req.headers["x-user-id"] = clawUserId ?? userId;
  // Phase-1 org context (additive; requireAuth family only).
  await attachOrgContext(req, clawUserId ?? userId);
}

/** Drop every caller-supplied user/identity header: the request then names no user. */
function clearUserPin(req: Request): void {
  delete req.headers["x-user-id"];
  delete req.headers["x-spaces-user-id"];
  delete req.headers["x-spaces-workspace-id"];
  delete req.headers["x-spaces-org-member-id"];
}

/**
 * Identity from a signed token, or undefined when the request carries none.
 *
 * - `x-spaces-delegation`: ES256 JWT minted by the Spaces backend for one user
 *   and one action (lib/spaces-delegation.ts). The user is its `sub`.
 * - `x-session-token` together with a valid runtime service assertion: the run
 *   token claw-auth mints for each run (lib/session-tokens.ts). The user is its
 *   `uid` (already a canonical Claw id).
 *
 * Returns "rejected" when a token is present but fails verification.
 */
async function resolveSignedIdentity(req: Request): Promise<"rejected" | "unavailable" | "delegation" | "run-token" | undefined> {
  const delegationRaw = headerValue(req, DELEGATION_HEADER);
  if (delegationRaw) {
    const delegation = await verifySpacesDelegation(delegationRaw);
    if (typeof delegation === "string") {
      log.warn(`[require-auth] delegation token rejected (${delegation}) ${req.method} ${req.originalUrl ?? req.url}`);
      return "rejected";
    }
    clearUserPin(req);
    await ensureUserExists(delegation.spacesUserId, "require-auth").catch((err) => {
      log.warn(`[require-auth] ensureUserExists(${delegation.spacesUserId}) for delegation failed:`, err instanceof Error ? err.message : err);
    });
    await stampVerifiedIdentity(
      req,
      { userId: delegation.spacesUserId, ...(delegation.workspaceId ? { workspaceId: delegation.workspaceId } : {}) },
      "[require-auth:delegation]",
    );
    log.debug?.(`[require-auth] delegation kid=${delegation.keyId} jti=${delegation.jti ?? "-"} purpose=${delegation.purpose ?? "-"}`);
    return "delegation";
  }

  const runTokenRaw = headerValue(req, "x-session-token");
  if (runTokenRaw) {
    // A run token names the user only on a call that also proves it comes from
    // the Claw runtime (or claw-auth itself): a signed service assertion.
    // Neither alone is enough, so a run token copied out of a run is not a
    // general bearer.
    const caller = await authenticateCaller(req, ["xyne-claw", "xyne-claw-auth"]);
    if (caller === "unavailable") return "unavailable";
    if (caller === "missing" || caller === "rejected") {
      log.warn(`[require-auth] run token without a runtime service assertion rejected ${req.method} ${req.originalUrl ?? req.url}`);
      return "rejected";
    }
    const run = verifySessionToken(runTokenRaw);
    if (typeof run === "string") {
      log.warn(`[require-auth] run token rejected (${run}) ${req.method} ${req.originalUrl ?? req.url}`);
      return "rejected";
    }
    clearUserPin(req);
    req.headers["x-user-id"] = run.uid;
    req.session = {
      userId: run.uid,
      sessionId: run.sid,
      ...(run.aslug ? { agentSlug: run.aslug } : {}),
      ...(run.appid ? { spacesAppId: run.appid } : {}),
    };
    await attachOrgContext(req, run.uid);
    return "run-token";
  }
  return undefined;
}

/**
 * Express middleware that verifies the caller's identity.
 *
 * Accepts auth via (in priority order):
 * 1. Spaces backend auth middleware via /api/auth/me (cookie-based)
 * 2. CLI/service access token via `Authorization: Bearer xyne_cli_...` or
 *    `xyne_svc_...` when CLI_TOKENS_ENABLED is on
 * 3. A signed identity token: `x-spaces-delegation` (Spaces-signed, per user and
 *    action) or `x-session-token` (claw-auth run token). The user comes from the
 *    token only.
 * 4. A service assertion (lib/service-assertion.ts) from the runtime, Spaces or
 *    claw-auth itself, with no user token: authenticates the service and names
 *    no user (every caller-supplied identity header is dropped).
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
  const identity = await resolveSpacesIdentity(req);
  const spacesIdentity = identity.kind === "user" ? identity : undefined;
  const userId = spacesIdentity?.userId;
  if (userId) {
    // JIT-mirror the user row from Spaces if we've never seen them. Lets a
    // brand-new Spaces user hit any claw-auth route without first POSTing
    // /users from the SPA. Silent no-op if the Spaces directory lookup misses or the
    // user row already exists.
    await ensureUserExists(userId, "require-auth").catch((err) => {
      log.warn(`[require-auth] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
    });
    await stampVerifiedIdentity(req, spacesIdentity, "[require-auth]");
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

  // 3. Signed identity: a Spaces delegation token or a claw-auth run token names
  // the user; no header or body field the caller chose can. A token that is
  // present but invalid is rejected outright.
  const signed = await resolveSignedIdentity(req);
  if (signed === "unavailable") {
    res.status(503).json({ success: false, error: "Service authentication unavailable" });
    return;
  }
  if (signed === "rejected") {
    res.status(401).json({ success: false, error: "Invalid or expired identity token" });
    return;
  }
  if (signed) {
    next();
    return;
  }

  // 4. A service with no user: proves which service is calling, names no user.
  const service = await authenticateCaller(req, ["xyne-claw", "xyne-spaces", "xyne-claw-auth"]);
  if (service === "unavailable") {
    res.status(503).json({ success: false, error: "Service authentication unavailable" });
    return;
  }
  if (service !== "missing" && service !== "rejected") {
    clearUserPin(req);
    next();
    return;
  }

  // 5. No valid auth. A Spaces lookup that never completed is reported as 503,
  // not 401 — see denyUnverified.
  denyUnverified(res, identity, "Authentication required");
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  stripClientOrgHeaders(req);
  try {
    const identity = await resolveSpacesIdentity(req).catch(() => undefined);
    const spacesIdentity = identity?.kind === "user" ? identity : undefined;
    const userId = spacesIdentity?.userId;
    if (userId) {
      await ensureUserExists(userId, "require-auth").catch((err) => {
        log.warn(`[optional-auth] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
      });
      // Mirror requireAuth: stamp the canonical Claw id in x-user-id and keep
      // the raw workspace identity on the side headers, so downstream handlers
      // and org context never see the raw Spaces id as a Claw key.
      await stampVerifiedIdentity(req, spacesIdentity, "[optional-auth]");
    } else {
      // No verified identity: strip the client-supplied x-user-id so downstream
      // getRequesterId()/getOrgId() see an anonymous caller instead of an
      // attacker-chosen one. Mirrors stripClientOrgHeaders (fail-closed). The
      // review_room org gate on the public design-share router relied on this
      // header being trustworthy — it is client-controlled until a verified
      // session/CLI token overwrites it, so an unauthenticated spoof must not
      // survive optionalAuth.
      delete req.headers["x-user-id"];
    }
  } catch (err) {
    log.warn("[optional-auth] identity resolution failed:", err instanceof Error ? err.message : err);
  }
  next();
}

/**
 * For routes the runtime calls on behalf of a run's user: the caller must be
 * the runtime (or claw-auth) by service assertion, and the user comes only from
 * the run's session token (`x-session-token`), which claw-auth issued. Sets
 * x-user-id and req.session from the token. Use after (or instead of)
 * requireRuntime; it verifies the assertion itself if not already done.
 */
export async function requireRunUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const caller = await authenticateCaller(req, ["xyne-claw", "xyne-claw-auth"]);
  if (caller === "unavailable") {
    res.status(503).json({ success: false, error: "Service authentication unavailable" });
    return;
  }
  if (caller === "missing" || caller === "rejected") {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }
  const run = verifySessionToken(headerValue(req, "x-session-token") ?? "");
  if (typeof run === "string") {
    log.warn(`[require-run-user] run token rejected (${run}) ${req.method} ${req.originalUrl ?? req.url}`);
    res.status(401).json({ success: false, error: "Run token required" });
    return;
  }
  clearUserPin(req);
  req.headers["x-user-id"] = run.uid;
  req.session = {
    userId: run.uid,
    sessionId: run.sid,
    ...(run.aslug ? { agentSlug: run.aslug } : {}),
    ...(run.appid ? { spacesAppId: run.appid } : {}),
  };
  await attachOrgContext(req, run.uid);
  next();
}

/**
 * Per-run authentication for pod result callbacks. Layered AFTER requireRuntime:
 * the service assertion proves "the runtime sent this", this proves "for THIS run". The
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
 * Rejects service assertions and run tokens.
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
  const identity = await resolveSpacesIdentity(req);
  const spacesIdentity = identity.kind === "user" ? identity : undefined;
  const userId = spacesIdentity?.userId;
  if (!userId) {
    denyUnverified(res, identity, "User session required");
    return;
  }
  // `ensureUserExists` keys its caller arg off SpacesAuthCaller for query
  // logging; "require-auth" covers both this and the permissive variant.
  await ensureUserExists(userId, "require-auth").catch((err) => {
    log.warn(`[require-user-auth] ensureUserExists(${userId}) failed:`, err instanceof Error ? err.message : err);
  });
  await stampVerifiedIdentity(req, spacesIdentity, "[require-user-auth]");
  next();
}

/**
 * Barrier middleware: reject requests whose identity came from a CLI/service
 * access token. Mount this AFTER requireAuth on routes that should only be
 * reachable by a browser session or a verified service.
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
 * Write-capable variant. An access token passes ONLY when ALL hold:
 *   1. the method is POST,
 *   2. the path is one of `paths` (matched against the router-relative path,
 *      so "/" is the collection create and nothing else), and
 *   3. the token carries `scope`.
 *
 * Everything else with a token in the registry is rejected exactly as
 * requireNoAccessToken would. The path allowlist is the point: `agents:write`
 * must not also unlock POST /:slug/promote, /:slug/shares or /:slug/tools,
 * which are far more dangerous than creating a new personal agent.
 *
 * `read` is optional and covers GET/HEAD on the same mount, so a router
 * needing both barriers uses this one alone rather than stacking two.
 */
export function allowScopedAccessToken(opts: {
  read?: string;
  write: string;
  writePaths?: readonly string[];
}) {
  const allowedPaths = new Set(opts.writePaths ?? ["/"]);
  return function allowScopedAccessTokenMw(req: Request, res: Response, next: NextFunction): void {
    const token = accessTokenRegistry.get(res);
    if (!token) {
      next();
      return;
    }
    const routerPath = req.path === "" ? "/" : req.path;
    if (opts.read && (req.method === "GET" || req.method === "HEAD")) {
      if (token.scopes.includes(opts.read)) {
        next();
        return;
      }
      res.status(403).json({
        success: false,
        error: `This token does not have the ${opts.read} scope.`,
        code: "ACCESS_TOKEN_NOT_ALLOWED",
      });
      return;
    }
    const isAllowedWrite = req.method === "POST" && allowedPaths.has(routerPath);
    const scope = opts.write;
    if (isAllowedWrite && token.scopes.includes(scope)) {
      log.info(
        `[require-auth] access-token (${token.client ?? "unknown"}) accepted scope=${scope} ${req.method} ${routerPath} userId=${token.userId}`,
      );
      next();
      return;
    }
    log.warn(
      `[require-auth] access-token (${token.client ?? "unknown"}) rejected: ` +
        `${req.method} ${routerPath} needs ${isAllowedWrite ? `scope ${scope}` : "a browser session"} userId=${token.userId}`,
    );
    res.status(403).json({
      success: false,
      error: isAllowedWrite
        ? `This token does not have the ${scope} scope.`
        : "CLI/service access tokens may only create here; other writes need a browser session.",
      code: "ACCESS_TOKEN_NOT_ALLOWED",
    });
  };
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
