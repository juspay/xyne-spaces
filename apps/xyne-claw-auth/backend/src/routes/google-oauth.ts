/**
 * Google OAuth routes for xyne-claw-auth.
 * Handles:
 *  - Token retrieval (with auto-refresh) for xyne-claw
 *  - OAuth authorize/callback flow for user connection setup
 */

import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { signOAuthState, verifyOAuthState, OAuthStateError } from "../lib/oauth-state.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { type OAuthTokenProvider, TokenRefreshError } from "../lib/oauth-token-endpoint.js";

import { createLogger } from "../logger.js";
const log = createLogger("google-oauth");

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/tasks",
  // Needed for creating/updating spreadsheets and sheet values.
  "https://www.googleapis.com/auth/spreadsheets",
  // Needed for creating/updating Google Docs document content.
  "https://www.googleapis.com/auth/documents",
  // Needed for creating/updating Google Slides presentations.
  "https://www.googleapis.com/auth/presentations",
  // Needed for reading/updating Google Forms structure/content.
  "https://www.googleapis.com/auth/forms.body",
  // Needed for reading Google Forms response data.
  "https://www.googleapis.com/auth/forms.responses.readonly",
  // Needed for creating/managing Sheets files the app can access/write.
  "https://www.googleapis.com/auth/drive.file",
  // Needed for searching/reading all user Drive files (not just app-created ones).
  "https://www.googleapis.com/auth/drive.readonly",
];

function getGoogleCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required");
  }
  return { clientId, clientSecret };
}

interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expires: number;
}

const router = Router();
router.use("/:userId", pinUserIdParam);

/**
 * Live Google access-token provider for the shared `/oauth/:provider/token`
 * route (see lib/oauth-token-endpoint.ts). Google does NOT rotate refresh
 * tokens, so the stored refreshToken is carried forward unchanged.
 */
export const googleOAuthProvider: OAuthTokenProvider = {
  serverType: "google",
  label: "Google",
  async refresh(creds) {
    const { clientId, clientSecret } = getGoogleCredentials();

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      throw new TokenRefreshError(502, `${response.status} ${await response.text()}`);
    }

    const tokens = (await response.json()) as { access_token: string; expires_in: number };
    return {
      accessToken: tokens.access_token,
      refreshToken: creds.refreshToken, // Google doesn't rotate refresh tokens
      expires: Date.now() + tokens.expires_in * 1000,
    };
  },
};

/**
 * POST /:userId/oauth/google/authorize
 * Start the Google OAuth flow. Returns the consent URL.
 * The frontend redirects the user to this URL.
 */
