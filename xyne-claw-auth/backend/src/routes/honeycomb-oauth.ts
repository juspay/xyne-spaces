/**
 * Honeycomb MCP OAuth routes for xyne-claw-auth.
 *
 * Honeycomb MCP uses OAuth 2.1 with Dynamic Client Registration (DCR, RFC 7591)
 * and PKCE (S256). There is no pre-registered client_id / client_secret — the
 * client self-registers at runtime, making this identical in pattern to the
 * Calendly and JotForm integrations.
 *
 * OAuth discovery: https://ui.honeycomb.io/.well-known/oauth-authorization-server
 *   issuer:                  https://ui.honeycomb.io
 *   authorization_endpoint:  https://ui.honeycomb.io/oauth/authorize
 *   token_endpoint:          https://ui.honeycomb.io/oauth/token
 *   registration_endpoint:   https://ui.honeycomb.io/oauth/register
 *   scopes_supported:        ["mcp:read", "mcp:write"]
 *   code_challenge_methods:  ["S256"]
 *
 * Protected resource: https://mcp.honeycomb.io/.well-known/oauth-protected-resource
 *   resource:                https://mcp.honeycomb.io/mcp
 *   authorization_servers:   ["https://ui.honeycomb.io"]
 *   bearer_methods_supported: ["header"]
 *
 * Flow:
 *   1. POST /:userId/oauth/honeycomb/authorize
 *      - Runs DCR to obtain a client_id from Honeycomb.
 *      - Generates a PKCE code_verifier + code_challenge.
 *      - Encodes { userId, clientId, codeVerifier, redirectUri } in the state
 *        parameter (base64url) so no server-side session is needed.
 *      - Returns the Honeycomb consent URL for the frontend to redirect the user to.
 *
 *   2. GET /honeycomb/callback
 *      - Browser-redirect callback from Honeycomb consent screen.
 *      - Decodes state to recover userId, clientId, codeVerifier, redirectUri.
 *      - Exchanges the authorization code for tokens using PKCE.
 *      - Stores encrypted { clientId, accessToken, refreshToken, expires } in
 *        UserMcpConnection (type: "honeycomb").
 *      - Redirects to the frontend with ?honeycomb_connected=true.
 *
 *   3. GET /:userId/oauth/honeycomb/token
 *      - Returns a valid Honeycomb access token (refreshes if expired).
 *      - Called by xyne-claw before routing MCP calls to https://mcp.honeycomb.io/mcp.
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
const log = createLogger("honeycomb-oauth");

const HONEYCOMB_REGISTER_URL = "https://ui.honeycomb.io/oauth/register";
const HONEYCOMB_AUTH_URL = "https://ui.honeycomb.io/oauth/authorize";
const HONEYCOMB_TOKEN_URL = "https://ui.honeycomb.io/oauth/token";
const HONEYCOMB_SCOPES = "mcp:read mcp:write";

interface HoneycombTokens {
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

/** Default browser-callback URI. */
function defaultCallbackUri(): string {
  return `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/honeycomb/callback`;
}

