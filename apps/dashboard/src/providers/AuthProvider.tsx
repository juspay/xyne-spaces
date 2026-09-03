import React, { createContext, useContext, ReactNode, useEffect, useCallback, useRef } from 'react';
import { useAuth, UseAuthReturn } from '../hooks/useAuth';
import { authActor, type User, type Workspace } from '../machines/authMachine';
import {
  NativeInboundMessageType,
  type NativeGoogleSignInResultPayload,
  type NativeMicrosoftSignInResultPayload,
  type NativePushTokenPayload,
  reactNativeBridge,
} from '../utils/reactNativeBridge';
import { setupElectronAuthListeners } from '../utils/electronAuth';
import { usePlatform } from '../hooks/usePlatform';
import { apiInstance } from '../services/clients/apiClient';
import { mixpanelService } from '../services/Analytics/mixpanelService';
import { EVENTS, EVENT_PROPERTIES } from '../services/Analytics/mixpanel.types';
import {
  registerNativePushToken,
  unregisterNativePushToken,
} from '../services/notifications/mobilePushService';
import { logger, Event as LoggerEvent } from '../utils/logger';

interface AuthProviderProps {
  children: ReactNode;
}

const AuthContext = createContext<UseAuthReturn | undefined>(undefined);

const buildUserFromPayload = (payload: NativeGoogleSignInResultPayload): User => ({
  id: payload.userId!,
  workspaceId: payload.workspaceId ?? '',
  role: payload.role ?? '',
  orgRole: payload.orgRole ?? '',
  memberId: payload.memberId ?? '',
});

type AuthMeResponse = {
  success: boolean;
  user: User;
};

const isAuthMeResponse = (value: unknown): value is AuthMeResponse => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  const success = record['success'];
  const user = record['user'];

  if (success !== true || !user || typeof user !== 'object') {
    return false;
  }

  const userRecord = user as Record<string, unknown>;
  const id = userRecord['id'];

  return typeof id === 'string' && id.length > 0;
};

const fetchUserFromSession = async (): Promise<User | null> => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const response = await apiInstance.get('/auth/me');
    const data: unknown = response.data;
    if (isAuthMeResponse(data)) {
      return data.user;
    }
  } catch (error) {
    logger.error(LoggerEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('[AUTH] Failed to fetch user via /auth/me after session bootstrap'),
      error: error,
    });
  }

  return null;
};

const hydrateNativeSession = async (sessionId: string | null | undefined): Promise<User | null> => {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!sessionId) {
    return null;
  }

  logger.info(LoggerEvent.FRONTEND_ERROR, {
    type: 'migrated_console_info',
    message: String('[AUTH] Native session injected via cookie, attempting /auth/me fetch'),
    context: [
      {
        sessionId,
      },
    ],
  });
  return fetchUserFromSession();
};

const handleNativeSignInResult = (
  payload: NativeGoogleSignInResultPayload | NativeMicrosoftSignInResultPayload | undefined,
): void => {
  if (!payload) {
    authActor.send({
      type: 'AUTH_ERROR',
      message: 'Native Google Sign-In returned no payload.',
    });
    return;
  }

  if (!payload.success) {
    authActor.send({
      type: 'AUTH_ERROR',
      message: payload.errorMessage || payload.error || 'Native sign-in failed. Please try again.',
    });
    return;
  }

  if (payload.workspaces && payload.workspaces.length > 0 && payload.email) {
    authActor.send({
      type: 'OAUTH_CALLBACK_COMPLETE',
      output: {
        workspaces: payload.workspaces as Workspace[],
        pendingUserData: {
          email: payload.email,
          name: payload.name ?? '',
          ...(payload.picture ? { picture: payload.picture } : {}),
        },
        userExistsButRemoved: payload.userExistsButRemoved || false,
      },
    });
    return;
  }

  if (!payload.sessionId || !payload.userId) {
    authActor.send({
      type: 'AUTH_ERROR',
      message: payload.errorMessage || payload.error || 'Native sign-in failed. Please try again.',
    });
    return;
  }
  const fallbackUser = buildUserFromPayload(payload);

  const processNativeSignIn = async (): Promise<void> => {
    try {
      let user: User | null = fallbackUser;

      if (payload.sessionId) {
        const exchangedUser = await hydrateNativeSession(payload.sessionId);
        if (exchangedUser?.id) {
          user = exchangedUser;
        } else {
          throw new Error(
            'Native session cookie injection succeeded but /auth/me returned no user.',
          );
        }
      } else {
        throw new Error('Native sign-in missing session bootstrap data.');
      }

      if (user?.id) {
        authActor.send({ type: 'SESSION_VALIDATED', user });
      } else {
        throw new Error('Native sign-in returned no valid user id.');
      }
    } catch (error) {
      authActor.send({
        type: 'AUTH_ERROR',
        message:
          error instanceof Error ? error.message : 'Unable to process native sign-in response.',
      });
    }
  };

  void processNativeSignIn();
};

