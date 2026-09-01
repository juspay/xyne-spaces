import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { reactNativeBridge } from '../../utils/reactNativeBridge';
import { posthogService, EVENTS, EVENT_PROPERTIES } from '../Analytics/posthogService';
import { API_BASE_URL, APP_BASE_PATH } from '../../config';
import { logger, Logger } from '../../utils/logger';
import {
  httpRequestDuration,
  httpRequestTotal,
  httpRequestErrors,
  safeRecordMetric,
  clearAuthTokenTotal,
} from '../otel';
import { getDynamicHeaders } from './dynamicHeaders';
import {
  encryptionRequestInterceptor,
  encryptionResponseInterceptor,
} from '../encryptionInterceptors';

// Define the base URL
export const BASE_URL = API_BASE_URL;

// Cache regex patterns to avoid recompilation on each call
const URL_SANITIZATION_PATTERNS = [
  {
    regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replacement: '{uuid}',
  },
  { regex: /\/\d+(?=\/|$|\?)/g, replacement: '/{id}' },
  { regex: /\b[a-zA-Z0-9_-]{20,}\b/g, replacement: '{token}' },
  { regex: /([?&][^=]+=)[^&]+/g, replacement: '$1{param}' },
];

function sanitizeUrl(url: string): string {
  return URL_SANITIZATION_PATTERNS.reduce(
    (sanitized, { regex, replacement }) => sanitized.replace(regex, replacement),
    url,
  );
}

// Create the main Axios instance with interceptors
const apiConfig: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
});

// Add encryption request interceptor (must be first to encrypt before other transformations)
apiConfig.interceptors.request.use(encryptionRequestInterceptor);

// Add a request interceptor
apiConfig.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Tokens are now in HTTP-only cookies and sent automatically by the browser
    // No need to manually set Authorization header - backend reads from cookie

    const requestId = uuidv4();

    // Capture request start time for latency tracking
    (
      config as InternalAxiosRequestConfig & { metadata?: { startTime: number; requestId: string } }
    ).metadata = {
      startTime: Date.now(),
      requestId,
    };

    if (config.headers) {
      config.headers.Accept = '*/*';
      config.headers['Access-Control-Allow-Credentials'] = 'true';
      config.headers['x-request-id'] = requestId;

      // X-Workspace-Id for multi-workspace. Main routes are /:workspaceId/...; standalone
      // /newWindow/* windows carry it as a query param (then fall back to lastActiveWorkspaceId).
      // The lane serves under the /sdlc-app basename, whose segment would otherwise
      // read as the workspace id. APP_BASE_PATH is '' in the main bundle.
      const path = window.location.pathname;
      const appPath = path.startsWith(APP_BASE_PATH) ? path.slice(APP_BASE_PATH.length) : path;
      const firstPathSegment = appPath.match(/^\/([^/]+)/)?.[1];
      let workspaceId: string | undefined = firstPathSegment;
      if (firstPathSegment === 'newWindow') {
        const search = new URLSearchParams(window.location.search);
        const userEmail = logger.emailId || localStorage.getItem('user_email');
        workspaceId =
          search.get('workspaceId') ||
          (userEmail
            ? localStorage.getItem(`lastActiveWorkspaceId_${userEmail}`) || undefined
            : undefined);
      }
      if (workspaceId && workspaceId !== 'auth') {
        config.headers['x-workspace-id'] = workspaceId;
      }

      const zeroClientId = logger.zeroClientId;
      if (zeroClientId) {
        config.headers['x-client-id'] = zeroClientId;
      }
      const zeroClientGroupId = logger.zeroClientGroupId;
      if (zeroClientGroupId) {
        config.headers['x-zero-client-group-id'] = zeroClientGroupId;
      }
      const userEmail = logger.emailId;
      if (userEmail) {
        config.headers['x-user-email'] = userEmail;
      }
      const clientSessionId = logger.clientSessionId;
      if (clientSessionId) {
        config.headers['x-client-session-id'] = clientSessionId;
      }
      for (const [name, value] of Object.entries(getDynamicHeaders())) {
        config.headers[name] = value;
      }
    }
    return config;
  },
  (error: unknown) =>
    Promise.reject(new Error(error instanceof Error ? error.message : 'Request interceptor error')),
);

