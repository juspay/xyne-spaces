/**
 * Egnyte OAuth routes for xyne-claw-auth.
 *
 * Egnyte MCP uses a standard OAuth 2.0 Authorization Code Grant with a
 * pre-registered App API Key (client_id / client_secret). Unlike Google /
 * Microsoft, the auth + token endpoints are **domain-scoped** — the user's
 * Egnyte domain (e.g. `acme.egnyte.com`) must be collected before the flow
 * starts and is stored alongside the tokens.
 *
 * Endpoints:
 *   POST /:userId/oauth/egnyte/authorize   → returns consent URL (signed state)
 *   POST /:userId/oauth/egnyte/callback    → programmatic code exchange
 *   GET  /egnyte/callback                  → browser-redirect callback
 *   GET  /:userId/oauth/egnyte/token       → fresh access token (refreshes if expired)
 *
 * `state` is HMAC-signed via lib/oauth-state.ts.
 * The user's `domain` is encoded into the signed state so the callback can
 * construct the correct token endpoint without a server-side session.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { syncToolsForServer } from "../tool-sync.js";
import { evictSession } from "../mcp/runner.js";
import { signOAuthState, verifyOAuthState, OAuthStateError } from "../lib/oauth-state.js";
import { defaultOAuthReturn, resolveOAuthReturn, withOAuthResult } from "../lib/oauth-return.js";
import { oauthLimiter } from "../middleware/rate-limiters.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { type OAuthTokenProvider, TokenRefreshError } from "../lib/oauth-token-endpoint.js";
import { asyncHandler, ok, badRequest, forbidden, HttpError } from "../lib/http.js";

import { createLogger } from "../logger.js";
const log = createLogger("egnyte-oauth");

function getEgnyteCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env["EGNYTE_CLIENT_ID"];
  const clientSecret = process.env["EGNYTE_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error("EGNYTE_CLIENT_ID and EGNYTE_CLIENT_SECRET are required");
  }
  return { clientId, clientSecret };
}

/** Egnyte auth endpoint — domain-scoped. */
function egnyteAuthUrl(domain: string): string {
  return `https://${domain}.egnyte.com/puboauth/token`;
}

/** Egnyte token endpoint — domain-scoped (same path as auth, POST). */
function egnyteTokenUrl(domain: string): string {
  return `https://${domain}.egnyte.com/puboauth/token`;
}

/** Default browser-callback URI. */
function defaultCallbackUri(): string {
  return `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/egnyte/callback`;
}

interface EgnyteTokens {
  accessToken: string;
  refreshToken: string;
  /** User's Egnyte domain without scheme, e.g. `acme.egnyte.com`. */
  domain: string;
  expires: number;
}

/** Ensures an "egnyte" McpServer row exists and is up-to-date. */
export async function ensureEgnyteServer() {
  const writeTools = [
    "create_folder",
    "upload_file",
    "set_file_metadata",
    "create_comment",
    "create_link",
  ];
  const healthcheckSpec = { name: "list_filesystem_by_path", params: { path: "/" } };
  return prisma.mcpServer.upsert({
    where: { type: "egnyte" },
    update: { writeToolPolicy: { mode: "allowlist", tools: writeTools }, healthcheckSpec, transport: "http", isOauth: true },
    create: {
      type: "egnyte",
      name: "Egnyte",
      url: "",
      description: "Egnyte content platform — search, manage, and collaborate on files and folders.",
      transport: "http",
      writeToolPolicy: { mode: "allowlist", tools: writeTools },
      healthcheckSpec,
      connectorMeta: { scope: "global", mode: "self-serve" },
      isOauth: true,
    },
  });
}

const router = Router();
router.use("/:userId", pinUserIdParam);

// ── Token endpoint ─────────────────────────────────────────────────────────

/**
 * Live Egnyte access-token provider for the shared `/oauth/:provider/token`
 * route (see lib/oauth-token-endpoint.ts). The token endpoint is per-tenant
 * (derived from the stored `domain`, which is also surfaced in the response so
 * the caller can route the MCP URL).
 */
