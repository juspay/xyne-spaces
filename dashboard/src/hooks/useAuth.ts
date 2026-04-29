import { useSelector } from '@xstate/react';
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authActor } from '../machines/authMachine';
import type { AuthState, User, Workspace } from '../machines/authMachine';
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
  workspaces: Workspace[];
  pendingUserData: { email: string; name: string; picture?: string } | null;
  isSelectingWorkspace: boolean;
  isCreatingOrg: boolean;
  isLoggingInToWorkspace: boolean;
  userExistsButRemoved: boolean;
  selfDmChannelId: string | null;

  signInWithGoogle: () => void;
  signInWithMicrosoft: () => void;
  logout: () => void;
  clearError: () => void;
  selectWorkspace: (workspaceId: string) => void;
  createOrg: (orgName: string, workspaceName: string) => void;
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

  const signInWithMicrosoft = useCallback(() => {
    send({ type: 'MICROSOFT_SIGNIN' });
  }, [send]);

  const clearError = useCallback(() => {
    send({ type: 'CLEAR_ERROR' });
  }, [send]);

  const selectWorkspace = useCallback(
    (workspaceId: string) => {
      send({ type: 'SELECT_WORKSPACE', workspaceId });
    },
    [send],
  );

  const createOrg = useCallback(
    (orgName: string, workspaceName: string) => {
      send({ type: 'SUBMIT_CREATE_ORG', orgName, workspaceName });
    },
    [send],
  );

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
      state.matches('authenticating') ||
      state.matches('loggingInToWorkspace') ||
      state.matches('submittingCreateOrg'),
    state: state.value as AuthState,
    isNewUser: state.context.isNewUser,
    workspaces: state.context.workspaces,
    pendingUserData: state.context.pendingUserData,
    isSelectingWorkspace: state.matches('selectingWorkspace'),
    isCreatingOrg: state.matches('creatingOrg'),
    isLoggingInToWorkspace: state.matches('loggingInToWorkspace'),
    userExistsButRemoved: state.context.userExistsButRemoved,
    selfDmChannelId: state.context.selfDmChannelId,

    signInWithGoogle,
    signInWithMicrosoft,
    logout,
    clearError,
    selectWorkspace,
    createOrg,
  };
};

export const useAuthContextValues = (): Context => {
  const { user } = useAuth();
  if (!user) {
    throw new Error('User must be logged in to create query context');
  }
  return {
    userID: user.id,
    workspaceId: user.workspaceId,
    role: user.role,
    orgRole: user.orgRole,
    memberId: user.memberId,
  };
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
