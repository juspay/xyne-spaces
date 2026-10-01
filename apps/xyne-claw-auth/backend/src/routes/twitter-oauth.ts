/**
 * "Sign in with X" for the Twitter / X connector, when an X app is set up
 * (X_OAUTH_CONSUMER_KEY / X_OAUTH_CONSUMER_SECRET: the app's API Key and
 * Secret). Without them the connector keeps asking for all four keys.
 *
 * The connector speaks OAuth 1.0a user context, so this is X's three-legged
 * 1.0a flow: a request token, the user's consent, then the user's access token
 * and secret. They are stored with the app's keys under the four fields the
 * adapter reads (adapters/twitter.ts), so the runner doesn't change. 1.0a
 * tokens don't expire.
 *
 * X rejects "localhost" callback URLs, so register
 * `${X_OAUTH_CALLBACK_BASE}/claw/api/v1/twitter/callback`; locally that is
 * http://127.0.0.1:3003/claw/api/v1/twitter/callback.
 *
 * The request token's secret waits in memory between the redirect to X and
 * the callback (1.0a callbacks carry no state of ours), so the flow assumes the
 * callback reaches the instance that started it.
 */
import { createHmac, randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { encrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { defaultOAuthReturn, resolveOAuthReturn, withOAuthResult } from "../lib/oauth-return.js";
import { oauthLimiter } from "../middleware/rate-limiters.js";
import { pinUserIdParam } from "../middleware/pin-user-id-param.js";
import { asyncHandler, ok, HttpError } from "../lib/http.js";
import { evictSession } from "../mcp/runner.js";
import { createLogger } from "../logger.js";

const log = createLogger("x-oauth");

export const X_SERVER_TYPE = "twitter";
const REQUEST_TOKEN_URL = "https://api.x.com/oauth/request_token";
const AUTHORIZE_URL = "https://api.x.com/oauth/authorize";
const ACCESS_TOKEN_URL = "https://api.x.com/oauth/access_token";
const PENDING_TTL_MS = 15 * 60 * 1000;

interface Consumer {
  key: string;
  secret: string;
}

function consumer(): Consumer | null {
  const key = process.env["X_OAUTH_CONSUMER_KEY"]?.trim();
  const secret = process.env["X_OAUTH_CONSUMER_SECRET"]?.trim();
  return key && secret ? { key, secret } : null;
}

/** Whether X connects by signing in. Otherwise it takes the four keys. */
export function xOAuthConfigured(): boolean {
  return consumer() !== null;
}

function callbackUri(): string {
  const base = process.env["X_OAUTH_CALLBACK_BASE"] ?? process.env["AUTH_SERVICE_URL"] ?? "http://127.0.0.1:3003";
  return `${base}/claw/api/v1/${X_SERVER_TYPE}/callback`;
}

/** RFC 3986 percent-encoding, which OAuth 1.0a signs with. */
function pe(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The OAuth 1.0a `Authorization` header for a POST to `url` with no body
 * parameters. `extra` carries oauth_callback or oauth_verifier; `token` is the
 * request token once there is one.
 */
export function oauth1Header(
  url: string,
  app: Consumer,
  extra: Record<string, string>,
  token?: { key: string; secret: string },
  nonce = randomBytes(16).toString("hex"),
  timestamp = String(Math.floor(Date.now() / 1000)),
): string {
  const params: Record<string, string> = {
    oauth_consumer_key: app.key,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_version: "1.0",
    ...(token ? { oauth_token: token.key } : {}),
    ...extra,
  };
  const paramString = Object.keys(params)
    .map((k) => [pe(k), pe(params[k]!)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = `POST&${pe(url)}&${pe(paramString)}`;
  const signature = createHmac("sha1", `${pe(app.secret)}&${pe(token?.secret ?? "")}`).update(base).digest("base64");
  const header: Record<string, string> = { ...params, oauth_signature: signature };
  return `OAuth ${Object.keys(header)
    .sort()
    .map((k) => `${pe(k)}="${pe(header[k]!)}"`)
    .join(", ")}`;
}

async function signedPost(url: string, authorization: string): Promise<URLSearchParams> {
  const response = await fetch(url, { method: "POST", headers: { Authorization: authorization } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} ${response.status} ${text.slice(0, 200)}`);
  return new URLSearchParams(text);
}

/** Request tokens waiting for their callback, by oauth_token. */
const pending = new Map<string, { userId: string; returnTo: string; secret: string; expiresAt: number }>();

function takePending(token: string | undefined): { userId: string; returnTo: string; secret: string } | null {
  const now = Date.now();
  for (const [key, entry] of pending) if (entry.expiresAt < now) pending.delete(key);
  if (!token) return null;
  const entry = pending.get(token);
  pending.delete(token);
  return entry ?? null;
}

export async function xAuthorizeUrl(userId: string, returnTo?: string): Promise<string> {
  const app = consumer();
  if (!app) throw new HttpError(404, "Sign in with X is not set up on this server");
  const reply = await signedPost(REQUEST_TOKEN_URL, oauth1Header(REQUEST_TOKEN_URL, app, { oauth_callback: callbackUri() }));
  const token = reply.get("oauth_token");
  const secret = reply.get("oauth_token_secret");
  if (!token || !secret || reply.get("oauth_callback_confirmed") !== "true") {
    throw new HttpError(502, "X didn't start the sign-in");
  }
  pending.set(token, { userId, returnTo: resolveOAuthReturn(returnTo), secret, expiresAt: Date.now() + PENDING_TTL_MS });
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("oauth_token", token);
  return url.toString();
}

/** Saves the user's keys where pasted ones would go, then restarts their X server with them. */
async function storeKeys(userId: string, app: Consumer, accessToken: string, accessTokenSecret: string): Promise<void> {
  const server = await prisma.mcpServer.findUnique({ where: { type: X_SERVER_TYPE } });
  if (!server) throw new Error("the Twitter / X connector is not registered");
  const credentials = { apiKey: app.key, apiSecretKey: app.secret, accessToken, accessTokenSecret };
  const { ciphertext, iv, authTag } = encrypt(JSON.stringify(credentials), CONFIG.encryptionKey);
  await prisma.userMcpConnection.upsert({
    where: { userId_mcpServerId: { userId, mcpServerId: server.id } },
    create: { userId, mcpServerId: server.id, encryptedCreds: ciphertext, iv, authTag },
    update: { encryptedCreds: ciphertext, iv, authTag },
  });
  await evictSession(userId, X_SERVER_TYPE).catch((err) => {
    log.error("[x-oauth] evictSession failed:", err);
  });
}

const router = Router();
router.use("/:userId", pinUserIdParam);

router.post(
  `/:userId/oauth/${X_SERVER_TYPE}/authorize`,
  oauthLimiter,
  asyncHandler(async (req: Request<{ userId: string }>, res: Response) => {
    const { returnTo } = req.body as { returnTo?: string };
    ok(res, { authUrl: await xAuthorizeUrl(req.params.userId, returnTo) });
  }),
);

const callbackRouter = Router();

callbackRouter.get(`/${X_SERVER_TYPE}/callback`, async (req: Request, res: Response) => {
  const { oauth_token: token, oauth_verifier: verifier, denied } = req.query as Record<string, string | undefined>;
  // Cancelling on X comes back as ?denied=<request token>.
  const started = takePending(token ?? denied);
  const frontendUrl = started?.returnTo ?? defaultOAuthReturn();
  const fail = (reason: string): void => res.redirect(withOAuthResult(frontendUrl, `${X_SERVER_TYPE}_error`, reason));
  if (!started) {
    fail("expired");
    return;
  }
  if (denied || !token || !verifier) {
    fail(denied ? "access_denied" : "missing_verifier");
    return;
  }
  const app = consumer();
  if (!app) {
    fail("not_configured");
    return;
  }
  try {
    const reply = await signedPost(
      ACCESS_TOKEN_URL,
      oauth1Header(ACCESS_TOKEN_URL, app, { oauth_verifier: verifier }, { key: token, secret: started.secret }),
    );
    const accessToken = reply.get("oauth_token");
    const accessTokenSecret = reply.get("oauth_token_secret");
    if (!accessToken || !accessTokenSecret) {
      fail("token_exchange_failed");
      return;
    }
    await storeKeys(started.userId, app, accessToken, accessTokenSecret);
    log.info(`[x-oauth] stored X credentials for user ${started.userId} (@${reply.get("screen_name") ?? "?"})`);
    res.redirect(withOAuthResult(frontendUrl, `${X_SERVER_TYPE}_connected`, "true"));
  } catch (err) {
    log.error("[x-oauth] callback error:", err instanceof Error ? err.message : err);
    fail("token_exchange_failed");
  }
});

export const xOAuthRouter = router;
export const xCallbackRouter = callbackRouter;
