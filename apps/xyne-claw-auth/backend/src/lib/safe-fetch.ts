import { isIP } from "node:net";
import { Agent } from "undici";
import {
  createPublicOnlyLookup,
  defaultResolve,
  isBlockedIpAddress,
  isLoopbackAddress,
  type ResolvedAddress,
} from "xyne-claw-shared";
import { CONFIG } from "../config.js";

export type SafeFetchErrorCode =
  | "invalid-url" | "blocked-scheme" | "blocked-userinfo" | "blocked-address"
  | "dns" | "too-many-redirects" | "response-too-large" | "not-config-origin";

export class SafeFetchError extends Error {
  constructor(message: string, readonly code: SafeFetchErrorCode, readonly url: string) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchOptions {
  allowPrivate?: boolean;
  allowLoopbackInDev?: boolean;
  /** internalFetch only: attach the fleet S2S key to the (config-origin) target. */
  s2s?: boolean;
  lookup?: ((hostname: string) => Promise<ResolvedAddress[]>) | undefined;
  maxRedirects?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
}

const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;

const SENSITIVE_HEADERS = new Set([
  "authorization", "proxy-authorization", "cookie", "x-s2s-key", "x-session-token", "x-api-key",
]);

function stripBrackets(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "");
}

/** Hostname is `localhost`, `*.localhost` or a loopback literal. */
export function isLoopbackHost(host: string): boolean {
  return isLoopbackHostname(host);
}

function isLoopbackHostname(host: string): boolean {
  const bare = stripBrackets(host).toLowerCase();
  if (bare === "localhost" || bare.endsWith(".localhost")) return true;
  return isLoopbackAddress(bare);
}

function loopbackAllowed(opts: SafeFetchOptions): boolean {
  if (opts.allowPrivate) return true;
  return opts.allowLoopbackInDev === true && process.env["NODE_ENV"] !== "production";
}

/**
 * The DNS-free half of the policy: scheme, userinfo and any literal address in
 * the host. `new URL()` canonicalises decimal/octal/hex/shortened IPv4 hosts
 * (`0x7f000001`, `2130706433`, `127.1`) to dotted-quad, so the deny list always
 * sees the real address and no numeric-host parser is needed here.
 */
function parseSafeUrl(rawUrl: string, opts: SafeFetchOptions): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("must be an absolute http(s) URL", "invalid-url", String(rawUrl));
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SafeFetchError(`unsupported URL protocol ${parsed.protocol}`, "blocked-scheme", rawUrl);
  }
  if (parsed.username || parsed.password) {
    throw new SafeFetchError("must not embed credentials in the URL", "blocked-userinfo", rawUrl);
  }
  const host = stripBrackets(parsed.hostname);
  if (!host) throw new SafeFetchError("is missing a hostname", "invalid-url", rawUrl);

  const allowLoopback = loopbackAllowed(opts);
  if (isLoopbackHostname(host) && !allowLoopback) {
    throw new SafeFetchError(`points at loopback (${host})`, "blocked-address", rawUrl);
  }
  if (isIP(host) !== 0 && !opts.allowPrivate && isBlockedIpAddress(host) && !(allowLoopback && isLoopbackAddress(host))) {
    throw new SafeFetchError(`points at a blocked address (${host})`, "blocked-address", rawUrl);
  }
  return parsed;
}

/** Save-time check for a URL that is not being dialled yet (an MCP server
 *  template, a stored backend URL). Returns a reason, or null when allowed. */
export function outboundUrlSyntaxError(rawUrl: string): string | null {
  try {
    parseSafeUrl(rawUrl, {});
    return null;
  } catch (err) {
    return err instanceof SafeFetchError ? err.message : "is not an allowed destination";
  }
}

const defaultLookup = defaultResolve;

/**
 * Validate an outbound URL and resolve it to the exact addresses a connect may
 * use. Every answer is checked, so a multi-A name mixing a public and a private
 * address is refused.
 */
