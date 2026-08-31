import { Router, type Request, type Response } from "express";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../db.js";
import { encrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { syncToolsForServer } from "../tool-sync.js";
import { evictSession } from "../mcp/runner.js";
import { type OAuthTokenProvider, TokenRefreshError } from "./oauth-token-endpoint.js";
import { signOAuthState, verifyOAuthState } from "./oauth-state.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { asyncHandler, ok, badRequest, forbidden, HttpError } from "./http.js";
import { createLogger } from "../logger.js";

export interface McpOAuthConfig {
  type: string;
  label: string;
  registerUrl: string;
  authUrl: string;
  tokenUrl: string;
  confidential: boolean;
  scope?: string;
  dcrScope?: string;
  clientName?: string;
  server: {
    name: string;
    url: string;
    description: string;
    transport?: string;
    writeToolPolicy: unknown;
    healthcheckSpec: unknown;
    connectorMeta?: unknown;
  };
}

export interface McpOAuthProvider {
  router: Router;
  callbackRouter: Router;
  provider: OAuthTokenProvider;
}

interface StoredTokens {
  clientId: string;
  clientSecret?: string | undefined;
  accessToken: string;
  refreshToken: string;
  expires: number;
}

interface StatePayload {
  userId: string;
  clientId: string;
  clientSecret?: string | undefined;
  codeVerifier: string;
  redirectUri: string;
}

export function createMcpOAuthProvider(config: McpOAuthConfig): McpOAuthProvider {
  const { type, label, registerUrl, authUrl, tokenUrl, confidential } = config;
  const clientName = config.clientName ?? "Xyne Claw";
  const log = createLogger(`${type}-oauth`);

  function encodeState(payload: StatePayload): string {
    const { userId, ...extra } = payload;
    return signOAuthState(userId, extra);
  }

  function decodeState(state: string): StatePayload {
    const verified = verifyOAuthState(state);
    return { userId: verified.userId, ...(verified.extra ?? {}) } as StatePayload;
  }

  function generateCodeVerifier(): string {
    return randomBytes(32).toString("base64url");
  }

  function deriveCodeChallenge(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url");
  }

  async function registerClient(redirectUri: string): Promise<{ clientId: string; clientSecret?: string | undefined }> {
    const res = await fetch(registerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: clientName,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: confidential ? "client_secret_post" : "none",
        ...(config.dcrScope ? { scope: config.dcrScope } : {}),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${label} DCR failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { client_id: string; client_secret?: string };
    return confidential
      ? { clientId: data.client_id, clientSecret: data.client_secret }
      : { clientId: data.client_id };
  }

  async function ensureServer() {
    const existing = await prisma.mcpServer.findUnique({ where: { type } });
    if (existing) return existing;
    return prisma.mcpServer.create({
      data: {
        type,
        name: config.server.name,
        url: config.server.url,
        description: config.server.description,
        transport: config.server.transport ?? "http",
        writeToolPolicy: config.server.writeToolPolicy as never,
        healthcheckSpec: config.server.healthcheckSpec as never,
        connectorMeta: (config.server.connectorMeta ?? { scope: "global", mode: "self-serve" }) as never,
        isOauth: true,
      },
    });
  }

  function tokenExchangeBody(params: { grantType: "authorization_code" | "refresh_token"; clientId: string; clientSecret?: string | undefined; code?: string; codeVerifier?: string; redirectUri?: string; refreshToken?: string }): URLSearchParams {
    const body = new URLSearchParams({ grant_type: params.grantType, client_id: params.clientId });
    if (confidential && params.clientSecret) body.set("client_secret", params.clientSecret);
    if (params.grantType === "authorization_code") {
      body.set("code", params.code ?? "");
      body.set("code_verifier", params.codeVerifier ?? "");
      body.set("redirect_uri", params.redirectUri ?? "");
    } else {
      body.set("refresh_token", params.refreshToken ?? "");
    }
    return body;
  }

  async function storeTokens(userId: string, clientId: string, clientSecret: string | undefined, accessToken: string, refreshToken: string, expiresIn: number): Promise<void> {
    const creds: StoredTokens = {
      clientId,
      ...(confidential ? { clientSecret } : {}),
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

    await evictSession(userId, type).catch(() => {});

    syncToolsForServer(userId, type, server.name, { accessToken, refreshToken, clientId }).catch((err) => {
      log.error(`[${type}-oauth] tool sync failed for user ${userId}:`, err);
    });
  }

  const provider: OAuthTokenProvider = {
    serverType: type,
    label,
    async refresh(creds) {
      const c = creds as unknown as StoredTokens;
      const refreshRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenExchangeBody({ grantType: "refresh_token", clientId: c.clientId, clientSecret: c.clientSecret, refreshToken: c.refreshToken }),
      });

      if (!refreshRes.ok) {
        throw new TokenRefreshError(502, `${refreshRes.status} ${await refreshRes.text()}`);
      }

      const tokens = (await refreshRes.json()) as { access_token: string; refresh_token?: string; expires_in: number };

      return {
        clientId: c.clientId,
        ...(confidential ? { clientSecret: c.clientSecret } : {}),
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? c.refreshToken,
        expires: Date.now() + tokens.expires_in * 1000,
      };
    },
  };

  const router = Router();
  router.use("/:userId", pinUserIdParam);

  router.post(`/:userId/oauth/${type}/authorize`, asyncHandler(async (req, res) => {
    const { userId } = req.params as { userId: string };
    const { redirectUri, scope } = req.body as { redirectUri?: string; scope?: string };

    const callbackUri =
      redirectUri ??
      `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/${type}/callback`;

    const { clientId, clientSecret } = await registerClient(callbackUri);

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = deriveCodeChallenge(codeVerifier);

    const state = encodeState({ userId, clientId, ...(confidential ? { clientSecret } : {}), codeVerifier, redirectUri: callbackUri });

    const url = new URL(authUrl);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", callbackUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (config.scope !== undefined) url.searchParams.set("scope", scope ?? config.scope);
    url.searchParams.set("state", state);

    ok(res, { authUrl: url.toString() });
  }));

  router.post(`/:userId/oauth/${type}/callback`, asyncHandler(async (req, res) => {
    const { userId } = req.params as { userId: string };
    const { code, state } = req.body as { code?: string; state?: string };

    if (!code || !state) {
      throw badRequest("code and state are required");
    }

    let statePayload: StatePayload;
    try {
      statePayload = decodeState(state);
    } catch {
      throw badRequest("Invalid state parameter");
    }

    if (statePayload.userId !== userId) {
      throw forbidden("State userId mismatch");
    }

    const { clientId, clientSecret, codeVerifier, redirectUri } = statePayload;

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenExchangeBody({ grantType: "authorization_code", clientId, clientSecret, code, codeVerifier, redirectUri }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      log.error(`[${type}-oauth] Token exchange failed for user ${userId}: ${tokenRes.status} ${text}`);
      throw new HttpError(502, `${label} token exchange failed`);
    }

    const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string; expires_in: number };

    await storeTokens(userId, clientId, clientSecret, tokens.access_token, tokens.refresh_token, tokens.expires_in);

    log.info(`[${type}-oauth] Stored ${label} credentials for user ${userId}`);
    ok(res, { message: `${label} account connected successfully` });
  }));

  const callbackRouter = Router();

  callbackRouter.get(`/${type}/callback`, async (req: Request, res: Response) => {
    const frontendUrl = process.env["FRONTEND_URL"] ?? "http://localhost:5174/claw/";

    try {
      const { code, state, error: oauthError } = req.query as { code?: string; state?: string; error?: string };

      if (oauthError) {
        log.error(`[${type}-oauth] OAuth error: ${oauthError}`);
        res.redirect(`${frontendUrl}?${type}_error=${encodeURIComponent(oauthError)}`);
        return;
      }

      if (!code || !state) {
        res.redirect(`${frontendUrl}?${type}_error=missing_code_or_state`);
        return;
      }

      let statePayload: StatePayload;
      try {
        statePayload = decodeState(state);
      } catch {
        res.redirect(`${frontendUrl}?${type}_error=invalid_state`);
        return;
      }

      const { userId, clientId, clientSecret, codeVerifier, redirectUri } = statePayload;

      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenExchangeBody({ grantType: "authorization_code", clientId, clientSecret, code, codeVerifier, redirectUri }),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        log.error(`[${type}-oauth] Browser callback token exchange failed: ${tokenRes.status} ${text}`);
        res.redirect(`${frontendUrl}?${type}_error=token_exchange_failed`);
        return;
      }

      const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string; expires_in: number };

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        log.error(`[${type}-oauth] User not found: ${userId}`);
        res.redirect(`${frontendUrl}?${type}_error=user_not_found`);
        return;
      }

      await storeTokens(userId, clientId, clientSecret, tokens.access_token, tokens.refresh_token, tokens.expires_in);

      log.info(`[${type}-oauth] Stored ${label} credentials for user ${userId} via browser callback`);
      res.redirect(`${frontendUrl}?${type}_connected=true`);
    } catch (err) {
      log.error(`[${type}-oauth] browser callback error:`, err);
      res.redirect(`${frontendUrl}?${type}_error=internal_error`);
    }
  });

  return { router, callbackRouter, provider };
}
