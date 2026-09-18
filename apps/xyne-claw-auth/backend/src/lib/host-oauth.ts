/**
 * One-click sign-in for a host an agent got blocked on.
 *
 * Discovery (RFC 9728 → RFC 8414), dynamic client registration (RFC 7591), the
 * PKCE authorization-code exchange, and the short-lived flow record that ties a
 * callback back to the user who started it. When a host implements none of it —
 * the common case — discovery returns null and the caller falls back to asking
 * the user to paste a token, with `detectCredentialHint` naming where to get one.
 *
 * The host is attacker-influenced: the agent picked the URL and the page that
 * suggested it may be hostile. So every outbound call goes through `safeFetch`,
 * and the issuer a host nominates must be related to that host — without that,
 * `evil.example` could name `accounts.google.com` as its authorization server
 * and we would render a real Google URL carrying attacker-chosen parameters.
 */

import crypto from "node:crypto";
import { prisma } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { CONFIG } from "../config.js";
import { redisService } from "../redis.js";
import { safeFetch, type SafeFetchOptions } from "./safe-fetch.js";
import type { HostCredentialScheme } from "./host-credentials.js";
import { createLogger } from "../logger.js";

const log = createLogger("host-oauth");

const allowLoopback = (): boolean => process.env["HOST_OAUTH_ALLOW_LOOPBACK"] === "true";

/* ------------------------------------------------------------------ hosts */

/**
 * Suffixes under which two names are NOT the same organisation. A miss here
 * costs a Sign in button, never a security property.
 */
const PUBLIC_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk",
  "co.in", "net.in", "org.in", "ac.in", "gov.in",
  "co.jp", "ne.jp", "or.jp", "co.kr", "co.id", "co.th", "co.il", "co.ke", "co.za", "co.nz",
  "com.au", "net.au", "org.au", "edu.au", "com.br", "com.cn", "net.cn", "com.sg",
  "com.mx", "com.tr", "com.hk", "com.my", "com.ph", "com.vn", "com.pk", "com.ar",
  "com.pe", "com.co", "com.ua", "com.ng", "com.eg", "com.sa", "com.tw", "com.bd",
  "github.io", "gitlab.io", "github.dev", "githubusercontent.com",
  "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "workers.dev",
  "azurewebsites.net", "azurestaticapps.net", "cloudapp.azure.com", "core.windows.net",
  "sharepoint.com", "cloudfront.net", "amazonaws.com", "elasticbeanstalk.com",
  "appspot.com", "firebaseapp.com", "web.app", "run.app", "a.run.app",
  "onrender.com", "fly.dev", "repl.co", "glitch.me", "surge.sh",
  "ngrok.io", "ngrok-free.app", "trycloudflare.com",
  "atlassian.net", "myshopify.com", "zendesk.com", "freshdesk.com", "service-now.com",
  "okta.com", "oktapreview.com", "auth0.com", "notion.site", "wixsite.com",
  "blogspot.com", "wordpress.com", "readthedocs.io", "gitbook.io",
]);

/**
 * Do these two hostnames plausibly belong to the same organisation? They must
 * share at least two trailing labels, and the shared part must not be a suffix
 * anyone can get a name under.
 *
 *   bitbucket.juspay.net ↔ sso.juspay.net → yes
 *   a.vercel.app         ↔ b.vercel.app   → no (share only a public suffix)
 *   app.acme.co.uk       ↔ id.acme.co.uk  → yes (3 labels shared)
 */
export function relatedHosts(a: string, b: string): boolean {
  const hostA = normalizeHostname(a);
  const hostB = normalizeHostname(b);
  if (!hostA || !hostB) return false;
  if (hostA === hostB) return true;
  const left = hostA.split(".");
  const right = hostB.split(".");

  let shared = 0;
  while (
    shared < left.length &&
    shared < right.length &&
    left[left.length - 1 - shared] === right[right.length - 1 - shared]
  ) {
    shared += 1;
  }
  if (shared < 2) return false;
  if (PUBLIC_SUFFIXES.has(left.slice(left.length - shared).join("."))) return false;
  // `acme.co.uk` is fine to share; `co.uk` alone is not.
  if (PUBLIC_SUFFIXES.has(left.slice(left.length - 2).join("."))) return shared >= 3;
  return true;
}

