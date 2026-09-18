/**
 * Per-user credentials for reaching a hostname with `webfetch`, and the fetch
 * that uses them.
 *
 * Storage is `user_host_credentials`, one row per (user, host) — NOT an
 * `McpServer` + `UserMcpConnection` pair. A host credential is not a connector:
 * it launches no server and exposes no tools. Modelling it as one put every
 * hostname a user bound into everyone's connector list, on a globally shared
 * row two users could overwrite for each other.
 *
 * The model never sees a secret and never names one. The credential is chosen
 * by the HOSTNAME OF THE URL BEING FETCHED and nothing else, so a prompt
 * injection saying "fetch evil.com with my GitHub token" resolves `evil.com` to
 * no binding and falls through to an anonymous fetch.
 */

import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";
import { loadEffectiveCredentials } from "./credentials-loader.js";
import { normalizeHeaders, safeFetch, type SafeFetchOptions } from "./safe-fetch.js";
import { refreshHostOAuthToken, revokeHostOAuthToken, revocationDetailsFor } from "./host-oauth.js";
import { createLogger } from "../logger.js";

const log = createLogger("host-credentials");

export type HostCredentialScheme = "bearer" | "header" | "cookie";

/**
 * Stable key for a per-host credential, used as the serverType a parked auth
 * grant is released against. NOT an `McpServer.type`.
 */
export const WEBFETCH_HOST_SERVER_PREFIX = "webfetch-host:";
export const hostGrantKey = (host: string): string => `${WEBFETCH_HOST_SERVER_PREFIX}${host}`;

/* ------------------------------------------------------------ host policy */

/**
 * Identity providers, and our own origin. A card saying "sign in to
 * accounts.google.com" is a phishing primitive whichever door raised it, and a
 * credential bound to our own hostname could be replayed against us.
 */
const BLOCKED_HOSTS = new Set([
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "appleid.apple.com",
  "okta.com",
  "login.okta.com",
  "auth0.com",
  "login.yahoo.com",
  "github.com/login",
]);

/** Enforced by every door that can store a credential: the form, and OAuth. */
export function hostAllowedForCredentials(host: string): boolean {
  if (BLOCKED_HOSTS.has(host)) return false;
  if (host === "xyne.ai" || host.endsWith(".xyne.ai")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host === "localhost") return false;
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host);
}

/* ---------------------------------------------------------------- storage */

/** Refresh this far ahead of expiry; a token that lapses mid-run is a 401 the agent cannot interpret. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * OAuth material carried alongside an access token, inside the same encrypted
 * blob. The access token stays under `credential`, where a pasted token would
 * be, so every reader finds it in one place.
 */
export interface HostOAuthMaterial {
  kind: "oauth";
  refreshToken: string | null;
  clientId: string;
  clientSecret: string | null;
  tokenEndpoint: string;
  issuer: string;
  resource: string | null;
}

export interface ResolvedHostCredential {
  host: string;
  scheme: HostCredentialScheme;
  headerName: string | null;
  secret: string;
}

function parseScheme(value: string): HostCredentialScheme {
  return value === "cookie" || value === "header" ? value : "bearer";
}

function readBlob(plaintext: string): { secret: string; oauth: HostOAuthMaterial | null } {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(plaintext) as Record<string, unknown>;
  } catch {
    return { secret: plaintext, oauth: null };
  }
  const v = parsed["credential"] ?? parsed["token"] ?? parsed["cookie"];
  const secret = typeof v === "string" ? v : "";
  const oauth =
    parsed["kind"] === "oauth" && typeof parsed["tokenEndpoint"] === "string"
      ? ({
          kind: "oauth",
          refreshToken: typeof parsed["refreshToken"] === "string" ? parsed["refreshToken"] : null,
          clientId: typeof parsed["clientId"] === "string" ? parsed["clientId"] : "",
          clientSecret: typeof parsed["clientSecret"] === "string" ? parsed["clientSecret"] : null,
          tokenEndpoint: parsed["tokenEndpoint"],
          issuer: typeof parsed["issuer"] === "string" ? parsed["issuer"] : "",
          resource: typeof parsed["resource"] === "string" ? parsed["resource"] : null,
        } satisfies HostOAuthMaterial)
      : null;
  return { secret, oauth };
}

