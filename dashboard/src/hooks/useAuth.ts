import { useSelector } from '@xstate/react';
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authActor } from '../machines/authMachine';
import type { AuthState, User } from '../machines/authMachine';
import { analyticsService } from '../services/Analytics/analyticsService';
import { Context } from '@xyne/shared/index';

export interface UseAuthReturn {
  // State
  user: User | null;
  error: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  state: AuthState;
  isNewUser: boolean;

  signInWithGoogle: () => void;
  logout: () => void;
  clearError: () => void;
}

export const useAuth = (): UseAuthReturn => {
  const state = useSelector(authActor, state => state);
  const send = useCallback((event: Parameters<typeof authActor.send>[0]) => {
    authActor.send(event);
  }, []);

  const logout = useCallback(() => {
    send({ type: 'LOGOUT' });
  }, [send]);

  const signInWithGoogle = useCallback(() => {
    send({ type: 'GOOGLE_SIGNIN' });
  }, [send]);

  const clearError = useCallback(() => {
    send({ type: 'CLEAR_ERROR' });
  }, [send]);

  return {
    // State
    user: state.context.user,
    error: state.context.error,
    isAuthenticated: state.matches('authenticated'),
    isLoading:
      state.matches('checkingSession') ||
      state.matches('processingOAuthCallback') ||
      state.matches('validatingSession') ||
      state.matches('loggingOut') ||
      state.matches('authenticating'),
    state: state.value as AuthState,
    isNewUser: state.context.isNewUser,

    signInWithGoogle,
    logout,
    clearError,
  };
};

export const useAuthContextValues = (): Context => {
  const { user } = useAuth();
  if (!user) {
    throw new Error('User must be logged in to create query context');
  }
  return { userID: user.id };
};

// Analytics permissions hook - handles permission checking for analytics features
export const useAnalyticsPermissions = (): {
  hasAnalyticsAccess: boolean;
  isCheckingPermissions: boolean;
  permissionError: string | null;
} => {
  const { user } = useAuth();

  const permissionQuery = useQuery({
    queryKey: ['analytics', 'permissions', user?.id],
    queryFn: () => analyticsService.checkAnalyticsAccess(),
    staleTime: 10 * 60 * 1000, // 10 minutes
    retry: false, // Don't retry permission checks
    refetchOnWindowFocus: false,
    enabled: !!user, // Only check if user is authenticated
  });

  return {
    hasAnalyticsAccess: permissionQuery.data?.hasAccess || false,
    isCheckingPermissions: permissionQuery.isLoading,
    permissionError: permissionQuery.error
      ? String(permissionQuery.error.message || 'Failed to check permissions')
      : null,
  };
};