/** A trailing dot is the same server but a different string — strip it. */
export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
}

/**
 * RFC 8414 §3.3 issuer comparison. `new URL(x).toString()` ADDS a trailing
 * slash, so normalising through URL and comparing to what a server sends over
 * the wire fails for every issuer published without one.
 */
export function sameIssuer(a: string, b: string): boolean {
  const trim = (v: string): string => v.replace(/\/+$/, "");
  try {
    return trim(new URL(a).toString()) === trim(new URL(b).toString());
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------- discovery */

export type DiscoverySource =
  | "www-authenticate"
  | "protected-resource"
  | "authorization-server"
  | "openid-configuration";

export interface DiscoveredAuthServer {
  /** Exactly as published — the RFC 9207 `iss` check compares it byte-for-byte. */
  issuer: string;
  issuerHost: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** null ⇒ no RFC 7591 support ⇒ no sign-in button. */
  registrationEndpoint: string | null;
  revocationEndpoint: string | null;
  scopesSupported: string[];
  resource: string | null;
  via: DiscoverySource;
}

function metadataOptions(): SafeFetchOptions {
  return {
    maxResponseBytes: 256 * 1024,
    timeoutMs: 8_000,
    /*
     * Zero, deliberately. `safeFetch` rebuilds its result, so `response.url` is
     * empty and a followed redirect is invisible to us — a validated pointer
     * could 302 to an unrelated origin and we would parse that document
     * believing it came from the host we checked.
     */
    maxRedirects: 0,
    allowLoopbackInDev: allowLoopback(),
  };
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await safeFetch(url, { headers: { Accept: "application/json" } }, metadataOptions());
    if (!res.ok) return null;
    const parsed = JSON.parse(await res.text()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Includes a login page served with 200 where JSON was expected, which is
    // routine on exactly the internal hosts this targets.
    return null;
  }
}

function str(doc: Record<string, unknown>, key: string): string | null {
  const v = doc[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function httpsUrl(value: string | null): URL | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol === "https:") return parsed;
  // Plain http only for a deliberately enabled local test rig.
  if (parsed.protocol === "http:" && allowLoopback() && process.env["NODE_ENV"] !== "production") {
    return parsed;
  }
  return null;
}

/**
 * Validate an RFC 8414 / OIDC metadata document. Returns null — never a
 * partially-trusted object — on any missing, non-https or off-host field.
 *
 * `expectedIssuer` is the issuer whose well-known path we just read; comparing
 * it to the document's own `issuer` is what stops a host from serving, at its
 * own well-known URL, a document claiming to be a different authorization server.
 */
export function parseAuthServerMetadata(
  doc: Record<string, unknown>,
  resourceHost: string,
  via: DiscoverySource,
  resource: string | null,
  expectedIssuer: string,
): DiscoveredAuthServer | null {
  const rawIssuer = str(doc, "issuer");
  const issuerUrl = httpsUrl(rawIssuer);
  if (!issuerUrl) return null;
  const issuerHost = normalizeHostname(issuerUrl.hostname);

  if (!sameIssuer(rawIssuer as string, expectedIssuer)) {
    log.warn(`[discovery] metadata at ${expectedIssuer} claims issuer ${String(rawIssuer)} — refusing`);
    return null;
  }
  if (!relatedHosts(issuerHost, resourceHost)) {
    log.warn(`[discovery] ${resourceHost} nominated unrelated AS ${issuerHost} — refusing`);
    return null;
  }

  const authorize = httpsUrl(str(doc, "authorization_endpoint"));
  const token = httpsUrl(str(doc, "token_endpoint"));
  if (!authorize || !token) return null;

  // Siblings are fine — canva.com serves authorize on www. and token on api. —
  // but an unrelated host would mean handing the exchange somewhere unchecked.
  if (!relatedHosts(authorize.hostname, issuerHost) || !relatedHosts(token.hostname, issuerHost)) {
    log.warn(`[discovery] ${issuerHost} published endpoints on an unrelated host — refusing`);
    return null;
  }

  // PKCE is mandatory for us; a server advertising its methods without S256
  // would silently downgrade the flow.
  const methods = doc["code_challenge_methods_supported"];
  if (Array.isArray(methods) && !methods.includes("S256")) {
    log.warn(`[discovery] ${issuerHost} does not advertise PKCE S256 — refusing`);
    return null;
  }

  const registration = httpsUrl(str(doc, "registration_endpoint"));
  const revocation = httpsUrl(str(doc, "revocation_endpoint"));
  const scopes = Array.isArray(doc["scopes_supported"])
    ? (doc["scopes_supported"] as unknown[]).filter((s): s is string => typeof s === "string")
    : [];

  return {
    issuer: rawIssuer as string,
    issuerHost,
    authorizationEndpoint: authorize.toString(),
    tokenEndpoint: token.toString(),
    registrationEndpoint:
      registration && relatedHosts(registration.hostname, issuerHost) ? registration.toString() : null,
    revocationEndpoint:
      revocation && relatedHosts(revocation.hostname, issuerHost) ? revocation.toString() : null,
    scopesSupported: scopes,
    resource,
    via,
  };
}

/** RFC 9728 §5.1: `WWW-Authenticate: Bearer resource_metadata="https://..."`. */
export function resourceMetadataUrlFrom(header: string | null | undefined): string | null {
  if (!header) return null;
  const quoted = header.match(/resource_metadata\s*=\s*"([^"]+)"/i);
  if (quoted?.[1]) return quoted[1];
  return header.match(/resource_metadata\s*=\s*([^\s,]+)/i)?.[1] ?? null;
}

interface Candidate {
  url: string;
  kind: DiscoverySource;
  /** The issuer this well-known path implies, for the §3.3 check. */
  issuer: string;
}

/** Well-known probes for one origin, RFC 8414 §3.1 path-insertion included. */
function wellKnownCandidates(target: URL): Candidate[] {
  const origin = target.origin;
  const path = target.pathname.replace(/\/+$/, "");
  const out: Candidate[] = [
    { url: `${origin}/.well-known/oauth-protected-resource`, kind: "protected-resource", issuer: origin },
    { url: `${origin}/.well-known/oauth-authorization-server`, kind: "authorization-server", issuer: origin },
    { url: `${origin}/.well-known/openid-configuration`, kind: "openid-configuration", issuer: origin },
  ];
  // Tenanted deployments publish under their own path prefix, not at the root.
  const prefix = path && path !== "/" ? path.split("/").filter(Boolean)[0] : undefined;
  if (prefix) {
    out.push({ url: `${origin}/.well-known/oauth-protected-resource/${prefix}`, kind: "protected-resource", issuer: `${origin}/${prefix}` });
    out.push({ url: `${origin}/.well-known/oauth-authorization-server/${prefix}`, kind: "authorization-server", issuer: `${origin}/${prefix}` });
  }
  return out;
}

async function loadIssuerMetadata(
  issuer: string,
  resourceHost: string,
  resource: string | null,
): Promise<DiscoveredAuthServer | null> {
  let base: URL;
  try {
    base = new URL(issuer);
  } catch {
    return null;
  }
  const path = base.pathname.replace(/\/+$/, "");
  const expectedIssuer = `${base.origin}${path}`;
  const candidates = [
    { url: `${base.origin}/.well-known/oauth-authorization-server${path}`, kind: "authorization-server" as const },
    { url: `${base.origin}/.well-known/openid-configuration${path}`, kind: "openid-configuration" as const },
    { url: `${base.origin}${path}/.well-known/openid-configuration`, kind: "openid-configuration" as const },
  ];
  for (const candidate of candidates) {
    const doc = await fetchJson(candidate.url);
    if (!doc) continue;
    const parsed = parseAuthServerMetadata(doc, resourceHost, candidate.kind, resource, expectedIssuer);
    if (parsed) return parsed;
  }
  return null;
}

async function fromProtectedResourceDoc(
  doc: Record<string, unknown>,
  resourceHost: string,
  via: DiscoverySource,
): Promise<DiscoveredAuthServer | null> {
  const servers = doc["authorization_servers"];
  if (!Array.isArray(servers)) return null;
  const resource = str(doc, "resource");

  for (const entry of servers.slice(0, 3)) {
    if (typeof entry !== "string") continue;
    const issuer = httpsUrl(entry);
    if (!issuer) continue;
    if (!relatedHosts(issuer.hostname, resourceHost)) {
      log.warn(`[discovery] ${resourceHost} nominated unrelated AS ${issuer.hostname} — refusing`);
      continue;
    }
    const found = await loadIssuerMetadata(entry, resourceHost, resource);
    if (found) return { ...found, via };
  }
  return null;
}

/** Unauthenticated GET purely to read the `WWW-Authenticate` challenge. */
async function probeChallenge(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, { headers: { Accept: "application/json" } }, {
      ...metadataOptions(),
      maxResponseBytes: 4 * 1024,
      timeoutMs: 6_000,
    });
    return res.headers.get("www-authenticate");
  } catch {
    return null;
  }
}