/** Performs DCR and returns the dynamically issued client_id. */
async function registerHoneycombClient(redirectUri: string): Promise<string> {
  const res = await fetch(HONEYCOMB_REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Xyne Claw",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: HONEYCOMB_SCOPES,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Honeycomb DCR failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { client_id: string };
  return data.client_id;
}

/** Ensures a "honeycomb" McpServer row exists, creating it if necessary. */
async function ensureHoneycombServer() {
  const existing = await prisma.mcpServer.findUnique({ where: { type: "honeycomb" } });
  if (existing) return existing;

  return prisma.mcpServer.create({
    data: {
      type: "honeycomb",
      name: "Honeycomb",
      url: "https://mcp.honeycomb.io/mcp",
      description: "Honeycomb observability — query traces, investigate anomalies, monitor SLOs and Triggers.",
      transport: "http",
      writeToolPolicy: {
        mode: "allowlist",
        // create_board is the only tool in Honeycomb MCP that requires mcp:write.
        tools: ["create_board"],
      },
      healthcheckSpec: { name: "get_workspace_context", params: {} },
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
 * Live Honeycomb access-token provider for the shared `/oauth/:provider/token`
 * route (see lib/oauth-token-endpoint.ts). Public client (DCR) — clientId in
 * the refresh body, no secret; Honeycomb may rotate the refresh token. Used by
 * xyne-claw when routing MCP calls to https://mcp.honeycomb.io/mcp.
 */
export const honeycombOAuthProvider: OAuthTokenProvider = {
  serverType: "honeycomb",
  label: "Honeycomb",
  async refresh(creds) {
    const c = creds as unknown as HoneycombTokens;

    const refreshRes = await fetch(HONEYCOMB_TOKEN_URL, {
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
      // Honeycomb may rotate the refresh token — always take the new one if provided.
      refreshToken: tokens.refresh_token ?? c.refreshToken,
      expires: Date.now() + tokens.expires_in * 1000,
    };
  },
};

// ── Authorize endpoint ─────────────────────────────────────────────────────

/**
 * POST /:userId/oauth/honeycomb/authorize
 * Performs DCR, builds the PKCE consent URL, and returns it for the frontend
 * to redirect the user to.
 */
router.post("/:userId/oauth/honeycomb/authorize", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { redirectUri } = req.body as { redirectUri?: string };

    const callbackUri = redirectUri ?? defaultCallbackUri();

    // DCR — register a fresh public client for this authorization attempt.
    const clientId = await registerHoneycombClient(callbackUri);

    // PKCE
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = deriveCodeChallenge(codeVerifier);

    // Encode all state needed for the callback into the state param.
    const state = encodeState({ userId, clientId, codeVerifier, redirectUri: callbackUri });

    const authUrl = new URL(HONEYCOMB_AUTH_URL);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", callbackUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", HONEYCOMB_SCOPES);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", state);

    res.json({ success: true, data: { authUrl: authUrl.toString() } });
  } catch (err) {
    log.error("[honeycomb-oauth] authorize error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Programmatic callback (POST) ───────────────────────────────────────────

/**
 * POST /:userId/oauth/honeycomb/callback
 * Programmatic token exchange — frontend passes code + state from query params.
 * Decodes state to get clientId + codeVerifier, then exchanges the code.
 */
router.post("/:userId/oauth/honeycomb/callback", async (req: Request<{ userId: string }>, res: Response) => {
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

    const tokenRes = await fetch(HONEYCOMB_TOKEN_URL, {
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
      log.error(`[honeycomb-oauth] Token exchange failed for user ${userId}: ${tokenRes.status} ${text}`);
      res.status(502).json({ success: false, error: "Honeycomb token exchange failed" });
      return;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    await storeHoneycombTokens(userId, clientId, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    log.info(`[honeycomb-oauth] Stored Honeycomb credentials for user ${userId}`);
    res.json({ success: true, data: { message: "Honeycomb account connected successfully" } });
  } catch (err) {
    log.error("[honeycomb-oauth] callback error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Browser-redirect callback (GET) ───────────────────────────────────────

/**
 * GET /honeycomb/callback
 * Browser-redirect callback from the Honeycomb consent screen.
 * Honeycomb redirects here with ?code=...&state=<base64url-encoded-payload>
 */
export const honeycombCallbackRouter = Router();

honeycombCallbackRouter.get("/honeycomb/callback", async (req: Request, res: Response) => {
  const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5174/claw/";

  try {
    const { code, state, error: oauthError } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (oauthError) {
      log.error(`[honeycomb-oauth] OAuth error: ${oauthError}`);
      res.redirect(`${frontendUrl}?honeycomb_error=${encodeURIComponent(oauthError)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}?honeycomb_error=missing_code_or_state`);
      return;
    }

    let statePayload: StatePayload;
    try {
      statePayload = decodeState(state);
    } catch {
      res.redirect(`${frontendUrl}?honeycomb_error=invalid_state`);
      return;
    }

    const { userId, clientId, codeVerifier, redirectUri } = statePayload;

    const tokenRes = await fetch(HONEYCOMB_TOKEN_URL, {
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
      log.error(`[honeycomb-oauth] Browser callback token exchange failed: ${tokenRes.status} ${text}`);
      res.redirect(`${frontendUrl}?honeycomb_error=token_exchange_failed`);
      return;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      log.error(`[honeycomb-oauth] User not found: ${userId}`);
      res.redirect(`${frontendUrl}?honeycomb_error=user_not_found`);
      return;
    }

    await storeHoneycombTokens(userId, clientId, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    log.info(`[honeycomb-oauth] Stored Honeycomb credentials for user ${userId} via browser callback`);
    res.redirect(`${frontendUrl}?honeycomb_connected=true`);
  } catch (err) {
    log.error("[honeycomb-oauth] browser callback error:", err);
    res.redirect(`${frontendUrl}?honeycomb_error=internal_error`);
  }
});

// ── Shared helper ──────────────────────────────────────────────────────────

async function storeHoneycombTokens(
  userId: string,
  clientId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): Promise<void> {
  const creds: HoneycombTokens = {
    clientId,
    accessToken,
    refreshToken,
    expires: Date.now() + expiresIn * 1000,
  };

  const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);
  const server = await ensureHoneycombServer();

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
  await evictSession(userId, "honeycomb").catch(() => {});

  // Sync tools from the Honeycomb MCP server into the DB so the agent can use them.
  syncToolsForServer(userId, "honeycomb", server.name, { accessToken, refreshToken, clientId }).catch((err) => {
    log.error(`[honeycomb-oauth] tool sync failed for user ${userId}:`, err);
  });
}

export { router as honeycombOAuthRouter };
