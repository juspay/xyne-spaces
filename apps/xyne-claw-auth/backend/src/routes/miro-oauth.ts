/**
 * Miro OAuth routes for xyne-claw-auth.
 *
 * Miro MCP uses OAuth 2.1 with Dynamic Client Registration (DCR, RFC 7591)
 * and PKCE (S256). Unlike Calendly/JotForm (public clients), Miro issues a
 * client_secret during DCR — making it a confidential DCR client. The secret
 * must be sent alongside client_id in all token requests.
 *
 * Discovery: https://mcp.miro.com/.well-known/oauth-authorization-server
 *   issuer:                  https://mcp.miro.com/
 *   authorization_endpoint:  https://mcp.miro.com/authorize
 *   token_endpoint:          https://mcp.miro.com/token
 *   registration_endpoint:   https://mcp.miro.com/register
 *   scopes_supported:        ["boards:read", "boards:write"]
 *   token_endpoint_auth:     client_secret_post
 *
 * Flow:
 *   1. POST /:userId/oauth/miro/authorize
 *      - Runs DCR to obtain a client_id + client_secret from Miro.
 *      - Generates a PKCE code_verifier + code_challenge.
 *      - Encodes { userId, clientId, clientSecret, codeVerifier, redirectUri }
 *        in the state parameter (base64url) so no server-side session is needed.
 *      - Returns the Miro consent URL for the frontend to redirect the user to.
 *
 *   2. GET /miro/callback
 *      - Browser-redirect callback from Miro consent screen.
 *      - Decodes state to recover userId, clientId, clientSecret, codeVerifier.
 *      - Exchanges the authorization code using PKCE + client_secret_post.
 *      - Stores encrypted { clientId, clientSecret, accessToken, refreshToken, expires }
 *        in UserMcpConnection (type: "miro").
 *      - Redirects to the frontend with ?miro_connected=true.
 *
 *   3. GET /:userId/oauth/miro/token
 *      - Returns a valid Miro access token (refreshes if expired).
 *      - Called by xyne-claw before running miro-agent tasks.
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
const log = createLogger("miro-oauth");

const MIRO_REGISTER_URL = "https://mcp.miro.com/register";
const MIRO_AUTH_URL = "https://mcp.miro.com/authorize";
const MIRO_TOKEN_URL = "https://mcp.miro.com/token";

interface MiroTokens {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expires: number;
}

interface StatePayload {
  userId: string;
  clientId: string;
  clientSecret: string;
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

/** Performs DCR and returns the dynamically issued { clientId, clientSecret }. */
async function registerMiroClient(redirectUri: string): Promise<{ clientId: string; clientSecret: string }> {
  const res = await fetch(MIRO_REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Xyne Claw",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Miro DCR failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { client_id: string; client_secret: string };
  return { clientId: data.client_id, clientSecret: data.client_secret };
}

/** Ensures a "miro" McpServer row exists, creating it if necessary. */
async function ensureMiroServer() {
  const existing = await prisma.mcpServer.findUnique({ where: { type: "miro" } });
  if (existing) return existing;
  return prisma.mcpServer.create({
    data: {
      type: "miro",
      name: "Miro",
      url: "https://mcp.miro.com/",
      description: "Miro integration — generate diagrams, read board context, create documents, tables, and code widgets.",
      transport: "http",
      writeToolPolicy: {
        mode: "allowlist",
        tools: [
          "diagram_create",
          "doc_create",
          "doc_update",
          "table_create",
          "table_sync_rows",
          "board_create",
          "image_create",
          "image_get_upload_url",
          "code_widget_create",
          "code_widget_delete",
          "code_widget_update",
          "comment_reply",
          "comment_resolve",
          "layout_create",
          "layout_update",
        ],
      },
      healthcheckSpec: { name: "board_search_boards", params: {} },
      connectorMeta: { scope: "global", mode: "self-serve" },
    },
  });
}

const router = Router();

// Every /:userId/oauth/miro/* route must be hit by the same user whose
// userId appears in the path. requireAuth (at the mount in main.ts) sets
// x-user-id from the cookie session; pinUserIdParam rejects the request
// with 403 if that doesn't match the URL. Without this, an authenticated
// user could enumerate userIds and exfiltrate another user's stored token
// via GET /:userId/oauth/miro/token. Same pattern used by all existing
// OAuth routers (docusign, egnyte, calendly, jotform).
router.use("/:userId", pinUserIdParam);

// ── Token endpoint ─────────────────────────────────────────────────────────

/**
 * Live Miro access-token provider for the shared `/oauth/:provider/token` route
 * (see lib/oauth-token-endpoint.ts). Miro is a confidential client using
 * client_secret_post, with both clientId + clientSecret stored per connection.
 */
export const miroOAuthProvider: OAuthTokenProvider = {
  serverType: "miro",
  label: "Miro",
  async refresh(creds) {
    const c = creds as unknown as MiroTokens;

    const refreshRes = await fetch(MIRO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: c.clientId,
        client_secret: c.clientSecret,
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
      clientSecret: c.clientSecret,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? c.refreshToken,
      expires: Date.now() + tokens.expires_in * 1000,
    };
  },
};

// ── Authorize endpoint ─────────────────────────────────────────────────────

/**
 * POST /:userId/oauth/miro/authorize
 * Performs DCR, builds the PKCE consent URL, and returns it for the frontend
 * to redirect the user to.
 */
router.post("/:userId/oauth/miro/authorize", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { redirectUri, scope } = req.body as { redirectUri?: string; scope?: string };

    const callbackUri =
      redirectUri ??
      `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/miro/callback`;

    // DCR — register a fresh confidential client for this authorization attempt.
    const { clientId, clientSecret } = await registerMiroClient(callbackUri);

    // PKCE
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = deriveCodeChallenge(codeVerifier);

    // Encode all state needed for the callback into the state param.
    const state = encodeState({ userId, clientId, clientSecret, codeVerifier, redirectUri: callbackUri });

    const authUrl = new URL(MIRO_AUTH_URL);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", callbackUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("scope", scope ?? "boards:read boards:write");
    authUrl.searchParams.set("state", state);

    res.json({ success: true, data: { authUrl: authUrl.toString() } });
  } catch (err) {
    log.error("[miro-oauth] authorize error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Programmatic callback (POST) ───────────────────────────────────────────

/**
 * POST /:userId/oauth/miro/callback
 * Programmatic token exchange — frontend passes code + state from query params.
 * Decodes state to get clientId + clientSecret + codeVerifier, then exchanges the code.
 */
router.post("/:userId/oauth/miro/callback", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { code, state } = req.body as { code?: string; state?: string };

    if (!code || !state) {
      res.status(400).json({ success: false, error: "code and state are required" });
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
      res.status(403).json({ success: false, error: "State userId mismatch" });
      return;
    }

    const { clientId, clientSecret, codeVerifier, redirectUri } = statePayload;

    const tokenRes = await fetch(MIRO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      log.error(`[miro-oauth] Token exchange failed for user ${userId}: ${tokenRes.status} ${text}`);
      res.status(502).json({ success: false, error: "Miro token exchange failed" });
      return;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    await storeMiroTokens(userId, clientId, clientSecret, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    log.info(`[miro-oauth] Stored Miro credentials for user ${userId}`);
    res.json({ success: true, data: { message: "Miro account connected successfully" } });
  } catch (err) {
    log.error("[miro-oauth] callback error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Browser-redirect callback (GET) ───────────────────────────────────────

/**
 * GET /miro/callback
 * Browser-redirect callback from Miro consent screen.
 * Miro redirects here with ?code=...&state=<base64url-encoded-payload>
 */
export const miroCallbackRouter = Router();

miroCallbackRouter.get("/miro/callback", async (req: Request, res: Response) => {
  const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5174/claw/";

  try {
    const { code, state, error: oauthError } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (oauthError) {
      log.error(`[miro-oauth] OAuth error: ${oauthError}`);
      res.redirect(`${frontendUrl}?miro_error=${encodeURIComponent(oauthError)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}?miro_error=missing_code_or_state`);
      return;
    }

    let statePayload: StatePayload;
    try {
      statePayload = decodeState(state);
    } catch {
      res.redirect(`${frontendUrl}?miro_error=invalid_state`);
      return;
    }

    const { userId, clientId, clientSecret, codeVerifier, redirectUri } = statePayload;

    const tokenRes = await fetch(MIRO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      log.error(`[miro-oauth] Browser callback token exchange failed: ${tokenRes.status} ${text}`);
      res.redirect(`${frontendUrl}?miro_error=token_exchange_failed`);
      return;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      log.error(`[miro-oauth] User not found: ${userId}`);
      res.redirect(`${frontendUrl}?miro_error=user_not_found`);
      return;
    }

    await storeMiroTokens(userId, clientId, clientSecret, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    log.info(`[miro-oauth] Stored Miro credentials for user ${userId} via browser callback`);
    res.redirect(`${frontendUrl}?miro_connected=true`);
  } catch (err) {
    log.error("[miro-oauth] browser callback error:", err);
    res.redirect(`${frontendUrl}?miro_error=internal_error`);
  }
});

// ── Shared helper ──────────────────────────────────────────────────────────

async function storeMiroTokens(
  userId: string,
  clientId: string,
  clientSecret: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): Promise<void> {
  const creds: MiroTokens = {
    clientId,
    clientSecret,
    accessToken,
    refreshToken,
    expires: Date.now() + expiresIn * 1000,
  };

  const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);
  const server = await ensureMiroServer();

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
  await evictSession(userId, "miro").catch(() => {});

  // Sync tools from the Miro MCP server into the DB so the agent can use them.
  syncToolsForServer(userId, "miro", server.name, { accessToken, refreshToken, clientId }).catch((err) => {
    log.error(`[miro-oauth] tool sync failed for user ${userId}:`, err);
  });
}

export { router as miroOAuthRouter };
