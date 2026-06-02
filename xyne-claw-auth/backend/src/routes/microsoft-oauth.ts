/**
 * Microsoft OAuth routes for xyne-claw-auth.
 * Handles:
 *  - Token retrieval (with auto-refresh) for xyne-claw
 *  - OAuth authorize/callback flow for user connection setup
 *
 * Uses Microsoft Identity Platform v2.0 with tenant-specific endpoint.
 * Token endpoint: https://login.microsoftonline.com/{tenant}/oauth2/v2.0
 */

import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { signOAuthState, verifyOAuthState, OAuthStateError } from "../lib/oauth-state.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";

const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  // Outlook Mail (read + draft creation)
  "Mail.Read",
  "Mail.ReadWrite",
  // Calendar
  "Calendars.ReadWrite",
  // Contacts & People
  "Contacts.Read",
  "People.Read",
  // Tasks (To Do)
  "Tasks.ReadWrite",
  // OneDrive
  "Files.Read.All",
  // Teams
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
  "ChannelMessage.Read.All",
  "ChannelMessage.Send",
  "Chat.Read",
  "Chat.ReadWrite",
  "ChatMessage.Read",
  "ChatMessage.Send",
  // User profile
  "User.Read",
];

function getMicrosoftCredentials(): { clientId: string; clientSecret: string; tenantId: string } {
  const clientId = process.env["MICROSOFT_CLIENT_ID"];
  const clientSecret = process.env["MICROSOFT_CLIENT_SECRET"];
  const tenantId = process.env["MICROSOFT_TENANT_ID"] ?? "common";
  if (!clientId || !clientSecret) {
    throw new Error("MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are required");
  }
  return { clientId, clientSecret, tenantId };
}

interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
  expires: number;
}

const router = Router();
router.use("/:userId", pinUserIdParam);

/**
 * GET /:userId/oauth/microsoft/token
 * Returns a valid Microsoft access token for the user (refreshes if expired).
 * Called by xyne-claw before running microsoft-agent tasks.
 */
