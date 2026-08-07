/**
 * React hook for authentication state management.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getAuthState,
  validateToken,
  saveAuth,
  clearAuth,
  type AuthState,
} from '../lib/auth';
import { resetSdkClient } from '../lib/sdk-client';

interface UseAuthReturn extends AuthState {
  isLoading: boolean;
  error: string | null;
  login: (token: string, baseUrl?: string) => Promise<void>;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    token: null,
    baseUrl: 'https://spaces.xyne.app',
    user: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load auth state on mount
  useEffect(() => {
    getAuthState()
      .then((authState) => {
        setState(authState);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setIsLoading(false);
      });
  }, []);

  // Listen for storage changes (e.g., from other extension contexts)
  useEffect(() => {
    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== 'local') return;

      if (changes.xyne_spaces_token || changes.xyne_spaces_user) {
        getAuthState().then(setState);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const login = useCallback(async (token: string, baseUrl?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const user = await validateToken(token, baseUrl);
      await saveAuth(token, user, baseUrl);
      resetSdkClient(); // Reset to use new token

      setState({
        isAuthenticated: true,
        token,
        baseUrl: baseUrl ?? 'https://spaces.xyne.app',
        user,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      await clearAuth();
      resetSdkClient();

      setState({
        isAuthenticated: false,
        token: null,
        baseUrl: 'https://spaces.xyne.app',
        user: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Logout failed';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    ...state,
    isLoading,
    error,
    login,
    logout,
  };
}