/**
 * Find the authorization server for `targetUrl`. Null means "this host does not
 * do OAuth, or not in a way we can use" — the ordinary answer, not a failure.
 *
 * `wwwAuthenticate` is the header from the response that blocked the agent when
 * the caller has it; it is the only branch the specs guarantee, so it is worth
 * one extra GET to fetch when the caller has none.
 */
export async function discoverHostOAuth(
  targetUrl: string,
  wwwAuthenticate?: string | null,
): Promise<DiscoveredAuthServer | null> {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return null;
  }
  const resourceHost = normalizeHostname(target.hostname);

  const header = wwwAuthenticate ?? (await probeChallenge(target.toString()));
  const fromHeader = resourceMetadataUrlFrom(header);
  if (fromHeader) {
    const headerUrl = httpsUrl(fromHeader);
    // The 401 is attacker-influenced too: an off-host pointer is a redirect we
    // never agreed to.
    if (headerUrl && relatedHosts(headerUrl.hostname, resourceHost)) {
      const doc = await fetchJson(headerUrl.toString());
      const found = doc ? await fromProtectedResourceDoc(doc, resourceHost, "www-authenticate") : null;
      if (found) return found;
    }
  }

  const candidates = wellKnownCandidates(target);
  const docs = await Promise.all(candidates.map((c) => fetchJson(c.url)));

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i] as Candidate;
    const doc = docs[i];
    if (!doc) continue;

    if (candidate.kind === "protected-resource") {
      const found = await fromProtectedResourceDoc(doc, resourceHost, candidate.kind);
      if (found) return found;
      continue;
    }
    const parsed = parseAuthServerMetadata(doc, resourceHost, candidate.kind, null, candidate.issuer);
    if (parsed) return parsed;
  }

  log.info(`[discovery] no usable OAuth metadata for ${resourceHost}`);
  return null;
}

