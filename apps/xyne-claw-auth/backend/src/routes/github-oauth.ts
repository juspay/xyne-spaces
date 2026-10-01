/**
 * GitHub sign-in for the GitHub connector, when a GitHub OAuth App is set up
 * (GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET). Without them GitHub
 * stays a personal-access-token connector and these routes refuse.
 *
 * The OAuth token stands in for the token a user would paste: it is stored as
 * `{ token }`, the field the GitHub server's launch template reads, so the
 * runner, availability and tool sync don't change. OAuth App tokens don't
 * expire, so there is nothing to refresh.
 *
 * Register the OAuth App's callback URL as
 * `${AUTH_SERVICE_URL}/claw/api/v1/github/callback`
 * (locally http://localhost:3003/claw/api/v1/github/callback).
 */
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { encrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { signOAuthState, verifyOAuthState, OAuthStateError } from "../lib/oauth-state.js";
import { defaultOAuthReturn, resolveOAuthReturn, withOAuthResult } from "../lib/oauth-return.js";
import { oauthLimiter } from "../middleware/rate-limiters.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { asyncHandler, ok, HttpError } from "../lib/http.js";
import { hasConnectorDefinition } from "../mcp/connector-definitions.js";
import { evictSession } from "../mcp/runner.js";
import { syncToolsForServer } from "../tool-sync.js";
import { createLogger } from "../logger.js";

const log = createLogger("github-oauth");

export const GITHUB_SERVER_TYPE = "github";
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
/** Repos and pull requests (private too), the user's orgs and their notifications. */
const SCOPE = "repo read:org read:user notifications";

function clientCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env["GITHUB_OAUTH_CLIENT_ID"]?.trim();
  const clientSecret = process.env["GITHUB_OAUTH_CLIENT_SECRET"]?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Whether GitHub connects by signing in. Otherwise it takes a pasted token. */
export function githubOAuthConfigured(): boolean {
  return clientCredentials() !== null;
}

function callbackUri(): string {
  return `${process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003"}/claw/api/v1/${GITHUB_SERVER_TYPE}/callback`;
}

export function githubAuthorizeUrl(userId: string, returnTo?: string): string {
  const credentials = clientCredentials();
  if (!credentials) throw new HttpError(404, "GitHub sign-in is not set up on this server");
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", credentials.clientId);
  url.searchParams.set("redirect_uri", callbackUri());
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("allow_signup", "false");
  url.searchParams.set("state", signOAuthState(userId, { returnTo: resolveOAuthReturn(returnTo) }));
  return url.toString();
}

/** Trades the callback's code for an access token. GitHub reports a bad code with a 200 and an `error`. */
export async function exchangeGithubCode(code: string): Promise<string> {
  const credentials = clientCredentials();
  if (!credentials) throw new Error("GitHub sign-in is not set up");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      redirect_uri: callbackUri(),
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(`token exchange failed: ${response.status} ${body.error ?? ""} ${body.error_description ?? ""}`.trim());
  }
  return body.access_token;
}

/** Saves the token where a pasted one would go, then restarts the user's GitHub server with it. */
async function storeToken(userId: string, token: string): Promise<void> {
  const server = await prisma.mcpServer.findUnique({ where: { type: GITHUB_SERVER_TYPE } });
  if (!server) throw new Error("the GitHub connector is not registered");
  const credentials = { token };
  const { ciphertext, iv, authTag } = encrypt(JSON.stringify(credentials), CONFIG.encryptionKey);
  await prisma.userMcpConnection.upsert({
    where: { userId_mcpServerId: { userId, mcpServerId: server.id } },
    create: { userId, mcpServerId: server.id, encryptedCreds: ciphertext, iv, authTag },
    update: { encryptedCreds: ciphertext, iv, authTag },
  });
  // A running GitHub server still has the old token in its env.
  await evictSession(userId, GITHUB_SERVER_TYPE).catch((err) => {
    log.error("[github-oauth] evictSession failed:", err);
  });
  if (await hasConnectorDefinition(GITHUB_SERVER_TYPE)) {
    syncToolsForServer(userId, GITHUB_SERVER_TYPE, server.name, credentials).catch((err) => {
      log.error("[github-oauth] tool sync failed:", err);
    });
  }
}

const router = Router();
router.use("/:userId", pinUserIdParam);

router.post(
  `/:userId/oauth/${GITHUB_SERVER_TYPE}/authorize`,
  oauthLimiter,
  asyncHandler(async (req: Request<{ userId: string }>, res: Response) => {
    const { returnTo } = req.body as { returnTo?: string };
    ok(res, { authUrl: githubAuthorizeUrl(req.params.userId, returnTo) });
  }),
);

const callbackRouter = Router();

callbackRouter.get(`/${GITHUB_SERVER_TYPE}/callback`, async (req: Request, res: Response) => {
  // Stays the default until the state is verified: an unverified state must never steer the redirect.
  let frontendUrl = defaultOAuthReturn();
  const fail = (reason: string): void => res.redirect(withOAuthResult(frontendUrl, `${GITHUB_SERVER_TYPE}_error`, reason));
  try {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    let userId: string;
    try {
      const verified = verifyOAuthState(state ?? "");
      userId = verified.userId;
      frontendUrl = resolveOAuthReturn(verified.extra?.["returnTo"]);
    } catch (err) {
      log.error(`[github-oauth] state ${err instanceof OAuthStateError ? err.reason : "malformed"}`);
      fail("invalid_state");
      return;
    }
    // Declining on GitHub's consent screen comes back as error=access_denied.
    if (error || !code) {
      fail(error ?? "missing_code");
      return;
    }
    let token: string;
    try {
      token = await exchangeGithubCode(code);
    } catch (err) {
      log.error("[github-oauth]", err instanceof Error ? err.message : err);
      fail("token_exchange_failed");
      return;
    }
    await storeToken(userId, token);
    log.info(`[github-oauth] stored GitHub credentials for user ${userId}`);
    res.redirect(withOAuthResult(frontendUrl, `${GITHUB_SERVER_TYPE}_connected`, "true"));
  } catch (err) {
    log.error("[github-oauth] callback error:", err);
    fail("internal_error");
  }
});

export const githubOAuthRouter = router;
export const githubCallbackRouter = callbackRouter;
