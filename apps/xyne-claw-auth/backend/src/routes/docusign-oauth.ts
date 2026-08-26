/**
 * DocuSign OAuth routes for xyne-claw-auth.
 *
 * Standard OAuth 2.0 Authorization Code Grant against DocuSign's developer or
 * production identity service. Pattern mirrors Google / Microsoft, with one
 * extra step on callback: we hit /oauth/userinfo to discover the user's
 * accountId + base_uri (DocuSign returns multiple accounts; we pick the
 * default) and store both alongside the tokens.
 *
 * Endpoints:
 *   POST /:userId/oauth/docusign/authorize     → returns consent URL (signed state)
 *   POST /:userId/oauth/docusign/callback      → programmatic code exchange
 *   GET  /docusign/callback                    → browser-redirect callback
 *   GET  /:userId/oauth/docusign/token         → fresh access token (refreshes if expired)
 *
 * `state` is HMAC-signed via lib/oauth-state.ts so an attacker can't trigger a
 * callback for an arbitrary userId.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { syncToolsForServer } from "../tool-sync.js";
import { evictSession } from "../mcp/runner.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { type OAuthTokenProvider, TokenRefreshError } from "../lib/oauth-token-endpoint.js";
import {
  DOCUSIGN_AUTH_URL,
  DOCUSIGN_TOKEN_URL,
  DOCUSIGN_USERINFO_URL,
  docuSignBasicAuthHeader,
  getDocuSignClientCredentials,
} from "../lib/docusign-config.js";
import { signOAuthState, verifyOAuthState, OAuthStateError } from "../lib/oauth-state.js";
import { asyncHandler, ok, badRequest, forbidden, HttpError } from "../lib/http.js";

import { createLogger } from "../logger.js";
const log = createLogger("docusign-oauth");

const DOCUSIGN_SCOPES = [
  "signature",
  "extended",
  "aow_manage",
  "account_product_read",
].join(" ");

interface DocuSignTokens {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  /** DocuSign per-account API host, e.g. https://na2.docusign.net. Used to route the MCP URL. */
  baseUri: string | undefined;
  expires: number;
}

/** Default callback URI used by both authorize + token-exchange. */
function defaultCallbackUri(): string {
  return `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/docusign/callback`;
}

/** Ensures a "docusign" McpServer row exists and is up-to-date. */
export async function ensureDocuSignServer() {
  const writeToolPolicy = {
    mode: "allowlist",
    tools: [
      "createEnvelope",
      "updateEnvelope",
      "triggerWorkflow",
      "cancelWorkflowInstance",
      "pauseNewWorkflowInstances",
      "resumeWorkflow",
      "installDVApps",
    ],
  };
  const healthcheckSpec = { name: "getUserInfo", params: {} };
  return prisma.mcpServer.upsert({
    where: { type: "docusign" },
    update: { writeToolPolicy, healthcheckSpec, transport: "http", isOauth: true },
    create: {
      type: "docusign",
      name: "DocuSign",
      url: "",
      description: "DocuSign eSignature integration — send, sign, and manage documents and envelopes.",
      transport: "http",
      writeToolPolicy,
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
 * Live DocuSign access-token provider for the shared `/oauth/:provider/token`
 * route (see lib/oauth-token-endpoint.ts). DocuSign refreshes with HTTP Basic
 * auth and the response surfaces accountId + baseUri alongside the token so the
 * caller can route the per-account MCP URL.
 */
export const docusignOAuthProvider: OAuthTokenProvider = {
  serverType: "docusign",
  label: "DocuSign",
  responseData: (creds) => ({
    accessToken: creds.accessToken,
    accountId: creds.accountId,
    baseUri: creds.baseUri,
  }),
  async refresh(creds) {
    const c = creds as unknown as DocuSignTokens;
    const { clientId, clientSecret } = getDocuSignClientCredentials();

    const refreshRes = await fetch(DOCUSIGN_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: docuSignBasicAuthHeader(clientId, clientSecret),
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: c.refreshToken,
      }),
    });

    if (!refreshRes.ok) {
      throw new TokenRefreshError(502, `${refreshRes.status} ${await refreshRes.text()}`);
    }

    const tokens = (await refreshRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      accessToken: tokens.access_token,
      // Defend against responses that omit refresh_token so we don't wipe the
      // only credential that lets us recover.
      refreshToken: tokens.refresh_token ?? c.refreshToken,
      accountId: c.accountId,
      baseUri: c.baseUri,
      expires: Date.now() + tokens.expires_in * 1000,
    };
  },
};

// ── Authorize endpoint ─────────────────────────────────────────────────────

/**
 * POST /:userId/oauth/docusign/authorize
 * Returns the DocuSign consent URL with an HMAC-signed `state`.
 */
router.post("/:userId/oauth/docusign/authorize", asyncHandler(async (req: Request<{ userId: string }>, res: Response, next?: NextFunction) => {
  const { userId } = req.params;
  const { redirectUri } = req.body as { redirectUri?: string };

  const callbackUri = redirectUri ?? defaultCallbackUri();

  const { clientId } = getDocuSignClientCredentials();

  const authUrl = new URL(DOCUSIGN_AUTH_URL);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", callbackUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", DOCUSIGN_SCOPES);
  authUrl.searchParams.set("state", signOAuthState(userId, { redirectUri: callbackUri }));

  ok(res, { authUrl: authUrl.toString() });
}));