router.get("/:userId/oauth/microsoft/token", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;

    const connection = await prisma.userMcpConnection.findFirst({
      where: { userId, mcpServer: { type: "microsoft" } },
      include: { mcpServer: true },
    });

    if (!connection) {
      res.status(404).json({ success: false, error: "No Microsoft connection found for this user" });
      return;
    }

    const decrypted = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
    const creds = JSON.parse(decrypted) as MicrosoftTokens;

    // Check if token is expired (with 60s buffer)
    if (Date.now() > creds.expires - 60_000) {
      const { clientId, clientSecret, tenantId } = getMicrosoftCredentials();

      const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
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
        const text = await response.text();
        console.error(`[microsoft-oauth] Token refresh failed for user ${userId}: ${response.status} ${text}`);
        res.status(502).json({ success: false, error: "Microsoft token refresh failed" });
        return;
      }

      const tokens = (await response.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };

      // Microsoft rotates refresh tokens — always store the new one
      const newCreds: MicrosoftTokens = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expires: Date.now() + tokens.expires_in * 1000,
      };

      const { ciphertext, iv, authTag } = encrypt(JSON.stringify(newCreds), CONFIG.encryptionKey);
      await prisma.userMcpConnection.update({
        where: { id: connection.id },
        data: { encryptedCreds: ciphertext, iv, authTag },
      });

      res.json({ success: true, data: { accessToken: tokens.access_token } });
    } else {
      res.json({ success: true, data: { accessToken: creds.accessToken } });
    }
  } catch (err) {
    console.error("[microsoft-oauth] token error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /:userId/oauth/microsoft/authorize
 * Start the Microsoft OAuth flow. Returns the consent URL.
 * The frontend redirects the user to this URL.
 */
router.post("/:userId/oauth/microsoft/authorize", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { redirectUri } = req.body as { redirectUri?: string };

    const callbackUri = redirectUri ?? `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/microsoft/callback`;

    const { clientId, tenantId } = getMicrosoftCredentials();

    const authUrl = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", callbackUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
    authUrl.searchParams.set("response_mode", "query");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", signOAuthState(userId));

    res.json({ success: true, data: { authUrl: authUrl.toString() } });
  } catch (err) {
    console.error("[microsoft-oauth] authorize error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * POST /:userId/oauth/microsoft/callback
 * Exchange the authorization code for tokens and store encrypted credentials.
 */
router.post("/:userId/oauth/microsoft/callback", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { code, redirectUri } = req.body as { code?: string; redirectUri?: string };

    if (!code || !redirectUri) {
      res.status(400).json({ success: false, error: "code and redirectUri are required" });
      return;
    }

    const { clientId, clientSecret, tenantId } = getMicrosoftCredentials();

    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
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
      console.error(`[microsoft-oauth] Token exchange failed for user ${userId}: ${response.status} ${text}`);
      res.status(502).json({ success: false, error: "Microsoft token exchange failed" });
      return;
    }

    const tokens = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const creds: MicrosoftTokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expires: Date.now() + tokens.expires_in * 1000,
    };

    const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);

    let microsoftServer = await prisma.mcpServer.findUnique({ where: { type: "microsoft" } });
    if (!microsoftServer) {
      microsoftServer = await prisma.mcpServer.create({
        data: {
          type: "microsoft",
          name: "Microsoft",
          url: "",
          description: "Microsoft OAuth integration (Outlook, Calendar, Contacts, To Do, OneDrive, Teams)",
        },
      });
    }

    const existing = await prisma.userMcpConnection.findFirst({
      where: { userId, mcpServerId: microsoftServer.id },
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
          mcpServerId: microsoftServer.id,
          encryptedCreds: ciphertext,
          iv,
          authTag,
        },
      });
    }

    console.log(`[microsoft-oauth] Stored Microsoft credentials for user ${userId}`);
    res.json({ success: true, data: { message: "Microsoft account connected successfully" } });
  } catch (err) {
    console.error("[microsoft-oauth] callback error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

/**
 * GET /microsoft/callback
 * Browser-redirect callback from Microsoft OAuth.
 * Microsoft redirects here with ?code=...&state=userId
 * We exchange the code, store tokens, and redirect back to the frontend.
 */
export const microsoftCallbackRouter = Router();

microsoftCallbackRouter.get("/microsoft/callback", async (req: Request, res: Response) => {
  const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5174/claw/";

  try {
    const { code, state, error: oauthError, error_description } = req.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };

    if (oauthError) {
      console.error(`[microsoft-oauth] OAuth error: ${oauthError} — ${error_description}`);
      res.redirect(`${frontendUrl}?microsoft_error=${encodeURIComponent(oauthError)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}?microsoft_error=missing_code_or_state`);
      return;
    }

    let userId: string;
    try {
      userId = verifyOAuthState(state).userId;
    } catch (err) {
      const reason = err instanceof OAuthStateError ? err.reason : "malformed";
      console.error(`[microsoft-oauth] state ${reason}`);
      res.redirect(`${frontendUrl}?microsoft_error=invalid_state`);
      return;
    }

    const { clientId, clientSecret, tenantId } = getMicrosoftCredentials();

    const redirectUri = `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/microsoft/callback`;

    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
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
      console.error(`[microsoft-oauth] Token exchange failed: ${response.status} ${text}`);
      res.redirect(`${frontendUrl}?microsoft_error=token_exchange_failed`);
      return;
    }

    const tokens = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const creds: MicrosoftTokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expires: Date.now() + tokens.expires_in * 1000,
    };

    const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);

    let microsoftServer = await prisma.mcpServer.findUnique({ where: { type: "microsoft" } });
    if (!microsoftServer) {
      microsoftServer = await prisma.mcpServer.create({
        data: {
          type: "microsoft",
          name: "Microsoft",
          url: "",
          description: "Microsoft OAuth integration (Outlook, Calendar, Contacts, To Do, OneDrive, Teams)",
        },
      });
    }

    const existing = await prisma.userMcpConnection.findFirst({
      where: { userId, mcpServerId: microsoftServer.id },
    });

    if (existing) {
      await prisma.userMcpConnection.update({
        where: { id: existing.id },
        data: { encryptedCreds: ciphertext, iv, authTag },
      });
    } else {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        console.error(`[microsoft-oauth] User not found: ${userId}`);
        res.redirect(`${frontendUrl}?microsoft_error=user_not_found`);
        return;
      }

      await prisma.userMcpConnection.create({
        data: {
          userId,
          mcpServerId: microsoftServer.id,
          encryptedCreds: ciphertext,
          iv,
          authTag,
        },
      });
    }

    console.log(`[microsoft-oauth] Stored Microsoft credentials for user ${userId} via browser callback`);
    res.redirect(`${frontendUrl}?microsoft_connected=true`);
  } catch (err) {
    console.error("[microsoft-oauth] browser callback error:", err);
    res.redirect(`${frontendUrl}?microsoft_error=internal_error`);
  }
});

export { router as microsoftOAuthRouter };