router.post("/:userId/oauth/google/authorize", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { redirectUri } = req.body as { redirectUri?: string };

    // Default to the browser-based GET callback
    const callbackUri = redirectUri ?? `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/google/callback`;

    const { clientId } = getGoogleCredentials();

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", callbackUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", signOAuthState(userId));

    res.json({ success: true, data: { authUrl: authUrl.toString() } });
  } catch (err) {
    log.error("[google-oauth] authorize error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /:userId/oauth/google/callback
 * Exchange the authorization code for tokens and store encrypted credentials.
 */
router.post("/:userId/oauth/google/callback", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { code, redirectUri } = req.body as { code?: string; redirectUri?: string };

    if (!code || !redirectUri) {
      res.status(400).json({ success: false, error: "code and redirectUri are required" });
      return;
    }

    const { clientId, clientSecret } = getGoogleCredentials();

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error(`[google-oauth] Token exchange failed for user ${userId}: ${response.status} ${text}`);
      res.status(502).json({ success: false, error: "Google token exchange failed" });
      return;
    }

    const tokens = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const creds: GoogleTokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expires: Date.now() + tokens.expires_in * 1000,
    };

    const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);

    // Ensure "google" server type exists
    let googleServer = await prisma.mcpServer.findUnique({ where: { type: "google" } });
    if (!googleServer) {
      googleServer = await prisma.mcpServer.create({
        data: {
          type: "google",
          name: "Google",
          url: "",
          description: "Google OAuth integration (Gmail, Calendar, Contacts, Tasks, Drive)",
        },
      });
    }

    // Upsert the connection
    const existing = await prisma.userMcpConnection.findFirst({
      where: { userId, mcpServerId: googleServer.id },
    });

    if (existing) {
      await prisma.userMcpConnection.update({
        where: { id: existing.id },
        data: { encryptedCreds: ciphertext, iv, authTag },
      });
    } else {
      await prisma.userMcpConnection.create({
        data: {
          userId,
          mcpServerId: googleServer.id,
          encryptedCreds: ciphertext,
          iv,
          authTag,
        },
      });
    }

    log.info(`[google-oauth] Stored Google credentials for user ${userId}`);
    res.json({ success: true, data: { message: "Google account connected successfully" } });
  } catch (err) {
    log.error("[google-oauth] callback error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /google/callback
 * Browser-redirect callback from Google OAuth.
 * Google redirects here with ?code=...&state=userId
 * We exchange the code, store tokens, and redirect back to the frontend.
 */
export const googleCallbackRouter = Router();

googleCallbackRouter.get("/google/callback", async (req: Request, res: Response) => {
  const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5174/claw/";

  try {
    const { code, state, error: oauthError } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (oauthError) {
      log.error(`[google-oauth] OAuth error: ${oauthError}`);
      res.redirect(`${frontendUrl}?google_error=${encodeURIComponent(oauthError)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}?google_error=missing_code_or_state`);
      return;
    }

    let userId: string;
    try {
      userId = verifyOAuthState(state).userId;
    } catch (err) {
      const reason = err instanceof OAuthStateError ? err.reason : "malformed";
      log.error(`[google-oauth] state ${reason}`);
      res.redirect(`${frontendUrl}?google_error=invalid_state`);
      return;
    }

    const { clientId, clientSecret } = getGoogleCredentials();

    // The redirect URI must match exactly what was sent in the authorize step
    const redirectUri = `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/google/callback`;

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error(`[google-oauth] Token exchange failed: ${response.status} ${text}`);
      res.redirect(`${frontendUrl}?google_error=token_exchange_failed`);
      return;
    }

    const tokens = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const creds: GoogleTokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expires: Date.now() + tokens.expires_in * 1000,
    };

    const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);

    // Ensure "google" server type exists
    let googleServer = await prisma.mcpServer.findUnique({ where: { type: "google" } });
    if (!googleServer) {
      googleServer = await prisma.mcpServer.create({
        data: {
          type: "google",
          name: "Google",
          url: "",
          description: "Google OAuth integration (Gmail, Calendar, Contacts, Tasks, Drive)",
        },
      });
    }

    // Upsert the connection
    const existing = await prisma.userMcpConnection.findFirst({
      where: { userId, mcpServerId: googleServer.id },
    });

    if (existing) {
      await prisma.userMcpConnection.update({
        where: { id: existing.id },
        data: { encryptedCreds: ciphertext, iv, authTag },
      });
    } else {
      // Ensure user exists
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        log.error(`[google-oauth] User not found: ${userId}`);
        res.redirect(`${frontendUrl}?google_error=user_not_found`);
        return;
      }

      await prisma.userMcpConnection.create({
        data: {
          userId,
          mcpServerId: googleServer.id,
          encryptedCreds: ciphertext,
          iv,
          authTag,
        },
      });
    }

    log.info(`[google-oauth] Stored Google credentials for user ${userId} via browser callback`);
    res.redirect(`${frontendUrl}?google_connected=true`);
  } catch (err) {
    log.error("[google-oauth] browser callback error:", err);
    res.redirect(`${frontendUrl}?google_error=internal_error`);
  }
});

export { router as googleOAuthRouter };
