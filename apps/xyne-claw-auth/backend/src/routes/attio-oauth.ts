/**
 * Attio OAuth routes for xyne-claw-auth.
 *
 * Attio MCP uses OAuth 2.1 with Dynamic Client Registration (DCR, RFC 7591)
 * and PKCE (S256). It is a public client (token_endpoint_auth_method: none) —
 * no pre-registered client_id / client_secret, identical pattern to Calendly,
 * JotForm, Webflow, and Wix.
 *
 * Discovery: https://mcp.attio.com/.well-known/oauth-authorization-server
 *   issuer:                  https://app.attio.com
 *   authorization_endpoint:  https://app.attio.com/oidc/authorize
 *   token_endpoint:          https://app.attio.com/oidc/token
 *   registration_endpoint:   https://app.attio.com/oauth/register
 *   token_endpoint_auth:     none (public client)
 *   PKCE:                    S256
 *   Scopes:                  mcp offline_access
 *
 * Flow:
 *   1. POST /:userId/oauth/attio/authorize
 *      - Runs DCR to obtain a client_id from Attio.
 *      - Generates a PKCE code_verifier + code_challenge.
 *      - Encodes { userId, clientId, codeVerifier, redirectUri } in the state
 *        parameter (base64url) so no server-side session is needed.
 *      - Returns the Attio consent URL for the frontend to redirect to.
 *
 *   2. GET /attio/callback
 *      - Browser-redirect callback from Attio consent screen.
 *      - Decodes state to recover userId, clientId, codeVerifier, redirectUri.
 *      - Exchanges the authorization code for tokens using PKCE (no secret).
 *      - Stores encrypted { clientId, accessToken, refreshToken, expires } in
 *        UserMcpConnection (type: "attio").
 *      - Redirects to the frontend with ?attio_connected=true.
 *
 *   3. GET /:userId/oauth/attio/token
 *      - Returns a valid Attio access token (refreshes if expired).
 *      - Called by xyne-claw before running attio-agent tasks.
 */

import { randomBytes, createHash } from "crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { syncToolsForServer } from "../tool-sync.js";
import { evictSession } from "../mcp/runner.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { type OAuthTokenProvider, TokenRefreshError } from "../lib/oauth-token-endpoint.js";
import { signOAuthState, verifyOAuthState } from "../lib/oauth-state.js";

import { createLogger } from "../logger.js";
const log = createLogger("attio-oauth");

const ATTIO_REGISTER_URL = "https://app.attio.com/oauth/register";
const ATTIO_AUTH_URL = "https://app.attio.com/oidc/authorize";
const ATTIO_TOKEN_URL = "https://app.attio.com/oidc/token";

interface AttioTokens {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expires: number;
}

interface StatePayload {
  userId: string;
  clientId: string;
  codeVerifier: string;
  redirectUri: string;
}

// HMAC-signed state — prevents an attacker from forging state={userId:victim}
// to bind their provider account to a victim (or capture victim tokens).
function encodeState(payload: StatePayload): string {
  const { userId, ...extra } = payload;
  return signOAuthState(userId, extra);
}

function decodeState(state: string): StatePayload {
  // Throws OAuthStateError on tampered/expired state; callers try/catch this.
  const verified = verifyOAuthState(state);
  return { userId: verified.userId, ...(verified.extra ?? {}) } as StatePayload;
}

