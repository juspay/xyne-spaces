import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { encrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { type OAuthTokenProvider, TokenRefreshError } from "./oauth-token-endpoint.js";
import { signOAuthState, verifyOAuthState, OAuthStateError } from "./oauth-state.js";
import { defaultOAuthReturn, resolveOAuthReturn, withOAuthResult } from "./oauth-return.js";
import { oauthLimiter } from "../middleware/rate-limiters.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { asyncHandler, ok, badRequest, HttpError } from "./http.js";
import { createLogger } from "../logger.js";

export interface ClassicOAuthConfig {
  type: string;
  label: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  authUrl: string | (() => string);
  tokenUrl: string | (() => string);
  scope: string;
  extraAuthParams?: Record<string, string>;
  rotatesRefreshToken: boolean;
  server: { name: string; url: string; description: string };
}

export interface ClassicOAuthProvider {
  router: Router;
  callbackRouter: Router;
  provider: OAuthTokenProvider;
}

interface ClassicTokens {
  accessToken: string;
  refreshToken: string;
  expires: number;
}

export function createClassicOAuthProvider(config: ClassicOAuthConfig): ClassicOAuthProvider {
  const { type, label } = config;
  const log = createLogger(`${type}-oauth`);

  const resolve = (u: string | (() => string)): string => (typeof u === "function" ? u() : u);

  function getCredentials(): { clientId: string; clientSecret: string } {
    const clientId = process.env[config.clientIdEnv];
    const clientSecret = process.env[config.clientSecretEnv];
    if (!clientId || !clientSecret) {
      throw new Error(`${config.clientIdEnv} and ${config.clientSecretEnv} are required`);
    }
    return { clientId, clientSecret };
  }

  async function ensureServer() {
    const existing = await prisma.mcpServer.findUnique({ where: { type } });
    if (existing) return existing;
    return prisma.mcpServer.create({
      data: { type, name: config.server.name, url: config.server.url, description: config.server.description, isOauth: true },
    });
  }

  async function exchangeCode(code: string, redirectUri: string): Promise<ClassicTokens> {
    const { clientId, clientSecret } = getCredentials();
    const response = await fetch(resolve(config.tokenUrl), {
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
      log.error(`[${type}-oauth] Token exchange failed: ${response.status} ${text}`);
      throw new HttpError(502, `${label} token exchange failed`);
    }

    const tokens = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expires: Date.now() + tokens.expires_in * 1000 };
  }

  async function storeTokens(userId: string, creds: ClassicTokens): Promise<void> {
    const { ciphertext, iv, authTag } = encrypt(JSON.stringify(creds), CONFIG.encryptionKey);
    const server = await ensureServer();

    const existing = await prisma.userMcpConnection.findFirst({ where: { userId, mcpServerId: server.id } });
    if (existing) {
      await prisma.userMcpConnection.update({ where: { id: existing.id }, data: { encryptedCreds: ciphertext, iv, authTag } });
    } else {
      await prisma.userMcpConnection.create({ data: { userId, mcpServerId: server.id, encryptedCreds: ciphertext, iv, authTag } });
    }
  }

  const provider: OAuthTokenProvider = {
    serverType: type,
    label,
    async refresh(creds) {
      const { clientId, clientSecret } = getCredentials();
      const response = await fetch(resolve(config.tokenUrl), {
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

      const tokens = (await response.json()) as { access_token: string; refresh_token?: string; expires_in: number };
      return {
        accessToken: tokens.access_token,
        refreshToken: config.rotatesRefreshToken ? (tokens.refresh_token ?? creds.refreshToken) : creds.refreshToken,
        expires: Date.now() + tokens.expires_in * 1000,
      };
    },
  };

  const router = Router();
  router.use("/:userId", pinUserIdParam);

  router.post(`/:userId/oauth/${type}/authorize`, oauthLimiter, asyncHandler(async (req: Request<{ userId: string }>, res: Response) => {
    const { userId } = req.params;
    const { redirectUri, returnTo } = req.body as { redirectUri?: string; returnTo?: string };

    const callbackUri = redirectUri ?? `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/${type}/callback`;

    const { clientId } = getCredentials();

    const url = new URL(resolve(config.authUrl));
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", callbackUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scope);
    for (const [k, v] of Object.entries(config.extraAuthParams ?? {})) url.searchParams.set(k, v);
    url.searchParams.set("state", signOAuthState(userId, { returnTo: resolveOAuthReturn(returnTo) }));

    ok(res, { authUrl: url.toString() });
  }));

  router.post(`/:userId/oauth/${type}/callback`, asyncHandler(async (req: Request<{ userId: string }>, res: Response) => {
    const { userId } = req.params;
    const { code, redirectUri } = req.body as { code?: string; redirectUri?: string };

    if (!code || !redirectUri) {
      throw badRequest("code and redirectUri are required");
    }

    const creds = await exchangeCode(code, redirectUri);
    await storeTokens(userId, creds);

    log.info(`[${type}-oauth] Stored ${label} credentials for user ${userId}`);
    ok(res, { message: `${label} account connected successfully` });
  }));

  const callbackRouter = Router();

  callbackRouter.get(`/${type}/callback`, async (req: Request, res: Response) => {
    // Stays the default until the state is verified below: an unverified state
    // must never steer the redirect.
    let frontendUrl = defaultOAuthReturn();

    try {
      const { code, state, error: oauthError } = req.query as { code?: string; state?: string; error?: string };

      if (oauthError) {
        log.error(`[${type}-oauth] OAuth error: ${oauthError}`);
        res.redirect(withOAuthResult(frontendUrl, `${type}_error`, oauthError));
        return;
      }

      if (!code || !state) {
        res.redirect(withOAuthResult(frontendUrl, `${type}_error`, "missing_code_or_state"));
        return;
      }

      let userId: string;
      try {
        const verified = verifyOAuthState(state);
        userId = verified.userId;
        // Signed, so this is the origin that actually started the flow.
        frontendUrl = resolveOAuthReturn(verified.extra?.["returnTo"]);
      } catch (err) {
        const reason = err instanceof OAuthStateError ? err.reason : "malformed";
        log.error(`[${type}-oauth] state ${reason}`);
        res.redirect(withOAuthResult(frontendUrl, `${type}_error`, "invalid_state"));
        return;
      }

      const redirectUri = `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/${type}/callback`;

      let creds: ClassicTokens;
      try {
        creds = await exchangeCode(code, redirectUri);
      } catch {
        res.redirect(withOAuthResult(frontendUrl, `${type}_error`, "token_exchange_failed"));
        return;
      }

      const server = await ensureServer();
      const existing = await prisma.userMcpConnection.findFirst({ where: { userId, mcpServerId: server.id } });
      if (!existing) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
          log.error(`[${type}-oauth] User not found: ${userId}`);
          res.redirect(withOAuthResult(frontendUrl, `${type}_error`, "user_not_found"));
          return;
        }
      }

      await storeTokens(userId, creds);

      log.info(`[${type}-oauth] Stored ${label} credentials for user ${userId} via browser callback`);
      res.redirect(withOAuthResult(frontendUrl, `${type}_connected`, "true"));
    } catch (err) {
      log.error(`[${type}-oauth] browser callback error:`, err);
      res.redirect(withOAuthResult(frontendUrl, `${type}_error`, "internal_error"));
    }
  });

  return { router, callbackRouter, provider };
}