/* ------------------------------------------------- paste-a-token fallback */

export interface CredentialHint {
  product: string;
  /** Where to create a credential. Always on the host we were blocked on. */
  tokenUrl: string;
  scheme: HostCredentialScheme;
  note: string;
}

/**
 * When there is no sign-in button, say WHICH credential to make and where.
 *
 * Every branch must fail closed: a wrong guess sends someone to a 404 on their
 * own intranet, which is worse than the generic copy. Entries are only added
 * once verified against a real instance.
 */
export async function detectCredentialHint(host: string): Promise<CredentialHint | null> {
  let headers: Headers;
  let title: string;
  try {
    const res = await safeFetch(
      `https://${host}/`,
      { headers: { Accept: "text/html,application/json" } },
      {
        maxResponseBytes: 64 * 1024,
        // Truncate rather than throw: a homepage over the cap is normal, and
        // without this a host identifiable from its RESPONSE HEADERS alone
        // (github.com, measured) silently returns no hint.
        truncateOversizeBody: true,
        timeoutMs: 6_000,
        maxRedirects: 2,
        allowLoopbackInDev: allowLoopback(),
      },
    );
    const body = await res.text().catch(() => "");
    headers = res.headers;
    title = (/<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1] ?? "").trim();
  } catch {
    return null;
  }

  const hay = `${title} ${host}`.toLowerCase();

  // `x-arequestid` identifies Atlassian Data Center but not WHICH product, and
  // Jira and Confluence keep their tokens somewhere else entirely.
  if (headers.get("x-arequestid")) {
    if (hay.includes("bitbucket")) {
      return {
        product: "Bitbucket Data Center",
        tokenUrl: `https://${host}/plugins/servlet/access-tokens/manage`,
        scheme: "bearer",
        note: "Create an HTTP access token with Repositories: Read. Better than a session cookie — it is scoped, revocable, and will not expire mid-task.",
      };
    }
    log.info(`[hint] ${host} is Atlassian DC but not identifiable as Bitbucket — no link offered`);
    return null;
  }

  if (headers.get("x-gitlab-meta") || /gitlab/i.test(title)) {
    return {
      product: "GitLab",
      tokenUrl: `https://${host}/-/user_settings/personal_access_tokens`,
      scheme: "bearer",
      note: "Create a personal access token with the read_api scope.",
    };
  }

  if (headers.get("x-github-request-id")) {
    return {
      product: host === "github.com" ? "GitHub" : "GitHub Enterprise",
      tokenUrl: `https://${host}/settings/tokens`,
      scheme: "bearer",
      note: "Create a personal access token with read access to the repositories you need.",
    };
  }

  return null;
}

