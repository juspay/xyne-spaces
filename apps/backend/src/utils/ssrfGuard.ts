
import { promises as dns } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export class SsrfBlockedError extends Error {
  public override readonly name = 'SsrfBlockedError';
  public readonly host: string;
  public readonly resolvedAddress: string | null;
  public constructor(host: string, resolvedAddress: string | null, reason: string) {
    super(
      `Refusing to connect to ${host}${resolvedAddress ? ` (${resolvedAddress})` : ''}: ${reason}`,
    );
    this.host = host;
    this.resolvedAddress = resolvedAddress;
  }
}

function isAllowPrivate(): boolean {
  // Local devs set DATA_SOURCE_ALLOW_PRIVATE_HOSTS=true in their own env.
  return config.dataSource.allowPrivateHosts;
}

const blockedV4 = new BlockList();
blockedV4.addRange('0.0.0.0', '0.255.255.255');
blockedV4.addRange('10.0.0.0', '10.255.255.255');
blockedV4.addRange('100.64.0.0', '100.127.255.255');
blockedV4.addRange('127.0.0.0', '127.255.255.255');
blockedV4.addRange('169.254.0.0', '169.254.255.255');
blockedV4.addRange('172.16.0.0', '172.31.255.255');
blockedV4.addRange('192.0.0.0', '192.0.0.255');
blockedV4.addRange('192.168.0.0', '192.168.255.255');
blockedV4.addRange('198.18.0.0', '198.19.255.255');
blockedV4.addRange('224.0.0.0', '239.255.255.255');
blockedV4.addRange('240.0.0.0', '255.255.255.255');

const blockedV6 = new BlockList();
blockedV6.addAddress('::', 'ipv6');
blockedV6.addAddress('::1', 'ipv6');
blockedV6.addSubnet('fc00::', 7, 'ipv6');
blockedV6.addSubnet('fe80::', 10, 'ipv6');
blockedV6.addSubnet('ff00::', 8, 'ipv6');

// A stricter subset that is refused even when internal webhook hosts are otherwise
// allowed: loopback and link-local / cloud-metadata (169.254.x — the instance
// metadata endpoint that can return the workload's credentials).
const metadataV4 = new BlockList();
metadataV4.addRange('0.0.0.0', '0.255.255.255');
metadataV4.addRange('127.0.0.0', '127.255.255.255');
metadataV4.addRange('169.254.0.0', '169.254.255.255');
const metadataV6 = new BlockList();
metadataV6.addAddress('::', 'ipv6');
metadataV6.addAddress('::1', 'ipv6');
metadataV6.addSubnet('fe80::', 10, 'ipv6');
// The IPv6 instance-metadata prefix (fd00:ec2::/32) sits inside the fc00::/7 ULA
// range that internal webhooks are otherwise allowed to reach — refuse just this
// metadata prefix without blocking legitimate internal ULA addresses.
metadataV6.addSubnet('fd00:ec2::', 32, 'ipv6');
// (IPv4-mapped loopback/link-local/metadata — dotted and compact ::ffff: forms — is
// handled by ipv4FromMapped() in isMetadataV6, mirroring the strict isBlockedV6 path.)

function ipv4FromMapped(addr: string): string | null {
  const lower = addr.toLowerCase();
  const dotted = lower.match(/^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/);
  if (dotted && dotted[1]) return dotted[1];
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex && hex[1] && hex[2]) {
    const upperGroup = parseInt(hex[1], 16);
    const lowerGroup = parseInt(hex[2], 16);
    const octet0 = (upperGroup >> 8) & 0xff;
    const octet1 = upperGroup & 0xff;
    const octet2 = (lowerGroup >> 8) & 0xff;
    const octet3 = lowerGroup & 0xff;
    return `${octet0}.${octet1}.${octet2}.${octet3}`;
  }
  return null;
}

function isBlockedV4(addr: string): boolean {
  return blockedV4.check(addr);
}

