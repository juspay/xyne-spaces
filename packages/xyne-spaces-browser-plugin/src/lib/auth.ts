/**
 * Authentication utilities for the browser extension.
 * Handles token storage, validation, and user identity.
 */

import {
  createClient,
  type SpacesClient,
  AuthError,
  decodeAccessToken,
  isTokenExpired,
} from '@xyne/spaces-sdk';
import {
  getStorage,
  setStorageMultiple,
  removeStorageMultiple,
  type StorageData,
} from './storage';

const DEFAULT_BASE_URL = 'https://spaces.xyne.app';

export interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  baseUrl: string;
  user: StorageData['xyne_spaces_user'] | null;
}

/**
 * Get the stored authentication token
 */
export async function getStoredToken(): Promise<string | null> {
  const token = await getStorage('xyne_spaces_token');
  return token ?? null;
}

/**
 * Get the configured base URL
 */
export async function getBaseUrl(): Promise<string> {
  const baseUrl = await getStorage('xyne_spaces_base_url');
  return baseUrl ?? DEFAULT_BASE_URL;
}

/**
 * Get the stored user info
 */
export async function getStoredUser(): Promise<StorageData['xyne_spaces_user'] | null> {
  const user = await getStorage('xyne_spaces_user');
  return user ?? null;
}

/**
 * Get the full authentication state
 */
export async function getAuthState(): Promise<AuthState> {
  const token = await getStoredToken();
  const baseUrl = await getBaseUrl();
  const user = await getStoredUser();

  return {
    isAuthenticated: !!token && !!user,
    token,
    baseUrl,
    user,
  };
}

/**
 * Save authentication credentials and user info
 */
export async function saveAuth(
  token: string,
  user: StorageData['xyne_spaces_user'],
  baseUrl?: string
): Promise<void> {
  await setStorageMultiple({
    xyne_spaces_token: token,
    xyne_spaces_user: user,
    xyne_spaces_base_url: baseUrl ?? DEFAULT_BASE_URL,
  });
}

/**
 * Clear authentication credentials
 */
export async function clearAuth(): Promise<void> {
  await removeStorageMultiple([
    'xyne_spaces_token',
    'xyne_spaces_user',
    'xyne_spaces_base_url',
  ]);
}

/**
 * Validate a token by decoding it and checking expiry
 */
export async function validateToken(
  token: string,
  _baseUrl?: string
): Promise<StorageData['xyne_spaces_user']> {
  try {
    // Decode the token to get user info
    const currentUser = decodeAccessToken(token);

    // Check if token is expired
    if (isTokenExpired(currentUser)) {
      throw new AuthError('Token has expired');
    }

    return {
      id: currentUser.id,
      email: currentUser.email,
      name: currentUser.name,
      workspaceId: currentUser.workspaceId,
    };
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError('Failed to validate token');
  }
}

/**
 * Create an SDK client with stored credentials
 */
export async function createAuthenticatedClient(): Promise<SpacesClient | null> {
  const token = await getStoredToken();
  const baseUrl = await getBaseUrl();

  if (!token) {
    return null;
  }

  return createClient({
    token,
    baseUrl,
  });
}

/**
 * Check if the current session is expired
 */
export async function isSessionExpired(): Promise<boolean> {
  const token = await getStoredToken();
  if (!token) {
    return true;
  }

  try {
    const currentUser = decodeAccessToken(token);
    return isTokenExpired(currentUser);
  } catch {
    return true;
  }
}