/* ----------------------------------------------------- registered clients */

/** Re-run discovery past this age so a rotated endpoint is eventually picked up. */
const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

export interface HostOAuthClientRecord {
  host: string;
  issuer: string;
  issuerHost: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
  resource: string | null;
  scope: string | null;
  clientId: string;
  clientSecret: string | null;
  redirectUri: string;
}

/** Fixed, and registered as such — never derived from a request. */
export function hostOAuthRedirectUri(): string {
  const base = (process.env["AUTH_SERVICE_URL"] ?? "http://localhost:3003").replace(/\/+$/, "");
  return `${base}/claw/api/v1/host-oauth/callback`;
}

function tokenRequestOptions(): SafeFetchOptions {
  return {
    maxResponseBytes: 256 * 1024,
    timeoutMs: 10_000,
    maxRedirects: 0,
    allowLoopbackInDev: allowLoopback(),
  };
}

function decryptSecret(row: {
  encryptedSecret: string | null;
  iv: string | null;
  authTag: string | null;
}): string | null {
  if (!row.encryptedSecret || !row.iv || !row.authTag) return null;
  try {
    return decrypt(row.encryptedSecret, row.iv, row.authTag, CONFIG.encryptionKey);
  } catch (err) {
    log.error("[host-oauth] client secret decrypt failed:", err);
    return null;
  }
}

function toRecord(row: {
  host: string;
  issuer: string;
  issuerHost: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
  resource: string | null;
  scope: string | null;
  clientId: string;
  redirectUri: string;
  encryptedSecret: string | null;
  iv: string | null;
  authTag: string | null;
}): HostOAuthClientRecord {
  return {
    host: row.host,
    issuer: row.issuer,
    issuerHost: row.issuerHost,
    authorizationEndpoint: row.authorizationEndpoint,
    tokenEndpoint: row.tokenEndpoint,
    revocationEndpoint: row.revocationEndpoint,
    resource: row.resource,
    scope: row.scope,
    clientId: row.clientId,
    clientSecret: decryptSecret(row),
    redirectUri: row.redirectUri,
  };
}