function isBlockedV6(addr: string): boolean {
  const mapped = ipv4FromMapped(addr);
  if (mapped) return isBlockedV4(mapped);
  return blockedV6.check(addr, 'ipv6');
}

function isMetadataV4(addr: string): boolean {
  return metadataV4.check(addr);
}

function isMetadataV6(addr: string): boolean {
  const mapped = ipv4FromMapped(addr);
  if (mapped) return isMetadataV4(mapped);
  return metadataV6.check(addr, 'ipv6');
}

// Hostnames refused even when internal webhook targets are allowed.
function isMetadataHostname(host: string): boolean {
  const lower = host.toLowerCase().trim();
  return (
    lower === 'localhost' ||
    lower === 'metadata.google.internal' ||
    lower === 'metadata' ||
    lower === 'instance-data'
  );
}

// Additional host names refused for external fetches, from operator config:
// SSRF_BLOCKED_HOST_SUFFIXES (host suffixes) and the INTERNAL_APP_HOST_MAP keys.
function isConfiguredInternalHostname(lower: string): boolean {
  for (const suffix of config.ssrf.blockedHostSuffixes) {
    if (lower === suffix || lower.endsWith(suffix)) return true;
  }
  if (Object.prototype.hasOwnProperty.call(config.apps.internalHostMap, lower)) return true;
  return false;
}

function isBlockedHostname(host: string): boolean {
  const lower = host.toLowerCase().trim();
  if (lower === 'localhost') return true;
  if (lower.endsWith('.svc.cluster.local')) return true;
  if (lower.endsWith('.local')) return true;
  if (lower === 'metadata.google.internal') return true;
  if (lower === 'instance-data') return true;
  if (isConfiguredInternalHostname(lower)) return true;
  return false;
}

