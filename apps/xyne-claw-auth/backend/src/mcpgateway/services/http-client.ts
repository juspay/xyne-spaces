import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isBlockedIpAddress } from "xyne-claw-shared";
import { isAllowlistedPrivateOrigin, outboundDispatcher } from "../../lib/safe-fetch.js";

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

  if (isAllowlistedPrivateOrigin(rawUrl)) {
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

    const dispatcher = outboundDispatcher(url);
    const requestInit: RequestInit = {
      method: requestMethod,
      redirect: "manual",
    };
    // validatePublicDestination resolves DNS once; the dispatcher re-checks
    // the address actually dialled so a rebinding name cannot slip through.
    if (dispatcher) (requestInit as { dispatcher?: unknown }).dispatcher = dispatcher;
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