/**
 * Refresh under a short Redis lock. Ten parallel webfetches inside the refresh
 * window would otherwise send ten refreshes, and a server that rotates refresh
 * tokens treats the second presentation as a replay and revokes the family —
 * signing the user out silently. Losers of the race use the current token.
 */
async function tryRefresh(
  rowId: string,
  userId: string,
  host: string,
  secret: string,
  oauth: HostOAuthMaterial,
): Promise<string | null> {
  if (!oauth.refreshToken) return null;

  let holdsLock = true;
  try {
    const redis = redisService.getConnection();
    holdsLock =
      (await redis.set(`host-oauth-refresh:${userId}:${host}`, "1", "PX", 30_000, "NX")) === "OK";
  } catch {
    // Redis down: refresh anyway rather than letting the credential lapse.
  }
  if (!holdsLock) {
    log.info(`[host-cred] refresh for ${host} already in flight — using the current token`);
    return null;
  }

  const tokens = await refreshHostOAuthToken({
    tokenEndpoint: oauth.tokenEndpoint,
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret,
    refreshToken: oauth.refreshToken,
    resource: oauth.resource,
  });
  if (!tokens) {
    log.warn(`[host-cred] refresh rejected for ${host} user=${userId}`);
    return null;
  }

  const material: HostOAuthMaterial = {
    ...oauth,
    // Rotation is the norm; keeping the old one would replay a spent token.
    refreshToken: tokens.refreshToken ?? oauth.refreshToken,
  };
  const enc = encrypt(JSON.stringify({ credential: tokens.accessToken, ...material }), CONFIG.encryptionKey);
  await prisma.userHostCredential.update({
    where: { id: rowId },
    data: { encryptedCred: enc.ciphertext, iv: enc.iv, authTag: enc.authTag, expiresAt: tokens.expiresAt },
  });
  log.info(`[host-cred] refreshed ${host} for user=${userId}`);
  return tokens.accessToken || secret;
}

/**
 * Resolve the credential for `host`, if this user has one and it applies to the
 * agent in play.
 */
export async function resolveHostCredential(
  userId: string,
  host: string,
  agentSlug?: string,
): Promise<ResolvedHostCredential | null> {
  const row = await prisma.userHostCredential.findUnique({ where: { userId_host: { userId, host } } });
  if (!row) return null;

  // Empty list = every agent this user runs. Non-empty = an explicit allowlist,
  // so a session cookie can be given to one agent instead of all of them.
  if (row.agentSlugs.length > 0 && (!agentSlug || !row.agentSlugs.includes(agentSlug))) {
    log.info(`[host-cred] ${host} is scoped to [${row.agentSlugs.join(",")}]; agent=${agentSlug ?? "(none)"} excluded`);
    return null;
  }

  let secret: string;
  let oauth: HostOAuthMaterial | null;
  try {
    ({ secret, oauth } = readBlob(decrypt(row.encryptedCred, row.iv, row.authTag, CONFIG.encryptionKey)));
  } catch (err) {
    log.error(`[host-cred] decrypt failed for ${host} user=${userId}:`, err);
    return null;
  }

  /*
   * Refresh runs BEFORE the expiry check. A run parks waiting for a login; an
   * hour later the access token minted at the start has lapsed. Checking expiry
   * first would discard exactly the credential we hold a live refresh token
   * for, and the resumed run would fetch anonymously into the same wall.
   */
  const expiresAt = row.expiresAt?.getTime() ?? null;
  if (oauth && expiresAt !== null && expiresAt - Date.now() <= REFRESH_MARGIN_MS) {
    const refreshed = await tryRefresh(row.id, userId, host, secret, oauth).catch((err) => {
      log.warn(`[host-cred] refresh threw for ${host}:`, err);
      return null;
    });
    if (refreshed) {
      secret = refreshed;
    } else if (expiresAt <= Date.now()) {
      log.info(`[host-cred] ${host} for user=${userId} expired and could not be refreshed`);
      return null;
    }
  } else if (expiresAt !== null && expiresAt <= Date.now()) {
    log.info(`[host-cred] ${host} for user=${userId} expired at ${row.expiresAt?.toISOString()}`);
    return null;
  }

  if (!secret) return null;

  void prisma.userHostCredential
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return { host, scheme: parseScheme(row.scheme), headerName: row.headerName, secret };
}

