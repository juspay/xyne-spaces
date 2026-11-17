import { API_BASE_URL, API_ORIGIN, isMtlsFeatureEnabled } from '../config';
import {
  getResponseJson,
  getResponseText,
  isMtlsHttpClientAvailable,
  isSocketIoRequestUrl,
  mtlsFetch,
  mtlsFetchAsWebResponse,
  type MtlsResponse,
} from '../utils/mtlsHttpClient';
import { isProtectedHttpsHost } from '../utils/mtlsTransportPolicy';
import { injectCookiesFromResponse } from '@/src/utils/cookie-injection';
import { getAuthOperation, getAuthSessionGeneration } from './authSessionLifecycle';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface MtlsRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: JsonValue | string;
  /** Aborts the request down to the native socket. */
  signal?: AbortSignal;
  /** Overrides the default request deadline. */
  timeoutMs?: number;
}

export class MtlsRequestError extends Error {
  statusCode: number;
  responseBody: string;

  constructor(message: string, statusCode: number, responseBody: string) {
    super(message);
    this.name = 'MtlsRequestError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export function isMtlsRequestError(error: unknown): error is MtlsRequestError {
  return error instanceof MtlsRequestError;
}

export interface MtlsHealthResult {
  isHealthy: boolean;
  statusCode?: number;
  isCertificateError?: boolean;
  url?: string;
  reason?: string;
  errorMessage?: string;
  responseBody?: string;
}

let isFetchGuardInstalled = false;

/** 401 codes from the auth middleware that a session refresh can fix. */
const REFRESHABLE_AUTH_CODES = new Set(['TOKEN_MISSING', 'TOKEN_EXPIRED', 'TOKEN_INVALID']);

/**
 * Renews the access JWT from the refresh cookie. Registered by AuthServices, which
 * imports this module and so cannot be imported from it.
 * - `refreshed`: the jar now holds a fresh JWT.
 * - `session-ended`: the backend ended the session; the user is being signed out.
 * - `unavailable`: the session is still valid but could not be renewed right now
 *   (5xx, network).
 */
export type SessionRefreshOutcome = 'refreshed' | 'session-ended' | 'unavailable';
type SessionRefresher = () => Promise<SessionRefreshOutcome>;

/**
 * Stands in for the original 401 when the session is fine but could not be renewed, so
 * screens show a "try again" message instead of telling a signed-in user to sign in.
 */
function sessionRefreshUnavailableResponse(): MtlsResponse {
  return {
    statusCode: 503,
    headers: { 'content-type': 'application/json' },
    body: {
      error: 'Session refresh unavailable',
      code: 'SESSION_REFRESH_UNAVAILABLE',
      message: 'Could not reach the server to renew your session. Please try again.',
    },
  };
}

let sessionRefresher: SessionRefresher | null = null;

export function setSessionRefresher(refresher: SessionRefresher): void {
  sessionRefresher = refresher;
}

function isRefreshableAuthFailure(response: MtlsResponse): boolean {
  if (response.statusCode !== 401) {
    return false;
  }
  try {
    const code = getResponseJson<{ code?: unknown } | null>(response)?.code;
    return typeof code === 'string' && REFRESHABLE_AUTH_CODES.has(code);
  } catch {
    return false;
  }
}

/**
 * After a refresh that did not fix the 401, further 401s wait this long before refreshing
 * again, so a burst of requests does not each trigger one.
 */
const REFRESH_COOLDOWN_MS = 15_000;
let refreshCooldownUntil = 0;

/**
 * Sends the request; on a refreshable 401 renews the session and sends it once more.
 * The JWT travels as a cookie, so the retry picks up the renewed one from the jar.
 */
async function fetchWithSessionRefresh(
  url: string,
  options: Parameters<typeof mtlsFetch>[1],
): Promise<MtlsResponse> {
  const response = await mtlsFetch(url, options);
  if (!sessionRefresher || !isRefreshableAuthFailure(response)) {
    return response;
  }
  if (Date.now() < refreshCooldownUntil) {
    return sessionRefreshUnavailableResponse();
  }
  const outcome = await sessionRefresher();
  if (outcome === 'unavailable') {
    refreshCooldownUntil = Date.now() + REFRESH_COOLDOWN_MS;
    return sessionRefreshUnavailableResponse();
  }
  if (outcome === 'session-ended') {
    return response;
  }
  const retried = await mtlsFetch(url, options);
  // Refreshed, yet still refused: the new token is not the one this request needs.
  // Refreshing again on the next request would not help either.
  refreshCooldownUntil = isRefreshableAuthFailure(retried) ? Date.now() + REFRESH_COOLDOWN_MS : 0;
  return retried;
}

function buildUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

function toResponseMessage(statusCode: number, responseBody: string): string {
  if (statusCode === 0) {
    return 'mTLS request failed before receiving an HTTP response';
  }
  if (!responseBody) {
    return `mTLS request failed with status ${statusCode}`;
  }
  return `mTLS request failed with status ${statusCode}: ${responseBody}`;
}

function parseJson<T>(response: MtlsResponse, url: string): T {
  try {
    return getResponseJson<T>(response);
  } catch {
    // Debug: log the actual response (truncated) and include in error for diagnosis
    const bodyText = getResponseText(response);
    const preview = bodyText.length > 200 ? bodyText.substring(0, 200) + '...' : bodyText;
    const contentTypeHint = bodyText.trimStart().startsWith('<') ? ' (likely HTML)' : '';
    console.warn('[mTLS] Non-JSON response:', { url, bodyLength: bodyText.length, preview });
    throw new Error(
      `[mTLS] Expected JSON response from ${url}, but received non-JSON body${contentTypeHint}. ` +
        `Body preview: ${preview || '(empty)'}`,
    );
  }
}

function isSslCertificateError(error: unknown): boolean {
  const errorMessage = String(error).toLowerCase();
  const sslErrorPatterns = [
    'ssl',
    'tls',
    'certificate',
    'cert',
    'unknown_ca',
    'certificate_required',
    'err_ssl_client_auth',
    'err_bad_ssl_client_auth_cert',
    'certificate_verify_failed',
    'did not accept',
    'certificate rejected',
    'client certificate rejected',
    'certificate denied',
    'cert_rejected',
    'no_certificate',
    'no_private_key',
    'no_identity',
  ];
  return sslErrorPatterns.some(pattern => errorMessage.includes(pattern));
}

export function installProtectedFetchGuard(): void {
  if (isFetchGuardInstalled || !isMtlsFeatureEnabled() || typeof globalThis.fetch !== 'function') {
    return;
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (isProtectedHttpsHost(requestUrl)) {
      // Socket.IO long-polling uses global fetch; route through mTLS HTTP (native cert).
      if (isSocketIoRequestUrl(requestUrl)) {
        return mtlsFetchAsWebResponse(input, init);
      }
      throw new Error(
        `[mTLS] Direct fetch is blocked for protected host "${requestUrl}". Use mtlsRequestJson() instead.`,
      );
    }

    return originalFetch(input, init);
  };

  isFetchGuardInstalled = true;
}

export async function mtlsRequestJson<T>(path: string, options?: MtlsRequestOptions): Promise<T> {
  const url = buildUrl(path);
  const method = options?.method ?? 'GET';
  const generation = getAuthSessionGeneration();
  const operation = getAuthOperation();

  let requestBody: string | undefined;
  if (typeof options?.body === 'string') {
    requestBody = options.body;
  } else if (options?.body !== undefined) {
    requestBody = JSON.stringify(options.body);
  }

  const headers: Record<string, string> = {
    ...(options?.headers ?? {}),
  };
  if (requestBody && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const requestOptions: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {
    method,
    headers,
  };
  if (requestBody !== undefined) {
    requestOptions.body = requestBody;
  }
  if (options?.signal !== undefined) {
    requestOptions.signal = options.signal;
  }
  if (options?.timeoutMs !== undefined) {
    requestOptions.timeoutMs = options.timeoutMs;
  }

  const response = await fetchWithSessionRefresh(url, requestOptions);

  // Fire-and-forget. This only mirrors cookies into the WebView store for Canvas;
  // no caller needs it to have finished. Awaiting it made every API response wait on
  // main-thread WebKit writes plus a hard sleep before the caller saw its data. The
  // captured session scope still drops the write if a logout lands in between.
  void injectCookiesFromResponse(API_ORIGIN, response.headers, { generation, operation });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const responseBody = getResponseText(response);
    throw new MtlsRequestError(
      toResponseMessage(response.statusCode, responseBody),
      response.statusCode,
      responseBody,
    );
  }

  return parseJson<T>(response, url);
}

export async function mtlsRequestText(
  path: string,
  options?: MtlsRequestOptions,
): Promise<{ data: string; contentType?: string }> {
  const url = buildUrl(path);
  const method = options?.method ?? 'GET';
  const generation = getAuthSessionGeneration();
  const operation = getAuthOperation();

  const headers: Record<string, string> = { ...(options?.headers ?? {}) };

  const response = await fetchWithSessionRefresh(url, {
    method,
    headers,
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });

  void injectCookiesFromResponse(API_ORIGIN, response.headers, { generation, operation });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const responseBody = getResponseText(response);
    throw new MtlsRequestError(
      toResponseMessage(response.statusCode, responseBody),
      response.statusCode,
      responseBody,
    );
  }

