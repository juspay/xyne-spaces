import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpRequestOptions {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpResponse<T> {
  status: number;
  data: T;
}

const MAX_REDIRECTS = 5;

export class HttpRequestError extends Error {
  readonly code: "timeout" | "network" | "http";
  readonly status?: number;
  readonly statusText?: string;
  readonly responseBody?: unknown;
  readonly url: string;
  readonly method: HttpMethod;

  constructor(params: {
    message: string;
    code: "timeout" | "network" | "http";
    url: string;
    method: HttpMethod;
    status?: number;
    statusText?: string;
    responseBody?: unknown;
  }) {
    super(params.message);
    this.name = "HttpRequestError";
    this.code = params.code;
    this.url = params.url;
    this.method = params.method;
    if (params.status !== undefined) this.status = params.status;
    if (params.statusText !== undefined) this.statusText = params.statusText;
    if (params.responseBody !== undefined) this.responseBody = params.responseBody;
  }
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((segment) => Number.parseInt(segment, 10));
  return ((parts[0] ?? 0) << 24) + ((parts[1] ?? 0) << 16) + ((parts[2] ?? 0) << 8) + (parts[3] ?? 0);
}

function isIpv4InCidr(ip: string, baseIp: string, prefix: number): boolean {
  const ipInt = ipv4ToInt(ip) >>> 0;
  const baseInt = ipv4ToInt(baseIp) >>> 0;
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return (ipInt & mask) === (baseInt & mask);
}

function isBlockedIpv4(ip: string): boolean {
  const blockedCidrs: Array<{ base: string; prefix: number }> = [
    { base: "0.0.0.0", prefix: 8 },
    { base: "10.0.0.0", prefix: 8 },
    { base: "100.64.0.0", prefix: 10 },
    { base: "127.0.0.0", prefix: 8 },
    { base: "169.254.0.0", prefix: 16 },
    { base: "172.16.0.0", prefix: 12 },
    { base: "192.0.0.0", prefix: 24 },
    { base: "192.0.2.0", prefix: 24 },
    { base: "192.168.0.0", prefix: 16 },
    { base: "198.18.0.0", prefix: 15 },
    { base: "198.51.100.0", prefix: 24 },
    { base: "203.0.113.0", prefix: 24 },
    { base: "224.0.0.0", prefix: 4 },
    { base: "240.0.0.0", prefix: 4 },
  ];

  return blockedCidrs.some(({ base, prefix }) => isIpv4InCidr(ip, base, prefix));
}

function parseIpv6ToBytes(ip: string): Uint8Array | null {
  const normalized = ip.toLowerCase();
  const zoneIdx = normalized.indexOf("%");
  const noZone = zoneIdx >= 0 ? normalized.slice(0, zoneIdx) : normalized;

  const embeddedIpv4Idx = noZone.lastIndexOf(":");
  let working = noZone;
  let ipv4Tail: number[] | null = null;
  if (working.includes(".") && embeddedIpv4Idx !== -1) {
    const ipv4 = working.slice(embeddedIpv4Idx + 1);
    const parts = ipv4.split(".").map((segment) => Number.parseInt(segment, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return null;
    }
    const p0 = parts[0] ?? 0;
    const p1 = parts[1] ?? 0;
    const p2 = parts[2] ?? 0;
    const p3 = parts[3] ?? 0;
    ipv4Tail = [(p0 << 8) | p1, (p2 << 8) | p3];
    working = `${working.slice(0, embeddedIpv4Idx)}:__ipv4__`;
  }

  const hasCompression = working.includes("::");
  const [leftRaw, rightRaw] = hasCompression ? working.split("::") : [working, ""];
  const left = leftRaw ? leftRaw.split(":").filter(Boolean) : [];
  const right = rightRaw ? rightRaw.split(":").filter(Boolean) : [];

  const leftParts = left.map((part) => (part === "__ipv4__" ? -1 : Number.parseInt(part, 16)));
  const rightParts = right.map((part) => (part === "__ipv4__" ? -1 : Number.parseInt(part, 16)));
  if ([...leftParts, ...rightParts].some((n) => n !== -1 && (Number.isNaN(n) || n < 0 || n > 0xffff))) {
    return null;
  }

  const totalProvided = leftParts.length + rightParts.length + (ipv4Tail ? 2 : 0);
  if ((!hasCompression && totalProvided !== 8) || (hasCompression && totalProvided > 8)) {
    return null;
  }

  const fillCount = hasCompression ? 8 - totalProvided : 0;
  const groups: number[] = [];
  for (const n of leftParts) {
    if (n === -1) {
      if (!ipv4Tail) return null;
      groups.push(...ipv4Tail);
    } else {
      groups.push(n);
    }
  }
  for (let i = 0; i < fillCount; i++) groups.push(0);
  for (const n of rightParts) {
    if (n === -1) {
      if (!ipv4Tail) return null;
      groups.push(...ipv4Tail);
    } else {
      groups.push(n);
    }
  }

  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, idx) => {
    bytes[idx * 2] = (group >> 8) & 0xff;
    bytes[idx * 2 + 1] = group & 0xff;
  });
  return bytes;
}