/** Outbound headers for a resolved credential. Never logged with values. */
export function hostCredentialHeaders(cred: ResolvedHostCredential): Record<string, string> {
  if (cred.scheme === "cookie") return { Cookie: cred.secret };
  if (cred.scheme === "header") return { [cred.headerName?.trim() || "X-API-Key"]: cred.secret };
  return { Authorization: `Bearer ${cred.secret}` };
}

export async function upsertHostCredential(input: {
  userId: string;
  host: string;
  secret: string;
  scheme: HostCredentialScheme;
  headerName?: string | undefined;
  label?: string | undefined;
  agentSlugs?: string[] | undefined;
  expiresAt?: Date | undefined;
  /** Set by the OAuth callback so the credential can renew itself later. */
  oauth?: HostOAuthMaterial | undefined;
}): Promise<void> {
  const enc = encrypt(JSON.stringify({ credential: input.secret, ...(input.oauth ?? {}) }), CONFIG.encryptionKey);
  const data = {
    scheme: input.scheme,
    headerName: input.scheme === "header" ? (input.headerName ?? "X-API-Key") : null,
    encryptedCred: enc.ciphertext,
    iv: enc.iv,
    authTag: enc.authTag,
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.agentSlugs !== undefined ? { agentSlugs: input.agentSlugs } : {}),
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
  };
  await prisma.userHostCredential.upsert({
    where: { userId_host: { userId: input.userId, host: input.host } },
    create: { userId: input.userId, host: input.host, ...data },
    update: data,
  });
  log.info(`[host-cred] stored user=${input.userId} host=${input.host} scheme=${input.scheme}`);
}

/**
 * Remove a credential, and tell the provider. Deleting only our row would leave
 * a live token at the authorization server until it expired naturally — a
 * "Remove" button that does not remove. Revocation is best effort.
 */
export async function deleteHostCredential(userId: string, host: string): Promise<boolean> {
  const row = await prisma.userHostCredential.findUnique({ where: { userId_host: { userId, host } } });
  if (!row) return false;

  let oauth: HostOAuthMaterial | null = null;
  let secret = "";
  try {
    ({ secret, oauth } = readBlob(decrypt(row.encryptedCred, row.iv, row.authTag, CONFIG.encryptionKey)));
  } catch {
    // Undecryptable rows are exactly the ones a user most wants gone.
  }

  await prisma.userHostCredential.delete({ where: { id: row.id } });
  log.info(`[host-cred] deleted user=${userId} host=${host}`);

  if (oauth) {
    void (async () => {
      const details = await revocationDetailsFor(host).catch(() => null);
      if (!details) return;
      for (const [token, hint] of [
        [oauth.refreshToken, "refresh_token"],
        [secret, "access_token"],
      ] as const) {
        if (!token) continue;
        await revokeHostOAuthToken({ ...details, token, tokenTypeHint: hint }).catch(() => false);
      }
    })();
  }
  return true;
}

/**
 * Partial update: rotating a token must not reset the agent scope, and
 * narrowing the scope must not require pasting the secret again. Returns false
 * when the user has no row for that host — the same answer they get for
 * somebody else's row, since userId is part of the lookup.
 */
export async function updateHostCredential(
  userId: string,
  host: string,
  patch: {
    secret?: string | undefined;
    scheme?: HostCredentialScheme | undefined;
    headerName?: string | undefined;
    label?: string | null | undefined;
    agentSlugs?: string[] | undefined;
    expiresAt?: Date | null | undefined;
  },
): Promise<boolean> {
  const row = await prisma.userHostCredential.findUnique({ where: { userId_host: { userId, host } } });
  if (!row) return false;

  const data: Record<string, unknown> = {};
  const scheme = patch.scheme ?? parseScheme(row.scheme);

  if (patch.secret !== undefined) {
    // A hand-pasted token has no refresh token and no client, so any OAuth
    // material goes with it rather than leaving us presenting a stale refresh
    // token the server may treat as a replay.
    const enc = encrypt(JSON.stringify({ credential: patch.secret }), CONFIG.encryptionKey);
    data["encryptedCred"] = enc.ciphertext;
    data["iv"] = enc.iv;
    data["authTag"] = enc.authTag;
    if (patch.expiresAt === undefined) data["expiresAt"] = null;
  }
  if (patch.scheme !== undefined) data["scheme"] = patch.scheme;
  if (patch.scheme !== undefined || patch.headerName !== undefined) {
    data["headerName"] = scheme === "header" ? (patch.headerName ?? row.headerName ?? "X-API-Key") : null;
  }
  if (patch.label !== undefined) data["label"] = patch.label;
  if (patch.agentSlugs !== undefined) data["agentSlugs"] = patch.agentSlugs;
  if (patch.expiresAt !== undefined) data["expiresAt"] = patch.expiresAt;

  if (Object.keys(data).length === 0) return true;
  await prisma.userHostCredential.update({ where: { id: row.id }, data });
  log.info(`[host-cred] updated user=${userId} host=${host} fields=${Object.keys(data).join(",")}`);
  return true;
}