export async function assertHostIsExternal(
  host: string,
  allowPrivate: boolean = isAllowPrivate() && config.env === 'development',
): Promise<void> {
  if (allowPrivate) {
    logger.debug(
      '[SsrfGuard] private hosts allowed (DATA_SOURCE_ALLOW_PRIVATE_HOSTS); skipping check',
      { host },
    );
    return;
  }

  const trimmed = host.trim();
  if (!trimmed) throw new SsrfBlockedError(host, null, 'empty host');

  if (isBlockedHostname(trimmed)) {
    throw new SsrfBlockedError(trimmed, null, 'hostname maps to an internal-only address');
  }

  const literalKind = isIP(trimmed);
  if (literalKind === 4) {
    if (isBlockedV4(trimmed)) {
      throw new SsrfBlockedError(trimmed, trimmed, 'private / loopback / link-local IPv4');
    }
    return;
  }
  if (literalKind === 6) {
    if (isBlockedV6(trimmed)) {
      throw new SsrfBlockedError(trimmed, trimmed, 'private / loopback / link-local IPv6');
    }
    return;
  }

  let v4: string[] = [];
  let v6: string[] = [];
  try {
    [v4, v6] = await Promise.all([
      dns.resolve4(trimmed).catch(() => [] as string[]),
      dns.resolve6(trimmed).catch(() => [] as string[]),
    ]);
  } catch (err) {
    throw new SsrfBlockedError(
      trimmed,
      null,
      `DNS resolution failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (v4.length === 0 && v6.length === 0) {
    throw new SsrfBlockedError(trimmed, null, 'no DNS records (hostname does not resolve)');
  }

  for (const addr of v4) {
    if (isBlockedV4(addr)) {
      throw new SsrfBlockedError(trimmed, addr, 'resolves to private / loopback / link-local IPv4');
    }
  }
  for (const addr of v6) {
    if (isBlockedV6(addr)) {
      throw new SsrfBlockedError(trimmed, addr, 'resolves to private / loopback / link-local IPv6');
    }
  }
}

/** Addresses that passed validation and are the only ones a caller may connect to. */
export interface PinnedHost {
  family: 4 | 6;
  addresses: string[];
}

/**
 * Validate a host and return the addresses that passed, so the caller can connect
 * to exactly those instead of resolving the name again. `assertHostIsExternal`
 * proves the name resolved to public addresses when asked; it cannot stop the HTTP
 * client resolving again and getting a different (internal) answer — DNS rebinding.
 * Returns null when the bypass is active and there is nothing to pin.
 */
export async function resolveExternalHostPinned(
  host: string,
  allowPrivate: boolean = isAllowPrivate() && config.env === 'development',
): Promise<PinnedHost | null> {
  if (allowPrivate) return null;

  await assertHostIsExternal(host, false);

  const trimmed = host.trim();
  const literalKind = isIP(trimmed);
  if (literalKind === 4) return { family: 4, addresses: [trimmed] };
  if (literalKind === 6) return { family: 6, addresses: [trimmed] };

  // Re-check every resolved address; the connection is held to this set.
  const [v4, v6] = await Promise.all([
    dns.resolve4(trimmed).catch(() => [] as string[]),
    dns.resolve6(trimmed).catch(() => [] as string[]),
  ]);

  const safeV4 = v4.filter((a) => !isBlockedV4(a));
  const safeV6 = v6.filter((a) => !isBlockedV6(a));

  if (safeV4.length !== v4.length || safeV6.length !== v6.length) {
    throw new SsrfBlockedError(trimmed, null, 'DNS answer changed to an internal address between checks');
  }
  if (safeV4.length === 0 && safeV6.length === 0) {
    throw new SsrfBlockedError(trimmed, null, 'no usable public address');
  }

  return safeV4.length > 0 ? { family: 4, addresses: safeV4 } : { family: 6, addresses: safeV6 };
}

/**
 * HTTP/HTTPS agents whose DNS lookup is fixed to `pinned`, so a request cannot
 * connect anywhere other than the validated addresses. The URL keeps its hostname,
 * so TLS still verifies against the name — only address selection is pinned. Any
 * other hostname fails closed (a redirect is re-validated and gets its own agents),
 * and keepAlive is off so a pinned socket is not reused under a later verdict.
 */
export function pinnedAgentsFor(
  hostname: string,
  pinned: PinnedHost,
): { httpAgent: http.Agent; httpsAgent: https.Agent } {
  const lookup = (
    host: string,
    options: { all?: boolean },
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ): void => {
    if (host !== hostname) {
      callback(new Error(`Refusing to resolve unexpected host "${host}"`), '', 4);
      return;
    }
    if (options?.all) {
      callback(null, pinned.addresses.map((address) => ({ address, family: pinned.family })));
      return;
    }
    callback(null, pinned.addresses[0]!, pinned.family);
  };

  return {
    httpAgent: new http.Agent({ keepAlive: false, lookup: lookup as never }),
    httpsAgent: new https.Agent({ keepAlive: false, lookup: lookup as never }),
  };
}

/**
 * An undici dispatcher whose connection lookup is fixed to `pinned`, for callers
 * that use fetch() rather than axios (which cannot take an http.Agent). Same
 * guarantee as pinnedAgentsFor: the request connects only to the validated
 * addresses, the URL keeps its hostname so TLS still verifies against the name,
 * and any other hostname (e.g. a redirect target) fails closed.
 */
export function pinnedDispatcherFor(hostname: string, pinned: PinnedHost): Agent {
  return new Agent({
    keepAliveTimeout: 1000,
    connect: {
      lookup: ((host: string, _options: unknown, callback: (err: Error | null, address?: unknown, family?: number) => void): void => {
        if (host !== hostname) {
          callback(new Error(`Refusing to resolve unexpected host "${host}"`));
          return;
        }
        callback(null, pinned.addresses.map((address) => ({ address, family: pinned.family })));
      }) as never,
    },
  });
}

/**
 * Webhook variant used when WEBHOOK_ALLOW_INTERNAL_HOSTS is enabled: allows private /
 * internal destinations but still refuses loopback and link-local / cloud-metadata
 * (the instance-metadata credential endpoint). Resolves and pins to the checked
 * addresses so a later DNS answer cannot swing to a refused address (rebinding-safe).
 */
export async function resolveWebhookHostAllowingInternal(host: string): Promise<PinnedHost> {
  const trimmed = host.trim();
  if (!trimmed) throw new SsrfBlockedError(host, null, 'empty host');
  if (isMetadataHostname(trimmed)) {
    throw new SsrfBlockedError(trimmed, null, 'loopback / metadata host is never allowed');
  }
  const literalKind = isIP(trimmed);
  if (literalKind === 4) {
    if (isMetadataV4(trimmed)) throw new SsrfBlockedError(trimmed, trimmed, 'loopback / link-local / metadata');
    return { family: 4, addresses: [trimmed] };
  }
  if (literalKind === 6) {
    if (isMetadataV6(trimmed)) throw new SsrfBlockedError(trimmed, trimmed, 'loopback / link-local / metadata');
    return { family: 6, addresses: [trimmed] };
  }
  const [v4, v6] = await Promise.all([
    dns.resolve4(trimmed).catch(() => [] as string[]),
    dns.resolve6(trimmed).catch(() => [] as string[]),
  ]);
  if (v4.length === 0 && v6.length === 0) {
    throw new SsrfBlockedError(trimmed, null, 'no DNS records (hostname does not resolve)');
  }
  for (const addr of v4) {
    if (isMetadataV4(addr)) throw new SsrfBlockedError(trimmed, addr, 'resolves to loopback / link-local / metadata');
  }
  for (const addr of v6) {
    if (isMetadataV6(addr)) throw new SsrfBlockedError(trimmed, addr, 'resolves to loopback / link-local / metadata');
  }
  return v4.length > 0 ? { family: 4, addresses: v4 } : { family: 6, addresses: v6 };
}

/**
 * Validate an outbound webhook URL and fetch it pinned to the addresses that passed,
 * so a second DNS answer cannot swing the connection between the check and the request
 * (rebinding). The fetch() counterpart to how LinkPreviewService uses
 * resolveExternalHostPinned + pinnedAgentsFor. Honors WEBHOOK_ALLOW_INTERNAL_HOSTS.
 * Callers MUST still pass `redirect: 'manual'` — a 3xx target is a fresh URL this has
 * not validated. Throws SsrfBlockedError on a blocked destination.
 */
export async function safeWebhookFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, null, 'invalid URL');
  }
  // When WEBHOOK_ALLOW_INTERNAL_HOSTS is set, internal webhook targets are allowed
  // while loopback and cloud-metadata stay refused.
  const pinned = config.webhooks.allowInternalHosts
    ? await resolveWebhookHostAllowingInternal(parsed.hostname)
    : await resolveExternalHostPinned(parsed.hostname, isAllowPrivate() && config.env === 'development');
  // A fresh dispatcher per request — never shared, so a pinned socket is never
  // reused under a later verdict; its idle socket is dropped on keep-alive timeout.
  const dispatcher = pinned
    ? pinnedDispatcherFor(parsed.hostname, pinned)
    : new Agent({ keepAliveTimeout: 1000 });
  return (await undiciFetch(rawUrl, { ...init, dispatcher } as never)) as unknown as Response;
}

/**
 * safeWebhookFetch's stricter sibling for a URL that has no legitimate internal target (a link
 * preview): private, loopback and in-cluster hosts are always refused, whatever
 * WEBHOOK_ALLOW_INTERNAL_HOSTS says. The connection is pinned to the validated addresses, or sent
 * through `proxyUrl` when one is configured (the proxy then makes the outbound connection, so
 * address pinning applies to direct connections only). Callers must follow redirects themselves.
 */
export async function safeExternalFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: { proxyUrl?: string } = {},
): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, null, 'invalid URL');
  }
  const pinned = await resolveExternalHostPinned(
    parsed.hostname,
    isAllowPrivate() && config.env === 'development',
  );
  const dispatcher = opts.proxyUrl
    ? new ProxyAgent(opts.proxyUrl)
    : pinned
      ? pinnedDispatcherFor(parsed.hostname, pinned)
      : new Agent({ keepAliveTimeout: 1000 });
  return (await undiciFetch(rawUrl, { ...init, redirect: 'manual', dispatcher } as never)) as unknown as Response;
}

/**
 * SSRF guard for outbound webhook URLs (app webhooks, automation
 * trigger_webhook). Ensures the host does not resolve to an internal / private /
 * loopback / link-local address. Throws SsrfBlockedError on any violation.
 * Scheme is intentionally not restricted to https.
 *
 * Callers MUST also disable redirect-following (`redirect: 'manual'`) on the
 * subsequent fetch.
 */
export async function assertWebhookUrlSafe(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, null, 'invalid URL');
  }
  // When WEBHOOK_ALLOW_INTERNAL_HOSTS is set, internal webhook targets are allowed
  // while loopback and cloud-metadata stay refused. Validation only: this throws on a
  // disallowed destination; the pinned outbound connection is made by safeWebhookFetch,
  // so the resolved addresses are intentionally not returned here.
  if (config.webhooks.allowInternalHosts) {
    await resolveWebhookHostAllowingInternal(parsed.hostname);
    return;
  }
  // Otherwise webhooks honor the private-host bypass only in local development, not
  // in shared non-prod where DATA_SOURCE_ALLOW_PRIVATE_HOSTS may be set for
  // data-source connectors.
  const allowPrivate = isAllowPrivate() && config.env === 'development';
  await assertHostIsExternal(parsed.hostname, allowPrivate);
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_STRIPPED_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

/**
 * safeWebhookFetch for callers that need redirects followed (provider file downloads
 * answer with a 302 to a signed CDN URL). Each hop goes back through safeWebhookFetch, so
 * every redirect target is validated and pinned like the first request. Credentials are
 * dropped when a hop leaves the original origin.
 */
export async function safeFetchFollowingRedirects(
  rawUrl: string,
  init: RequestInit = {},
  maxRedirects: number = 5,
): Promise<Response> {
  let url = rawUrl;
  let current: RequestInit = { ...init, redirect: 'manual' };
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await safeWebhookFetch(url, current);
    const location = res.headers.get('location');
    if (!REDIRECT_STATUSES.has(res.status) || !location) return res;
    await res.body?.cancel().catch(() => undefined);

    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new SsrfBlockedError(location, null, 'invalid redirect URL');
    }
    const headers = new Headers(current.headers);
    if (next.origin !== new URL(url).origin) {
      for (const name of CROSS_ORIGIN_STRIPPED_HEADERS) headers.delete(name);
    }
    const toGet =
      res.status === 303 ||
      ((res.status === 301 || res.status === 302) && current.method?.toUpperCase() === 'POST');
    current = { ...current, headers, ...(toGet ? { method: 'GET', body: undefined } : {}) };
    url = next.toString();
  }
  throw new SsrfBlockedError(rawUrl, null, `too many redirects (more than ${maxRedirects})`);
}

/**
 * Synchronous, DNS-free check for where a URL first enters the system (request
 * validation, stored config): http(s) only, no embedded credentials, and the host is not a
 * known-internal name or a private / loopback / metadata IP literal. It cannot see what a
 * hostname resolves to, so it complements the fetch-time guard and never replaces it.
 * Honors the same bypasses as assertWebhookUrlSafe. Returns the parsed URL.
 */
export function assertUrlSyntaxSafe(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, null, 'invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError(parsed.hostname, null, 'only http(s) URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError(parsed.hostname, null, 'credentials in the URL are not allowed');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new SsrfBlockedError(rawUrl, null, 'empty host');

  const literalKind = isIP(host);
  if (config.webhooks.allowInternalHosts) {
    if (isMetadataHostname(host) || (literalKind === 4 && isMetadataV4(host)) || (literalKind === 6 && isMetadataV6(host))) {
      throw new SsrfBlockedError(host, literalKind ? host : null, 'loopback / link-local / metadata');
    }
    return parsed;
  }
  if (isAllowPrivate() && config.env === 'development') return parsed;

  if (isBlockedHostname(host)) {
    throw new SsrfBlockedError(host, null, 'hostname maps to an internal-only address');
  }
  if ((literalKind === 4 && isBlockedV4(host)) || (literalKind === 6 && isBlockedV6(host))) {
    throw new SsrfBlockedError(host, host, 'private / loopback / link-local address');
  }
  return parsed;
}

export type GuardedFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface HttpRequestConfig {
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | undefined>;
  /** Milliseconds; the request is aborted after this long. */
  timeout?: number;
  /** Return true for a status that should resolve rather than throw. Defaults to 2xx. */
  validateStatus?: (status: number) => boolean;
  /** 0 returns a redirect response to the caller instead of following it. */
  maxRedirects?: number;
  /** Bytes; a larger response body is refused instead of being read into memory. */
  maxContentLength?: number;
  responseType?: 'json' | 'text' | 'arraybuffer';
  signal?: AbortSignal;
}

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
}

/**
 * Thrown for a non-2xx response (or one `validateStatus` rejects) and for a failed request
 * (timeout, connection error), shaped like an axios error: `response` is set only when the
 * server answered, and `code` is ECONNABORTED for a timeout or ERR_NETWORK otherwise.
 */
export class HttpError<T = unknown> extends Error {
  public override readonly name = 'HttpError';
  public readonly isHttpError = true;
  public constructor(
    message: string,
    public readonly response?: { status: number; statusText: string; data: T; headers: Headers },
    public readonly code?: string,
    cause?: unknown,
  ) {
    super(message);
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const tooLarge = (): HttpError =>
    new HttpError(`maxContentLength size of ${maxBytes} exceeded`, undefined, 'ERR_BAD_RESPONSE');
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

async function readBody(
  res: Response,
  responseType: HttpRequestConfig['responseType'],
  maxBytes?: number,
): Promise<unknown> {
  if (responseType === 'arraybuffer') {
    return maxBytes === undefined ? Buffer.from(await res.arrayBuffer()) : readCapped(res, maxBytes);
  }
  const text = maxBytes === undefined ? await res.text() : (await readCapped(res, maxBytes)).toString('utf8');
  if (responseType === 'text') return text;
  if (!text) return '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * A small axios-shaped client over a guarded fetch (allowlistedFetch or safeWebhookFetch): the
 * `{ data, status, headers }` result, a throw on a non-2xx status with `error.response`, params,
 * timeout, validateStatus and a JSON body, so call sites keep their shape while every request
 * goes through the SSRF guard.
 */
export function createHttpClient(
  guardedFetch: GuardedFetch,
  defaults: { baseURL?: string; headers?: Record<string, string>; timeout?: number } = {},
): {
  request<T = any>(method: string, url: string, data?: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
  get<T = any>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
  post<T = any>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
  put<T = any>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
  patch<T = any>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
  delete<T = any>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>>;
} {
  async function request<T = any>(
    method: string,
    url: string,
    data?: unknown,
    config: HttpRequestConfig = {},
  ): Promise<HttpResponse<T>> {
    const target = new URL(url, defaults.baseURL);
    for (const [key, value] of Object.entries(config.params ?? {})) {
      if (value !== undefined) target.searchParams.append(key, String(value));
    }

    const headers: Record<string, string> = { ...defaults.headers, ...config.headers };
    let body: RequestInit['body'] | undefined;
    if (data !== undefined && data !== null && method !== 'GET' && method !== 'HEAD') {
      const isPlainObject = typeof data === 'object' && Object.getPrototypeOf(data) === Object.prototype;
      if (isPlainObject || Array.isArray(data)) {
        body = JSON.stringify(data);
        if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
          headers['Content-Type'] = 'application/json';
        }
      } else {
        body = data as RequestInit['body'];
      }
    }

    const timeout = config.timeout ?? defaults.timeout;
    const signals = [config.signal, timeout ? AbortSignal.timeout(timeout) : undefined].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    );
    let res: Response;
    try {
      res = await guardedFetch(target, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        ...(signals.length > 0 ? { signal: AbortSignal.any(signals) } : {}),
        ...(config.maxRedirects === 0 ? { redirect: 'manual' as const } : {}),
      });
    } catch (error) {
      if (error instanceof SsrfBlockedError) throw error;
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new HttpError(
        error instanceof Error ? error.message : 'Network error',
        undefined,
        timedOut ? 'ECONNABORTED' : 'ERR_NETWORK',
        error,
      );
    }

    const payload = (await readBody(res, config.responseType, config.maxContentLength)) as T;
    const accepted = config.validateStatus ? config.validateStatus(res.status) : res.ok;
    if (!accepted) {
      throw new HttpError(`Request failed with status code ${res.status}`, {
        status: res.status,
        statusText: res.statusText,
        data: payload,
        headers: res.headers,
      });
    }
    return { data: payload, status: res.status, statusText: res.statusText, headers: res.headers };
  }

  return {
    request,
    get: (url, config) => request('GET', url, undefined, config),
    post: (url, data, config) => request('POST', url, data, config),
    put: (url, data, config) => request('PUT', url, data, config),
    patch: (url, data, config) => request('PATCH', url, data, config),
    delete: (url, config) => request('DELETE', url, undefined, config),
  };
}

/**
 * fetch for a caller that only ever talks to a fixed set of hosts: a vendor API, an in-cluster
 * service or a configured base URL. `allowed` lists hostnames (matched exactly or as a parent
 * domain) or full origins, and is read on every call so config changes are picked up. A request to
 * any other host is refused, and a redirect is followed only to another allowed host (credentials
 * are dropped when it leaves the origin), so a tampered URL or a redirect cannot steer the call
 * elsewhere. It does not resolve or pin DNS, so never use it for a URL that a user, an app or
 * stored config can influence: that is what safeWebhookFetch is for.
 */
export function allowlistedFetch(
  allowed: () => ReadonlyArray<string | undefined>,
  maxRedirects: number = 5,
): (input: string | URL, init?: RequestInit) => Promise<Response> {
  const isAllowed = (url: URL): boolean => {
    for (const entry of allowed()) {
      if (!entry) continue;
      if (entry.includes('://')) {
        try {
          if (new URL(entry).origin === url.origin) return true;
        } catch {
          // an unparseable entry matches nothing
        }
      } else {
        const host = entry.toLowerCase();
        if (url.hostname === host || url.hostname.endsWith(`.${host}`)) return true;
      }
    }
    return false;
  };

  return async (input, init = {}) => {
    let url = new URL(input.toString());
    const followRedirects = init.redirect !== 'manual' && init.redirect !== 'error';
    let current: RequestInit = followRedirects ? { ...init, redirect: 'manual' } : init;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (!isAllowed(url)) {
        throw new SsrfBlockedError(url.hostname, null, 'host is not on this client\'s allow-list');
      }
      const res = await globalThis.fetch(url, current);
      const location = res.headers.get('location');
      if (!followRedirects || !REDIRECT_STATUSES.has(res.status) || !location) return res;
      await res.body?.cancel().catch(() => undefined);

      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        throw new SsrfBlockedError(location, null, 'invalid redirect URL');
      }
      const headers = new Headers(current.headers);
      if (next.origin !== url.origin) {
        for (const name of CROSS_ORIGIN_STRIPPED_HEADERS) headers.delete(name);
      }
      const toGet =
        res.status === 303 ||
        ((res.status === 301 || res.status === 302) && current.method?.toUpperCase() === 'POST');
      current = { ...current, headers, ...(toGet ? { method: 'GET', body: undefined } : {}) };
      url = next;
    }
    throw new SsrfBlockedError(url.hostname, null, `too many redirects (more than ${maxRedirects})`);
  };
}