/** Generates a PKCE code verifier (43 random url-safe bytes). */
function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** Derives the S256 code challenge from a verifier. */
function deriveCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Performs DCR and returns the dynamically issued client_id. */
async function registerAttioClient(redirectUri: string): Promise<string> {
  const res = await fetch(ATTIO_REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Xyne Claw",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Attio DCR failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { client_id: string };
  return data.client_id;
}

/** Ensures an "attio" McpServer row exists, creating it if necessary. */
async function ensureAttioServer() {
  const existing = await prisma.mcpServer.findUnique({ where: { type: "attio" } });
  if (existing) return existing;
  return prisma.mcpServer.create({
    data: {
      type: "attio",
      name: "Attio",
      url: "https://mcp.attio.com/mcp",
      description: "Attio integration — manage CRM records, contacts, companies, deals, tasks, notes, and meetings.",
      transport: "http",
      writeToolPolicy: {
        mode: "allowlist",
        tools: [
          "add-record-to-list",
          "create-comment",
          "create-note",
          "create-record",
          "create-task",
          "delete-comment",
          "update-list",
          "update-list-entry-by-id",
          "update-list-entry-by-record-id",
          "update-note",
          "update-record",
          "update-task",
          "upsert-record",
        ],
      },
      healthcheckSpec: { name: "whoami", params: {} },
      connectorMeta: { scope: "global", mode: "self-serve" },
    },
  });
}

const router = Router();

// CSRF / IDOR guard — see miro-oauth.ts for the rationale. The `/:userId`
// path param must match the requester's session userId or pinUserIdParam
// rejects with 403. requireAuth (at the mount) is what sets x-user-id
// from the cookie session in the first place.
router.use("/:userId", pinUserIdParam);

// ── Token endpoint ─────────────────────────────────────────────────────────

/**
 * Live Attio access-token provider for the shared `/oauth/:provider/token`
 * route (see lib/oauth-token-endpoint.ts). Public client — clientId in the
 * refresh body, no secret.
 */
export const attioOAuthProvider: OAuthTokenProvider = {
  serverType: "attio",
  label: "Attio",
  async refresh(creds) {
    const c = creds as unknown as AttioTokens;

    const refreshRes = await fetch(ATTIO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: c.clientId,
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
      clientId: c.clientId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? c.refreshToken,
      expires: Date.now() + tokens.expires_in * 1000,
    };
  },
};

// ── Authorize endpoint ─────────────────────────────────────────────────────

/**
 * POST /:userId/oauth/attio/authorize
 * Performs DCR, builds the PKCE consent URL, and returns it for the frontend
 * to redirect the user to.
 */
router.post("/:userId/oauth/attio/authorize", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { redirectUri } = req.body as { redirectUri?: string };

    const callbackUri =
      redirectUri ??
      `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/attio/callback`;

    // DCR — register a fresh public client for this authorization attempt.
    const clientId = await registerAttioClient(callbackUri);

    // PKCE
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = deriveCodeChallenge(codeVerifier);

    const state = encodeState({ userId, clientId, codeVerifier, redirectUri: callbackUri });

    const authUrl = new URL(ATTIO_AUTH_URL);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", callbackUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "mcp offline_access");
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", state);

    res.json({ success: true, data: { authUrl: authUrl.toString() } });
  } catch (err) {
    log.error("[attio-oauth] authorize error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Programmatic callback (POST) ───────────────────────────────────────────

/**
 * POST /:userId/oauth/attio/callback
 * Programmatic token exchange — frontend passes code + state.
 */
router.post("/:userId/oauth/attio/callback", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { code, state } = req.body as { code?: string; state?: string };

    if (!code || !state) {
      res.status(400).json({ success: false, error: "Missing code or state" });
      return;
    }

    let statePayload: StatePayload;
    try {
      statePayload = decodeState(state);
    } catch {
      res.status(400).json({ success: false, error: "Invalid state parameter" });
      return;
    }

    if (statePayload.userId !== userId) {
      res.status(400).json({ success: false, error: "State userId mismatch" });
      return;
    }

    const { clientId, codeVerifier, redirectUri } = statePayload;

    const tokenRes = await fetch(ATTIO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      log.error(`[attio-oauth] Token exchange failed: ${tokenRes.status} ${text}`);
      res.status(500).json({ success: false, error: "Failed to exchange authorization code" });
      return;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    await storeAttioTokens(userId, clientId, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    log.info(`[attio-oauth] Stored Attio credentials for user ${userId}`);
    res.json({ success: true, data: { message: "Attio account connected successfully" } });
  } catch (err) {
    log.error("[attio-oauth] callback error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Browser-redirect callback (GET) ───────────────────────────────────────

/**
 * GET /attio/callback
 * Browser-redirect callback from Attio consent screen.
 */
export const attioCallbackRouter = Router();

attioCallbackRouter.get("/attio/callback", async (req: Request, res: Response) => {
  const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5174/claw/";

  try {
    const { code, state, error: oauthError } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (oauthError) {
      log.error(`[attio-oauth] OAuth error: ${oauthError}`);
      res.redirect(`${frontendUrl}?attio_error=${encodeURIComponent(oauthError)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}?attio_error=missing_code_or_state`);
      return;
    }

    let statePayload: StatePayload;
    try {
      statePayload = decodeState(state);
    } catch {
      res.redirect(`${frontendUrl}?attio_error=invalid_state`);
      return;
    }

    const { userId, clientId, codeVerifier, redirectUri } = statePayload;

    const tokenRes = await fetch(ATTIO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      log.error(`[attio-oauth] Token exchange failed: ${tokenRes.status} ${text}`);
      res.redirect(`${frontendUrl}?attio_error=token_exchange_failed`);
      return;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    await storeAttioTokens(userId, clientId, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    log.info(`[attio-oauth] Browser callback: Attio connected for user ${userId}`);
    res.redirect(`${frontendUrl}?attio_connected=true`);
  } catch (err) {
    log.error("[attio-oauth] Browser callback error:", err);
    res.redirect(`${frontendUrl}?attio_error=internal_error`);
  }
});

// ── Shared helper ──────────────────────────────────────────────────────────

async function storeAttioTokens(
  userId: string,
  clientId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): Promise<void> {
  const creds: AttioTokens = {
    clientId,
    accessToken,
    refreshToken,
    expires: Date.now() + expiresIn * 1000,
  };

  const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);
  const server = await ensureAttioServer();

  const existing = await prisma.userMcpConnection.findFirst({
    where: { userId, mcpServerId: server.id },
  });

  if (existing) {
    await prisma.userMcpConnection.update({
      where: { id: existing.id },
      data: { encryptedCreds: ciphertext, iv, authTag },
    });
  } else {
    await prisma.userMcpConnection.create({ data: { userId, mcpServerId: server.id, encryptedCreds: ciphertext, iv, authTag } });
  }

  await evictSession(userId, "attio").catch(() => {});

  syncToolsForServer(userId, "attio", server.name, { accessToken, refreshToken, clientId }).catch((err) => {
    log.error(`[attio-oauth] Tool sync failed for user ${userId}:`, err);
  });
}

export { router as attioOAuthRouter };