export interface HostCredentialSummary {
  host: string;
  scheme: HostCredentialScheme;
  headerName: string | null;
  label: string | null;
  agentSlugs: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  /** "oauth" when it came from a Sign in, "manual" when it was pasted. */
  origin: "oauth" | "manual";
  expired: boolean;
}

/** Everything the settings dashboard shows, and no secret material. */
export async function listHostCredentials(userId: string): Promise<HostCredentialSummary[]> {
  const rows = await prisma.userHostCredential.findMany({ where: { userId }, orderBy: { host: "asc" } });
  const now = Date.now();
  return rows.map((row) => {
    let origin: "oauth" | "manual" = "manual";
    try {
      origin = readBlob(decrypt(row.encryptedCred, row.iv, row.authTag, CONFIG.encryptionKey)).oauth
        ? "oauth"
        : "manual";
    } catch {
      /* an unreadable row still belongs in the list so it can be removed */
    }
    return {
      host: row.host,
      scheme: parseScheme(row.scheme),
      headerName: row.headerName,
      label: row.label,
      agentSlugs: row.agentSlugs,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      origin,
      expired: row.expiresAt !== null && row.expiresAt.getTime() <= now,
    };
  });
}

/* ---------------------------------------------------- credentialed fetch */

/**
 * Hosts served by a first-class connector. Exact hostnames — never suffix
 * matching, which would let `api.github.com.attacker.net` collect a GitHub token.
 */
const HOST_TO_SERVER_TYPE: Readonly<Record<string, string>> = {
  "api.github.com": "github",
  "github.com": "github",
  "raw.githubusercontent.com": "github",
};

/** GET/HEAD only: writes stay behind connector tools and the approval flow. */
const ALLOWED_METHODS = new Set(["GET", "HEAD"]);

export interface AuthenticatedFetchContext {
  /** Absent for unauthenticated/system callers — the fetch then stays anonymous. */
  userId?: string | undefined;
  agentSlug?: string | undefined;
}

export interface AttachedCredential {
  serverType: string;
  /** Which cascade level answered: subagent | agent | user | global. */
  source: string;
}

/** A host we DO have a connector for, that this user has not connected. */
export interface MissingConnector {
  serverType: string;
  label: string;
}

export interface AuthenticatedFetchResult {
  response: Response;
  host: string;
  /** Never carries the secret — only which connector answered. */
  attached: AttachedCredential | null;
  missingConnector: MissingConnector | null;
  /** A credential WAS attached and the origin refused it (401/403). */
  credentialRejected: AttachedCredential | null;
  anonymousFallbackUsed: boolean;
}

async function connectorHeaders(
  userId: string,
  serverType: string,
  agentSlug: string | undefined,
): Promise<{ headers: Record<string, string>; source: string } | null> {
  const effective = await loadEffectiveCredentials(userId, serverType, agentSlug);
  if (!effective) return null;
  const creds = effective.credentials;
  const token = typeof creds["token"] === "string" ? creds["token"].trim() : "";
  const accessToken = typeof creds["accessToken"] === "string" ? creds["accessToken"].trim() : "";
  const bearer = token || accessToken;
  // No usable bearer field is treated as "not connected" rather than sending
  // `Authorization: Bearer undefined`.
  if (!bearer) return null;
  return { headers: { Authorization: `Bearer ${bearer}` }, source: effective.source };
}

