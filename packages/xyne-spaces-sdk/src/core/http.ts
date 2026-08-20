/**
 * HTTP Client
 *
 * Handles HTTP requests with authentication, timeout, and error handling.
 */

import { SdkError, AuthError, RateLimitError, NotFoundError } from './errors.js';

export interface HttpClientOptions {
  /** Base URL of the Spaces API */
  baseUrl: string;
  /** Access token for authentication */
  token?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

export class HttpClient {
  private baseUrl: string;
  private token?: string;
  private timeout: number;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.timeout = options.timeout ?? 30000;
  }

  /**
   * Set the access token for authentication.
   */
  setToken(token: string): void {
    this.token = token;
  }

  /**
   * Clear the access token.
   */
  clearToken(): void {
    this.token = undefined;
  }

  /**
   * Get the current token (for refresh scenarios).
   */
  getToken(): string | undefined {
    return this.token;
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>('GET', url);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', `${this.baseUrl}${path}`, body);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', `${this.baseUrl}${path}`, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', `${this.baseUrl}${path}`, body);
  }

  async delete<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = this.buildUrl(path, params);
    return this.request<T>('DELETE', url);
  }

  private buildUrl(path: string, params?: Record<string, unknown>): string {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<T> {
    const isMultipart = typeof FormData !== 'undefined' && body instanceof FormData;
    const headers: Record<string, string> = { Accept: 'application/json' };

    // Let fetch add the multipart boundary. Supplying Content-Type ourselves
    // would omit it and make Express/multer reject an otherwise valid upload.
    if (!isMultipart) headers['Content-Type'] = 'application/json';

    const requestBody =
      body === undefined
        ? undefined
        : isMultipart
          ? (body as FormData)
          : JSON.stringify(body);

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: requestBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const text = await response.text();
      if (!response.ok) {
        this.handleError(response, text);
      }

      // Handle empty responses (e.g., 204 No Content)
      if (!text) return undefined as T;

      return JSON.parse(text) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof SdkError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new SdkError('timeout', 'Request timed out');
      }

      throw new SdkError(
        'network_error',
        `Request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private handleError(response: Response, text: string): never {
    let body: {
      error?: string | { message?: string; code?: string };
      message?: string;
      code?: string;
    } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      // Ignore JSON parse errors for error responses
    }

    const nestedError =
      body.error && typeof body.error === 'object' ? body.error : undefined;
    const message =
      body.message ||
      nestedError?.message ||
      (typeof body.error === 'string' ? body.error : undefined) ||
      response.statusText;

    // The API's envelope is `{ error: { code, message } }`. That `code` is the only
    // way to tell apart failures sharing a status — `insufficient_scope` from
    // `forbidden`, `idempotency_key_conflict` from a plain `conflict` — so carry it
    // onto the thrown error instead of discarding it. Vocabulary is the contract's.
    const serverCode = nestedError?.code ?? body.code;

    switch (response.status) {
      case 401:
        throw new AuthError(message, serverCode);
      case 403:
        throw new SdkError('forbidden', message, serverCode);
      case 404:
        throw new NotFoundError(message, serverCode);
      case 422:
        throw new SdkError('validation_error', message, serverCode);
      case 429: {
        const retryAfter = response.headers.get('Retry-After');
        throw new RateLimitError(
          message,
          retryAfter ? parseInt(retryAfter, 10) : undefined,
          serverCode
        );
      }
      default:
        throw new SdkError('api_error', message, serverCode);
    }
  }
}