/**
 * Register a client on the host's own authorization server.
 *
 * Public client (`token_endpoint_auth_method: "none"`) relying on PKCE: a
 * confidential client would mean holding a long-lived secret for a host we
 * discovered five seconds ago, and buys nothing when the redirect_uri is fixed.
 *
 * Scope policy is to ask for nothing and let the server apply its default —
 * requesting everything in `scopes_supported` would be a request for admin,
 * write and delete on a service we know nothing about. `offline_access` is the
 * exception: without a refresh token a long task dies when the token ages out.
 */
async function registerClient(
  discovered: DiscoveredAuthServer,
  redirectUri: string,
): Promise<{ clientId: string; clientSecret: string | null; scope: string | null } | null> {
  if (!discovered.registrationEndpoint) return null;
  const scope = discovered.scopesSupported.includes("offline_access") ? "offline_access" : null;

  const res = await safeFetch(
    discovered.registrationEndpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_name: "Xyne Claw",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "web",
        ...(scope ? { scope } : {}),
      }),
    },
    tokenRequestOptions(),
  );

  if (!res.ok) {
    log.warn(`[host-oauth] DCR refused by ${discovered.issuerHost}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return null;
  }

  const data = (await res.json()) as { client_id?: unknown; client_secret?: unknown; scope?: unknown };
  const clientId = typeof data.client_id === "string" ? data.client_id : "";
  if (!clientId) return null;

  return {
    clientId,
    clientSecret: typeof data.client_secret === "string" ? data.client_secret : null,
    scope: typeof data.scope === "string" ? data.scope : scope,
  };
}

/** Cached lookup only — no network. Used by the card, which must render fast. */
export async function lookupHostOAuthClient(host: string): Promise<HostOAuthClientRecord | null> {
  const row = await prisma.hostOAuthClient.findUnique({ where: { host } });
  if (!row) return null;
  if (row.redirectUri !== hostOAuthRedirectUri()) return null;
  return toRecord(row);
}

/**
 * Discover, register if needed, and return the client for `host`. One
 * registration per host, reused by every user: DCR creates a real persistent
 * object on somebody else's server, and per-user registration would make this
 * backend an amplifier that fills a third party's client table on demand.
 *
 * `probeUrl` is the URL the agent was blocked on — its path matters, because
 * tenanted deployments publish metadata under a path prefix.
 */
export async function ensureHostOAuthClient(
  host: string,
  probeUrl: string,
  wwwAuthenticate?: string | null,
): Promise<HostOAuthClientRecord | null> {
  const redirectUri = hostOAuthRedirectUri();
  const existing = await prisma.hostOAuthClient.findUnique({ where: { host } });

  if (
    existing &&
    existing.redirectUri === redirectUri &&
    Date.now() - existing.discoveredAt.getTime() < DISCOVERY_TTL_MS
  ) {
    return toRecord(existing);
  }

  // The probe URL comes from the agent; the host does not. Binding discovery to
  // the host we were asked about stops a crafted URL from pointing discovery at
  // an unrelated origin whose answer would be cached under this host.
  let probe = `https://${host}/`;
  try {
    const parsed = new URL(probeUrl);
    if (parsed.hostname.toLowerCase() === host) probe = parsed.toString();
  } catch {
    /* keep the origin-root probe */
  }

  const discovered = await discoverHostOAuth(probe, wwwAuthenticate);
  if (!discovered) {
    log.info(`[host-oauth] ${host} has no usable OAuth metadata`);
    return null;
  }
  if (!discovered.registrationEndpoint) {
    log.info(`[host-oauth] ${discovered.issuerHost} publishes no registration_endpoint — no sign-in button`);
    return null;
  }
  if (!relatedHosts(discovered.issuerHost, host)) return null;

  // Reuse a client we already hold for this issuer rather than registering a
  // second one because a sibling hostname asked.
  const sibling =
    existing?.issuer === discovered.issuer && existing.redirectUri === redirectUri
      ? existing
      : await prisma.hostOAuthClient.findFirst({ where: { issuer: discovered.issuer, redirectUri } });

  let clientId = sibling?.clientId ?? "";
  let encrypted: { ciphertext: string; iv: string; authTag: string } | null = null;
  let scope = sibling?.scope ?? null;

  if (sibling) {
    const secret = decryptSecret(sibling);
    if (secret) encrypted = encrypt(secret, CONFIG.encryptionKey);
  } else {
    const registered = await registerClient(discovered, redirectUri).catch((err) => {
      log.warn(`[host-oauth] DCR failed for ${discovered.issuerHost}:`, err);
      return null;
    });
    if (!registered) return null;
    clientId = registered.clientId;
    scope = registered.scope;
    if (registered.clientSecret) encrypted = encrypt(registered.clientSecret, CONFIG.encryptionKey);
  }

  const data = {
    issuer: discovered.issuer,
    issuerHost: discovered.issuerHost,
    authorizationEndpoint: discovered.authorizationEndpoint,
    tokenEndpoint: discovered.tokenEndpoint,
    registrationEndpoint: discovered.registrationEndpoint,
    revocationEndpoint: discovered.revocationEndpoint,
    resource: discovered.resource,
    scope,
    clientId,
    redirectUri,
    encryptedSecret: encrypted?.ciphertext ?? null,
    iv: encrypted?.iv ?? null,
    authTag: encrypted?.authTag ?? null,
    discoveredAt: new Date(),
  };

  const row = await prisma.hostOAuthClient.upsert({
    where: { host },
    create: { host, ...data },
    update: data,
  });
  log.info(`[host-oauth] ${host} → issuer=${discovered.issuerHost} via=${discovered.via} client=${clientId.slice(0, 8)}…`);
  return toRecord(row);
}

/* ------------------------------------------------------------ token grant */

export interface HostOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** null when the server did not say — treated as "no known expiry". */
  expiresAt: Date | null;
  scope: string | null;
}

