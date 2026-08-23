/**
 * Factory for public-client DCR OAuth flows in xyne-claw-auth.
 *
 * Several MCP connectors (attio, calendly, customerio, honeycomb, jotform,
 * mailerlite, webflow, wix) speak OAuth 2.1 with Dynamic Client Registration
 * (DCR, RFC 7591) + PKCE (S256) as PUBLIC clients (token_endpoint_auth_method:
 * none — no pre-registered client_id/client_secret). Their route files were
 * byte-for-byte identical except for a handful of values (endpoints, scope,
 * the McpServer descriptor, and whether the browser callback checks that the
 * user still exists). That skeleton — DCR, PKCE, HMAC-signed state, token
 * exchange, encrypt + persist, tool sync, and the live refresh() provider —
 * lived copy-pasted in every file.
 *
 * This module holds that skeleton ONCE. Each connector contributes only a
 * `DcrOAuthFlowConfig`; `buildDcrOAuthFlow(config)` returns the three symbols
 * each connector already exported: `{ oauthRouter, callbackRouter,
 * tokenProvider }`, so main.ts / oauth-token.ts wiring is unchanged.
 *
 * SCOPE: public clients only. Confidential clients (miro — DCR issues a
 * client_secret that is threaded through the signed state and both token
 * bodies) are NOT handled here; passing `clientAuth: "client_secret_post"`
 * throws, and miro keeps its bespoke route file until that axis is added.
 */

import { randomBytes, createHash } from "crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { encrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { syncToolsForServer } from "../tool-sync.js";
import { evictSession } from "../mcp/runner.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { type OAuthTokenProvider, TokenRefreshError } from "./oauth-token-endpoint.js";
import { signOAuthState, verifyOAuthState } from "./oauth-state.js";
import { createLogger } from "../logger.js";

/** Permissive McpServer create spec — typed locally so we never import Prisma types. */
interface McpServerSpec {
  type: string;
  name: string;
  url: string;
  description: string;
  transport: string;
  writeToolPolicy?: { mode: string; tools: string[] };
  healthcheckSpec?: { name: string; params: Record<string, unknown> };
  connectorMeta?: { scope: string; mode: string };
  [key: string]: unknown;
}

export interface DcrOAuthFlowConfig {
  /** McpServer.type + route segment + query-param prefix + evict/sync key, e.g. "attio". */
  provider: string;
  /** Human label for messages, e.g. "Attio". */
  label: string;
  /** OAuth endpoints (from the provider's discovery document). */
  registerUrl: string;
  authUrl: string;
  tokenUrl: string;
  /** Space-delimited default scope, e.g. "mcp offline_access". */
  scope: string;
  /** When true, the authorize handler honors a `scope` override in the request body. */
  scopeOverridable?: boolean;
  /** When true, the requested scope is also sent in the DCR registration body. */
  scopeInDcrBody?: boolean;
  /** DCR client_name (default "Xyne Claw"). */
  clientName?: string;
  /**
   * When true, the browser (GET) callback verifies the user still exists before
   * storing tokens, redirecting `?<provider>_error=user_not_found` if not.
   * (Variant B: calendly, customerio, honeycomb, jotform, webflow, wix.)
   */
  checkUserExists?: boolean;
  /** Public vs confidential client. Only "none" is supported here. */
  clientAuth?: "none" | "client_secret_post";
  /** McpServer row created on first successful connect. */
  serverSpec: McpServerSpec;
  /** Path of the auth-service callback registered with the provider (default derived). */
  defaultCallbackPath?: string;
  /** Path of the browser-redirect GET callback route (default `/<provider>/callback`). */
  browserCallbackPath?: string;
}

interface DcrTokens {
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
  scope: string;
}

interface FlowHandles {
  /** Programmatic router: pinUserIdParam + POST authorize + POST callback. */
  oauthRouter: Router;
  /** Browser-redirect GET callback router. */
  callbackRouter: Router;
  /** Live access-token provider for the shared /oauth/:provider/token route. */
  tokenProvider: OAuthTokenProvider;
}