  const rawBody = getResponseText(response);
  const contentTypeHeader = response.headers?.['content-type'];
  const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;

  return { data: rawBody, ...(contentType !== undefined && { contentType }) };
}

export async function verifyMtlsHealth(): Promise<MtlsHealthResult> {
  const healthUrl = `${API_BASE_URL}/health`;

  if (!isMtlsFeatureEnabled()) {
    return {
      isHealthy: true,
      url: healthUrl,
      reason: 'MTLS_DISABLED',
    };
  }

  const hasNativeMtlsClient = isMtlsHttpClientAvailable();

  if (!hasNativeMtlsClient) {
    const result: MtlsHealthResult = {
      isHealthy: false,
      url: healthUrl,
      reason: 'NATIVE_CLIENT_UNAVAILABLE',
      errorMessage: 'CertificateModule.performMtlsRequest is unavailable',
    };
    console.error('[mTLS][health] Native mTLS client unavailable', result);
    return result;
  }

  try {
    const response = await mtlsFetch(healthUrl, {
      method: 'GET',
      headers: {},
    });
    const result: MtlsHealthResult = {
      isHealthy: response.statusCode >= 200 && response.statusCode < 300,
      statusCode: response.statusCode,
      url: healthUrl,
      reason: response.statusCode >= 200 && response.statusCode < 300 ? 'OK' : 'NON_2XX',
      responseBody: getResponseText(response),
    };
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const result: MtlsHealthResult = {
      isHealthy: false,
      isCertificateError: isSslCertificateError(error),
      url: healthUrl,
      reason: 'REQUEST_FAILED',
      errorMessage,
    };
    console.error('[mTLS][health] Health check request failed', result);
    return result;
  }
}

export async function verifyMtlsHealthWithRetry(
  attempts: number = 3,
  initialDelayMs: number = 500,
): Promise<MtlsHealthResult> {
  let lastResult: MtlsHealthResult = { isHealthy: false };
  let certificateErrorCount = 0;

  for (let i = 0; i < attempts; i += 1) {
    lastResult = await verifyMtlsHealth();

    if (lastResult.isCertificateError) {
      certificateErrorCount += 1;
    }

    if (lastResult.isHealthy) {
      return lastResult;
    }

    if (i < attempts - 1) {
      const delayMs = initialDelayMs * Math.pow(2, i);
      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    }
  }

  if (certificateErrorCount === attempts) {
    lastResult.isCertificateError = true;
  }

  return lastResult;
}