/**
 * Fetch `rawUrl`, attaching this user's credential when the URL's host has one.
 * Falls back to an anonymous `safeFetch` in every other case, so unmapped hosts
 * behave exactly as the credential-less fetch always did.
 *
 * Resolution happens ONCE, before the redirect loop, and `safeFetch` drops
 * `Authorization` on any origin change — a redirect can neither carry the token
 * off-origin nor pick up another host's credential mid-chain.
 */
export async function authenticatedFetch(
  rawUrl: string,
  ctx: AuthenticatedFetchContext,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<AuthenticatedFetchResult> {
  const method = (init.method ?? "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error(
      `authenticatedFetch supports GET and HEAD only (got ${method}). ` +
        `Writes must go through a connector tool so writeToolPolicy and the approval flow still apply.`,
    );
  }

  let hostname = "";
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    // safeFetch produces the canonical invalid-url error below.
  }

  const anonymous = async (
    extra: Partial<AuthenticatedFetchResult> = {},
  ): Promise<AuthenticatedFetchResult> => ({
    response: await safeFetch(rawUrl, init, opts),
    host: hostname,
    attached: null,
    missingConnector: null,
    credentialRejected: null,
    anonymousFallbackUsed: false,
    ...extra,
  });

  if (!ctx.userId || !hostname) return anonymous();
  const host = hostname;

  // A credential the user bound to this exact host wins over the built-in
  // connector map: one hostname can front two auth systems (api.github.com
  // takes a PAT, the github.com web UI takes a session cookie) and the
  // deliberate binding must not be shadowed by a default.
  const hostCred = await resolveHostCredential(ctx.userId, host, ctx.agentSlug);
  let attached: AttachedCredential | null = null;
  let headers: Record<string, string> | null = null;

  if (hostCred) {
    attached = { serverType: hostGrantKey(host), source: "user" };
    headers = { ...normalizeHeaders(init.headers), ...hostCredentialHeaders(hostCred) };
    log.info(`[auth-fetch] host=${host} → user host credential (${hostCred.scheme})`);
  } else {
    const staticType = HOST_TO_SERVER_TYPE[host];
    if (!staticType) return anonymous();
    const server = await prisma.mcpServer.findUnique({
      where: { type: staticType },
      select: { name: true, enabled: true },
    });
    if (!server?.enabled) return anonymous();

    const resolved = await connectorHeaders(ctx.userId, staticType, ctx.agentSlug);
    if (!resolved) {
      log.info(`[auth-fetch] host=${host} type=${staticType} → no usable connection for user`);
      return anonymous({ missingConnector: { serverType: staticType, label: server.name } });
    }
    attached = { serverType: staticType, source: resolved.source };
    headers = { ...normalizeHeaders(init.headers), ...resolved.headers };
    // Header names only — a value here would put the credential in the logs.
    log.info(`[auth-fetch] host=${host} type=${staticType} source=${resolved.source} headers=${Object.keys(resolved.headers).join(",")}`);
  }

  const response = await safeFetch(rawUrl, { ...init, headers }, opts);
  if (response.status !== 401 && response.status !== 403) {
    return { response, host, attached, missingConnector: null, credentialRejected: null, anonymousFallbackUsed: false };
  }

  /*
   * A credential is NOT automatically better than no credential. Measured in
   * production: a valid GitHub token blocked for one org (SAML, IP allowlist,
   * repo-scoped PAT) returns 403 on a resource that answers 200 anonymously,
   * and the agent burned a whole run trying to escape its own credential. So on
   * a refusal, retry once WITHOUT it and prefer that result — one extra request
   * on the failure path only, and strictly fewer secrets sent.
   */
  log.info(`[auth-fetch] host=${host} type=${attached.serverType} → ${response.status}; retrying anonymously`);
  try {
    const anon = await safeFetch(rawUrl, init, opts);
    if (anon.ok) {
      return { response: anon, host, attached: null, missingConnector: null, credentialRejected: attached, anonymousFallbackUsed: true };
    }
  } catch {
    // Keep the credentialed response, whose body usually explains the refusal.
  }
  return { response, host, attached, missingConnector: null, credentialRejected: attached, anonymousFallbackUsed: false };
}
