import { createMachine, createActor, fromPromise, assign } from 'xstate';
import Cookies from 'js-cookie';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { reactNativeBridge } from '../utils/reactNativeBridge';
import { mixpanelService, EVENTS, EVENT_PROPERTIES } from '../services/Analytics/mixpanelService';
import { API_BASE_URL, isTestEnv } from '../config';
import { logger } from '../utils/logger';

export interface User {
  id: string;
  name?: string;
  email?: string;
  googleId?: string;
  [key: string]: string | undefined;
}

interface AuthContext {
  user: User | null;
  error: string | null;
  isNewUser: boolean;
}

type AuthEvent =
  | { type: 'GOOGLE_SIGNIN' }
  | { type: 'LOGOUT' }
  | { type: 'SESSION_VALIDATED'; user: User; isNewUser?: boolean }
  | { type: 'AUTH_ERROR'; message: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'COMPLETE_ONBOARDING' };

export type AuthState =
  | 'checkingSession'
  | 'authenticated'
  | 'unauthenticated'
  | 'authenticating'
  | 'loggingOut'
  | 'validatingSession'
  | 'processingOAuthCallback'
  | 'testAuthenticating';

interface ValidateSessionResponse {
  user: User;
}

interface ApiErrorResponse {
  error: string;
}

interface OAuthCallbackOutput {
  user: User;
}

interface XStateEvent {
  type: string;
  output?: OAuthCallbackOutput & { isNewUser?: boolean };
}

const clearPersistedSession = (): void => {
  Cookies.remove('user_data');
  Cookies.remove('user_name');
  Cookies.remove('user_email');
};

const clearOnboardingCookie = (): void => {
  Cookies.remove('is_new_user');
};

const createClearedContext = (): AuthContext => ({
  user: null,
  error: null,
  isNewUser: false,
});

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
    },
    states: {
      checkingSession: {
        entry: assign(({ context: _context }) => {
          const userId = localStorage.getItem('user_id');
          const userEmail = localStorage.getItem('user_email');

          let user = null;

          if (userId) {
            user = { id: userId, ...(userEmail && { email: userEmail }) };
          }

          // Check for is_new_user cookie
          const isNewUserCookie = Cookies.get('is_new_user');
          const isNewUser = isNewUserCookie === 'true';

          return {
            user: user,
            error: null,
            isNewUser: isNewUser,
          };
        }),
        always: [
          {
            target: 'processingOAuthCallback',
            guard: 'hasOAuthCallback',
          },
          {
            target: 'authenticated',
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
          onDone: {
            target: 'authenticated',
            actions: [
              assign(({ context, event }) => {
                const output = (event as XStateEvent).output;

                if (output?.user) {
                  // Store user data in cookies
                  localStorage.setItem('user_id', output.user.id);
                  if (output.user.email) {
                    localStorage.setItem('user_email', output.user.email);
                    // Send email to Electron for logging (only during initial OAuth login)
                    if (window.electronAPI?.setUserEmail) {
                      window.electronAPI.setUserEmail(output.user.email);
                    }
                  }
                }

                // Session tokens are set via HTTP-only cookies from backend
                // No need to store in localStorage or set cookies from frontend

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
      validatingSession: {
        invoke: {
          src: 'validateSession',
          onDone: {
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
              };
            }),
          },
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
            mixpanelService.identify(context.user);
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
          SESSION_VALIDATED: {
            target: 'authenticated',
            actions: {
              type: 'setAuthenticatedUser',
            },
          },
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
    },
    actions: {
      clearSessionCookies: () => {
        clearPersistedSession();
        localStorage.removeItem('user_id');
        localStorage.removeItem('user_email');
        clearOnboardingCookie();
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
          const loginUrl = isElectron
            ? `${API_BASE_URL}/auth/login?platform=electron`
            : `${API_BASE_URL}/auth/login`;

          if (isElectron && window.electronAPI) {
            window.electronAPI.openExternal(loginUrl);
          } else {
            window.location.href = loginUrl;
          }
        } catch {
          // Ignore Google Sign-In initiation errors
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
          mixpanelService.identify(context.user);
          mixpanelService.track(EVENTS.AUTHENTICATION, {
            type: EVENT_PROPERTIES.AUTH_TYPES.LOGIN,
          });
        }
      },
      trackLogoutSuccess: () => {
        mixpanelService.track(EVENTS.AUTHENTICATION, {
          type: EVENT_PROPERTIES.AUTH_TYPES.LOGOUT,
        });
        mixpanelService.reset();
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
      }),
      processOAuthCallback: fromPromise(async () => {
        const urlParams = new URLSearchParams(window.location.search);
        const success = urlParams.get('success');
        const error = urlParams.get('error');
        const errorMessage = urlParams.get('message');

        window.history.replaceState({}, document.title, window.location.pathname);

        if (error) {
          return Promise.reject(new Error(`Authentication failed: ${errorMessage || error}`));
        }

        if (success === 'true') {
          try {
            const headers: Record<string, string> = {};
            headers['x-request-id'] = uuidv4();
            if (logger.zeroClientID) {
              headers['x-client-id'] = logger.zeroClientID;
            }
            if (logger.zeroClientGroupID) {
              headers['x-zero-client-group-id'] = logger.zeroClientGroupID;
            }
            const userEmail = logger.emailId;
            if (userEmail) {
              headers['x-user-email'] = userEmail;
            }
            // Note: Using direct axios call instead of apiInstance
            const response = await axios.get(`${API_BASE_URL}/auth/me`, {
              withCredentials: true,
              headers: {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                'Content-Type': 'application/json',
                ...headers,
              },
            });

            const data = response.data as { success: boolean; user: User };
            if (data.success && data.user) {
              // Check for is_new_user cookie after successful auth
              const isNewUserCookie = Cookies.get('is_new_user');
              const isNewUser = isNewUserCookie === 'true';

              return Promise.resolve({ user: data.user, isNewUser });
            }

            return Promise.reject(new Error('Failed to fetch user data'));
          } catch {
            return Promise.reject(new Error('Failed to fetch user data after OAuth callback'));
          }
        }

        return Promise.reject(new Error('No valid OAuth callback parameters found'));
      }),
      validateSession: fromPromise(async () => {
        try {
          const headers: Record<string, string> = {};
          headers['x-request-id'] = uuidv4();
          if (logger.zeroClientID) {
            headers['x-client-id'] = logger.zeroClientID;
          }
          if (logger.zeroClientGroupID) {
            headers['x-zero-client-group-id'] = logger.zeroClientGroupID;
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
          const isAdmin = urlParams.get('isAdmin') === 'true';

          const response = await axios.post(
            `${API_BASE_URL}/test/auth/login${isAdmin ? '?isAdmin=true' : ''}`,
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
