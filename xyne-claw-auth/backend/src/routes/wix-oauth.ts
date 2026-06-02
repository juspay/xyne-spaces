/**
 * Wix OAuth routes for xyne-claw-auth.
 *
 * Wix MCP uses OAuth 2.1 with Dynamic Client Registration (DCR, RFC 7591)
 * and PKCE (S256). It is a public client (token_endpoint_auth_method: none) —
 * no pre-registered client_id / client_secret, identical pattern to Calendly
 * and JotForm.
 *
 * Discovery: https://mcp.wix.com/.well-known/oauth-authorization-server
 *   issuer:                  https://mcp.wix.com
 *   authorization_endpoint:  https://mcp.wix.com/authorize
 *   token_endpoint:          https://mcp.wix.com/token
 *   registration_endpoint:   https://mcp.wix.com/register
 *   token_endpoint_auth:     none (public client)
 *   PKCE:                    S256
 *
 * Flow:
 *   1. POST /:userId/oauth/wix/authorize
 *      - Runs DCR to obtain a client_id from Wix.
 *      - Generates a PKCE code_verifier + code_challenge.
 *      - Encodes { userId, clientId, codeVerifier, redirectUri } in the state
 *        parameter (base64url) so no server-side session is needed.
 *      - Returns the Wix consent URL for the frontend to redirect to.
 *
 *   2. GET /wix/callback
 *      - Browser-redirect callback from Wix consent screen.
 *      - Decodes state to recover userId, clientId, codeVerifier, redirectUri.
 *      - Exchanges the authorization code for tokens using PKCE (no secret).
 *      - Stores encrypted { clientId, accessToken, refreshToken, expires } in
 *        UserMcpConnection (type: "wix").
 *      - Redirects to the frontend with ?wix_connected=true.
 *
 *   3. GET /:userId/oauth/wix/token
 *      - Returns a valid Wix access token (refreshes if expired).
 *      - Called by xyne-claw before running wix-agent tasks.
 */

import { randomBytes, createHash } from "crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { syncToolsForServer } from "../tool-sync.js";
import { evictSession } from "../mcp/runner.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";

const WIX_REGISTER_URL = "https://mcp.wix.com/register";
const WIX_AUTH_URL = "https://mcp.wix.com/authorize";
const WIX_TOKEN_URL = "https://mcp.wix.com/token";