/** Generates a PKCE code verifier (43 random url-safe bytes). */
function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** Derives the S256 code challenge from a verifier. */
function deriveCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildDcrOAuthFlow(config: DcrOAuthFlowConfig): FlowHandles {
  if (config.clientAuth === "client_secret_post") {
    throw new Error(
      `buildDcrOAuthFlow: confidential clients are not supported (provider "${config.provider}")`,
    );
  }

  const { provider, label, registerUrl, authUrl, tokenUrl } = config;
  const log = createLogger(`${provider}-oauth`);
  const clientName = config.clientName ?? "Xyne Claw";
  const defaultCallbackPath = config.defaultCallbackPath ?? `/claw/api/v1/${provider}/callback`;
  const browserCallbackPath = config.browserCallbackPath ?? `/${provider}/callback`;

  // ── HMAC-signed state — prevents an attacker from forging state={userId:victim}
  // to bind their provider account to a victim (or capture victim tokens). ──
  function encodeState(payload: StatePayload): string {
    const { userId, ...extra } = payload;
    return signOAuthState(userId, extra);
  }

  function decodeState(state: string): StatePayload {
    // Throws OAuthStateError on tampered/expired state; callers try/catch this.
    const verified = verifyOAuthState(state);
    return { userId: verified.userId, ...(verified.extra ?? {}) } as StatePayload;
  }

  /** Performs DCR and returns the dynamically issued client_id. */
  async function registerClient(redirectUri: string, scope: string): Promise<string> {
    const body: Record<string, unknown> = {
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
    if (config.scopeInDcrBody) body["scope"] = scope;

    const res = await fetch(registerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${label} DCR failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { client_id: string };
    return data.client_id;
  }

  /** Ensures the connector's McpServer row exists, creating it if necessary. */
  async function ensureServer() {
    const existing = await prisma.mcpServer.findUnique({ where: { type: provider } });
    if (existing) return existing;
    return prisma.mcpServer.create({ data: config.serverSpec });
  }

  /** Exchanges an authorization code for tokens via PKCE (public client, no secret). */
  async function exchangeCode(payload: StatePayload, code: string) {
    const { clientId, codeVerifier, redirectUri } = payload;
    const tokenRes = await fetch(tokenUrl, {
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
      log.error(`[${provider}-oauth] Token exchange failed: ${tokenRes.status} ${text}`);
      return null;
    }

    return (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
  }

  async function storeTokens(
    userId: string,
    clientId: string,
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ): Promise<void> {
    const creds: DcrTokens = {
      clientId,
      accessToken,
      refreshToken,
      expires: Date.now() + expiresIn * 1000,
    };

    const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);
    const server = await ensureServer();

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

    await evictSession(userId, provider).catch(() => {});

    syncToolsForServer(userId, provider, server.name, { accessToken, refreshToken, clientId }).catch(
      (err) => {
        log.error(`[${provider}-oauth] Tool sync failed for user ${userId}:`, err);
      },
    );
  }

  // ── Token endpoint provider ──────────────────────────────────────────────

  const tokenProvider: OAuthTokenProvider = {
    serverType: provider,
    label,
    async refresh(creds) {
      const c = creds as unknown as DcrTokens;

      const refreshRes = await fetch(tokenUrl, {
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

  // ── Programmatic router (authorize + POST callback) ───────────────────────

  const router = Router();

  // CSRF / IDOR guard — the `/:userId` path param must match the requester's
  // session userId or pinUserIdParam rejects with 403. requireAuth (at the
  // mount) is what sets x-user-id from the cookie session in the first place.
  router.use("/:userId", pinUserIdParam);

  /**
   * POST /:userId/oauth/<provider>/authorize
   * Runs DCR, builds the PKCE consent URL, and returns it for the frontend
   * to redirect the user to.
   */
  router.post(
    `/:userId/oauth/${provider}/authorize`,
    async (req: Request<{ userId: string }>, res: Response) => {
      try {
        const { userId } = req.params;
        const body = req.body as { redirectUri?: string; scope?: string };

        const callbackUri =
          body.redirectUri ??
          `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}${defaultCallbackPath}`;

        const scope = config.scopeOverridable && body.scope ? body.scope : config.scope;

        // DCR — register a fresh public client for this authorization attempt.
        const clientId = await registerClient(callbackUri, scope);

        // PKCE
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = deriveCodeChallenge(codeVerifier);

        const state = encodeState({
          userId,
          clientId,
          codeVerifier,
          redirectUri: callbackUri,
          scope,
        });

        const url = new URL(authUrl);
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", callbackUri);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", scope);
        url.searchParams.set("code_challenge", codeChallenge);
        url.searchParams.set("code_challenge_method", "S256");
        url.searchParams.set("state", state);

        res.json({ success: true, data: { authUrl: url.toString() } });
      } catch (err) {
        log.error(`[${provider}-oauth] authorize error:`, err);
        res.status(500).json({ success: false, error: "Internal server error" });
      }
    },
  );

  /**
   * POST /:userId/oauth/<provider>/callback
   * Programmatic token exchange — frontend passes code + state.
   */
  router.post(
    `/:userId/oauth/${provider}/callback`,
    async (req: Request<{ userId: string }>, res: Response) => {
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

        const tokens = await exchangeCode(statePayload, code);
        if (!tokens) {
          res
            .status(500)
            .json({ success: false, error: "Failed to exchange authorization code" });
          return;
        }

        await storeTokens(
          userId,
          statePayload.clientId,
          tokens.access_token,
          tokens.refresh_token,
          tokens.expires_in,
        );

        log.info(`[${provider}-oauth] Stored ${label} credentials for user ${userId}`);
        res.json({
          success: true,
          data: { message: `${label} account connected successfully` },
        });
      } catch (err) {
        log.error(`[${provider}-oauth] callback error:`, err);
        res.status(500).json({ success: false, error: "Internal server error" });
      }
    },
  );

  // ── Browser-redirect callback (GET) ───────────────────────────────────────

  const callbackRouter = Router();

  callbackRouter.get(browserCallbackPath, async (req: Request, res: Response) => {
    const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5174/claw/";

    try {
      const { code, state, error: oauthError } = req.query as {
        code?: string;
        state?: string;
        error?: string;
      };

      if (oauthError) {
        log.error(`[${provider}-oauth] OAuth error: ${oauthError}`);
        res.redirect(`${frontendUrl}?${provider}_error=${encodeURIComponent(oauthError)}`);
        return;
      }

      if (!code || !state) {
        res.redirect(`${frontendUrl}?${provider}_error=missing_code_or_state`);
        return;
      }

      let statePayload: StatePayload;
      try {
        statePayload = decodeState(state);
      } catch {
        res.redirect(`${frontendUrl}?${provider}_error=invalid_state`);
        return;
      }

      const { userId, clientId } = statePayload;

      if (config.checkUserExists) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
          res.redirect(`${frontendUrl}?${provider}_error=user_not_found`);
          return;
        }
      }

      const tokens = await exchangeCode(statePayload, code);
      if (!tokens) {
        res.redirect(`${frontendUrl}?${provider}_error=token_exchange_failed`);
        return;
      }

      await storeTokens(
        userId,
        clientId,
        tokens.access_token,
        tokens.refresh_token,
        tokens.expires_in,
      );

      log.info(`[${provider}-oauth] Browser callback: ${label} connected for user ${userId}`);
      res.redirect(`${frontendUrl}?${provider}_connected=true`);
    } catch (err) {
      log.error(`[${provider}-oauth] Browser callback error:`, err);
      res.redirect(`${frontendUrl}?${provider}_error=internal_error`);
    }
  });

  return { oauthRouter: router, callbackRouter, tokenProvider };
}
