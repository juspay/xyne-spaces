/**
 * Self-serve access to a host an agent got blocked on: paste a credential, or
 * sign in when the host supports it.
 *
 *   POST   /host-bindings              store a credential, release the parked run
 *   GET    /host-bindings              the connected-hosts dashboard
 *   PATCH  /host-bindings/:host        rotate or re-scope
 *   DELETE /host-bindings/:host        remove, revoking at the provider
 *   GET    /host-oauth/discover        can this host do one-click sign-in?
 *   POST   /host-oauth/authorize       start a flow, return a URL for a new tab
 *   GET    /host-oauth/callback        finish it, store the token, resume the run
 *
 * OWNERSHIP. These are the user's own logins to third-party services, and
 * nobody else reads or changes them — explicitly including platform admins. The
 * guarantee is structural rather than a check that could be forgotten: the
 * acting user comes from `x-user-id`, which `requireAuth` sets from a verified
 * session, so there is no id in any path or body for a caller to substitute;
 * every query names `userId` in its WHERE clause, so "not yours" and "does not
 * exist" are one lookup and one 404; and no endpoint here accepts a target user.
 *
 * Secrets are write-only over HTTP: they go in through POST/PATCH and are never
 * returned by any response, including to their owner.
 */

import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { asyncHandler, ok, badRequest, forbidden, notFound } from "../lib/http.js";
import {
  hostAllowedForCredentials,
  hostGrantKey,
  upsertHostCredential,
  updateHostCredential,
  deleteHostCredential,
  listHostCredentials,
  type HostCredentialScheme,
} from "../lib/host-credentials.js";
import {
  normalizeHostname,
  sameIssuer,
  detectCredentialHint,
  ensureHostOAuthClient,
  lookupHostOAuthClient,
  exchangeAuthorizationCode,
  createHostOAuthFlow,
  consumeHostOAuthFlow,
  type HostOAuthClientRecord,
} from "../lib/host-oauth.js";
import { resolveAuthGrants } from "../lib/auth-grant-store.js";
import { signOAuthState, verifyOAuthState } from "../lib/oauth-state.js";
import { defaultOAuthReturn, resolveOAuthReturn, withOAuthResult } from "../lib/oauth-return.js";
import { outboundUrlSyntaxError } from "../lib/safe-fetch.js";
import { safeFetch } from "../lib/safe-fetch.js";
import { oauthLimiter } from "../middleware/rate-limiters.js";
import { createLogger } from "../logger.js";

const log = createLogger("host-access");

const bindingsRouter = Router();
const oauthRouter = Router();
const callbackRouter = Router();

/** The acting user, and the only source of one in this file. */
function actingUser(req: Request): string {
  const userId = String(req.header("x-user-id") ?? "").trim();
  if (!userId) throw badRequest("x-user-id is required");
  return userId;
}

/* -------------------------------------------------------- host bindings */

/**
 * POST /host-bindings { host, credential, headerName?, scheme?, agentSlugs?, conversationId? }
 *
 * `scheme` picks how the credential is sent: bearer (default), cookie, or
 * `headerName`: credential.
 */
bindingsRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const userId = actingUser(req);

  const { host: rawHost, credential, headerName, scheme: rawScheme, agentSlugs, conversationId } =
    req.body as {
      host?: string; credential?: string; headerName?: string; scheme?: string;
      agentSlugs?: unknown; conversationId?: string;
    };

  const host = String(rawHost ?? "").trim().toLowerCase();
  if (!host) throw badRequest("host is required");
  if (!credential || typeof credential !== "string" || !credential.trim()) {
    throw badRequest("credential is required");
  }
  if (!hostAllowedForCredentials(host)) throw forbidden(`Credentials cannot be bound to ${host}`);
  // Same destination policy the fetch itself will face — refuse here rather
  // than storing a secret for somewhere we would never dial.
  const urlProblem = outboundUrlSyntaxError(`https://${host}`);
  if (urlProblem) throw badRequest(`host ${urlProblem}`);

  const scheme: HostCredentialScheme =
    rawScheme === "cookie" || rawScheme === "header" ? rawScheme : "bearer";

  await upsertHostCredential({
    userId,
    host,
    secret: credential.trim(),
    scheme,
    ...(scheme === "header" ? { headerName: String(headerName ?? "").trim() || "X-API-Key" } : {}),
    ...(Array.isArray(agentSlugs) ? { agentSlugs: agentSlugs.map(String) } : {}),
  });

  log.info(`[host-bindings] user=${userId} host=${host} scheme=${scheme}`);

  // Release the run parked in THIS conversation. Cards in other chats stay put.
  const type = hostGrantKey(host);
  const resumed = await resolveAuthGrants(userId, type, { conversationId });
  ok(res, { host, serverType: type, resumedRuns: resumed });
}));