export const egnyteOAuthProvider: OAuthTokenProvider = {
  serverType: "egnyte",
  label: "Egnyte",
  responseData: (creds) => ({ accessToken: creds.accessToken, domain: creds.domain }),
  async refresh(creds) {
    const c = creds as unknown as EgnyteTokens;
    const { clientId, clientSecret } = getEgnyteCredentials();

    const refreshRes = await fetch(egnyteTokenUrl(c.domain), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: c.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!refreshRes.ok) {
      throw new TokenRefreshError(502, `${refreshRes.status} ${await refreshRes.text()}`);
    }

    const tokens = (await refreshRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? c.refreshToken,
      domain: c.domain,
      // Egnyte tokens are typically valid for 3600 s; fall back if omitted.
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    };
  },
};

// ── Authorize endpoint ─────────────────────────────────────────────────────

/**
 * POST /:userId/oauth/egnyte/authorize
 * Body: { domain: string, redirectUri?: string }
 * Returns the Egnyte consent URL with an HMAC-signed `state` that includes the domain.
 */
router.post("/:userId/oauth/egnyte/authorize", oauthLimiter, asyncHandler(async (req: Request<{ userId: string }>, res: Response, next?: NextFunction) => {
  const { userId } = req.params;
  const { redirectUri, returnTo } = req.body as { redirectUri?: string; returnTo?: string };

  const envDomain = process.env["EGNYTE_DOMAIN"];
  if (!envDomain || envDomain.trim().length === 0) {
    throw new HttpError(500, "EGNYTE_DOMAIN is not configured on the server");
  }

  // Normalise — strip scheme and .egnyte.com suffix if someone put the full host in .env.
  const normalizedDomain = envDomain
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.egnyte\.com$/i, "");

  const { clientId } = getEgnyteCredentials();
  const callbackUri = redirectUri ?? defaultCallbackUri();

  // Encode the domain into the signed state so the callback can use it.
  const state = signOAuthState(userId, { domain: normalizedDomain, redirectUri: callbackUri, returnTo: resolveOAuthReturn(returnTo) });

  const authUrl = new URL(egnyteAuthUrl(normalizedDomain));
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callbackUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  ok(res, { authUrl: authUrl.toString() });
}));

// ── Programmatic callback (POST) ───────────────────────────────────────────

/**
 * POST /:userId/oauth/egnyte/callback
 * Programmatic code exchange — frontend passes code + state from the redirect URL.
 */
router.post("/:userId/oauth/egnyte/callback", asyncHandler(async (req: Request<{ userId: string }>, res: Response, next?: NextFunction) => {
  const { userId } = req.params;
  const { code, state } = req.body as { code?: string; state?: string };

  if (!code || !state) {
    throw badRequest("code and state are required");
  }

  let verified;
  try {
    verified = verifyOAuthState(state);
  } catch (err) {
    const reason = err instanceof OAuthStateError ? err.reason : "malformed";
    throw badRequest(`Invalid state (${reason})`);
  }

  if (verified.userId !== userId) {
    throw forbidden("State userId mismatch");
  }

  const domain = verified.extra?.["domain"] as string | undefined;
  const redirectUri = (verified.extra?.["redirectUri"] as string | undefined) ?? defaultCallbackUri();

  if (!domain) {
    throw badRequest("domain missing from state");
  }

  const result = await exchangeAndStore(userId, code, domain, redirectUri);
  if (!result.ok) {
    throw new HttpError(result.status, result.error);
  }

  ok(res, { message: "Egnyte account connected successfully" });
}));

// ── Browser-redirect callback (GET) ───────────────────────────────────────

/**
 * GET /egnyte/callback
 * Egnyte redirects here with ?code=...&state=<signed-state>.
 */
export const egnyteCallbackRouter = Router();

