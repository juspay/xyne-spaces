/**
 * JotForm OAuth routes for xyne-claw-auth.
 *
 * JotForm MCP uses OAuth 2.1 with Dynamic Client Registration (DCR, RFC 7591)
 * and PKCE (S256). There is no pre-registered client_id / client_secret — the
 * client self-registers at runtime, identical pattern to Calendly.
 *
 * Discovery: https://mcp.jotform.com/.well-known/oauth-authorization-server
 *   issuer:                  https://oauth2.jotform.com
 *   authorization_endpoint:  https://oauth2.jotform.com/authorize
 *   token_endpoint:          https://oauth2.jotform.com/token
 *   registration_endpoint:   https://oauth2.jotform.com/register-public-client
 *   scopes_supported:        ["readOnly", "full"]
 *
 * Flow:
 *   1. POST /:userId/oauth/jotform/authorize
 *      - Runs DCR to obtain a client_id from JotForm.
 *      - Generates a PKCE code_verifier + code_challenge.
 *      - Encodes { userId, clientId, codeVerifier, redirectUri } in the state
 *        parameter (base64url) so no server-side session is needed.
 *      - Returns the JotForm consent URL for the frontend to redirect the user to.
 *
 *   2. GET /jotform/callback
 *      - Browser-redirect callback from JotForm.
 *      - Decodes state to recover userId, clientId, codeVerifier, redirectUri.
 *      - Exchanges the authorization code for tokens using PKCE.
 *      - Stores encrypted { clientId, accessToken, refreshToken, expires } in
 *        UserMcpConnection (type: "jotform").
 *      - Redirects to the frontend with ?jotform_connected=true.
 *
 *   3. GET /:userId/oauth/jotform/token
 *      - Returns a valid JotForm access token (refreshes if expired).
 *      - Called by xyne-claw before running jotform-agent tasks.
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
const log = createLogger("jotform-oauth");

const JOTFORM_REGISTER_URL = "https://oauth2.jotform.com/register-public-client";
const JOTFORM_AUTH_URL = "https://oauth2.jotform.com/authorize";
const JOTFORM_TOKEN_URL = "https://oauth2.jotform.com/token";

interface JotFormTokens {
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
async function registerJotFormClient(redirectUri: string): Promise<string> {
  const res = await fetch(JOTFORM_REGISTER_URL, {
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
    throw new Error(`JotForm DCR failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { client_id: string };
  return data.client_id;
}

/** Ensures a "jotform" McpServer row exists, creating it if necessary. */
async function ensureJotFormServer() {
  const existing = await prisma.mcpServer.findUnique({ where: { type: "jotform" } });
  if (existing) return existing;
  return prisma.mcpServer.create({
    data: {
      type: "jotform",
      name: "JotForm",
      url: "https://mcp.jotform.com",
      description: "JotForm integration — build forms, capture submissions, and manage your workspace.",
      transport: "http",
      writeToolPolicy: {
        mode: "allowlist",
        tools: [
          "create_form",
          "edit_form",
          "create_submission",
        ],
      },
      healthcheckSpec: { name: "form_list", params: {} },
      connectorMeta: { scope: "global", mode: "self-serve" },
    },
  });
}

const router = Router();
router.use("/:userId", pinUserIdParam);

// ── Token endpoint ─────────────────────────────────────────────────────────

/**
 * Live JotForm access-token provider for the shared `/oauth/:provider/token`
 * route (see lib/oauth-token-endpoint.ts). Public client — clientId in the
 * refresh body, no secret; JotForm may rotate the refresh token.
 */