// Add a response interceptor
apiConfig.interceptors.response.use(encryptionResponseInterceptor);

apiConfig.interceptors.response.use(
  (response: AxiosResponse) => {
    // Token refresh is now handled by backend via HTTP-only cookies
    // No need to manually update tokens from frontend

    const config = response.config as InternalAxiosRequestConfig & {
      metadata?: { startTime: number; requestId: string };
    };
    const fullUrl = config.baseURL ? `${config.baseURL}${config.url}` : config.url || 'unknown';
    const latency = config.metadata?.startTime ? Date.now() - config.metadata.startTime : 0;
    const sanitizedUrl = sanitizeUrl(fullUrl);
    const method = config.method?.toUpperCase() || 'unknown';

    logger.info(Logger.Event.API_CALL_SUCCESSFUL, {
      api_url: sanitizedUrl,
      method,
      status_code: response.status,
      latency,
      requestId: config.metadata?.requestId,
    });

    safeRecordMetric(() => {
      httpRequestDuration.record(latency, {
        method,
        route: sanitizedUrl,
        status_code: String(response.status),
      });
      httpRequestTotal.add(1, {
        method,
        route: sanitizedUrl,
        status_code: String(response.status),
      });
    });

    return response;
  },
  async (error: unknown) => {
    // Type guard to ensure error has the expected structure
    if (!error || typeof error !== 'object' || !('config' in error)) {
      logger.error(Logger.Event.API_CALL_FAILED, {
        errorMessage: 'Unknown error structure in response interceptor',
      });
      return Promise.reject(new Error('Unknown error occurred'));
    }

    const axiosError = error as AxiosError & {
      config: InternalAxiosRequestConfig & { _retry?: boolean };
      response?: {
        status: number;
        data?: {
          error?: string;
          message?: string;
        };
      };
    };

    logger.debug(Logger.Event.API_ERROR_INTERCEPTOR_CAUGHT, {
      message: axiosError.message,
      code: axiosError.code,
      url: axiosError.config?.url,
    });

    const config = axiosError.config as InternalAxiosRequestConfig & {
      metadata?: { startTime: number; requestId: string };
    };
    const fullUrl = config.baseURL ? `${config.baseURL}${config.url}` : config.url || 'unknown';
    const latency = config.metadata?.startTime ? Date.now() - config.metadata.startTime : 0;
    const sanitizedUrl = sanitizeUrl(fullUrl);
    const method = config.method?.toUpperCase() || 'unknown';
    const statusCode = axiosError.response?.status || 0;
    const responseData = axiosError.response?.data;

    logger.error(Logger.Event.API_CALL_FAILED, {
      api_url: sanitizedUrl,
      method,
      status_code: statusCode,
      latency,
      error_message: axiosError.message,
      requestId: config.metadata?.requestId,
      serverError: responseData?.error,
      serverMessage: responseData?.message,
    });

    safeRecordMetric(() => {
      httpRequestDuration.record(latency, {
        method,
        route: sanitizedUrl,
        status_code: String(statusCode),
      });
      httpRequestTotal.add(1, {
        method,
        route: sanitizedUrl,
        status_code: String(statusCode),
      });
      httpRequestErrors.add(1, {
        method,
        route: sanitizedUrl,
        status_code: String(statusCode),
        error_type: axiosError.code || 'unknown',
      });
    });

    if (axiosError.response?.status === 401) {
      logger.warn(Logger.Event.AUTH_SESSION_EXPIRED, {
        url: sanitizedUrl,
        message: 'Received 401 Unauthorized. Logging out.',
        serverError: responseData?.error,
        serverMessage: responseData?.message,
      });

      // Track app refresh before reload
      posthogService.capture(EVENTS.APP_REFRESH, {
        trigger: EVENT_PROPERTIES.REFRESH_TRIGGERS.API_SESSION_EXPIRED,
        errorMessage: 'Session refresh failed - please re-authenticate',
        url: window.location.href,
        sessionDuration: Date.now() - (window.performance?.timing?.navigationStart || 0),
      });

      clearAuthTokens();

      window.location.href = '/auth';
      window.location.reload();

      return Promise.reject(new Error('Session refresh failed - please re-authenticate'));
    } else if (!axiosError.response) {
      // Network error (backend down) - log but don't redirect
      logger.warn(Logger.Event.API_NETWORK_ERROR, {
        message: axiosError.message,
        code: axiosError.code,
        description: 'Network error - backend server may be down.',
      });
      // console.error('🌐 [AUTH] Network error - backend server may be down:', error);
    }

    // Create a custom error with status code preservation for important HTTP codes.
    // Also attaches the original response body when present so downstream callers
    // that need structured info (e.g. previewService reads `code` + `message`
    // separately to drive UI badges) can still recover it. Without this, the
    // interceptor was silently turning every API error into a bare Error and
    // hiding the real diagnosis behind a one-line message string.
    const createErrorWithStatus = (message: string, status: number, responseData?: unknown) => {
      const errorWithStatus = new Error(message) as Error & {
        status?: number;
        responseData?: unknown;
      };
      errorWithStatus.status = status;
      if (responseData !== undefined) {
        errorWithStatus.responseData = responseData;
      }
      return errorWithStatus;
    };

    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;

      logger.info(Logger.Event.API_OPERATIONAL_ERROR, {
        url: sanitizedUrl,
        status,
        message: `Handling operational error for status ${status}`,
      });

      // Handle specific error responses with custom data
      if (error.response.data) {
        const data = error.response.data as {
          error?: string | { message?: string; code?: string };
          message?: string;
          errors?: { message?: string }[];
        };

        if (typeof data.error === 'string') {
          // Backends standardized on { error: "<code>", message: "<text>" }.
          // Prefer the user-facing `message` so toasts / tile bodies show
          // the diagnosis ("type mismatch in JOIN ON clause"), not the
          // category code ("ServerError"). Fall back to the code when no
          // message is supplied (older endpoints, generic 500s).
          const userMsg =
            typeof data.message === 'string' && data.message ? data.message : data.error;
          return Promise.reject(createErrorWithStatus(userMsg, status, data));
        }
        if (typeof data.error === 'object' && data.error?.message) {
          return Promise.reject(createErrorWithStatus(data.error.message, status, data));
        }
        if (Array.isArray(data.errors) && data.errors[0]?.message) {
          return Promise.reject(createErrorWithStatus(data.errors[0].message, status, data));
        }
      }

      // Always preserve status codes for important HTTP errors (429, 403, etc.)
      const errorMessage = error.message || `HTTP ${status} error`;
      return Promise.reject(createErrorWithStatus(errorMessage, status));
    }

    return Promise.reject(new Error(error instanceof Error ? error.message : 'API request failed'));
  },
);

/**
 * Clear all authentication tokens and user data
 */
export function clearAuthTokens(): void {
  if (typeof window.electronAPI?.clearAllCookies === 'function') {
    window.electronAPI.clearAllCookies();
  } else {
    document.cookie = 'user_email=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    document.cookie = 'user_name=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    document.cookie = 'user_data=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  }
  logger.info(Logger.Event.CLEAR_AUTH_TOKEN_CALLED);

  safeRecordMetric(() => {
    clearAuthTokenTotal.add(1, {
      platformName: logger.platformName,
    });
  });

  localStorage.removeItem('user_id');

  reactNativeBridge.notifySignOut('Session cleared by API client');
}

// Export the configured Axios instance
export const apiInstance: AxiosInstance = apiConfig;