async function assertDestination(
  rawUrl: string,
  opts: SafeFetchOptions,
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  const parsed = parseSafeUrl(rawUrl, opts);
  const host = stripBrackets(parsed.hostname);
  const allowLoopback = loopbackAllowed(opts);
  const allowPrivate = opts.allowPrivate === true || isAllowlistedPrivateOrigin(parsed.toString());

  const literal = isIP(host);
  if (literal !== 0) return { url: parsed, addresses: [{ address: host, family: literal }] };

  // A config origin is trusted by configuration, not by its address. DNS
  // pinning exists to defeat rebinding on an untrusted name, so skip both the
  // resolve and the pin here — it would only add a lookup (and, for in-cluster
  // or *.local service names, a slow one) to a destination we already trust.
  if (allowPrivate) return { url: parsed, addresses: [] };

  let resolved: ResolvedAddress[];
  try {
    resolved = await (opts.lookup ?? defaultLookup)(host);
  } catch {
    throw new SafeFetchError(`Could not resolve hostname: ${host}`, "dns", rawUrl);
  }
  if (resolved.length === 0) {
    throw new SafeFetchError(`Could not resolve hostname: ${host}`, "dns", rawUrl);
  }
  for (const entry of resolved) {
    if (allowPrivate) continue;
    if (allowLoopback && isLoopbackAddress(entry.address)) continue;
    if (isBlockedIpAddress(entry.address)) {
      throw new SafeFetchError(`Blocked destination address: ${entry.address}`, "blocked-address", rawUrl);
    }
  }
  return { url: parsed, addresses: resolved };
}

export async function assertSafeOutboundUrl(rawUrl: string, opts: SafeFetchOptions = {}): Promise<URL> {
  return (await assertDestination(rawUrl, opts)).url;
}

type ConnectCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

/**
 * Shared dispatcher for callers that cannot use `safeFetch` (streaming bodies,
 * soft size caps, manual redirect loops). Every connect — first request, each
 * redirect hop and each keep-alive reconnect — re-resolves the host through a
 * guarded lookup and refuses blocked addresses, so a pre-flight
 * `assertSafeOutboundUrl` cannot be bypassed by DNS rebinding between check
 * and connect. Loopback is permitted outside production only, matching
 * `allowLoopbackInDev`.
 */
export const publicOnlyAgent: Agent = new Agent({
  connect: { lookup: createPublicOnlyLookup({ allowLoopback: process.env["NODE_ENV"] !== "production" }) },
});

/**
 * Dispatcher to pass to `fetch` for an untrusted outbound URL. Operator-
 * allowlisted private origins and config origins are trusted by configuration
 * (they may legitimately live on a private address), so they keep the default
 * dispatcher; everything else gets the connect-time guard.
 */
export function outboundDispatcher(rawUrl: string): Agent | undefined {
  if (isAllowlistedPrivateOrigin(rawUrl) || isConfigOrigin(rawUrl)) return undefined;
  return publicOnlyAgent;
}

/** Dial this exact address while the request keeps the original Host/SNI. */
function pinnedAgent(address: string, family: number): Agent {
  const lookup = (_host: string, options: { all?: boolean | undefined }, cb: ConnectCallback): void => {
    if (options?.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
  return new Agent({ connect: { lookup } });
}

function normalizeHeaders(source: RequestInit["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!source) return out;
  if (source instanceof Headers) source.forEach((value, name) => { out[name] = value; });
  else if (Array.isArray(source)) for (const [name, value] of source) { if (name && value !== undefined) out[name] = value; }
  else for (const [name, value] of Object.entries(source)) { if (value !== undefined) out[name] = String(value); }
  return out;
}

function stripSensitiveHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => {
    const lower = name.toLowerCase();
    return !SENSITIVE_HEADERS.has(lower) && !lower.startsWith("x-auth-") && !lower.includes("api-key");
  }));
}