export const jotformOAuthProvider: OAuthTokenProvider = {
  serverType: "jotform",
  label: "JotForm",
  async refresh(creds) {
    const c = creds as unknown as JotFormTokens;

    const refreshRes = await fetch(JOTFORM_TOKEN_URL, {
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
      // JotForm may rotate the refresh token — always take the new one if provided.
      refreshToken: tokens.refresh_token ?? c.refreshToken,
      expires: Date.now() + tokens.expires_in * 1000,
    };
  },
};

// ── Authorize endpoint ─────────────────────────────────────────────────────

/**
 * POST /:userId/oauth/jotform/authorize
 * Performs DCR, builds the PKCE consent URL, and returns it for the frontend
 * to redirect the user to.
 */
router.post("/:userId/oauth/jotform/authorize", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { redirectUri, scope } = req.body as { redirectUri?: string; scope?: string };

    const callbackUri =
      redirectUri ??
      `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/jotform/callback`;

    // DCR — register a fresh public client for this authorization attempt.
    const clientId = await registerJotFormClient(callbackUri);

    // PKCE
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = deriveCodeChallenge(codeVerifier);

    // Encode all state needed for the callback into the state param.
    const state = encodeState({ userId, clientId, codeVerifier, redirectUri: callbackUri });

    const authUrl = new URL(JOTFORM_AUTH_URL);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", callbackUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("scope", scope ?? "full");
    authUrl.searchParams.set("state", state);

    res.json({ success: true, data: { authUrl: authUrl.toString() } });
  } catch (err) {
    log.error("[jotform-oauth] authorize error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Programmatic callback (POST) ───────────────────────────────────────────

/**
 * POST /:userId/oauth/jotform/callback
 * Programmatic token exchange — frontend passes code + state from query params.
 * Decodes state to get clientId + codeVerifier, then exchanges the code.
 */
router.post("/:userId/oauth/jotform/callback", async (req: Request<{ userId: string }>, res: Response) => {
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

    const { clientId, codeVerifier, redirectUri } = statePayload;

    const tokenRes = await fetch(JOTFORM_TOKEN_URL, {
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
      log.error(`[jotform-oauth] Token exchange failed for user ${userId}: ${tokenRes.status} ${text}`);
      res.status(502).json({ success: false, error: "JotForm token exchange failed" });
      return;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    await storeJotFormTokens(userId, clientId, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    log.info(`[jotform-oauth] Stored JotForm credentials for user ${userId}`);
    res.json({ success: true, data: { message: "JotForm account connected successfully" } });
  } catch (err) {
    log.error("[jotform-oauth] callback error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Browser-redirect callback (GET) ───────────────────────────────────────

/**
 * GET /jotform/callback
 * Browser-redirect callback from JotForm consent screen.
 * JotForm redirects here with ?code=...&state=<base64url-encoded-payload>
 */
export const jotformCallbackRouter = Router();

jotformCallbackRouter.get("/jotform/callback", async (req: Request, res: Response) => {
  const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5174/claw/";

  try {
    const { code, state, error: oauthError } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (oauthError) {
      log.error(`[jotform-oauth] OAuth error: ${oauthError}`);
      res.redirect(`${frontendUrl}?jotform_error=${encodeURIComponent(oauthError)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}?jotform_error=missing_code_or_state`);
      return;
    }

    let statePayload: StatePayload;
    try {
      statePayload = decodeState(state);
    } catch {
      res.redirect(`${frontendUrl}?jotform_error=invalid_state`);
      return;
    }

    const { userId, clientId, codeVerifier, redirectUri } = statePayload;

    const tokenRes = await fetch(JOTFORM_TOKEN_URL, {
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
      log.error(`[jotform-oauth] Browser callback token exchange failed: ${tokenRes.status} ${text}`);
      res.redirect(`${frontendUrl}?jotform_error=token_exchange_failed`);
      return;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      log.error(`[jotform-oauth] User not found: ${userId}`);
      res.redirect(`${frontendUrl}?jotform_error=user_not_found`);
      return;
    }

    await storeJotFormTokens(userId, clientId, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    log.info(`[jotform-oauth] Stored JotForm credentials for user ${userId} via browser callback`);
    res.redirect(`${frontendUrl}?jotform_connected=true`);
  } catch (err) {
    log.error("[jotform-oauth] browser callback error:", err);
    res.redirect(`${frontendUrl}?jotform_error=internal_error`);
  }
});

// ── Shared helper ──────────────────────────────────────────────────────────

async function storeJotFormTokens(
  userId: string,
  clientId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): Promise<void> {
  const creds: JotFormTokens = {
    clientId,
    accessToken,
    refreshToken,
    expires: Date.now() + expiresIn * 1000,
  };

  const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);
  const server = await ensureJotFormServer();

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
  await evictSession(userId, "jotform").catch(() => {});

  // Sync tools from the JotForm MCP server into the DB so the agent can use them.
  syncToolsForServer(userId, "jotform", server.name, { accessToken, refreshToken, clientId }).catch((err) => {
    log.error(`[jotform-oauth] tool sync failed for user ${userId}:`, err);
  });
}

export { router as jotformOAuthRouter };
