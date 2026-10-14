import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { encrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { ensureMcpServer } from "./ensure-mcp-server.js";
import { type OAuthAuthorizeOptions, type OAuthTokenProvider, TokenRefreshError } from "./oauth-token-endpoint.js";
import { signOAuthState, verifyOAuthState, OAuthStateError } from "./oauth-state.js";
import { defaultOAuthReturn, resolveOAuthReturn, withOAuthResult } from "./oauth-return.js";
import { oauthLimiter } from "../middleware/rate-limiters.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { resolveCanonicalUserIdOrSelf } from "./users-jit.js";
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
  ensureServer: () => Promise<unknown>;
}

interface ClassicTokens {
  accessToken: string;
  refreshToken: string;
  expires: number;
}

/** Providers that issue non-expiring tokens (no `expires_in`) are treated as valid for this long. */
const NON_EXPIRING_TOKEN_MS = 10 * 365 * 24 * 60 * 60 * 1000;

interface RawTokenResponse {
  ok?: boolean;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  authed_user?: { access_token?: string; refresh_token?: string; expires_in?: number };
}

/**
 * Normalise a token response. Some providers answer failures with HTTP 200 and
 * an `error` / `ok: false` body (GitHub, Slack), nest the user token under
 * `authed_user` (Slack), or omit `refresh_token` / `expires_in` for tokens that
 * never expire (GitHub OAuth Apps). Returns null when no access token came back.
 */
function parseTokenResponse(raw: RawTokenResponse, previousRefreshToken = ""): ClassicTokens | null {
  if (raw.ok === false || raw.error) return null;
  const nested = raw.authed_user;
  const accessToken = raw.access_token ?? nested?.access_token;
  if (!accessToken) return null;
  const expiresIn = raw.expires_in ?? nested?.expires_in;
  return {
    accessToken,
    refreshToken: raw.refresh_token ?? nested?.refresh_token ?? previousRefreshToken,
    expires: Date.now() + (typeof expiresIn === "number" ? expiresIn * 1000 : NON_EXPIRING_TOKEN_MS),
  };
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
    return ensureMcpServer(type, {
      type,
      name: config.server.name,
      url: config.server.url,
      description: config.server.description,
      isOauth: true,
      connectorMeta: { scope: "global", mode: "self-serve" },
    });
  }

  async function exchangeCode(code: string, redirectUri: string): Promise<ClassicTokens> {
    const { clientId, clientSecret } = getCredentials();
    const response = await fetch(resolve(config.tokenUrl), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
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

    const tokens = parseTokenResponse((await response.json()) as RawTokenResponse);
    if (!tokens) {
      log.error(`[${type}-oauth] Token exchange returned no access token`);
      throw new HttpError(502, `${label} token exchange failed`);
    }
    return tokens;
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

  async function authorize(userId: string, opts: OAuthAuthorizeOptions = {}): Promise<string> {
    const callbackUri = opts.redirectUri ?? `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/${type}/callback`;

    const { clientId } = getCredentials();

    const url = new URL(resolve(config.authUrl));
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", callbackUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scope);
    for (const [k, v] of Object.entries(config.extraAuthParams ?? {})) url.searchParams.set(k, v);
    url.searchParams.set("state", signOAuthState(userId, { returnTo: resolveOAuthReturn(opts.returnTo) }));
    return url.toString();
  }

  const provider: OAuthTokenProvider = {
    serverType: type,
    label,
    authorize,
    async refresh(creds) {
      if (!creds.refreshToken) {
        throw new TokenRefreshError(401, `${label} token expired and has no refresh token; reconnect the account`);
      }
      const { clientId, clientSecret } = getCredentials();
      const response = await fetch(resolve(config.tokenUrl), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
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

      const tokens = parseTokenResponse((await response.json()) as RawTokenResponse, creds.refreshToken);
      if (!tokens) {
        throw new TokenRefreshError(502, `${label} refresh returned no access token`);
      }
      return {
        accessToken: tokens.accessToken,
        refreshToken: config.rotatesRefreshToken ? tokens.refreshToken : creds.refreshToken,
        expires: tokens.expires,
      };
    },
  };

  const router = Router();
  router.use("/:userId", pinUserIdParam);

  router.post(`/:userId/oauth/${type}/authorize`, oauthLimiter, asyncHandler(async (req: Request<{ userId: string }>, res: Response) => {
    const { userId } = req.params;
    const { redirectUri, returnTo } = req.body as { redirectUri?: string; returnTo?: string };
    // Sign the CANONICAL Claw id into the state: connection rows are keyed by
    // it, while the URL param may carry the user's raw Spaces alias.
    ok(res, { authUrl: await authorize(await resolveCanonicalUserIdOrSelf(userId), { redirectUri, returnTo }) });
  }));

  router.post(`/:userId/oauth/${type}/callback`, asyncHandler(async (req: Request<{ userId: string }>, res: Response) => {
    const { userId } = req.params;
    const { code, redirectUri } = req.body as { code?: string; redirectUri?: string };

    if (!code || !redirectUri) {
      throw badRequest("code and redirectUri are required");
    }

    const creds = await exchangeCode(code, redirectUri);
    const canonicalUserId = await resolveCanonicalUserIdOrSelf(userId);
    await storeTokens(canonicalUserId, creds);

    log.info(`[${type}-oauth] Stored ${label} credentials for user ${canonicalUserId}`);
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

      // Tolerate states minted before canonical signing: resolve the (possibly
      // raw Spaces) id so the row lands under the canonical Claw id.
      const canonicalUserId = await resolveCanonicalUserIdOrSelf(userId);

      const server = await ensureServer();
      const existing = await prisma.userMcpConnection.findFirst({ where: { userId: canonicalUserId, mcpServerId: server.id } });
      if (!existing) {
        const user = await prisma.user.findUnique({ where: { id: canonicalUserId } });
        if (!user) {
          log.error(`[${type}-oauth] User not found: ${canonicalUserId}`);
          res.redirect(withOAuthResult(frontendUrl, `${type}_error`, "user_not_found"));
          return;
        }
      }

      await storeTokens(canonicalUserId, creds);

      log.info(`[${type}-oauth] Stored ${label} credentials for user ${canonicalUserId} via browser callback`);
      res.redirect(withOAuthResult(frontendUrl, `${type}_connected`, "true"));
    } catch (err) {
      log.error(`[${type}-oauth] browser callback error:`, err);
      res.redirect(withOAuthResult(frontendUrl, `${type}_error`, "internal_error"));
    }
  });

  return { router, callbackRouter, provider, ensureServer };
}