/** Read the body under a byte cap and hand back a detached, replayable Response. */
async function bufferCapped(response: Response, maxBytes: number, url: string): Promise<Response> {
  const chunks: Buffer[] = [];
  let total = 0;
  if (response.body) {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          throw new SafeFetchError(`Response exceeded ${maxBytes} bytes`, "response-too-large", url);
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  const { status, statusText, headers } = response;
  return new Response(Buffer.concat(chunks), { status, statusText, headers });
}

/**
 * SSRF-safe replacement for `fetch`. Validates the URL, resolves DNS once,
 * re-checks every resolved address, then connects to the pinned address so the
 * name cannot be re-resolved to a private target between check and connect.
 * Redirects are followed manually and re-validated per hop; sensitive headers
 * are dropped on any origin change. `maxRedirects: 0` returns the redirect
 * response instead of following it.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let url = rawUrl;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  let headers = normalizeHeaders(init.headers);
  let redirects = 0;

  for (;;) {
    const { url: parsed, addresses } = await assertDestination(url, opts);
    const pinned = addresses[0];
    const agent = pinned ? pinnedAgent(pinned.address, pinned.family) : undefined;

    let response: Response;
    try {
      const requestInit: Record<string, unknown> = {
        ...init,
        method,
        headers,
        redirect: "manual",
        signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        ...(agent ? { dispatcher: agent } : {}),
      };
      if (body === undefined || method === "GET" || method === "HEAD") delete requestInit["body"];
      else requestInit["body"] = body;
      response = await fetch(url, requestInit as RequestInit);
    } catch (err) {
      await agent?.close().catch(() => undefined);
      throw err;
    }

    let buffered: Response;
    try {
      buffered = await bufferCapped(response, maxBytes, url);
    } finally {
      await agent?.close().catch(() => undefined);
    }

    const status = response.status;
    if (status < 300 || status >= 400 || status === 304) return buffered;

    const location = response.headers.get("location");
    if (!location || maxRedirects === 0) return buffered;

    redirects += 1;
    if (redirects > maxRedirects) {
      throw new SafeFetchError("Too many redirects", "too-many-redirects", url);
    }
    const nextUrl = new URL(location, url).toString();
    if (new URL(nextUrl).origin !== parsed.origin) headers = stripSensitiveHeaders(headers);
    if (status === 303 || ((status === 301 || status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
    }
    url = nextUrl;
  }
}

function toOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function configOrigins(): string[] {
  const extra = (process.env["CLUSTER_CALLBACK_ORIGINS"] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [
    CONFIG.selfUrl,
    CONFIG.internalUrl,
    CONFIG.xyneClawUrl,
    CONFIG.spacesInternalUrl,
    CONFIG.spacesBackendUrl,
    ...extra,
  ]
    .map(toOrigin)
    .filter((origin): origin is string => origin !== null);
}

export function privateOrigins(): string[] {
  return (process.env["OUTBOUND_PRIVATE_ORIGIN_ALLOWLIST"] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(toOrigin)
    .filter((origin): origin is string => origin !== null);
}

/**
 * Exact-origin match against operator-allowlisted private destinations, for
 * in-cluster services a connector is legitimately configured to reach. Trusted
 * by configuration, like a config origin — never by anything a caller supplies.
 */
export function isAllowlistedPrivateOrigin(rawUrl: string): boolean {
  const candidate = toOrigin(rawUrl);
  return candidate !== null && privateOrigins().includes(candidate);
}

/** Exact-origin match against the configured internal services. */
export function isConfigOrigin(rawUrl: string): boolean {
  const candidate = toOrigin(rawUrl);
  return candidate !== null && configOrigins().includes(candidate);
}

/**
 * The only sanctioned way to attach the fleet S2S key: it is added when, and
 * only when, the target origin is one this service was configured with.
 */
export function attachS2sKey(
  headers: Record<string, string>,
  rawUrl: string,
  key: string = CONFIG.xyneClawS2sKey,
): Record<string, string> {
  if (!key || !isConfigOrigin(rawUrl)) return { ...headers };
  return { ...headers, "x-s2s-key": key };
}

/**
 * Fetch a config-derived internal URL. Refuses anything not on a config origin,
 * and is the only function permitted to attach the fleet S2S key (`s2s: true`).
 */
export async function internalFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<Response> {
  if (!isConfigOrigin(rawUrl)) {
    throw new SafeFetchError("Target is not a configured internal origin", "not-config-origin", rawUrl);
  }
  const headers = opts.s2s ? attachS2sKey(normalizeHeaders(init.headers), rawUrl) : init.headers;
  return safeFetch(rawUrl, { ...init, ...(headers ? { headers } : {}) }, { ...opts, allowPrivate: true });
}
