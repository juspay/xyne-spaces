/**
 * Calendly OAuth routes for xyne-claw-auth.
 *
 * Calendly MCP uses OAuth 2.1 with Dynamic Client Registration (DCR, RFC 7591)
 * and PKCE (S256). There is no pre-registered client_id / client_secret — the
 * client self-registers at runtime, making this different from Google/Microsoft.
 *
 * Flow:
 *   1. POST /:userId/oauth/calendly/authorize
 *      - Runs DCR to obtain a client_id from Calendly.
 *      - Generates a PKCE code_verifier + code_challenge.
 *      - Encodes { userId, clientId, codeVerifier, redirectUri } in the state
 *        parameter (base64url) so no server-side session is needed.
 *      - Returns the Calendly consent URL for the frontend to redirect the
 *        user to.
 *
 *   2. GET /calendly/callback
 *      - Browser-redirect callback from Calendly.
 *      - Decodes state to recover userId, clientId, codeVerifier, redirectUri.
 *      - Exchanges the authorization code for tokens using PKCE.
 *      - Stores encrypted { clientId, accessToken, refreshToken, expires } in
 *        UserMcpConnection (type: "calendly").
 *      - Redirects to the frontend with ?calendly_connected=true.
 *
 *   3. GET /:userId/oauth/calendly/token
 *      - Returns a valid Calendly access token (refreshes if expired).
 *      - Called by xyne-claw before running calendly-agent tasks.
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
const log = createLogger("calendly-oauth");

const CALENDLY_REGISTER_URL = "https://calendly.com/oauth/register";
const CALENDLY_AUTH_URL = "https://calendly.com/oauth/authorize";
const CALENDLY_TOKEN_URL = "https://calendly.com/oauth/token";

interface CalendlyTokens {
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
async function registerCalendlyClient(redirectUri: string): Promise<string> {
  const res = await fetch(CALENDLY_REGISTER_URL, {
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
    throw new Error(`Calendly DCR failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { client_id: string };
  return data.client_id;
}

/** Ensures a "calendly" McpServer row exists, creating it if necessary. */
async function ensureCalendlyServer() {
  const existing = await prisma.mcpServer.findUnique({ where: { type: "calendly" } });
  if (existing) return existing;
  return prisma.mcpServer.create({
    data: {
      type: "calendly",
      name: "Calendly",
      url: "https://mcp.calendly.com",
      description: "Calendly scheduling integration — manage event types, availability, and bookings.",
      transport: "http",
      writeToolPolicy: {
        mode: "allowlist",
        tools: [
          "event_types-create_event_type",
          "event_types-update_event_type",
          "event_types-update_event_type_availability_schedule",
          "meetings-cancel_event",
          "meetings-create_invitee",
          "meetings-create_invitee_no_show",
          "meetings-delete_invitee_no_show",
          "scheduling_links-create_single_use_scheduling_link",
          "shares-create_share",
          "organizations-create_organization_invitation",
          "organizations-revoke_organization_invitation",
          "organizations-delete_organization_membership",
        ],
      },
      healthcheckSpec: { name: "users-get_current_user", params: {} },
      connectorMeta: { scope: "global", mode: "self-serve" },
    },
  });
}

const router = Router();
router.use("/:userId", pinUserIdParam);

// ── Token endpoint ─────────────────────────────────────────────────────────

/**
 * Live Calendly access-token provider for the shared `/oauth/:provider/token`
 * route (see lib/oauth-token-endpoint.ts). Public client — clientId in the
 * refresh body, no secret; Calendly may rotate the refresh token.
 */