function hostParam(req: Request): string {
  const host = normalizeHostname(String((req.params as { host?: string }).host ?? ""));
  if (!host) throw badRequest("host is required");
  return host;
}

/** GET /host-bindings — this user's rows, with no secret material. */
bindingsRouter.get("/", asyncHandler(async (req: Request, res: Response) => {
  const userId = actingUser(req);
  ok(res, { hosts: await listHostCredentials(userId) });
}));

/**
 * PATCH /host-bindings/:host { credential?, scheme?, headerName?, label?, agentSlugs?, expiresAt? }
 *
 * Partial by design: rotating a token must not reset the agent scope, and
 * narrowing the scope must not require pasting the secret again.
 */
bindingsRouter.patch("/:host", asyncHandler(async (req: Request, res: Response) => {
  const userId = actingUser(req);
  const host = hostParam(req);

  const body = (req.body ?? {}) as {
    credential?: unknown; scheme?: unknown; headerName?: unknown;
    label?: unknown; agentSlugs?: unknown; expiresAt?: unknown; conversationId?: unknown;
  };

  const patch: Parameters<typeof updateHostCredential>[2] = {};
  if (typeof body.credential === "string" && body.credential.trim()) {
    patch.secret = body.credential.trim();
  }
  if (body.scheme === "bearer" || body.scheme === "header" || body.scheme === "cookie") {
    patch.scheme = body.scheme;
  }
  if (typeof body.headerName === "string") patch.headerName = body.headerName.trim() || "X-API-Key";
  if (typeof body.label === "string") patch.label = body.label.trim() || null;
  if (body.label === null) patch.label = null;
  if (Array.isArray(body.agentSlugs)) patch.agentSlugs = body.agentSlugs.map(String);
  if (body.expiresAt === null) patch.expiresAt = null;
  if (typeof body.expiresAt === "string" && body.expiresAt.trim()) {
    const when = new Date(body.expiresAt);
    if (Number.isNaN(when.getTime())) throw badRequest("expiresAt must be an ISO date");
    patch.expiresAt = when;
  }

  if (!(await updateHostCredential(userId, host, patch))) {
    throw notFound(`No credential stored for ${host}`);
  }
  log.info(`[host-bindings] updated user=${userId} host=${host}`);

  const resumed = await resolveAuthGrants(userId, hostGrantKey(host), {
    conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
  }).catch(() => 0);
  ok(res, { host, resumedRuns: resumed });
}));

/** DELETE /host-bindings/:host — also revokes at the provider when it came from a sign-in. */
bindingsRouter.delete("/:host", asyncHandler(async (req: Request, res: Response) => {
  const userId = actingUser(req);
  const host = hostParam(req);
  if (!(await deleteHostCredential(userId, host))) {
    throw notFound(`No credential stored for ${host}`);
  }
  log.info(`[host-bindings] deleted user=${userId} host=${host}`);
  ok(res, { host, deleted: true });
}));

/* ------------------------------------------------------------- sign-in */