function isIpv6PrefixMatch(ip: string, prefixBytes: Uint8Array, prefixLength: number): boolean {
  const bytes = parseIpv6ToBytes(ip);
  if (!bytes) return false;

  const fullBytes = Math.floor(prefixLength / 8);
  const remBits = prefixLength % 8;
  for (let i = 0; i < fullBytes; i++) {
    if (bytes[i] !== prefixBytes[i]) return false;
  }
  if (remBits > 0) {
    const mask = (0xff << (8 - remBits)) & 0xff;
    const ipByte = bytes[fullBytes] ?? 0;
    const prefixByte = prefixBytes[fullBytes] ?? 0;
    if ((ipByte & mask) !== (prefixByte & mask)) return false;
  }
  return true;
}

function isBlockedIpv6(ip: string): boolean {
  const blockedPrefixes: Array<{ prefix: string; length: number }> = [
    { prefix: "::", length: 128 },
    { prefix: "::1", length: 128 },
    { prefix: "fe80::", length: 10 },
    { prefix: "fc00::", length: 7 },
    { prefix: "ff00::", length: 8 },
    { prefix: "2001:db8::", length: 32 },
  ];

  const mappedV4 = parseIpv6ToBytes(ip);
  if (mappedV4 && mappedV4.slice(0, 10).every((b) => b === 0) && mappedV4[10] === 0xff && mappedV4[11] === 0xff) {
    const v4 = `${mappedV4[12]}.${mappedV4[13]}.${mappedV4[14]}.${mappedV4[15]}`;
    return isBlockedIpv4(v4);
  }

  for (const { prefix, length } of blockedPrefixes) {
    const prefixBytes = parseIpv6ToBytes(prefix);
    if (prefixBytes && isIpv6PrefixMatch(ip, prefixBytes, length)) return true;
  }
  return false;
}

function isBlockedIpAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true;
}

async function validatePublicDestination(rawUrl: string, method: HttpMethod): Promise<void> {
  const isProd = process.env.NODE_ENV === "production";

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new HttpRequestError({
      message: "Invalid request URL",
      code: "network",
      url: rawUrl,
      method,
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpRequestError({
      message: `Unsupported URL protocol: ${parsed.protocol}`,
      code: "network",
      url: rawUrl,
      method,
    });
  }

  const host = parsed.hostname;
  if (!host) {
    throw new HttpRequestError({
      message: "Missing request hostname",
      code: "network",
      url: rawUrl,
      method,
    });
  }

  // In non-production, allow loopback (localhost / 127.x) for local services.
  // All other private/reserved ranges are still blocked regardless of env.
  const isLoopbackHost =
    host === "localhost" ||
    host === "::1" ||
    /^127\./.test(host);

  if (!isProd && isLoopbackHost) {
    return;
  }

  const literalVersion = isIP(host);
  if (literalVersion !== 0) {
    if (isBlockedIpAddress(host)) {
      throw new HttpRequestError({
        message: `Blocked destination address: ${host}`,
        code: "network",
        url: rawUrl,
        method,
      });
    }
    return;
  }

  const resolved = await lookup(host, { all: true, verbatim: true });
  if (resolved.length === 0) {
    throw new HttpRequestError({
      message: `Could not resolve hostname: ${host}`,
      code: "network",
      url: rawUrl,
      method,
    });
  }

  for (const entry of resolved) {
    // In non-production, allow resolved loopback IPs too (e.g. localhost → 127.0.0.1).
    if (!isProd && /^127\./.test(entry.address)) continue;
    if (!isProd && entry.address === "::1") continue;

    if (isBlockedIpAddress(entry.address)) {
      throw new HttpRequestError({
        message: `Blocked destination address: ${entry.address}`,
        code: "network",
        url: rawUrl,
        method,
      });
    }
  }
}

export async function assertSafeOutboundUrl(rawUrl: string): Promise<void> {
  await validatePublicDestination(rawUrl, "GET");
}

function toUrlWithQuery(url: string, query?: Record<string, unknown>): string {
  if (!query || Object.keys(query).length === 0) return url;

  const fullUrl = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) {
          fullUrl.searchParams.append(key, String(item));
        }
      }
      continue;
    }
    fullUrl.searchParams.append(key, String(value));
  }
  return fullUrl.toString();
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function resolveRedirectUrl(currentUrl: string, location: string): string {
  return new URL(location, currentUrl).toString();
}

function isSensitiveRedirectHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "authorization" ||
    lower === "proxy-authorization" ||
    lower === "cookie" ||
    lower.startsWith("x-auth-") ||
    lower === "x-api-key" ||
    lower.includes("api-key")
  );
}

function stripSensitiveHeadersForCrossOriginRedirect(
  sourceHeaders: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!sourceHeaders) return undefined;
  const filteredEntries = Object.entries(sourceHeaders).filter(([name]) => !isSensitiveRedirectHeader(name));
  return Object.fromEntries(filteredEntries);
}

export async function httpRequest<T = unknown>(opts: HttpRequestOptions): Promise<HttpResponse<T>> {
  const { method, headers, timeoutMs } = opts;
  let url = toUrlWithQuery(opts.url, opts.query);
  let redirectCount = 0;
  let requestMethod: HttpMethod | "GET" = method;
  let requestBody = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  let redirectedHeaders: Record<string, string> | undefined = headers ? { ...headers } : undefined;

  while (true) {
    await validatePublicDestination(url, requestMethod as HttpMethod);

    const requestInit: RequestInit = {
      method: requestMethod,
      redirect: "manual",
    };
    // NOTE: URL destination is validated before each fetch, but DNS may still
    // be resolved again by the underlying runtime at connect-time.
    if (redirectedHeaders) requestInit.headers = redirectedHeaders;
    if (requestBody !== undefined) requestInit.body = requestBody;
    if (timeoutMs) requestInit.signal = AbortSignal.timeout(timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, requestInit);
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new HttpRequestError({
          message: `Request timeout after ${Math.floor((timeoutMs ?? 0) / 1000)}s`,
          code: "timeout",
          url,
          method: requestMethod as HttpMethod,
        });
      }

      throw new HttpRequestError({
        message: error instanceof Error ? error.message : "Network request failed",
        code: "network",
        url,
        method: requestMethod as HttpMethod,
      });
    }

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new HttpRequestError({
          message: `Redirect response missing Location header`,
          code: "http",
          url,
          method: requestMethod as HttpMethod,
          status: response.status,
          statusText: response.statusText,
          responseBody: await parseResponseBody(response),
        });
      }

      redirectCount += 1;
      if (redirectCount > MAX_REDIRECTS) {
        throw new HttpRequestError({
          message: `Too many redirects`,
          code: "network",
          url,
          method: requestMethod as HttpMethod,
        });
      }

      const nextUrl = resolveRedirectUrl(url, location);
      await validatePublicDestination(nextUrl, requestMethod as HttpMethod);

      const previousOrigin = new URL(url).origin;
      const nextOrigin = new URL(nextUrl).origin;
      if (nextOrigin !== previousOrigin) {
        redirectedHeaders = stripSensitiveHeadersForCrossOriginRedirect(redirectedHeaders);
      }

      // Preserve the outbound headers while following the redirect manually.
      // For 303, switch to GET and drop the body per HTTP semantics.
      if (response.status === 303) {
        requestMethod = "GET";
        requestBody = undefined;
      }

      url = nextUrl;
      continue;
    }

    const data = await parseResponseBody(response);
    if (!response.ok) {
      throw new HttpRequestError({
        message: `HTTP ${response.status} ${response.statusText}`,
        code: "http",
        url,
        method: requestMethod as HttpMethod,
        status: response.status,
        statusText: response.statusText,
        responseBody: data,
      });
    }

    return {
      status: response.status,
      data: data as T,
    };
  }
}