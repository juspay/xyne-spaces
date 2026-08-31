import { createMachine, createActor, fromPromise, assign } from 'xstate';
import Cookies from 'js-cookie';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { reactNativeBridge } from '../utils/reactNativeBridge';
import { posthogService, EVENTS, EVENT_PROPERTIES } from '../services/Analytics/posthogService';
import { API_BASE_URL, isSdlcSurface, isTestEnv } from '../config';
import { logger } from '../utils/logger';
import {
  CommunityJoinResultStatus,
  WorkspaceType,
  type CommunityJoinResultStatus as CommunityJoinResultStatusType,
} from '@xyne/shared';

export const PENDING_WORKSPACE_ID_KEY = 'pending_workspace_id';
export const PENDING_WORKSPACE_NAME_KEY = 'pending_workspace_name';
import { clearAllSessionKeys } from '../services/sessionKeyStore';
import { indexedDBService } from '../services/indexedDBService';
import { resetEncryption } from './encryptionMachine';
import { decryptionCache } from '@xyne/shared';
import { resetGlobalEncryptionBootstrap } from '@xyne/shared/hooks';
import { dropAllZeroDatabases, dropZeroDatabases } from '../zero/dropZeroDatabases';

export interface User {
  id: string;
  name?: string;
  email?: string;
  googleId?: string;
  picture?: string;
  workspaceId: string;
  role: string;
  orgRole: string;
  memberId: string;
  [key: string]: string | undefined;
}

export interface Workspace {
  id: string;
  name: string;
  role: string;
  orgId?: string;
  orgName?: string;
  workspaceType?: string | null;
  memberCount?: number;
}

export interface CommunityJoinRequestContext {
  workspaceId: string;
  requestId?: string;
  status: CommunityJoinResultStatusType;
  isExisting?: boolean;
}

export interface EnterpriseJoinTarget {
  orgName: string;
  workspaces: Array<{ id: string; name: string }>;
}

interface AuthContext {
  user: User | null;
  error: string | null;
  isNewUser: boolean;
  workspaces: Workspace[];
  pendingUserData: { email: string; name: string; picture?: string } | null;
  selectedWorkspaceId: string | null;
  orgData: { orgName: string; workspaceName: string } | null;
  userExistsButRemoved: boolean;
  selfDmChannelId: string | null;
  landingChannelId: string | null;
  communityJoinRequest: CommunityJoinRequestContext | null;
  enterpriseJoinTarget: EnterpriseJoinTarget | null;
}

type AuthEvent =
  | { type: 'GOOGLE_SIGNIN' }
  | { type: 'MICROSOFT_SIGNIN' }
  | { type: 'EMAIL_SIGNIN' }
  | { type: 'EMAIL_REGISTER' }
  | { type: 'LOGOUT' }
  | { type: 'SESSION_VALIDATED'; user: User; isNewUser?: boolean }
  | { type: 'OAUTH_CALLBACK_COMPLETE'; output: OAuthCallbackOutput }
  | { type: 'AUTH_ERROR'; message: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'COMPLETE_ONBOARDING' }
  | { type: 'SELECT_WORKSPACE'; workspaceId: string }
  | { type: 'JOIN_COMMUNITY_WORKSPACE'; workspaceId: string }
  | { type: 'START_ENTERPRISE_LOGIN' }
  | { type: 'CREATE_ORG' }
  | { type: 'SUBMIT_CREATE_ORG'; orgName: string; workspaceName: string };

export type AuthState =
  | 'checkingSession'
  | 'authenticated'
  | 'unauthenticated'
  | 'authenticating'
  | 'registering'
  | 'loggingOut'
  | 'validatingSession'
  | 'processingOAuthCallback'
  | 'joiningWorkspace'
  | 'communityJoinRequested'
  | 'redirectingToInvitation'
  | 'testAuthenticating';

interface ValidateSessionResponse {
  user: User & { workspaceId?: string };
  selfDmChannelId?: string | null;
  landingChannelId?: string | null;
}

interface ApiErrorResponse {
  error: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  workspaceId?: string;
  organizationName?: string;
  workspaceName?: string;
}

export interface OAuthCallbackOutput {
  user?: User;
  workspaces: Workspace[];
  invitations?: Invitation[];
  pendingUserData: { email: string; name: string; picture?: string };
  autoLoginWorkspace?: string;
  isNewUser?: boolean;
  userExistsButRemoved?: boolean;
  domainConflictError?: string;
  publicEmailDomainError?: string;
  enterpriseJoinOrgName?: string;
  enterpriseJoinWorkspaces?: string;
  selfDmChannelId?: string | null;
  landingChannelId?: string | null;
}

interface XStateEvent {
  type: string;
  output?: OAuthCallbackOutput & {
    communityJoinRequest?: Omit<CommunityJoinRequestContext, 'workspaceId'>;
  };
}

const clearPersistedSession = (): void => {
  Cookies.remove('user_data');
  Cookies.remove('user_name');
  Cookies.remove('user_email');
};

const clearOnboardingCookie = (): void => {
  Cookies.remove('is_new_user');
};

export const getLastActiveWorkspaceId = (email: string): string | null => {
  return localStorage.getItem(`lastActiveWorkspaceId_${email}`);
};

export const setLastActiveWorkspaceId = (email: string, workspaceId: string): void => {
  localStorage.setItem(`lastActiveWorkspaceId_${email}`, workspaceId);
};

export const getLastActiveWorkspaceName = (email: string): string | null => {
  return localStorage.getItem(`lastActiveWorkspaceName_${email}`);
};

export const setLastActiveWorkspaceName = (email: string, workspaceName: string): void => {
  localStorage.setItem(`lastActiveWorkspaceName_${email}`, workspaceName);
};

const createClearedContext = (): AuthContext => ({
  user: null,
  error: null,
  isNewUser: false,
  workspaces: [],
  pendingUserData: null,
  selectedWorkspaceId: null,
  orgData: null,
  userExistsButRemoved: false,
  selfDmChannelId: null,
  landingChannelId: null,
  communityJoinRequest: null,
  enterpriseJoinTarget: null,
});

const getWorkspaces = (output?: OAuthCallbackOutput): Workspace[] => {
  return output?.workspaces || [];
};