/** A host the caller named, validated by the same policy the paste form uses. */
function requireHost(value: unknown): string {
  const host = normalizeHostname(String(value ?? ""));
  if (!host) throw badRequest("host is required");
  if (!hostAllowedForCredentials(host)) throw forbidden(`Sign-in cannot be offered for ${host}`);
  return host;
}

/**
 * The URL the run was blocked on. Agent-supplied, so it is re-parsed and never
 * allowed to point somewhere other than the host we are minting a credential for.
 */
function sameHostUrl(value: unknown, host: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (normalizeHostname(parsed.hostname) !== host) return null;
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * GET /host-oauth/discover?host=&url=
 *
 * The card calls this on mount to decide whether to render a Sign in button.
 * Rate limited because a miss makes outbound requests to a caller-named host.
 */
oauthRouter.get("/discover", oauthLimiter, asyncHandler(async (req: Request, res: Response) => {
  actingUser(req);
  const host = requireHost(req.query["host"]);
  const blockedUrl = sameHostUrl(req.query["url"], host);

  const cached = await lookupHostOAuthClient(host);
  if (cached) {
    ok(res, { available: true, issuerHost: cached.issuerHost, cached: true });
    return;
  }

  const client = await ensureHostOAuthClient(host, blockedUrl ?? `https://${host}/`);
  if (client) {
    ok(res, { available: true, issuerHost: client.issuerHost, cached: false });
    return;
  }

  // No sign-in here — the ordinary answer. Spend one more request working out
  // WHICH credential the user should go and make.
  const hint = await detectCredentialHint(host).catch(() => null);
  ok(res, { available: false, ...(hint ? { hint } : {}) });
}));

/**
 * POST /host-oauth/authorize { host, url?, returnTo?, conversationId? } → { authUrl }
 *
 * Returns a URL rather than redirecting: the caller is a card inside a chat, and
 * navigating the page away mid-task is the friction this exists to remove.
 */
oauthRouter.post("/authorize", oauthLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = actingUser(req);
  const body = (req.body ?? {}) as {
    host?: unknown; url?: unknown; returnTo?: unknown; conversationId?: unknown;
  };
  const host = requireHost(body.host);
  const blockedUrl = sameHostUrl(body.url, host);

  const client = await ensureHostOAuthClient(host, blockedUrl ?? `https://${host}/`);
  if (!client) throw badRequest(`${host} does not support automatic sign-in`);

  // RFC 7636. The verifier stays server-side; only its hash goes out.
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

  const flowId = await createHostOAuthFlow({
    userId,
    host,
    issuer: client.issuer,
    clientId: client.clientId,
    codeVerifier,
    blockedUrl,
    conversationId:
      typeof body.conversationId === "string" && body.conversationId ? body.conversationId : null,
    returnTo: resolveOAuthReturn(body.returnTo),
  });

  const authUrl = new URL(client.authorizationEndpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", client.clientId);
  authUrl.searchParams.set("redirect_uri", client.redirectUri);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", signOAuthState(userId, { flowId }));
  if (client.scope) authUrl.searchParams.set("scope", client.scope);
  // RFC 8707: bind the token to the resource that asked for it.
  if (client.resource) authUrl.searchParams.set("resource", client.resource);

  log.info(`[host-oauth] authorize user=${userId} host=${host} issuer=${client.issuerHost}`);
  ok(res, { authUrl: authUrl.toString(), issuerHost: client.issuerHost });
}));

/**
 * Does the token we just minted actually open the door?
 *
 * An authorization server behind an internal service often issues tokens for
 * its OWN API rather than for the service that pointed at it. Storing one would
 * overwrite a working credential and hand the agent a bearer the resource
 * ignores — a silent downgrade that looks like a successful sign-in.
 */
async function tokenOpensTheDoor(blockedUrl: string, accessToken: string): Promise<boolean> {
  try {
    const res = await safeFetch(
      blockedUrl,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      {
        maxResponseBytes: 64 * 1024,
        timeoutMs: 10_000,
        allowLoopbackInDev: process.env["HOST_OAUTH_ALLOW_LOOPBACK"] === "true",
      },
    );
    return res.status !== 401 && res.status !== 403;
  } catch {
    // A network failure is not evidence the token is bad.
    return true;
  }
}