const handleNativeSignOut = (reason?: string): void => {
  authActor.send({ type: 'LOGOUT' });
  if (reason) {
    authActor.send({ type: 'AUTH_ERROR', message: reason });
  }
};

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const auth = useAuth();
  const { user } = auth;
  const { isElectron, isMobile } = usePlatform();

  const pendingNativePushTokenRef = useRef<NativePushTokenPayload | null>(null);
  const registeredNativePushTokenRef = useRef<string | null>(null);
  const requestNativePushToken = useCallback(() => {
    if (!isMobile) {
      return;
    }
    reactNativeBridge.requestNativePushToken();
  }, [isMobile]);

  const ensureNativePushRegistration = useCallback(
    async (incomingPayload?: NativePushTokenPayload | null): Promise<void> => {
      if (!isMobile) {
        pendingNativePushTokenRef.current = incomingPayload ?? pendingNativePushTokenRef.current;
        return;
      }

      if (!user) {
        pendingNativePushTokenRef.current = incomingPayload ?? pendingNativePushTokenRef.current;
        return;
      }

      const payload = incomingPayload ?? pendingNativePushTokenRef.current;
      if (!payload?.token) {
        requestNativePushToken();
        return;
      }

      if (registeredNativePushTokenRef.current === payload.token) {
        return;
      }

      try {
        await registerNativePushToken(payload);
        registeredNativePushTokenRef.current = payload.token;
        pendingNativePushTokenRef.current = null;
      } catch (error) {
        logger.error(LoggerEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[AUTH] Failed to register native push token'),
          error: error,
        });
      }
    },
    [isMobile, requestNativePushToken, user],
  );

  useEffect(() => {
    if (!isElectron) {
      return (): void => undefined;
    }

    const bootstrapElectronSession = async (): Promise<void> => {
      authActor.send({ type: 'CLEAR_ERROR' });

      try {
        const user = await fetchUserFromSession();
        if (user?.id) {
          authActor.send({ type: 'SESSION_VALIDATED', user });

          mixpanelService.track(EVENTS.APP_REFRESH, {
            trigger: EVENT_PROPERTIES.REFRESH_TRIGGERS.AUTH_SUCCESS_REDIRECT,
            url: window.location.href,
          });

          logger.info(LoggerEvent.APP_REFRESH, {
            url: window.location.href,
            trigger: 'AUTH_SUCCESS_REDIRECT',
          });
        } else {
          throw new Error('Electron sign-in succeeded but returned no user data.');
        }
      } catch (error) {
        authActor.send({
          type: 'AUTH_ERROR',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to complete Electron authentication handshake.',
        });
      }
    };

    const cleanup = setupElectronAuthListeners(
      data => {
        if (data?.workspaces && data.email) {
          authActor.send({
            type: 'OAUTH_CALLBACK_COMPLETE',
            output: {
              workspaces: data.workspaces as Workspace[],
              pendingUserData: {
                email: data.email,
                name: data.name,
                ...(data.picture ? { picture: data.picture } : {}),
              },
              userExistsButRemoved: data.userExistsButRemoved || false,
            },
          });
        } else {
          void bootstrapElectronSession();
        }
      },
      () => {
        localStorage.removeItem('user_id');
        authActor.send({ type: 'LOGOUT' });
      },
    );

    return cleanup;
  }, [isElectron]);

  useEffect(() => {
    if (!isMobile) {
      return;
    }

    reactNativeBridge.initialize();
    logger.info(LoggerEvent.FRONTEND_ERROR, {
      type: 'migrated_console_info',
      message: String('[AUTH] React Native WebView detected, wiring native auth bridge'),
    });

    const unsubscribeNativeReady = reactNativeBridge.on(
      NativeInboundMessageType.NATIVE_READY,
      () => {
        logger.info(LoggerEvent.FRONTEND_ERROR, {
          type: 'migrated_console_info',
          message: String('[AUTH] Native host reported ready'),
        });
      },
    );

    const unsubscribeSignInResult = reactNativeBridge.on(
      NativeInboundMessageType.GOOGLE_SIGN_IN_RESULT,
      message => {
        handleNativeSignInResult(message.payload);
      },
    );

    const unsubscribeMicrosoftSignInResult = reactNativeBridge.on(
      NativeInboundMessageType.MICROSOFT_SIGN_IN_RESULT,
      message => {
        handleNativeSignInResult(message.payload);
      },
    );

    const unsubscribeNativeSignOut = reactNativeBridge.on(
      NativeInboundMessageType.NATIVE_SIGN_OUT,
      message => {
        handleNativeSignOut(message.payload?.reason);
      },
    );

    const unsubscribeNativePushToken = reactNativeBridge.on(
      NativeInboundMessageType.NATIVE_PUSH_TOKEN,
      message => {
        pendingNativePushTokenRef.current = message.payload ?? null;
        void ensureNativePushRegistration(message.payload ?? null);
      },
    );

    return (): void => {
      unsubscribeNativeReady();
      unsubscribeSignInResult();
      unsubscribeMicrosoftSignInResult();
      unsubscribeNativeSignOut();
      unsubscribeNativePushToken();
      reactNativeBridge.dispose();
    };
  }, [isMobile, ensureNativePushRegistration, requestNativePushToken]);

  useEffect(() => {
    if (!isMobile) {
      return;
    }

    if (!user) {
      const lastToken = registeredNativePushTokenRef.current;
      if (lastToken) {
        void unregisterNativePushToken().catch(error => {
          logger.error(LoggerEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('[AUTH] Failed to unregister native push token'),
            error: error,
          });
        });
        registeredNativePushTokenRef.current = null;
      }
      return;
    }

    void ensureNativePushRegistration();
  }, [user, isMobile, ensureNativePushRegistration]);

  useEffect(() => {
    if (!isMobile) {
      return;
    }

    reactNativeBridge.syncAuthState({
      isAuthenticated: !!user,
      user: user
        ? {
            id: user.id,
            email: user.email ?? null,
          }
        : null,
    });
  }, [user, isMobile]);

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
};

export const useAuthContext = (): UseAuthReturn => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};

// Export both hooks for convenience
export { useAuth };
