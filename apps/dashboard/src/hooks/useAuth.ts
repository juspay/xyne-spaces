import { useSelector } from '@xstate/react';
import { useCallback } from 'react';
import axios from 'axios';
import { authActor } from '../machines/authMachine';
import type {
  AuthState,
  CommunityJoinRequestContext,
  User,
  Workspace,
  OAuthCallbackOutput,
  EnterpriseJoinTarget,
} from '../machines/authMachine';
import { Context } from '@xyne/shared/index';
import { apiInstance } from '../services/clients/apiClient';
import { hashPasswordForAuth } from '../utils/passwordHash';

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
  landingChannelId: string | null;
  communityJoinRequest: CommunityJoinRequestContext | null;
  enterpriseJoinTarget: EnterpriseJoinTarget | null;

  signInWithGoogle: () => void;
  signInWithMicrosoft: () => void;
  signInWithEmail: (email: string, password: string, invitationId?: string) => Promise<void>;
  registerWithEmail: (
    email: string,
    password: string,
    name: string,
    workspaceId?: string,
    invitationId?: string,
  ) => Promise<{ success: boolean; message?: string; error?: string }>;
  verifyEmailCode: (
    email: string,
    code: string,
  ) => Promise<{ success: boolean; status?: string; error?: string }>;
  resendVerificationCode: (
    email: string,
  ) => Promise<{ success: boolean; message?: string; error?: string }>;
  logout: () => void;
  clearError: () => void;
  startEnterpriseLogin: () => void;
  selectWorkspace: (workspaceId: string) => void;
  joinCommunityWorkspace: (workspaceId: string) => void;
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

  const signInWithEmail = useCallback(
    async (email: string, password: string, invitationId?: string) => {
      send({ type: 'EMAIL_SIGNIN' });
      try {
        const response = await apiInstance.post(
          '/v2/auth/email/login',
          { email, password, invitationId },
          { timeout: 15000 },
        );
        const data = response.data as {
          success: boolean;
          user?: User;
          workspaces: Workspace[];
          pendingUserData: { email: string; name: string; picture?: string };
          userExistsButRemoved: boolean;
          autoLoginWorkspace?: string;
          invitationPending?: boolean;
          invitationId?: string;
        };

        if (!data.success) {
          send({ type: 'AUTH_ERROR', message: 'Email login failed' });
          return;
        }

        // If this is an invited user who hasn't accepted yet, redirect to the
        // invitation page
        if (data.invitationPending && data.invitationId) {
          window.location.replace(
            `/invite?invitationId=${encodeURIComponent(data.invitationId)}` +
              `&loginComplete=true` +
              `&loggedInEmail=${encodeURIComponent(data.pendingUserData.email)}`,
          );
          return;
        }

        authActor.send({
          type: 'OAUTH_CALLBACK_COMPLETE',
          output: {
            ...(data.user ? { user: data.user } : {}),
            workspaces: data.workspaces,
            pendingUserData: data.pendingUserData,
            userExistsButRemoved: data.userExistsButRemoved,
            autoLoginWorkspace: data.autoLoginWorkspace,
          } as OAuthCallbackOutput,
        });
      } catch (err) {
        const serverMessage =
          (err as { responseData?: { message?: string } })?.responseData?.message ??
          (axios.isAxiosError(err)
            ? (err.response?.data as { message?: string } | undefined)?.message
            : undefined);

        send({
          type: 'AUTH_ERROR',
          message: serverMessage ?? 'Email login failed. Please check your credentials.',
        });
      }
    },
    [send],
  );

  const clearError = useCallback(() => {
    send({ type: 'CLEAR_ERROR' });
  }, [send]);

  const startEnterpriseLogin = useCallback(() => {
    send({ type: 'START_ENTERPRISE_LOGIN' });
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

  const joinCommunityWorkspace = useCallback(
    (workspaceId: string) => {
      send({ type: 'JOIN_COMMUNITY_WORKSPACE', workspaceId });
    },
    [send],
  );

  const registerWithEmail = useCallback(
    async (
      email: string,
      password: string,
      name: string,
      workspaceId?: string,
      invitationId?: string,
    ): Promise<{ success: boolean; message?: string; error?: string }> => {
      try {
        const hashedPassword = await hashPasswordForAuth(password);
        const response = await apiInstance.post(
          '/v2/auth/email/register',
          {
            email,
            hashedPassword,
            name,
            ...(workspaceId ? { workspaceId } : {}),
            ...(invitationId ? { invitationId } : {}),
          },
          { timeout: 30000 },
        );
        const data = response.data as { success: boolean; message?: string };
        return { success: true, message: data.message ?? 'Verification code sent.' };
      } catch (err) {
        if (axios.isAxiosError(err)) {
          const data = err.response?.data as { error?: string; message?: string } | undefined;
          return { success: false, error: data?.message ?? data?.error ?? 'Registration failed' };
        }
        const errWithResponse = err as { responseData?: { message?: string; error?: string } };
        const errMessage =
          errWithResponse.responseData?.message ??
          errWithResponse.responseData?.error ??
          (err instanceof Error ? err.message : '');
        return { success: false, error: errMessage || 'Registration failed. Please try again.' };
      }
    },
    [],
  );

  const verifyEmailCode = useCallback(
    async (
      email: string,
      code: string,
    ): Promise<{ success: boolean; status?: string; error?: string }> => {
      try {
        const response = await apiInstance.post(
          '/v2/auth/email/verify',
          { email, code },
          { timeout: 15000 },
        );
        const data = response.data as {
          success: boolean;
          status?: string;
          user?: User;
          workspaces?: Workspace[];
          pendingUserData?: { email: string; name: string; picture?: string };
          userExistsButRemoved?: boolean;
          autoLoginWorkspace?: string;
          invitationPending?: boolean;
          invitationId?: string;
          domainConflictError?: string;
          publicEmailDomainError?: string;
          enterpriseJoinOrgName?: string;
          enterpriseJoinWorkspaces?: string;
        };

        if (!data.success) {
          return { success: false, error: 'Verification failed' };
        }

        if (data.invitationPending && data.invitationId) {
          const emailForRedirect = data.pendingUserData?.email ?? email;
          window.location.replace(
            `/invite?invitationId=${encodeURIComponent(data.invitationId)}` +
              `&loginComplete=true` +
              `&loggedInEmail=${encodeURIComponent(emailForRedirect)}`,
          );
          return { success: true, status: data.status ?? 'INVITATION_PENDING' };
        }

        // Dispatch to auth machine — same as OAuth callback.
        // The auth machine will check hasPendingWorkspace (from localStorage)
        // and trigger the joinWorkspace actor, which handles community OPEN,
        // community REQUEST_TO_JOIN, and enterprise join flows identically
        // to Google/Microsoft SSO. If no workspaceId is pending, the auth
        // machine shows the create-org / workspace-selection / domain-conflict
        // UI — exactly like the OAuth callback flow.
        authActor.send({
          type: 'OAUTH_CALLBACK_COMPLETE',
          output: {
            ...(data.user ? { user: data.user } : {}),
            workspaces: data.workspaces ?? [],
            pendingUserData: data.pendingUserData ?? { email, name: '' },
            userExistsButRemoved: data.userExistsButRemoved ?? false,
            autoLoginWorkspace: data.autoLoginWorkspace,
            domainConflictError: data.domainConflictError,
            publicEmailDomainError: data.publicEmailDomainError,
            enterpriseJoinOrgName: data.enterpriseJoinOrgName,
            enterpriseJoinWorkspaces: data.enterpriseJoinWorkspaces,
          } as OAuthCallbackOutput,
        });

        return { success: true, status: data.status ?? 'JOINED' };
      } catch (err) {
        if (axios.isAxiosError(err)) {
          const data = err.response?.data as { error?: string; message?: string } | undefined;
          return { success: false, error: data?.message ?? data?.error ?? 'Verification failed' };
        }
        const errWithResponse = err as { responseData?: { message?: string; error?: string } };
        const errMessage =
          errWithResponse.responseData?.message ??
          errWithResponse.responseData?.error ??
          (err instanceof Error ? err.message : '');
        return { success: false, error: errMessage || 'Verification failed. Please try again.' };
      }
    },
    [],
  );

  const resendVerificationCode = useCallback(
    async (email: string): Promise<{ success: boolean; message?: string; error?: string }> => {
      try {
        const response = await apiInstance.post(
          '/v2/auth/email/resend-code',
          { email },
          { timeout: 30000 },
        );
        const data = response.data as { success: boolean; message?: string };
        return { success: true, message: data.message ?? 'A new verification code has been sent.' };
      } catch (err) {
        if (axios.isAxiosError(err)) {
          const data = err.response?.data as { error?: string; message?: string } | undefined;
          return { success: false, error: data?.message ?? data?.error ?? 'Failed to resend code' };
        }
        const errWithResponse = err as { responseData?: { message?: string; error?: string } };
        const errMessage =
          errWithResponse.responseData?.message ??
          errWithResponse.responseData?.error ??
          (err instanceof Error ? err.message : '');
        return { success: false, error: errMessage || 'Failed to resend code. Please try again.' };
      }
    },
    [],
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
      state.matches('joiningCommunityWorkspace') ||
      state.matches('submittingCreateOrg'),
    state: state.value as AuthState,
    isNewUser: state.context.isNewUser,
    workspaces: state.context.workspaces,
    pendingUserData: state.context.pendingUserData,
    isSelectingWorkspace: state.matches('selectingWorkspace'),
    isCreatingOrg: state.matches('creatingOrg'),
    isLoggingInToWorkspace:
      state.matches('loggingInToWorkspace') || state.matches('joiningCommunityWorkspace'),
    userExistsButRemoved: state.context.userExistsButRemoved,
    selfDmChannelId: state.context.selfDmChannelId,
    landingChannelId: state.context.landingChannelId,
    communityJoinRequest: state.context.communityJoinRequest,
    enterpriseJoinTarget: state.context.enterpriseJoinTarget,

    signInWithGoogle,
    signInWithMicrosoft,
    signInWithEmail,
    registerWithEmail,
    verifyEmailCode,
    resendVerificationCode,
    logout,
    clearError,
    startEnterpriseLogin,
    selectWorkspace,
    joinCommunityWorkspace,
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