callbackRouter.get("/host-oauth/callback", async (req: Request, res: Response) => {
  // Until the state verifies, an unverified value must never steer the redirect.
  let target = defaultOAuthReturn();
  const fail = (reason: string): void => {
    res.redirect(withOAuthResult(target, "host_oauth_error", reason));
  };

  try {
    const { code, state, error, iss } = req.query as {
      code?: string; state?: string; error?: string; iss?: string;
    };
    if (error) {
      log.warn(`[host-oauth] authorization server returned error: ${String(error).slice(0, 100)}`);
      fail("denied");
      return;
    }
    if (!code || !state) {
      fail("missing_code_or_state");
      return;
    }

    let flowId: string;
    let stateUserId: string;
    try {
      const verified = verifyOAuthState(state);
      stateUserId = verified.userId;
      flowId = String((verified.extra as { flowId?: unknown } | undefined)?.flowId ?? "");
    } catch {
      fail("invalid_state");
      return;
    }
    if (!flowId) {
      fail("invalid_state");
      return;
    }

    const flow = await consumeHostOAuthFlow(flowId);
    if (!flow) {
      // Already redeemed, or older than the flow TTL.
      fail("expired");
      return;
    }
    target = resolveOAuthReturn(flow.returnTo);

    if (flow.userId !== stateUserId) {
      log.error(`[host-oauth] flow/state user mismatch (${flow.userId} vs ${stateUserId})`);
      fail("user_mismatch");
      return;
    }

    // RFC 9207: one callback serves every host, so when the server identifies
    // itself it must be the one we sent the user to.
    if (iss && !sameIssuer(iss, flow.issuer)) {
      log.error(`[host-oauth] iss mismatch: got ${String(iss).slice(0, 120)}, expected ${flow.issuer}`);
      fail("issuer_mismatch");
      return;
    }

    // Re-read the endpoints from our own table rather than trusting anything
    // that made the round trip through the browser.
    const client: HostOAuthClientRecord | null = await lookupHostOAuthClient(flow.host);
    if (!client || client.clientId !== flow.clientId || !sameIssuer(client.issuer, flow.issuer)) {
      log.error(`[host-oauth] client record changed under flow for ${flow.host}`);
      fail("client_changed");
      return;
    }

    const tokens = await exchangeAuthorizationCode({ client, code, codeVerifier: flow.codeVerifier });
    if (!tokens) {
      fail("token_exchange_failed");
      return;
    }

    if (flow.blockedUrl && !(await tokenOpensTheDoor(flow.blockedUrl, tokens.accessToken))) {
      log.warn(`[host-oauth] ${client.issuerHost} issued a token ${flow.host} does not accept — not storing`);
      fail("token_not_accepted");
      return;
    }

    await upsertHostCredential({
      userId: flow.userId,
      host: flow.host,
      secret: tokens.accessToken,
      scheme: "bearer",
      label: `Signed in via ${client.issuerHost}`,
      ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
      oauth: {
        kind: "oauth",
        refreshToken: tokens.refreshToken,
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        tokenEndpoint: client.tokenEndpoint,
        issuer: client.issuer,
        resource: client.resource,
      },
    });

    const resumed = await resolveAuthGrants(flow.userId, hostGrantKey(flow.host), {
      conversationId: flow.conversationId ?? undefined,
    }).catch(() => 0);
    log.info(`[host-oauth] connected ${flow.host} for user=${flow.userId}; resumed ${resumed} run(s)`);
    res.redirect(withOAuthResult(target, "host_connected", flow.host));
  } catch (err) {
    log.error("[host-oauth] callback error:", err);
    fail("internal_error");
  }
});

export const hostBindingsRouter = bindingsRouter;
export const hostOAuthRouter = oauthRouter;
export const hostOAuthCallbackRouter = callbackRouter;
