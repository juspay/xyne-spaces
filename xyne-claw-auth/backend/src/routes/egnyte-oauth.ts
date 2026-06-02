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

import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { syncToolsForServer } from "../tool-sync.js";
import { evictSession } from "../mcp/runner.js";
import { signOAuthState, verifyOAuthState, OAuthStateError } from "../lib/oauth-state.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";

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
    update: { writeToolPolicy: { mode: "allowlist", tools: writeTools }, healthcheckSpec, transport: "http" },
    create: {
      type: "egnyte",
      name: "Egnyte",
      url: "",
      description: "Egnyte content platform — search, manage, and collaborate on files and folders.",
      transport: "http",
      writeToolPolicy: { mode: "allowlist", tools: writeTools },
      healthcheckSpec,
      connectorMeta: { scope: "global", mode: "self-serve" },
    },
  });
}

const router = Router();
router.use("/:userId", pinUserIdParam);

// ── Token endpoint ─────────────────────────────────────────────────────────

/**
 * GET /:userId/oauth/egnyte/token
 * Returns a valid Egnyte access token, refreshing if within 60 s of expiry.
 */
router.get("/:userId/oauth/egnyte/token", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;

    const connection = await prisma.userMcpConnection.findFirst({
      where: { userId, mcpServer: { type: "egnyte" } },
      include: { mcpServer: true },
    });

    if (!connection) {
      res.status(404).json({ success: false, error: "No Egnyte connection found for this user" });
      return;
    }

    const decrypted = decrypt(connection.encryptedCreds, connection.iv, connection.authTag, CONFIG.encryptionKey);
    const creds = JSON.parse(decrypted) as EgnyteTokens;

    if (Date.now() <= creds.expires - 60_000) {
      res.json({ success: true, data: { accessToken: creds.accessToken, domain: creds.domain } });
      return;
    }

    const { clientId, clientSecret } = getEgnyteCredentials();

    const refreshRes = await fetch(egnyteTokenUrl(creds.domain), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!refreshRes.ok) {
      const text = await refreshRes.text();
      console.error(`[egnyte-oauth] Token refresh failed for user ${userId}: ${refreshRes.status} ${text}`);
      res.status(502).json({ success: false, error: "Egnyte token refresh failed" });
      return;
    }

    const tokens = (await refreshRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const newCreds: EgnyteTokens = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? creds.refreshToken,
      domain: creds.domain,
      // Egnyte tokens are typically valid for 3600 s; fall back if omitted.
      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    };

    const { ciphertext, iv, authTag } = encrypt(JSON.stringify(newCreds), CONFIG.encryptionKey);
    await prisma.userMcpConnection.update({
      where: { id: connection.id },
      data: { encryptedCreds: ciphertext, iv, authTag },
    });

    res.json({ success: true, data: { accessToken: tokens.access_token, domain: creds.domain } });
  } catch (err) {
    console.error("[egnyte-oauth] token error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Authorize endpoint ─────────────────────────────────────────────────────

/**
 * POST /:userId/oauth/egnyte/authorize
 * Body: { domain: string, redirectUri?: string }
 * Returns the Egnyte consent URL with an HMAC-signed `state` that includes the domain.
 */
router.post("/:userId/oauth/egnyte/authorize", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { redirectUri } = req.body as { redirectUri?: string };

    const envDomain = process.env["EGNYTE_DOMAIN"];
    if (!envDomain || envDomain.trim().length === 0) {
      res.status(500).json({ success: false, error: "EGNYTE_DOMAIN is not configured on the server" });
      return;
    }

    // Normalise — strip scheme and .egnyte.com suffix if someone put the full host in .env.
    const normalizedDomain = envDomain
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/\.egnyte\.com$/i, "");

    const { clientId } = getEgnyteCredentials();
    const callbackUri = redirectUri ?? defaultCallbackUri();

    // Encode the domain into the signed state so the callback can use it.
    const state = signOAuthState(userId, { domain: normalizedDomain, redirectUri: callbackUri });

    const authUrl = new URL(egnyteAuthUrl(normalizedDomain));
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", callbackUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);

    res.json({ success: true, data: { authUrl: authUrl.toString() } });
  } catch (err) {
    console.error("[egnyte-oauth] authorize error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Programmatic callback (POST) ───────────────────────────────────────────

/**
 * POST /:userId/oauth/egnyte/callback
 * Programmatic code exchange — frontend passes code + state from the redirect URL.
 */
router.post("/:userId/oauth/egnyte/callback", async (req: Request<{ userId: string }>, res: Response) => {
  try {
    const { userId } = req.params;
    const { code, state } = req.body as { code?: string; state?: string };

    if (!code || !state) {
      res.status(400).json({ success: false, error: "code and state are required" });
      return;
    }

    let verified;
    try {
      verified = verifyOAuthState(state);
    } catch (err) {
      const reason = err instanceof OAuthStateError ? err.reason : "malformed";
      res.status(400).json({ success: false, error: `Invalid state (${reason})` });
      return;
    }

    if (verified.userId !== userId) {
      res.status(403).json({ success: false, error: "State userId mismatch" });
      return;
    }

    const domain = verified.extra?.["domain"] as string | undefined;
    const redirectUri = (verified.extra?.["redirectUri"] as string | undefined) ?? defaultCallbackUri();

    if (!domain) {
      res.status(400).json({ success: false, error: "domain missing from state" });
      return;
    }

    const result = await exchangeAndStore(userId, code, domain, redirectUri);
    if (!result.ok) {
      res.status(result.status).json({ success: false, error: result.error });
      return;
    }

    res.json({ success: true, data: { message: "Egnyte account connected successfully" } });
  } catch (err) {
    console.error("[egnyte-oauth] callback error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Browser-redirect callback (GET) ───────────────────────────────────────

/**
 * GET /egnyte/callback
 * Egnyte redirects here with ?code=...&state=<signed-state>.
 */
export const egnyteCallbackRouter = Router();

egnyteCallbackRouter.get("/egnyte/callback", async (req: Request, res: Response) => {
  const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5174/claw/";

  try {
    const { code, state, error: oauthError } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    if (oauthError) {
      console.error(`[egnyte-oauth] OAuth error: ${oauthError}`);
      res.redirect(`${frontendUrl}?egnyte_error=${encodeURIComponent(oauthError)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}?egnyte_error=missing_code_or_state`);
      return;
    }

    let verified;
    try {
      verified = verifyOAuthState(state);
    } catch (err) {
      const reason = err instanceof OAuthStateError ? err.reason : "malformed";
      console.error(`[egnyte-oauth] state ${reason}`);
      res.redirect(`${frontendUrl}?egnyte_error=invalid_state`);
      return;
    }

    const userId = verified.userId;
    const domain = verified.extra?.["domain"] as string | undefined;
    const redirectUri = (verified.extra?.["redirectUri"] as string | undefined) ?? defaultCallbackUri();

    if (!domain) {
      res.redirect(`${frontendUrl}?egnyte_error=missing_domain_in_state`);
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      console.error(`[egnyte-oauth] User not found: ${userId}`);
      res.redirect(`${frontendUrl}?egnyte_error=user_not_found`);
      return;
    }

    const result = await exchangeAndStore(userId, code, domain, redirectUri);
    if (!result.ok) {
      res.redirect(`${frontendUrl}?egnyte_error=${encodeURIComponent(result.code)}`);
      return;
    }

    console.log(`[egnyte-oauth] Stored Egnyte credentials for user ${userId} (domain: ${domain}.egnyte.com)`);
    res.redirect(`${frontendUrl}?egnyte_connected=true`);
  } catch (err) {
    console.error("[egnyte-oauth] browser callback error:", err);
    res.redirect(`${frontendUrl}?egnyte_error=internal_error`);
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
    console.error(`[egnyte-oauth] Token exchange failed: ${tokenRes.status} ${text}`);
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
    console.error(`[egnyte-oauth] tool sync failed for user ${userId}:`, err);
  });
}

export { router as egnyteOAuthRouter };
