/**
 * HTTP Client
 *
 * Handles HTTP requests with authentication, timeout, and error handling.
 * Supports mTLS (mutual TLS) for client certificate authentication using Undici.
 */

import type { Agent, fetch as undiciFetchType } from 'undici';
import { SdkError, AuthError, RateLimitError, NotFoundError } from './errors.js';
import {
  type MTLSConfig,
  type UndiciRequestInit,
  isNodeEnvironment,
  createMTLSAgent,
  MTLSError,
} from './mtls.js';

/** Normalized response data extracted from either fetch or undici response */
interface ResponseData {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
  headers: { get(name: string): string | null };
}

export interface HttpClientOptions {
  /** Base URL of the Spaces API */
  baseUrl: string;
  /** Access token for authentication */
  token?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /**
   * mTLS configuration for client certificate authentication.
   * When provided, the client certificate will be sent with every request.
   *
   * @example
   * ```typescript
   * {
   *   cert: fs.readFileSync('/path/to/client.crt', 'utf8'),
   *   key: fs.readFileSync('/path/to/client.key', 'utf8'),
   * }
   * ```
   */
  mtls?: MTLSConfig;
}

export class HttpClient {
  private baseUrl: string;
  private token?: string;
  private timeout: number;
  private mtlsConfig?: MTLSConfig;
  private mtlsAgent?: Agent;
  private mtlsAgentPromise?: Promise<Agent | undefined>;
  /** Undici fetch function, loaded dynamically when mTLS is configured */
  private undiciFetch?: typeof undiciFetchType;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.timeout = options.timeout ?? 30000;
    this.mtlsConfig = options.mtls;

    // Pre-create the mTLS agent if config is provided
    if (this.mtlsConfig) {
      this.mtlsAgentPromise = this.initMTLSAgent();
    }
  }

  /**
   * Initialize the mTLS agent asynchronously.
   * This is done once and cached for all requests.
   * In browser/Electron environments, returns undefined as mTLS is handled by the OS.
   */
  private async initMTLSAgent(): Promise<Agent | undefined> {
    if (!this.mtlsConfig) return undefined;
    this.mtlsAgent = await createMTLSAgent(this.mtlsConfig);

    // Also load undici's fetch for mTLS requests (Node.js only)
    if (this.mtlsAgent && isNodeEnvironment()) {
      const undici = await import('undici');
      this.undiciFetch = undici.fetch;
    }

    return this.mtlsAgent;
  }

  /**
   * Get the mTLS agent, waiting for initialization if needed.
   */
  private async getMTLSAgent(): Promise<Agent | undefined> {
    if (this.mtlsAgent) return this.mtlsAgent;
    if (this.mtlsAgentPromise) return this.mtlsAgentPromise;
    return undefined;
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
      // Build fetch options
      const fetchOptions: UndiciRequestInit = {
        method,
        headers,
        body: requestBody,
        signal: controller.signal,
      };

      // Use undici's fetch with dispatcher for mTLS (Node.js only)
      // Otherwise use global fetch
      const useMtls = this.mtlsConfig && isNodeEnvironment();
      const agent = useMtls ? await this.getMTLSAgent() : undefined;

      let responseData: ResponseData;

      if (agent && this.undiciFetch) {
        // Use undici fetch with mTLS agent as dispatcher
        fetchOptions.dispatcher = agent;
        // Cast to unknown first to avoid type conflicts between global and undici types
        const response = await this.undiciFetch(url, fetchOptions as unknown as Parameters<typeof undiciFetchType>[1]);
        responseData = {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          text: await response.text(),
          headers: response.headers,
        };
      } else {
        // Use global fetch for non-mTLS requests or browser environments
        const response = await fetch(url, fetchOptions as RequestInit);
        responseData = {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          text: await response.text(),
          headers: response.headers,
        };
      }

      clearTimeout(timeoutId);

      if (!responseData.ok) {
        this.handleError(responseData);
      }

      // Handle empty responses (e.g., 204 No Content)
      if (!responseData.text) return undefined as T;

      return JSON.parse(responseData.text) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      // Re-throw SDK errors and mTLS errors as-is
      if (error instanceof SdkError || error instanceof MTLSError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new SdkError('timeout', 'Request timed out');
      }

      // Detect TLS/certificate errors and provide better error messages
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes('certificate') ||
        errorMessage.includes('SSL') ||
        errorMessage.includes('TLS') ||
        errorMessage.includes('CERT_')
      ) {
        throw new MTLSError(`TLS/Certificate error: ${errorMessage}`);
      }

      throw new SdkError(
        'network_error',
        `Request failed: ${errorMessage}`
      );
    }
  }

  private handleError(response: ResponseData): never {
    let body: {
      error?: string | { message?: string; code?: string };
      message?: string;
      code?: string;
    } = {};
    try {
      body = JSON.parse(response.text) as typeof body;
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