export const authMachine = createMachine(
  {
    /** @xstate-layout N4IgpgJg5mDOIC5QEMCuAXAFgWWQY0wEsA7MAOgLDwGsSoBlOWQge2IGIBtABgF1FQABxbN0rYgJAAPRACYAjAE4yANgAsADjXaArIsUaA7AGZ1AGhABPRJuUbjew9xUbZa7muOGAvt4tosXAISckoaOkZYZjYueX4kEGFRcUkZBAVldS1dfSNTNQtrBHUVMmN5WR1TDRVueyrffwwcfCJSCkwqWmIGJnEuWXihEUIxNlS5JVVNbTU9AxNzK0QNeTIdbk35eTmVY25FY1lGkACW4PbBACcWPD6egHkAQWaAYWQAGw+AI3xqdggbHIJAAbixqOQzkE2uRrrd7lBnm9Pj8-ghQbdkGNiDxeLjJElRikEmlDAoyGodnVjHMFCpZCpCjYNNwynp3HolIYdOoTlDWiEyHC7lE6EisO8vr8aOwwFcblchR8sQAzFhXAC2ZH5F1hNxFzEeLwlKOl1HRxDBeCx4lx+IShOxEwQZLWlPc9lp8npjOWCGMNTIimcskMuxqbkUfOa0MFIM+hAgNp6ABVwWAOID2hiIdqYwL2vGPonk1A0xDiBarTa2Ha+ASRk6SYgyaywyp5M5uDo1Io5homf7uGtKjoeWGdLI6jUVNHAgXyEWS2JU+mOHKFUrVeqtTqYWQl0mV2W11XMdi60NEo3iaBSeT3dSvT7B1PWZstvIZ6YlGo5+d9zODMxGtdBIHYAAZB4AHEHgAVRTe1hmScZmwQbZTApbINh0bljEOAc-Q7VkFAOQwtA0CiaX-WN2lQYggOIECsXA2CYIggBRAB9egAEloIAOV4gSkOvFCJDQipyLIbhZAcOoPEUQxDAqQdJzUIMtADRx6gMGiFzIejGOYsCIHYV5OKeAAlLiOKsqyHis0THVvaREAqRQ1iqScFBMXydEIoo1FkDR1nKSoVD7KcaWMXw-BAYgWAgOBJD3EIG3E50AFpfSKLKdCDfQlI0HRvQULRPP03UOi6CI+lQ5CiQatyEGCwc1HUdYSsUDsOrDDQ9PitLLn1BFxUwSVURoDKmoku8bA2GT5B5H95AcBwx3azqAr0SKAoDDteSG-NqsPUtywzGam3m-1DFKBxvQCkKKlqQxXzDdYVHI5a9iMCpjmO+dquMwhQMgK7XLSAw21Wcp5CcYN+sHPZjFUIwx20b76R8QGAMFIzmmA0GWIgCHmrSCpA25cjai8Gk7uRhkKS8UqNh2Fwxzi7wgA */
    id: 'authMachine',
    initial: 'checkingSession',
    types: {
      context: {} as AuthContext,
      events: {} as AuthEvent,
    },
    context: {
      user: null,
      error: null,
      isNewUser: false,
      workspaces: [],
      pendingUserData: null,
      selectedWorkspaceId: null,
      orgData: null,
      userExistsButRemoved: false,
      selfDmChannelId: null,
      landingChannelId: null,
      communityJoinRequest: null,
      enterpriseJoinTarget: null,
    },
    states: {
      checkingSession: {
        entry: assign(({ context: _context }) => {
          const userId = localStorage.getItem('user_id');
          const userEmail = localStorage.getItem('user_email');

          let user = null;

          if (userId) {
            user = {
              id: userId,
              workspaceId: '',
              role: '',
              orgRole: '',
              memberId: '',
              ...(userEmail && { email: userEmail }),
            };
          }

          const lastActiveWorkspaceId = userEmail ? getLastActiveWorkspaceId(userEmail) : null;

          // Check for is_new_user cookie
          const isNewUserCookie = Cookies.get('is_new_user');
          const isNewUser = isNewUserCookie === 'true';

          return {
            user: user,
            error: null,
            isNewUser: isNewUser,
            selectedWorkspaceId: lastActiveWorkspaceId,
          };
        }),
        always: [
          {
            target: 'processingOAuthCallback',
            guard: 'hasOAuthCallback',
          },
          {
            target: 'validatingSession',
            guard: 'hasStoredSession',
          },
          {
            target: 'unauthenticated',
          },
        ],
      },
      processingOAuthCallback: {
        invoke: {
          src: 'processOAuthCallback',
          onDone: [
            {
              // If pending invitation exists in localStorage, prioritize invitation flow
              // This overrides auto-login so user can see and accept the invitation
              target: 'redirectingToInvitation',
              guard: 'hasPendingInvitationInStorage',
              actions: assign(({ context, event }) => {
                const output = event.output as OAuthCallbackOutput | undefined;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  invitations: output?.invitations || [],
                  pendingUserData: output?.pendingUserData || null,
                  error: null,
                };
              }),
            },
            {
              // A community workspace was selected before OAuth; join it before enterprise auto-login.
              target: 'joiningWorkspace',
              guard: 'hasPendingWorkspace',
              actions: assign(({ context, event }) => {
                const output = event.output as OAuthCallbackOutput | undefined;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  selectedWorkspaceId: localStorage.getItem(PENDING_WORKSPACE_ID_KEY),
                  error: null,
                };
              }),
            },
            {
              // User already exists in a workspace (legacy flow or session refresh)
              target: 'authenticated',
              guard: 'hasUserInOutput',
              actions: [
                assign(({ context, event }) => {
                  const output = (event as XStateEvent).output;
                  if (output?.user) {
                    localStorage.setItem('user_id', output.user.id);
                    if (output.user.email) {
                      localStorage.setItem('user_email', output.user.email);
                      if (window.electronAPI?.setUserEmail) {
                        window.electronAPI.setUserEmail(output.user.email);
                      }
                      if (output.user.workspaceId) {
                        setLastActiveWorkspaceId(output.user.email, output.user.workspaceId);
                      }
                    }
                  }
                  return {
                    user: output?.user || context.user,
                    error: null,
                    isNewUser: output?.isNewUser ?? context.isNewUser,
                    workspaces: [],
                    pendingUserData: null,
                  };
                }),
                'trackLoginSuccess',
              ],
            },
            {
              // Has autoLoginWorkspace from invitation flow - auto-login to that workspace
              target: 'loggingInToWorkspace',
              guard: 'hasAutoLoginWorkspace',
              actions: assign(({ context, event }) => {
                const output = event.output as OAuthCallbackOutput | undefined;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  selectedWorkspaceId: output?.autoLoginWorkspace || null,
                  error: null,
                };
              }),
            },
            {
              // Has lastActiveWorkspaceId in localStorage - auto-login to that workspace
              target: 'loggingInToWorkspace',
              guard: 'hasLastActiveWorkspace',
              actions: assign(({ context, event }) => {
                const output = event.output as OAuthCallbackOutput | undefined;
                const email = output?.pendingUserData?.email;
                const lastWorkspaceId = email ? getLastActiveWorkspaceId(email) : null;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  selectedWorkspaceId: lastWorkspaceId,
                  error: null,
                };
              }),
            },
            {
              // Has workspaces but no lastActiveWorkspaceId - show selection UI
              target: 'selectingWorkspace',
              guard: 'hasWorkspaces',
              actions: assign(({ context, event }) => {
                const output = event.output as OAuthCallbackOutput | undefined;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  error: null,
                };
              }),
            },
            {
              // No workspaces - show create org UI or removed user message
              target: 'creatingOrg',
              actions: assign(({ context, event }) => {
                const output = event.output as OAuthCallbackOutput | undefined;
                return {
                  ...context,
                  workspaces: [],
                  pendingUserData: output?.pendingUserData || null,
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: output?.domainConflictError ?? output?.publicEmailDomainError ?? null,
                  enterpriseJoinTarget:
                    output?.enterpriseJoinOrgName && output.enterpriseJoinWorkspaces
                      ? {
                          orgName: output.enterpriseJoinOrgName,
                          workspaces: JSON.parse(output.enterpriseJoinWorkspaces) as Array<{
                            id: string;
                            name: string;
                          }>,
                        }
                      : null,
                };
              }),
            },
          ],
          onError: {
            target: 'unauthenticated',
            actions: 'setError',
          },
        },
      },
      redirectingToInvitation: {
        // Entry action that performs the navigation
        entry: () => {
          const pendingInvitationId = localStorage.getItem('pending_invitation_id');
          if (pendingInvitationId) {
            window.location.href = `/invite?invitationId=${encodeURIComponent(pendingInvitationId)}&loginComplete=true`;
          }
        },
      },
      selectingWorkspace: {
        on: {
          SELECT_WORKSPACE: {
            target: 'loggingInToWorkspace',
            actions: assign(({ context, event }) => ({
              ...context,
              selectedWorkspaceId: (event as { type: 'SELECT_WORKSPACE'; workspaceId: string })
                .workspaceId,
            })),
          },
          CREATE_ORG: {
            target: 'creatingOrg',
          },
          JOIN_COMMUNITY_WORKSPACE: {
            target: 'joiningWorkspace',
            actions: assign(({ context, event }) => ({
              ...context,
              selectedWorkspaceId: (
                event as { type: 'JOIN_COMMUNITY_WORKSPACE'; workspaceId: string }
              ).workspaceId,
            })),
          },
          AUTH_ERROR: {
            target: 'unauthenticated',
            actions: 'setError',
          },
        },
      },
      joiningWorkspace: {
        invoke: {
          src: 'joinWorkspace',
          input: ({ context }) => ({ workspaceId: context.selectedWorkspaceId! }),
          onDone: [
            {
              target: 'communityJoinRequested',
              guard: 'isCommunityJoinRequest',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                const joinRequest = output?.communityJoinRequest;
                localStorage.removeItem(PENDING_WORKSPACE_ID_KEY);
                localStorage.removeItem(PENDING_WORKSPACE_NAME_KEY);
                return {
                  ...context,
                  error: null,
                  communityJoinRequest: {
                    workspaceId: context.selectedWorkspaceId || '',
                    status: joinRequest?.status || CommunityJoinResultStatus.REQUEST_PENDING,
                    ...(joinRequest?.requestId ? { requestId: joinRequest.requestId } : {}),
                    ...(joinRequest?.isExisting !== undefined
                      ? { isExisting: joinRequest.isExisting }
                      : {}),
                  },
                  selectedWorkspaceId: null,
                };
              }),
            },
            {
              target: 'authenticated',
              actions: [
                assign(({ context, event }) => {
                  const output = (event as XStateEvent).output;
                  if (output?.user) {
                    localStorage.setItem('user_id', output.user.id);
                    if (output.user.email) {
                      localStorage.setItem('user_email', output.user.email);
                      if (window.electronAPI?.setUserEmail) {
                        window.electronAPI.setUserEmail(output.user.email);
                      }
                      if (output.user.workspaceId) {
                        setLastActiveWorkspaceId(output.user.email, output.user.workspaceId);
                      }
                    }
                  }
                  localStorage.removeItem(PENDING_WORKSPACE_ID_KEY);
                  localStorage.removeItem(PENDING_WORKSPACE_NAME_KEY);
                  return {
                    user: output?.user || context.user,
                    error: null,
                    isNewUser: output?.isNewUser ?? context.isNewUser,
                    selfDmChannelId: output?.selfDmChannelId ?? null,
                    landingChannelId: output?.landingChannelId ?? null,
                    workspaces: [],
                    pendingUserData: null,
                    selectedWorkspaceId: null,
                    communityJoinRequest: null,
                  };
                }),
                'trackLoginSuccess',
              ],
            },
          ],
          onError: {
            target: 'unauthenticated',
            actions: 'setError',
          },
        },
      },
      communityJoinRequested: {
        on: {
          START_ENTERPRISE_LOGIN: {
            target: 'unauthenticated',
            actions: assign(({ context }) => ({
              ...context,
              error: null,
              communityJoinRequest: null,
              selectedWorkspaceId: null,
            })),
          },
          JOIN_COMMUNITY_WORKSPACE: {
            target: 'joiningWorkspace',
            actions: assign(({ context, event }) => ({
              ...context,
              selectedWorkspaceId: (
                event as { type: 'JOIN_COMMUNITY_WORKSPACE'; workspaceId: string }
              ).workspaceId,
            })),
          },
          CLEAR_ERROR: {
            actions: {
              type: 'clearError',
            },
          },
          AUTH_ERROR: {
            target: 'unauthenticated',
            actions: 'setError',
          },
          LOGOUT: {
            target: 'unauthenticated',
            actions: [
              'clearSessionCookies',
              { type: 'notifySignOut', params: { reason: 'User canceled sign-in' } },
              assign(() => createClearedContext()),
            ],
          },
        },
      },
      loggingInToWorkspace: {
        invoke: {
          src: 'loginWorkspace',
          input: ({ context }) => ({ workspaceId: context.selectedWorkspaceId! }),
          onDone: {
            target: 'authenticated',
            actions: [
              assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                if (output?.user) {
                  localStorage.setItem('user_id', output.user.id);
                  if (output.user.email) {
                    localStorage.setItem('user_email', output.user.email);
                    if (window.electronAPI?.setUserEmail) {
                      window.electronAPI.setUserEmail(output.user.email);
                    }
                    if (output.user.workspaceId) {
                      setLastActiveWorkspaceId(output.user.email, output.user.workspaceId);
                    }
                  }
                }
                localStorage.removeItem(PENDING_WORKSPACE_ID_KEY);
                localStorage.removeItem(PENDING_WORKSPACE_NAME_KEY);
                return {
                  user: output?.user || context.user,
                  error: null,
                  isNewUser: output?.isNewUser ?? context.isNewUser,
                  selfDmChannelId: output?.selfDmChannelId ?? null,
                  landingChannelId: output?.landingChannelId ?? null,
                  workspaces: [],
                  pendingUserData: null,
                  selectedWorkspaceId: null,
                };
              }),
              'trackLoginSuccess',
            ],
          },
          onError: {
            target: 'selectingWorkspace',
            actions: 'setError',
          },
        },
      },
      creatingOrg: {
        on: {
          JOIN_COMMUNITY_WORKSPACE: {
            target: 'joiningWorkspace',
            actions: assign(({ context, event }) => ({
              ...context,
              selectedWorkspaceId: (
                event as { type: 'JOIN_COMMUNITY_WORKSPACE'; workspaceId: string }
              ).workspaceId,
            })),
          },
          SUBMIT_CREATE_ORG: {
            target: 'submittingCreateOrg',
            actions: assign(({ context, event }) => ({
              ...context,
              orgData: event as {
                type: 'SUBMIT_CREATE_ORG';
                orgName: string;
                workspaceName: string;
              },
            })),
          },
          AUTH_ERROR: {
            target: 'unauthenticated',
            actions: 'setError',
          },
        },
      },
      submittingCreateOrg: {
        invoke: {
          src: 'createOrg',
          input: ({ context }) => ({
            orgName: context.orgData!.orgName,
            workspaceName: context.orgData!.workspaceName,
          }),
          onDone: {
            target: 'authenticated',
            actions: [
              assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                if (output?.user) {
                  localStorage.setItem('user_id', output.user.id);
                  if (output.user.email) {
                    localStorage.setItem('user_email', output.user.email);
                    if (window.electronAPI?.setUserEmail) {
                      window.electronAPI.setUserEmail(output.user.email);
                    }
                    if (output.user.workspaceId) {
                      setLastActiveWorkspaceId(output.user.email, output.user.workspaceId);
                      if (context.orgData?.workspaceName) {
                        setLastActiveWorkspaceName(
                          output.user.email,
                          context.orgData.workspaceName,
                        );
                      }
                    }
                  }
                }
                localStorage.removeItem(PENDING_WORKSPACE_ID_KEY);
                localStorage.removeItem(PENDING_WORKSPACE_NAME_KEY);
                return {
                  user: output?.user || context.user,
                  error: null,
                  isNewUser: true,
                  selfDmChannelId: output?.selfDmChannelId ?? null,
                  landingChannelId: output?.landingChannelId ?? null,
                  workspaces: [],
                  pendingUserData: null,
                  orgData: null,
                };
              }),
              'trackLoginSuccess',
            ],
          },
          onError: {
            target: 'creatingOrg',
            actions: 'setError',
          },
        },
      },
      validatingSession: {
        invoke: {
          src: 'validateSession',
          onDone: [
            {
              target: 'joiningWorkspace',
              guard: 'hasPendingWorkspaceAfterSessionValidation',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                if (output?.user?.id) {
                  localStorage.setItem('user_id', output.user.id);
                }

                return {
                  ...context,
                  user: output?.user || context.user,
                  selectedWorkspaceId: localStorage.getItem(PENDING_WORKSPACE_ID_KEY),
                  error: null,
                  isNewUser: output?.isNewUser ?? context.isNewUser,
                  selfDmChannelId: output?.selfDmChannelId ?? null,
                  landingChannelId: output?.landingChannelId ?? null,
                };
              }),
            },
            {
              target: 'authenticated',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;

                if (output?.user) {
                  localStorage.setItem('user_id', output.user.id);
                }

                // Session tokens are set via HTTP-only cookies from backend
                // No need to store in localStorage or set cookies from frontend

                return {
                  user: output?.user || context.user,
                  error: null,
                  isNewUser: output?.isNewUser ?? context.isNewUser,
                  selfDmChannelId: output?.selfDmChannelId ?? null,
                  landingChannelId: output?.landingChannelId ?? null,
                };
              }),
            },
          ],
          onError: {
            target: 'unauthenticated',
            actions: [
              'clearSessionCookies',
              { type: 'notifySignOut', params: { reason: 'Token validation failed' } },
              assign(() => createClearedContext()),
            ],
          },
        },
      },
      authenticated: {
        entry: ({ context }) => {
          if (context.user?.id) {
            posthogService.identify(context.user);
          }
        },
        on: {
          LOGOUT: {
            target: 'loggingOut',
          },
          COMPLETE_ONBOARDING: {
            actions: [
              assign(({ context }) => ({
                ...context,
                isNewUser: false,
              })),
              'clearOnboardingCookie',
            ],
          },
        },
      },
      loggingOut: {
        invoke: {
          src: 'performLogout',
          onDone: {
            target: 'unauthenticated',
            actions: [
              'clearSessionCookies',
              'trackLogoutSuccess',
              { type: 'notifySignOut', params: { reason: 'User signed out from dashboard' } },
              assign(() => createClearedContext()),
            ],
          },
        },
        on: {
          SESSION_VALIDATED: {
            actions: {
              type: 'setAuthenticatedUser',
            },
          },
          AUTH_ERROR: {
            actions: {
              type: 'setError',
            },
          },
        },
      },
      unauthenticated: {
        on: {
          GOOGLE_SIGNIN: [
            {
              guard: 'isTestEnvironment',
              target: 'testAuthenticating',
            },
            {
              target: 'authenticating',
              actions: {
                type: 'initiateGoogleSignIn',
              },
            },
          ],
          MICROSOFT_SIGNIN: {
            target: 'authenticating',
            actions: {
              type: 'initiateMicrosoftSignIn',
            },
          },
          EMAIL_SIGNIN: {
            target: 'authenticating',
          },
          EMAIL_REGISTER: {
            target: 'registering',
          },
          SESSION_VALIDATED: {
            target: 'authenticated',
            actions: {
              type: 'setAuthenticatedUser',
            },
          },
          OAUTH_CALLBACK_COMPLETE: [
            {
              guard: 'hasPendingWorkspace',
              target: 'joiningWorkspace',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  selectedWorkspaceId: localStorage.getItem(PENDING_WORKSPACE_ID_KEY),
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: null,
                };
              }),
            },
            {
              guard: 'hasLastActiveWorkspace',
              target: 'loggingInToWorkspace',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                const email = output?.pendingUserData?.email;
                const lastWorkspaceId = email ? getLastActiveWorkspaceId(email) : null;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  selectedWorkspaceId: lastWorkspaceId,
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: null,
                };
              }),
            },
            {
              guard: 'hasWorkspaces',
              target: 'selectingWorkspace',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: null,
                };
              }),
            },
            {
              target: 'creatingOrg',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                return {
                  ...context,
                  workspaces: [],
                  pendingUserData: output?.pendingUserData || null,
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: null,
                };
              }),
            },
          ],
          AUTH_ERROR: {
            actions: {
              type: 'setError',
            },
          },
          CLEAR_ERROR: {
            actions: {
              type: 'clearError',
            },
          },
        },
      },
      authenticating: {
        on: {
          GOOGLE_SIGNIN: {
            actions: {
              type: 'initiateGoogleSignIn',
            },
          },
          SESSION_VALIDATED: {
            target: 'authenticated',
            actions: {
              type: 'setAuthenticatedUser',
            },
          },
          OAUTH_CALLBACK_COMPLETE: [
            {
              guard: 'hasPendingWorkspace',
              target: 'joiningWorkspace',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  selectedWorkspaceId: localStorage.getItem(PENDING_WORKSPACE_ID_KEY),
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: null,
                };
              }),
            },
            {
              // Single-workspace auto-login (e.g. email login with exactly one workspace):
              // skip the picker and log straight into the returned workspace, mirroring OAuth.
              guard: 'hasAutoLoginWorkspace',
              target: 'loggingInToWorkspace',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  selectedWorkspaceId: output?.autoLoginWorkspace || null,
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: null,
                };
              }),
            },
            {
              guard: 'hasLastActiveWorkspace',
              target: 'loggingInToWorkspace',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                const email = output?.pendingUserData?.email;
                const lastWorkspaceId = email ? getLastActiveWorkspaceId(email) : null;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  selectedWorkspaceId: lastWorkspaceId,
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: null,
                };
              }),
            },
            {
              guard: 'hasWorkspaces',
              target: 'selectingWorkspace',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: null,
                };
              }),
            },
            {
              target: 'creatingOrg',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                return {
                  ...context,
                  workspaces: [],
                  pendingUserData: output?.pendingUserData || null,
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: null,
                };
              }),
            },
          ],
          AUTH_ERROR: {
            target: 'unauthenticated',
            actions: {
              type: 'setError',
            },
          },
          CLEAR_ERROR: {
            actions: {
              type: 'clearError',
            },
          },
          LOGOUT: {
            target: 'unauthenticated',
            actions: [
              'clearSessionCookies',
              { type: 'notifySignOut', params: { reason: 'User canceled sign-in' } },
              assign(() => createClearedContext()),
            ],
          },
        },
      },
      registering: {
        on: {
          OAUTH_CALLBACK_COMPLETE: [
            {
              guard: 'hasPendingWorkspace',
              target: 'joiningWorkspace',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  selectedWorkspaceId: localStorage.getItem(PENDING_WORKSPACE_ID_KEY),
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: null,
                };
              }),
            },
            {
              guard: 'hasLastActiveWorkspace',
              target: 'loggingInToWorkspace',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                const email = output?.pendingUserData?.email;
                const lastWorkspaceId = email ? getLastActiveWorkspaceId(email) : null;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  selectedWorkspaceId: lastWorkspaceId,
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: null,
                };
              }),
            },
            {
              guard: 'hasWorkspaces',
              target: 'selectingWorkspace',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                return {
                  ...context,
                  workspaces: getWorkspaces(output),
                  pendingUserData: output?.pendingUserData || null,
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: null,
                };
              }),
            },
            {
              target: 'creatingOrg',
              actions: assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                return {
                  ...context,
                  workspaces: [],
                  pendingUserData: output?.pendingUserData || null,
                  userExistsButRemoved: output?.userExistsButRemoved || false,
                  error: null,
                };
              }),
            },
          ],
          AUTH_ERROR: {
            target: 'unauthenticated',
            actions: {
              type: 'setError',
            },
          },
          CLEAR_ERROR: {
            actions: {
              type: 'clearError',
            },
          },
          LOGOUT: {
            target: 'unauthenticated',
            actions: [
              'clearSessionCookies',
              { type: 'notifySignOut', params: { reason: 'User canceled registration' } },
              assign(() => createClearedContext()),
            ],
          },
        },
      },
      testAuthenticating: {
        invoke: {
          src: 'performTestLogin',
          onDone: {
            target: 'authenticated',
            actions: [
              assign(({ context, event }) => {
                const output = (event as XStateEvent).output;
                if (output?.user) {
                  localStorage.setItem('user_id', output.user.id);
                  if (output.user.email) {
                    localStorage.setItem('user_email', output.user.email);
                    if (window.electronAPI?.setUserEmail) {
                      window.electronAPI.setUserEmail(output.user.email);
                    }
                    if (output.user.workspaceId) {
                      setLastActiveWorkspaceId(output.user.email, output.user.workspaceId);
                    }
                  }
                }
                return {
                  user: output?.user || context.user,
                  error: null,
                  isNewUser: output?.isNewUser ?? context.isNewUser,
                };
              }),
              'trackLoginSuccess',
            ],
          },
          onError: {
            target: 'unauthenticated',
            actions: 'setError',
          },
        },
      },
    },
  },
  {
    guards: {
      hasOAuthCallback: () => {
        // Skip OAuth callback processing for the launch screen
        if (window.location.pathname.startsWith('/launch')) {
          return false;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const hasCallback =
          urlParams.has('success') || urlParams.has('error') || urlParams.has('code');

        return hasCallback;
      },
      hasStoredSession: () => {
        const userId = localStorage.getItem('user_id');
        return !!userId;
      },
      isTestEnvironment: () => isTestEnv,
      hasUserInOutput: ({ event }) => {
        const e = event as { output?: OAuthCallbackOutput };
        return !!e.output?.user?.id;
      },
      hasPendingInvitationInStorage: ({ event }) => {
        const e = event as { output?: OAuthCallbackOutput };
        // Only check for pending invitation if we have a valid OAuth callback
        if (!e.output?.pendingUserData?.email) return false;
        // Check localStorage for pending invitation (set by AcceptInvitation.tsx)
        const pendingInvitationId = localStorage.getItem('pending_invitation_id');
        return !!pendingInvitationId;
      },
      hasPendingWorkspace: ({ event }) => {
        const e = event as { output?: OAuthCallbackOutput };
        if (!e.output?.pendingUserData?.email) return false;
        return !!localStorage.getItem(PENDING_WORKSPACE_ID_KEY);
      },
      isCommunityJoinRequest: ({ event }) => {
        const e = event as {
          output?: { communityJoinRequest?: { status?: string } };
        };
        return (
          e.output?.communityJoinRequest?.status === CommunityJoinResultStatus.REQUEST_PENDING ||
          e.output?.communityJoinRequest?.status === CommunityJoinResultStatus.REQUEST_REJECTED
        );
      },
      hasPendingWorkspaceAfterSessionValidation: ({ event }) => {
        const e = event as { output?: OAuthCallbackOutput };
        if (!e.output?.user?.id) return false;
        return !!localStorage.getItem(PENDING_WORKSPACE_ID_KEY);
      },
      hasLastActiveWorkspace: ({ event }) => {
        const e = event as { output?: OAuthCallbackOutput };
        const email = e.output?.pendingUserData?.email;
        if (!email) return false;
        const lastWorkspaceId = getLastActiveWorkspaceId(email);
        if (!lastWorkspaceId) return false;
        return getWorkspaces(e.output).some(
          (workspace: Workspace) => workspace.id === lastWorkspaceId,
        );
      },
      hasWorkspaces: ({ event }) => {
        const e = event as { output?: OAuthCallbackOutput };
        return getWorkspaces(e.output).length > 0;
      },
      hasAutoLoginWorkspace: ({ event }) => {
        const e = event as { output?: OAuthCallbackOutput };
        return !!e.output?.autoLoginWorkspace;
      },
    },
    actions: {
      clearSessionCookies: () => {
        clearPersistedSession();
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_email');
        localStorage.removeItem(PENDING_WORKSPACE_ID_KEY);
        localStorage.removeItem(PENDING_WORKSPACE_NAME_KEY);
        clearOnboardingCookie();
        decryptionCache.clear();
        resetEncryption();
        resetGlobalEncryptionBootstrap();
        void clearAllSessionKeys();
      },
      clearOnboardingCookie: () => {
        clearOnboardingCookie();
      },
      clearError: ({ context }) => {
        context.error = null;
      },
      setError: ({ context, event }) => {
        const enrichedEvent = event as Partial<{ error: Error; message: string }>;
        const fallbackMessage =
          typeof enrichedEvent.message === 'string'
            ? enrichedEvent.message
            : enrichedEvent.error?.message;
        context.error = fallbackMessage || 'Authentication failed';
        context.user = null;
      },
      initiateGoogleSignIn: () => {
        try {
          if (reactNativeBridge.isAvailable()) {
            reactNativeBridge.initialize();
            const dispatched = reactNativeBridge.requestGoogleSignIn({
              reason: 'User requested sign-in inside React Native host',
            });
            if (dispatched) {
              return;
            }
          }
        } catch {
          // Fall through to web OAuth flow if native bridge interaction fails
        }

        try {
          const isElectron = typeof window.electronAPI?.openExternal === 'function';

          // Read invitationId from current URL (for invitation flow)
          const urlParams = new URLSearchParams(window.location.search);
          const urlInvitationId = urlParams.get('invitationId');

          // Fallback to localStorage if not in URL (for Electron flow after authMachine navigation)
          const storageInvitationId = localStorage.getItem('pending_invitation_id');
          const invitationId = urlInvitationId || storageInvitationId;

          const loginParams = new URLSearchParams();
          if (isElectron) {
            loginParams.set('platform', 'electron');
          }
          if (invitationId) {
            loginParams.set('invitationId', invitationId);
          }
          const loginQuery = loginParams.toString();
          const loginUrl = `${API_BASE_URL}/auth/login${loginQuery ? `?${loginQuery}` : ''}`;

          if (isElectron && window.electronAPI) {
            window.electronAPI.openExternal(loginUrl);
          } else {
            window.location.href = loginUrl;
          }
        } catch {
          // Ignore Google Sign-In initiation errors
        }
      },
      initiateMicrosoftSignIn: () => {
        try {
          if (reactNativeBridge.isAvailable()) {
            reactNativeBridge.initialize();
            const dispatched = reactNativeBridge.requestMicrosoftSignIn({
              reason: 'User requested sign-in inside React Native host',
            });
            if (dispatched) {
              return;
            }
          }
        } catch {
          // Fall through to web OAuth flow if native bridge interaction fails
        }

        try {
          const isElectron = typeof window.electronAPI?.openExternal === 'function';

          // Read invitationId from current URL (for invitation flow)
          const urlParams = new URLSearchParams(window.location.search);
          const urlInvitationId = urlParams.get('invitationId');

          // Fallback to localStorage if not in URL (for Electron flow after authMachine navigation)
          const storageInvitationId = localStorage.getItem('pending_invitation_id');
          const invitationId = urlInvitationId || storageInvitationId;

          const loginParams = new URLSearchParams();
          if (isElectron) {
            loginParams.set('platform', 'electron');
          }
          if (invitationId) {
            loginParams.set('invitationId', invitationId);
          }
          const loginQuery = loginParams.toString();
          const loginUrl = `${API_BASE_URL}/v2/auth/microsoft/login${loginQuery ? `?${loginQuery}` : ''}`;

          if (isElectron && window.electronAPI) {
            window.electronAPI.openExternal(loginUrl);
          } else {
            window.location.href = loginUrl;
          }
        } catch {
          // Ignore Microsoft Sign-In initiation errors
        }
      },
      setAuthenticatedUser: assign(({ context, event }) => {
        if (event.type !== 'SESSION_VALIDATED') {
          return context;
        }

        try {
          if (event.user?.id) {
            localStorage.setItem('user_id', event.user.id);
          }
          if (event.user?.email) {
            localStorage.setItem('user_email', event.user.email);
            if (window.electronAPI?.setUserEmail) {
              window.electronAPI.setUserEmail(event.user.email);
            }
          }
        } catch {
          // Silently ignore localStorage write failures (Safari private mode, etc.)
        }

        return {
          ...context,
          user: event.user,
          error: null,
          isNewUser: event.isNewUser ?? context.isNewUser,
        };
      }),
      trackLoginSuccess: ({ context }) => {
        if (context.user?.id) {
          posthogService.identify(context.user);
          posthogService.capture(EVENTS.AUTHENTICATION, {
            type: EVENT_PROPERTIES.AUTH_TYPES.LOGIN,
          });
        }
      },
      trackLogoutSuccess: () => {
        posthogService.capture(EVENTS.AUTHENTICATION, {
          type: EVENT_PROPERTIES.AUTH_TYPES.LOGOUT,
        });
        posthogService.reset();
      },
    },
    actors: {
      performLogout: fromPromise(async () => {
        try {
          await axios.post(
            `${API_BASE_URL}/auth/logout`,
            {},
            {
              withCredentials: true,
              headers: {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'Content-Type': 'application/json',
              },
            },
          );
        } catch {
          /* empty */
        }

        // Logout is the one place a cross-lane drop is right: both bundles are going
        // away. The lane must not take out its host's store, so it only drops its own.
        await (isSdlcSurface ? dropZeroDatabases() : dropAllZeroDatabases());
        await indexedDBService.dropAllUserDatabases();
      }),
      processOAuthCallback: fromPromise(async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const success = urlParams.get('success');
        const error = urlParams.get('error');
        const errorMessage = urlParams.get('message');
        const workspacesJson = urlParams.get('workspaces');
        const email = urlParams.get('email');
        const name = urlParams.get('name');
        const picture = urlParams.get('picture');
        const autoLoginWorkspace = urlParams.get('autoLoginWorkspace');
        const userExistsButRemoved = urlParams.get('userExistsButRemoved') === 'true';
        const domainConflictError = urlParams.get('domainConflictError') || undefined;
        const publicEmailDomainError = urlParams.get('publicEmailDomainError') || undefined;
        const enterpriseJoinOrgName = urlParams.get('enterpriseJoinOrgName') || undefined;
        const enterpriseJoinWorkspaces = urlParams.get('enterpriseJoinWorkspaces') || undefined;

        window.history.replaceState(window.history.state, document.title, window.location.pathname);

        if (error) {
          return Promise.reject(new Error(`Authentication failed: ${errorMessage || error}`));
        }

        if (success === 'true' && email && name) {
          // Parse workspaces from URL
          let workspaces: Workspace[] = [];
          try {
            if (workspacesJson) {
              workspaces = JSON.parse(workspacesJson) as Workspace[];
            }
          } catch {
            workspaces = [];
          }

          return Promise.resolve({
            workspaces,
            pendingUserData: { email, name, picture: picture || undefined },
            autoLoginWorkspace: autoLoginWorkspace || undefined,
            userExistsButRemoved,
            domainConflictError,
            publicEmailDomainError,
            enterpriseJoinOrgName,
            enterpriseJoinWorkspaces,
          });
        }

        return Promise.reject(new Error('No valid OAuth callback parameters found'));
      }),
      loginWorkspace: fromPromise(async ({ input }: { input: { workspaceId: string } }) => {
        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };
          headers['x-request-id'] = uuidv4();
          if (logger.zeroClientId) {
            headers['x-client-id'] = logger.zeroClientId;
          }
          if (logger.zeroClientGroupId) {
            headers['x-zero-client-group-id'] = logger.zeroClientGroupId;
          }
          const userEmail = logger.emailId;
          if (userEmail) {
            headers['x-user-email'] = userEmail;
          }

          const response = await axios.post(
            `${API_BASE_URL}/auth/login-workspace`,
            { workspaceId: input.workspaceId },
            {
              withCredentials: true,
              headers,
            },
          );

          const data = response.data as {
            user: User;
            isNewUser?: boolean;
            selfDmChannelId?: string;
            landingChannelId?: string | null;
          };
          if (data.user) {
            return {
              user: data.user,
              isNewUser: data.isNewUser ?? false,
              selfDmChannelId: data.selfDmChannelId,
              landingChannelId: data.landingChannelId ?? null,
            };
          }
          throw new Error('Login to workspace failed: No user data');
        } catch (error) {
          if (axios.isAxiosError(error)) {
            const errorData = error.response?.data as { error?: string; message?: string };
            throw new Error(
              errorData?.message || errorData?.error || 'Failed to login to workspace',
            );
          }
          throw new Error('Failed to login to workspace');
        }
      }),
      joinWorkspace: fromPromise(async ({ input }: { input: { workspaceId: string } }) => {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        headers['x-request-id'] = uuidv4();
        if (logger.zeroClientId) {
          headers['x-client-id'] = logger.zeroClientId;
        }
        if (logger.zeroClientGroupId) {
          headers['x-zero-client-group-id'] = logger.zeroClientGroupId;
        }
        const userEmail = logger.emailId;
        if (userEmail) {
          headers['x-user-email'] = userEmail;
        }

        try {
          const typeResponse = await axios.get(
            `${API_BASE_URL}/public/workspace-type?workspaceId=${encodeURIComponent(input.workspaceId)}`,
          );
          const workspaceType = (typeResponse.data as { workspaceType?: string })?.workspaceType;

          if (workspaceType === WorkspaceType.COMMUNITY) {
            const response = await axios.post(
              `${API_BASE_URL}/community/${input.workspaceId}/join`,
              {},
              { withCredentials: true, headers },
            );

            const data = response.data as {
              user?: User;
              status?: CommunityJoinResultStatusType;
              isNewUser?: boolean;
              selfDmChannelId?: string;
              landingChannelId?: string | null;
              joinRequest?: {
                id: string;
                status: string;
                isExisting?: boolean;
              };
            };
            if (data.user) {
              return {
                user: data.user,
                isNewUser: data.isNewUser ?? false,
                selfDmChannelId: data.selfDmChannelId,
                landingChannelId: data.landingChannelId ?? null,
              };
            }
            if (
              (data.status === CommunityJoinResultStatus.REQUEST_PENDING ||
                data.status === CommunityJoinResultStatus.REQUEST_REJECTED) &&
              data.joinRequest
            ) {
              return {
                communityJoinRequest: {
                  requestId: data.joinRequest.id,
                  status: data.status,
                  isExisting: data.joinRequest.isExisting,
                },
              };
            }
            throw new Error('Community workspace join failed: No user data');
          }

          const response = await axios.post(
            `${API_BASE_URL}/auth/login-workspace`,
            { workspaceId: input.workspaceId },
            { withCredentials: true, headers },
          );

          const data = response.data as {
            user: User;
            isNewUser?: boolean;
            selfDmChannelId?: string;
            landingChannelId?: string | null;
            joinRequest?: {
              id: string;
              status: string;
              isExisting?: boolean;
            };
          };
          if (data.user) {
            return {
              user: data.user,
              isNewUser: data.isNewUser ?? false,
              selfDmChannelId: data.selfDmChannelId,
              landingChannelId: data.landingChannelId ?? null,
            };
          }
          throw new Error('Login to workspace failed: No user data');
        } catch (error) {
          if (axios.isAxiosError(error)) {
            const errorData = error.response?.data as { error?: string; message?: string };
            throw new Error(errorData?.message || errorData?.error || 'Failed to join workspace');
          }
          throw new Error('Failed to join workspace');
        }
      }),
      createOrg: fromPromise(
        async ({ input }: { input: { orgName: string; workspaceName: string } }) => {
          try {
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            headers['x-request-id'] = uuidv4();
            if (logger.zeroClientId) {
              headers['x-client-id'] = logger.zeroClientId;
            }
            if (logger.zeroClientGroupId) {
              headers['x-zero-client-group-id'] = logger.zeroClientGroupId;
            }
            const userEmail = logger.emailId;
            if (userEmail) {
              headers['x-user-email'] = userEmail;
            }

            const response = await axios.post(
              `${API_BASE_URL}/auth/create-org`,
              { orgName: input.orgName, workspaceName: input.workspaceName },
              {
                withCredentials: true,
                headers,
              },
            );

            const data = response.data as {
              user: User;
              isNewUser?: boolean;
              selfDmChannelId?: string;
              landingChannelId?: string | null;
            };
            if (data.user) {
              return {
                user: data.user,
                isNewUser: true,
                selfDmChannelId: data.selfDmChannelId,
                landingChannelId: data.landingChannelId ?? null,
              };
            }
            throw new Error('Create org failed: No user data');
          } catch (error) {
            if (axios.isAxiosError(error)) {
              const errorData = error.response?.data as { error?: string; message?: string };
              throw new Error(
                errorData?.message || errorData?.error || 'Failed to create organization',
              );
            }
            throw new Error('Failed to create organization');
          }
        },
      ),
      validateSession: fromPromise(async () => {
        try {
          const headers: Record<string, string> = {};
          headers['x-request-id'] = uuidv4();
          if (logger.zeroClientId) {
            headers['x-client-id'] = logger.zeroClientId;
          }
          if (logger.zeroClientGroupId) {
            headers['x-zero-client-group-id'] = logger.zeroClientGroupId;
          }
          const userEmail = logger.emailId;
          if (userEmail) {
            headers['x-user-email'] = userEmail;
          }
          // Note: Using direct axios call instead of apiInstance
          const response = await axios.get(`${API_BASE_URL}/auth/validate`, {
            withCredentials: true,
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'content-type': 'application/json',
              ...headers,
            },
          });

          const data = response.data as ValidateSessionResponse;

          // Check for is_new_user cookie during session validation
          const isNewUserCookie = Cookies.get('is_new_user');
          const isNewUser = isNewUserCookie === 'true';

          return {
            user: data.user,
            isNewUser: isNewUser,
            selfDmChannelId: data.selfDmChannelId ?? null,
            landingChannelId: data.landingChannelId ?? null,
          };
        } catch (error) {
          if (axios.isAxiosError(error)) {
            const errorData = error.response?.data as ApiErrorResponse;
            throw new Error(
              errorData?.error ||
                `Session validation failed: ${error.response?.status || 'unknown'}`,
            );
          }
          throw new Error('Session validation failed: unknown error');
        }
      }),
      performTestLogin: fromPromise(async () => {
        try {
          const urlParams = new URLSearchParams(window.location.search);
          const email = urlParams.get('email');
          const setAsNewUser = urlParams.get('setAsNewUser');
          const loginParams = new URLSearchParams();

          if (email) {
            loginParams.set('email', email);
          }

          if (setAsNewUser === 'true' || setAsNewUser === 'false') {
            loginParams.set('setAsNewUser', setAsNewUser);
          }

          const queryString = loginParams.toString();

          const response = await axios.post(
            `${API_BASE_URL}/test/auth/login${queryString ? `?${queryString}` : ''}`,
            {},
            {
              withCredentials: true,
              headers: {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'Content-Type': 'application/json',
              },
            },
          );

          const data = response.data as { success: boolean; user: User & { isNewUser: boolean } };
          if (data.success && data.user) {
            return { user: data.user, isNewUser: data.user.isNewUser };
          }
          throw new Error('Test login failed: No user data');
        } catch {
          throw new Error('Test login failed');
        }
      }),
    },
  },
);

export const authActor = createActor(authMachine).start();