export const calendlyOAuthProvider: OAuthTokenProvider = {
  serverType: "calendly",
  label: "Calendly",
  async refresh(creds) {
    const c = creds as unknown as CalendlyTokens;

    const refreshRes = await fetch(CALENDLY_TOKEN_URL, {
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
      // Calendly may rotate the refresh token — always take the new one if provided.
      refreshToken: tokens.refresh_token ?? c.refreshToken,
      expires: Date.now() + tokens.expires_in * 1000,
    };
  },
};

// ── Authorize endpoint ─────────────────────────────────────────────────────

/**
 * POST /:userId/oauth/calendly/authorize
 * Performs DCR, builds the PKCE consent URL, and returns it for the frontend
 * to redirect the user to.
 */
router.post("/:userId/oauth/calendly/authorize", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { redirectUri } = req.body as { redirectUri?: string };

    const callbackUri =
      redirectUri ??
      `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/calendly/callback`;

    // DCR — register a fresh public client for this authorization attempt.
    const clientId = await registerCalendlyClient(callbackUri);

    // PKCE
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = deriveCodeChallenge(codeVerifier);

    // Encode all state needed for the callback into the state param.
    const state = encodeState({ userId, clientId, codeVerifier, redirectUri: callbackUri });

    const authUrl = new URL(CALENDLY_AUTH_URL);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", callbackUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", state);

    res.json({ success: true, data: { authUrl: authUrl.toString() } });
  } catch (err) {
    log.error("[calendly-oauth] authorize error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Programmatic callback (POST) ───────────────────────────────────────────

/**
 * POST /:userId/oauth/calendly/callback
 * Programmatic token exchange — frontend passes code + state from query params.
 * Decodes state to get clientId + codeVerifier, then exchanges the code.
 */
router.post("/:userId/oauth/calendly/callback", async (req: Request<{ userId: string }>, res: Response) => {
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

    const tokenRes = await fetch(CALENDLY_TOKEN_URL, {
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
      log.error(`[calendly-oauth] Token exchange failed for user ${userId}: ${tokenRes.status} ${text}`);
      res.status(502).json({ success: false, error: "Calendly token exchange failed" });
      return;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    await storeCalendlyTokens(userId, clientId, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    log.info(`[calendly-oauth] Stored Calendly credentials for user ${userId}`);
    res.json({ success: true, data: { message: "Calendly account connected successfully" } });
  } catch (err) {
    log.error("[calendly-oauth] callback error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Browser-redirect callback (GET) ───────────────────────────────────────

/**
 * GET /calendly/callback
 * Browser-redirect callback from Calendly consent screen.
 * Calendly redirects here with ?code=...&state=<base64url-encoded-payload>
 */
export const calendlyCallbackRouter = Router();

calendlyCallbackRouter.get("/calendly/callback", async (req: Request, res: Response) => {
  const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5174/claw/";

  try {
    const { code, state, error: oauthError } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (oauthError) {
      log.error(`[calendly-oauth] OAuth error: ${oauthError}`);
      res.redirect(`${frontendUrl}?calendly_error=${encodeURIComponent(oauthError)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}?calendly_error=missing_code_or_state`);
      return;
    }

    let statePayload: StatePayload;
    try {
      statePayload = decodeState(state);
    } catch {
      res.redirect(`${frontendUrl}?calendly_error=invalid_state`);
      return;
    }

    const { userId, clientId, codeVerifier, redirectUri } = statePayload;

    const tokenRes = await fetch(CALENDLY_TOKEN_URL, {
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
      log.error(`[calendly-oauth] Browser callback token exchange failed: ${tokenRes.status} ${text}`);
      res.redirect(`${frontendUrl}?calendly_error=token_exchange_failed`);
      return;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      log.error(`[calendly-oauth] User not found: ${userId}`);
      res.redirect(`${frontendUrl}?calendly_error=user_not_found`);
      return;
    }

    await storeCalendlyTokens(userId, clientId, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    log.info(`[calendly-oauth] Stored Calendly credentials for user ${userId} via browser callback`);
    res.redirect(`${frontendUrl}?calendly_connected=true`);
  } catch (err) {
    log.error("[calendly-oauth] browser callback error:", err);
    res.redirect(`${frontendUrl}?calendly_error=internal_error`);
  }
});

// ── Shared helper ──────────────────────────────────────────────────────────

async function storeCalendlyTokens(
  userId: string,
  clientId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): Promise<void> {
  const creds: CalendlyTokens = {
    clientId,
    accessToken,
    refreshToken,
    expires: Date.now() + expiresIn * 1000,
  };

  const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);
  const server = await ensureCalendlyServer();

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
  await evictSession(userId, "calendly").catch(() => {});

  // Sync tools from the Calendly MCP server into the DB so the agent can use them.
  syncToolsForServer(userId, "calendly", server.name, { accessToken, refreshToken, clientId }).catch((err) => {
    log.error(`[calendly-oauth] tool sync failed for user ${userId}:`, err);
  });
}

export { router as calendlyOAuthRouter };