egnyteCallbackRouter.get("/egnyte/callback", async (req: Request, res: Response) => {
  // Default until the state verifies below — an unverified state must never
  // steer the redirect.
  let frontendUrl = defaultOAuthReturn();

  try {
    const { code, state, error: oauthError } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (oauthError) {
      log.error(`[egnyte-oauth] OAuth error: ${oauthError}`);
      res.redirect(withOAuthResult(frontendUrl, "egnyte_error", oauthError));
      return;
    }

    if (!code || !state) {
      res.redirect(withOAuthResult(frontendUrl, "egnyte_error", "missing_code_or_state"));
      return;
    }

    let verified;
    try {
      verified = verifyOAuthState(state);
    } catch (err) {
      const reason = err instanceof OAuthStateError ? err.reason : "malformed";
      log.error(`[egnyte-oauth] state ${reason}`);
      res.redirect(withOAuthResult(frontendUrl, "egnyte_error", "invalid_state"));
      return;
    }

    const userId = verified.userId;
    frontendUrl = resolveOAuthReturn(verified.extra?.["returnTo"]);
    const domain = verified.extra?.["domain"] as string | undefined;
    const redirectUri = (verified.extra?.["redirectUri"] as string | undefined) ?? defaultCallbackUri();

    if (!domain) {
      res.redirect(withOAuthResult(frontendUrl, "egnyte_error", "missing_domain_in_state"));
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      log.error(`[egnyte-oauth] User not found: ${userId}`);
      res.redirect(withOAuthResult(frontendUrl, "egnyte_error", "user_not_found"));
      return;
    }

    const result = await exchangeAndStore(userId, code, domain, redirectUri);
    if (!result.ok) {
      res.redirect(withOAuthResult(frontendUrl, "egnyte_error", result.code));
      return;
    }

    log.info(`[egnyte-oauth] Stored Egnyte credentials for user ${userId} (domain: ${domain}.egnyte.com)`);
    res.redirect(withOAuthResult(frontendUrl, "egnyte_connected", "true"));
  } catch (err) {
    log.error("[egnyte-oauth] browser callback error:", err);
    res.redirect(withOAuthResult(frontendUrl, "egnyte_error", "internal_error"));
  }
});

// ── Shared exchange + persist ─────────────────────────────────────────────

type ExchangeResult =
  | { ok: true }
  | { ok: false; status: number; code: string; error: string };

async function exchangeAndStore(
  userId: string,
  code: string,
  domain: string,
  redirectUri: string,
): Promise<ExchangeResult> {
  const { clientId, clientSecret } = getEgnyteCredentials();

  const tokenRes = await fetch(egnyteTokenUrl(domain), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    log.error(`[egnyte-oauth] Token exchange failed: ${tokenRes.status} ${text}`);
    return { ok: false, status: 502, code: "token_exchange_failed", error: "Egnyte token exchange failed" };
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!tokens.access_token) {
    return { ok: false, status: 502, code: "no_access_token", error: "Egnyte response missing access_token" };
  }

  await storeEgnyteTokens(userId, tokens.access_token, tokens.refresh_token ?? "", domain, tokens.expires_in ?? 3600);
  return { ok: true };
}

async function storeEgnyteTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  domain: string,
  expiresIn: number,
): Promise<void> {
  const creds: EgnyteTokens = {
    accessToken,
    refreshToken,
    domain,
    expires: Date.now() + expiresIn * 1000,
  };

  const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);
  const server = await ensureEgnyteServer();

  const existing = await prisma.userMcpConnection.findFirst({
    where: { userId, mcpServerId: server.id },
  });

  if (existing) {
    await prisma.userMcpConnection.update({
      where: { id: existing.id },
      data: { encryptedCreds: ciphertext, iv, authTag },
    });
  } else {
    await prisma.userMcpConnection.create({
      data: { userId, mcpServerId: server.id, encryptedCreds: ciphertext, iv, authTag },
    });
  }

  // Evict any stale MCP client so the next call uses the fresh token.
  await evictSession(userId, "egnyte").catch(() => {});

  syncToolsForServer(userId, "egnyte", server.name, { accessToken, refreshToken, domain }).catch((err) => {
    log.error(`[egnyte-oauth] tool sync failed for user ${userId}:`, err);
  });
}

export { router as egnyteOAuthRouter };