interface WixTokens {
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

function encodeState(payload: StatePayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeState(state: string): StatePayload {
  return JSON.parse(Buffer.from(state, "base64url").toString()) as StatePayload;
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
async function registerWixClient(redirectUri: string): Promise<string> {
  const res = await fetch(WIX_REGISTER_URL, {
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
    throw new Error(`Wix DCR failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { client_id: string };
  return data.client_id;
}

/** Ensures a "wix" McpServer row exists, creating it if necessary. */
async function ensureWixServer() {
  const existing = await prisma.mcpServer.findUnique({ where: { type: "wix" } });
  if (existing) return existing;
  return prisma.mcpServer.create({
    data: {
      type: "wix",
      name: "Wix",
      url: "https://mcp.wix.com/mcp",
      description: "Wix integration — manage sites, CMS collections, pages, assets, and publish content.",
      transport: "http",
      writeToolPolicy: {
        mode: "allowlist",
        tools: [
          "CallWixSiteAPI",
          "CreateWixBusinessGuide",
          "ExecuteWixAPI",
          "ManageWixSite",
          "UploadImageToWixSite",
          "WixSiteBuilder",
          "pullSiteCreationJob",
        ],
      },
      healthcheckSpec: { name: "ListWixSites", params: {} },
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
 * GET /:userId/oauth/wix/token
 * Returns a valid Wix access token, refreshing if within 60 s of expiry.
 */
router.get("/:userId/oauth/wix/token", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;

    const connection = await prisma.userMcpConnection.findFirst({
      where: { userId, mcpServer: { type: "wix" } },
      include: { mcpServer: true },
    });

    if (!connection) {
      res.status(404).json({ success: false, error: "No Wix connection found for this user" });
      return;
    }

    const decrypted = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
    const creds = JSON.parse(decrypted) as WixTokens;

    if (Date.now() <= creds.expires - 60_000) {
      res.json({ success: true, data: { accessToken: creds.accessToken } });
      return;
    }

    // Refresh — Wix is a public client; send client_id in body, no secret.
    const refreshRes = await fetch(WIX_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: creds.clientId,
        refresh_token: creds.refreshToken,
      }),
    });

    if (!refreshRes.ok) {
      const text = await refreshRes.text();
      console.error(`[wix-oauth] Token refresh failed for user ${userId}: ${refreshRes.status} ${text}`);
      res.status(502).json({ success: false, error: "Wix token refresh failed" });
      return;
    }

    const tokens = (await refreshRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    const newCreds: WixTokens = {
      clientId: creds.clientId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? creds.refreshToken,
      expires: Date.now() + tokens.expires_in * 1000,
    };

    const { ciphertext, iv, authTag } = encrypt(JSON.stringify(newCreds), CONFIG.encryptionKey);
    await prisma.userMcpConnection.update({
      where: { id: connection.id },
      data: { encryptedCreds: ciphertext, iv, authTag },
    });

    res.json({ success: true, data: { accessToken: tokens.access_token } });
  } catch (err) {
    console.error("[wix-oauth] token error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Authorize endpoint ─────────────────────────────────────────────────────

/**
 * POST /:userId/oauth/wix/authorize
 * Performs DCR, builds the PKCE consent URL, and returns it for the frontend
 * to redirect the user to.
 */
router.post("/:userId/oauth/wix/authorize", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { redirectUri } = req.body as { redirectUri?: string };

    const callbackUri =
      redirectUri ??
      `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/wix/callback`;

    // DCR — register a fresh public client for this authorization attempt.
    const clientId = await registerWixClient(callbackUri);

    // PKCE
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = deriveCodeChallenge(codeVerifier);

    const state = encodeState({ userId, clientId, codeVerifier, redirectUri: callbackUri });

    const authUrl = new URL(WIX_AUTH_URL);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", callbackUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", state);

    res.json({ success: true, data: { authUrl: authUrl.toString() } });
  } catch (err) {
    console.error("[wix-oauth] authorize error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Programmatic callback (POST) ───────────────────────────────────────────

/**
 * POST /:userId/oauth/wix/callback
 * Programmatic token exchange — frontend passes code + state.
 */
router.post("/:userId/oauth/wix/callback", async (req: Request<{ userId: string }>, res: Response) => {
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

    const tokenRes = await fetch(WIX_TOKEN_URL, {
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
      console.error(`[wix-oauth] Token exchange failed for user ${userId}: ${tokenRes.status} ${text}`);
      res.status(502).json({ success: false, error: "Wix token exchange failed" });
      return;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    await storeWixTokens(userId, clientId, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    console.log(`[wix-oauth] Stored Wix credentials for user ${userId}`);
    res.json({ success: true, data: { message: "Wix account connected successfully" } });
  } catch (err) {
    console.error("[wix-oauth] callback error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Browser-redirect callback (GET) ───────────────────────────────────────

/**
 * GET /wix/callback
 * Browser-redirect callback from Wix consent screen.
 */
export const wixCallbackRouter = Router();

wixCallbackRouter.get("/wix/callback", async (req: Request, res: Response) => {
  const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5174/claw/";

  try {
    const { code, state, error: oauthError } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (oauthError) {
      console.error(`[wix-oauth] OAuth error: ${oauthError}`);
      res.redirect(`${frontendUrl}?wix_error=${encodeURIComponent(oauthError)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}?wix_error=missing_code_or_state`);
      return;
    }

    let statePayload: StatePayload;
    try {
      statePayload = decodeState(state);
    } catch {
      res.redirect(`${frontendUrl}?wix_error=invalid_state`);
      return;
    }

    const { userId, clientId, codeVerifier, redirectUri } = statePayload;

    const tokenRes = await fetch(WIX_TOKEN_URL, {
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
      console.error(`[wix-oauth] Browser callback token exchange failed: ${tokenRes.status} ${text}`);
      res.redirect(`${frontendUrl}?wix_error=token_exchange_failed`);
      return;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      console.error(`[wix-oauth] User not found: ${userId}`);
      res.redirect(`${frontendUrl}?wix_error=user_not_found`);
      return;
    }

    await storeWixTokens(userId, clientId, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    console.log(`[wix-oauth] Stored Wix credentials for user ${userId} via browser callback`);
    res.redirect(`${frontendUrl}?wix_connected=true`);
  } catch (err) {
    console.error("[wix-oauth] browser callback error:", err);
    res.redirect(`${frontendUrl}?wix_error=internal_error`);
  }
});

// ── Shared helper ──────────────────────────────────────────────────────────

async function storeWixTokens(
  userId: string,
  clientId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): Promise<void> {
  const creds: WixTokens = {
    clientId,
    accessToken,
    refreshToken,
    expires: Date.now() + expiresIn * 1000,
  };

  const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);
  const server = await ensureWixServer();

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

  await evictSession(userId, "wix").catch(() => {});

  syncToolsForServer(userId, "wix", server.name, { accessToken, refreshToken, clientId }).catch((err) => {
    console.error(`[wix-oauth] tool sync failed for user ${userId}:`, err);
  });
}

export { router as wixOAuthRouter };