async function postToken(tokenEndpoint: string, body: URLSearchParams): Promise<HostOAuthTokens | null> {
  const res = await safeFetch(
    tokenEndpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    },
    tokenRequestOptions(),
  );
  if (!res.ok) {
    log.warn(`[host-oauth] token endpoint said ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = (await res.json()) as Record<string, unknown>;
  const accessToken = typeof data["access_token"] === "string" ? data["access_token"] : "";
  if (!accessToken) return null;
  const expiresIn = typeof data["expires_in"] === "number" ? data["expires_in"] : null;
  return {
    accessToken,
    refreshToken: typeof data["refresh_token"] === "string" ? data["refresh_token"] : null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    scope: typeof data["scope"] === "string" ? data["scope"] : null,
  };
}

export async function exchangeAuthorizationCode(params: {
  client: HostOAuthClientRecord;
  code: string;
  codeVerifier: string;
}): Promise<HostOAuthTokens | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.client.redirectUri,
    client_id: params.client.clientId,
    code_verifier: params.codeVerifier,
  });
  if (params.client.clientSecret) body.set("client_secret", params.client.clientSecret);
  // RFC 8707: audience-bind the token so it cannot be replayed at another
  // service behind the same authorization server.
  if (params.client.resource) body.set("resource", params.client.resource);
  return postToken(params.client.tokenEndpoint, body);
}

/** Pure network — the DB write belongs to `host-credentials.ts`. */
export async function refreshHostOAuthToken(params: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string | null;
  refreshToken: string;
  resource?: string | null;
}): Promise<HostOAuthTokens | null> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });
  if (params.clientSecret) body.set("client_secret", params.clientSecret);
  if (params.resource) body.set("resource", params.resource);
  try {
    return await postToken(params.tokenEndpoint, body);
  } catch (err) {
    log.warn("[host-oauth] refresh failed:", err);
    return null;
  }
}

/**
 * RFC 7009 revocation — best effort by design. A provider that is down must
 * never stop a user deleting their own credential, so every failure here is
 * swallowed and the delete proceeds.
 */
export async function revokeHostOAuthToken(params: {
  revocationEndpoint: string;
  clientId: string;
  clientSecret?: string | null;
  token: string;
  tokenTypeHint: "access_token" | "refresh_token";
}): Promise<boolean> {
  try {
    const body = new URLSearchParams({
      token: params.token,
      token_type_hint: params.tokenTypeHint,
      client_id: params.clientId,
    });
    if (params.clientSecret) body.set("client_secret", params.clientSecret);
    const res = await safeFetch(
      params.revocationEndpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      tokenRequestOptions(),
    );
    return res.ok;
  } catch (err) {
    log.warn("[host-oauth] revocation failed:", err);
    return false;
  }
}

/** Endpoints needed to revoke, looked up by host. No user data involved. */
export async function revocationDetailsFor(
  host: string,
): Promise<{ revocationEndpoint: string; clientId: string; clientSecret: string | null } | null> {
  const row = await prisma.hostOAuthClient.findUnique({ where: { host } });
  if (!row?.revocationEndpoint) return null;
  return {
    revocationEndpoint: row.revocationEndpoint,
    clientId: row.clientId,
    clientSecret: decryptSecret(row),
  };
}

/* ------------------------------------------------------------- flow store */

const FLOW_PREFIX = "host-oauth-flow:";
/** Enterprise SSO first-run is slow: account chooser, MFA, device trust, consent. */
const FLOW_TTL_SECONDS = 30 * 60;

export interface HostOAuthFlow {
  userId: string;
  /** Resource host, lowercase. The credential is written for exactly this. */
  host: string;
  /** Checked against the RFC 9207 `iss` at the callback. */
  issuer: string;
  clientId: string;
  codeVerifier: string;
  /** The URL the run was blocked on, used to verify the new token works. */
  blockedUrl: string | null;
  /** Which conversation to resume — the callback has no other way to know. */
  conversationId: string | null;
  returnTo: string;
  createdAt: number;
}

/**
 * Park one in-flight authorization server-side.
 *
 * This exists so the PKCE verifier never travels in `state`. `signOAuthState`
 * SIGNS its payload, it does not ENCRYPT it, so anyone holding the state string
 * — the browser, extensions, the authorization server, every proxy and access
 * log in between — can read it verbatim. A verifier travelling beside its own
 * authorization code reduces the flow to plain authorization-code, which is
 * what PKCE exists to stop being enough.
 */
export async function createHostOAuthFlow(flow: Omit<HostOAuthFlow, "createdAt">): Promise<string> {
  const flowId = crypto.randomBytes(16).toString("base64url");
  const record: HostOAuthFlow = { ...flow, createdAt: Date.now() };
  const redis = redisService.getConnection();
  await redis.set(`${FLOW_PREFIX}${flowId}`, JSON.stringify(record), "EX", FLOW_TTL_SECONDS);
  log.info(`[host-oauth-flow] created ${flowId.slice(0, 8)}… user=${flow.userId} host=${flow.host}`);
  return flowId;
}

/** Atomic take — a replayed callback finds nothing. */
export async function consumeHostOAuthFlow(flowId: string): Promise<HostOAuthFlow | null> {
  try {
    const redis = redisService.getConnection();
    const raw = await redis.getdel(`${FLOW_PREFIX}${flowId}`);
    return raw ? (JSON.parse(raw) as HostOAuthFlow) : null;
  } catch (err) {
    log.error("[host-oauth-flow] consume failed:", err);
    return null;
  }
}
