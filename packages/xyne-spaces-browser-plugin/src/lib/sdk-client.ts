/**
 * SDK client singleton for the browser extension.
 * Provides a centralized SDK instance with automatic token management.
 */

import {
  createClient,
  type SpacesClient,
  AuthError,
  NotFoundError,
  RateLimitError,
} from '@xyne/spaces-sdk';
import { getStoredToken, getBaseUrl } from './auth';

let clientInstance: SpacesClient | null = null;

/**
 * Get or create the SDK client singleton
 */
export async function getSdkClient(): Promise<SpacesClient> {
  if (clientInstance) {
    return clientInstance;
  }

  const token = await getStoredToken();
  const baseUrl = await getBaseUrl();

  if (!token) {
    throw new AuthError('No authentication token found. Please configure your token in settings.');
  }

  clientInstance = createClient({
    token,
    baseUrl,
  });

  return clientInstance;
}

/**
 * Reset the SDK client (use after token change)
 */
export function resetSdkClient(): void {
  clientInstance = null;
}

/**
 * Update the SDK client's token
 */
export async function updateSdkToken(token: string): Promise<void> {
  if (clientInstance) {
    clientInstance.setToken(token);
  } else {
    const baseUrl = await getBaseUrl();
    clientInstance = createClient({
      token,
      baseUrl,
    });
  }
}

/**
 * Error type for SDK operations
 */
export type SdkOperationError =
  | { type: 'auth'; message: string }
  | { type: 'not_found'; message: string }
  | { type: 'rate_limit'; retryAfter?: number }
  | { type: 'unknown'; message: string };

/**
 * Wrap SDK operations with standardized error handling
 */
export async function withSdkErrorHandling<T>(
  operation: () => Promise<T>
): Promise<{ data: T; error: null } | { data: null; error: SdkOperationError }> {
  try {
    const data = await operation();
    return { data, error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        data: null,
        error: { type: 'auth', message: error.message },
      };
    }

    if (error instanceof NotFoundError) {
      return {
        data: null,
        error: { type: 'not_found', message: error.message },
      };
    }

    if (error instanceof RateLimitError) {
      return {
        data: null,
        error: { type: 'rate_limit', retryAfter: error.retryAfter },
      };
    }

    return {
      data: null,
      error: {
        type: 'unknown',
        message: error instanceof Error ? error.message : 'An unknown error occurred',
      },
    };
  }
}

// Re-export error types for convenience
export { AuthError, NotFoundError, RateLimitError };