// ── Programmatic callback (POST) ───────────────────────────────────────────

/**
 * POST /:userId/oauth/docusign/callback
 * Programmatic exchange — frontend passes code + state from the redirect URL.
 */
router.post("/:userId/oauth/docusign/callback", asyncHandler(async (req: Request<{ userId: string }>, res: Response, next?: NextFunction) => {
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

  const redirectUri = (verified.extra?.["redirectUri"] as string | undefined) ?? defaultCallbackUri();
  const result = await exchangeAndStore(userId, code, redirectUri);
  if (!result.ok) {
    throw new HttpError(result.status, result.error);
  }

  ok(res, { message: "DocuSign account connected successfully" });
}));

// ── Browser-redirect callback (GET) ───────────────────────────────────────

/**
 * GET /docusign/callback
 * DocuSign redirects here with ?code=...&state=<signed-state>.
 */
export const docusignCallbackRouter = Router();

docusignCallbackRouter.get("/docusign/callback", async (req: Request, res: Response) => {
  const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5174/claw/";

  try {
    const { code, state, error: oauthError } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (oauthError) {
      log.error(`[docusign-oauth] OAuth error: ${oauthError}`);
      res.redirect(`${frontendUrl}?docusign_error=${encodeURIComponent(oauthError)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}?docusign_error=missing_code_or_state`);
      return;
    }

    let verified;
    try {
      verified = verifyOAuthState(state);
    } catch (err) {
      const reason = err instanceof OAuthStateError ? err.reason : "malformed";
      log.error(`[docusign-oauth] state ${reason}`);
      res.redirect(`${frontendUrl}?docusign_error=invalid_state`);
      return;
    }

    const userId = verified.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      log.error(`[docusign-oauth] User not found: ${userId}`);
      res.redirect(`${frontendUrl}?docusign_error=user_not_found`);
      return;
    }

    const redirectUri = (verified.extra?.["redirectUri"] as string | undefined) ?? defaultCallbackUri();
    const result = await exchangeAndStore(userId, code, redirectUri);
    if (!result.ok) {
      res.redirect(`${frontendUrl}?docusign_error=${encodeURIComponent(result.code)}`);
      return;
    }

    log.info(`[docusign-oauth] Stored DocuSign credentials for user ${userId} (accountId: ${result.accountId})`);
    res.redirect(`${frontendUrl}?docusign_connected=true`);
  } catch (err) {
    log.error("[docusign-oauth] browser callback error:", err);
    res.redirect(`${frontendUrl}?docusign_error=internal_error`);
  }
});

// ── Shared exchange + persist ─────────────────────────────────────────────

type ExchangeResult =
  | { ok: true; accountId: string }
  | { ok: false; status: number; code: string; error: string };

async function exchangeAndStore(userId: string, code: string, redirectUri: string): Promise<ExchangeResult> {
  const { clientId, clientSecret } = getDocuSignClientCredentials();

  const tokenRes = await fetch(DOCUSIGN_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: docuSignBasicAuthHeader(clientId, clientSecret),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    log.error(`[docusign-oauth] Token exchange failed: ${tokenRes.status} ${text}`);
    return { ok: false, status: 502, code: "token_exchange_failed", error: "DocuSign token exchange failed" };
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  // DocuSign returns one or more accounts on /oauth/userinfo. We pick the
  // default; if a user has multiple accounts they'll need account-picker UX
  // (out of scope here). At minimum, log a warning so we know it happened.
  const userInfoRes = await fetch(DOCUSIGN_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoRes.ok) {
    log.error(`[docusign-oauth] userinfo fetch failed: ${userInfoRes.status}`);
    return { ok: false, status: 502, code: "userinfo_failed", error: "DocuSign /oauth/userinfo failed" };
  }

  const userInfo = await userInfoRes.json() as {
    sub: string;
    accounts: Array<{ account_id: string; is_default: boolean; base_uri: string }>;
  };

  const account = userInfo.accounts.find(a => a.is_default) ?? userInfo.accounts[0];
  if (!account) {
    log.error(`[docusign-oauth] No account found in userinfo for user ${userId}`);
    return { ok: false, status: 400, code: "no_account_found", error: "DocuSign returned no accounts" };
  }
  if (userInfo.accounts.length > 1) {
    log.warn(`[docusign-oauth] User ${userId} has ${userInfo.accounts.length} DocuSign accounts; picked ${account.account_id}`);
  }

  await storeDocuSignTokens(
    userId,
    tokens.access_token,
    tokens.refresh_token,
    account.account_id,
    account.base_uri,
    tokens.expires_in,
  );

  return { ok: true, accountId: account.account_id };
}

async function storeDocuSignTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  accountId: string,
  baseUri: string | undefined,
  expiresIn: number,
): Promise<void> {
  const creds: DocuSignTokens = {
    accessToken,
    refreshToken,
    accountId,
    baseUri,
    expires: Date.now() + expiresIn * 1000,
  };

  const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);
  const server = await ensureDocuSignServer();

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

  // Token rotation invalidates any cached MCP client for this user.
  await evictSession(userId, "docusign").catch(() => {});

  // Sync tools from the DocuSign MCP process into the DB.
  syncToolsForServer(userId, "docusign", server.name, { accessToken, refreshToken, accountId, baseUri }).catch((err) => {
    log.error(`[docusign-oauth] tool sync failed for user ${userId}:`, err);
  });
}

export { router as docusignOAuthRouter };
