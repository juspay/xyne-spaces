import { ReactElement, ReactNode, useEffect, useRef, useState } from 'react';
import { ZeroProvider as ZeroReactProvider } from '@rocicorp/zero/react';
import { dropAllDatabases, UpdateNeededReason, Zero } from '@rocicorp/zero';
import { useSelector } from '@xstate/react';

import { schema } from '@xyne/shared';
import { stateMachineActor } from '@xyne/shared/machines';
import { ZERO_SERVER_URL } from '@/src/config';
import { useAuth } from '@/src/contexts/AuthContext';
import { ProtectedStartupScreen } from '@/src/components/startup/ProtectedStartupScreen';
import { mutators } from '../zero/mutators';
import { initializeMtlsTransport } from '../utils/mtlsTransport';
import {
  consumeDropDatabasesOnZeroInit,
  isWorkspaceSwitchInProgress,
} from '@/src/services/workspaceSessionReset';
import {
  decodeAuthJwtClaims,
  isTokenExpiringSoon,
  resolveAccessToken,
  type ResolvedAccessToken,
} from '@/src/services/authToken';
import { trackZeroConnectionDuration } from '@/src/utils/zeroConnectionTiming';
import { subscribeZeroConnectedHeartbeat } from '@/src/utils/zeroConnectedHeartbeat';
import { LotusZeroFallbackProvider } from './LotusZeroFallbackProvider';
import {
  ensureReactNativeDocumentVisibleForZero,
  requestZeroClientRefresh,
} from './zeroClientState';

interface ZeroProviderProps {
  children: ReactNode;
}

type ResolvedZeroAuthToken = {
  token: string;
  userId: string;
  workspaceId: string;
};

const getWorkspaceKey = (workspaceId: string | undefined): string => workspaceId ?? '';

const tokenMatchesWorkspace = (token: string, workspaceId: string | undefined): boolean => {
  if (!workspaceId) {
    return false;
  }
  return decodeAuthJwtClaims(token)?.workspaceId === workspaceId;
};

const resolvedAccessTokenMatchesWorkspace = (
  resolved: ResolvedAccessToken,
  workspaceId: string | undefined,
): boolean => {
  if (!resolved.token || !workspaceId) {
    return false;
  }
  if (resolved.claims?.workspaceId) {
    return resolved.claims.workspaceId === workspaceId;
  }
  if (resolved.cookieWorkspaceId === workspaceId) {
    return true;
  }
  return false;
};

const ZeroProvider: React.FC<ZeroProviderProps> = ({ children }): ReactElement | null => {
  const { user, token } = useAuth();
  const refreshCount = useSelector(stateMachineActor, state => state.context.zeroRefreshCounter);
  const prevWorkspaceIdRef = useRef<string | undefined>(undefined);
  const unsubscribeConnectionTimingRef = useRef<(() => void) | null>(null);
  const unsubscribeHeartbeatRef = useRef<(() => void) | null>(null);
  const zeroRef = useRef<Zero | null>(null);
  const zeroAuthTokenRef = useRef<string | null>(null);

  const [resolvedToken, setResolvedToken] = useState<ResolvedZeroAuthToken | null>(null);
  const [zero, setZero] = useState<Zero | null>(null);

  const uid = user?.user_id ?? null;
  const workspaceId = user?.workspaceId;
  // Auth verification replaces the user object on cold start. Track only the
  // values captured by Zero so identical verified data cannot rebuild it.
  const role = user?.role ?? '';
  const orgRole = user?.orgRole ?? '';
  const memberId = user?.memberId ?? '';
  const currentWorkspaceId = workspaceId ?? '';
  const resolvedAuthToken =
    workspaceId && resolvedToken?.userId === uid && resolvedToken.workspaceId === currentWorkspaceId
      ? resolvedToken.token
      : null;
  const hasResolvedAuthToken = resolvedAuthToken !== null;
  const resolvedAuthTokenRef = useRef(resolvedAuthToken);
  resolvedAuthTokenRef.current = resolvedAuthToken;

  useEffect(() => {
    let cancelled = false;

    if (!token || !uid || !workspaceId) {
      setResolvedToken(prev => (prev === null ? prev : null));
      return;
    }

    const workspaceKey = getWorkspaceKey(workspaceId);
    const setCurrentResolvedToken = (nextToken: string): void => {
      setResolvedToken(prev => {
        if (prev?.token === nextToken && prev.userId === uid && prev.workspaceId === workspaceKey) {
          return prev;
        }
        return {
          token: nextToken,
          userId: uid,
          workspaceId: workspaceKey,
        };
      });
    };

    void (async (): Promise<void> => {
      const tokenMatchesCurrentWorkspace = tokenMatchesWorkspace(token, workspaceId);
      const tokenIsFresh = !isTokenExpiringSoon(token, 60);

      // Use the in-memory token immediately only when it is valid for this workspace.
      // Otherwise Zero can connect with a stale workspace JWT and enter needs-auth.
      if (tokenMatchesCurrentWorkspace) {
        setCurrentResolvedToken(token);
      } else {
        setResolvedToken(prev => (prev === null ? prev : null));
      }

      if (tokenMatchesCurrentWorkspace && tokenIsFresh) {
        return;
      }

      const nextToken = await resolveAccessToken({
        minValiditySeconds: 60,
        ...(workspaceId ? { preferredWorkspaceId: workspaceId } : {}),
      });
      if (
        !cancelled &&
        nextToken.token &&
        resolvedAccessTokenMatchesWorkspace(nextToken, workspaceId)
      ) {
        setCurrentResolvedToken(nextToken.token);
      }
    })();

    return (): void => {
      cancelled = true;
    };
  }, [token, uid, workspaceId, refreshCount]);

  useEffect(() => {
    if (!uid || !workspaceId || !resolvedAuthTokenRef.current) {
      unsubscribeConnectionTimingRef.current?.();
      unsubscribeConnectionTimingRef.current = null;
      unsubscribeHeartbeatRef.current?.();
      unsubscribeHeartbeatRef.current = null;
      setZero(null);
      return;
    }

    const prevWorkspaceId = prevWorkspaceIdRef.current;
    prevWorkspaceIdRef.current = currentWorkspaceId;

    let cancelled = false;

    const initZero = async (): Promise<void> => {
      const previousZero = zeroRef.current;
      zeroRef.current = null;
      zeroAuthTokenRef.current = null;
      if (previousZero) {
        try {
          await previousZero.close();
        } catch {
          // ignore
        }
      }

      const shouldDropDatabases =
        (prevWorkspaceId !== undefined && prevWorkspaceId !== currentWorkspaceId) ||
        consumeDropDatabasesOnZeroInit();
      if (shouldDropDatabases) {
        try {
          await dropAllDatabases();
        } catch {
          // ignore
        }
      }

      if (cancelled) {
        return;
      }

      const authToken = resolvedAuthTokenRef.current;
      if (!authToken) {
        return;
      }

      initializeMtlsTransport();
      ensureReactNativeDocumentVisibleForZero();
      const zeroObj = new Zero({
        userID: uid,
        auth: authToken,
        server: ZERO_SERVER_URL,
        schema,
        mutators,
        // RN often polyfills `document` as hidden. 60s here closed the socket
        // while the app was open, then opening a chat waited on a full reconnect.
        hiddenTabDisconnectDelay: 24 * 60 * 60 * 1000,
        pingTimeoutMs: 10_000,
        context: {
          userID: uid,
          workspaceId: currentWorkspaceId,
          role,
          orgRole,
          memberId,
        },
        maxHeaderLength: 3072,
        // In-memory kvStore skips op-sqlite hydration — Zero cold-connect
        // drops from ~5s to ~1s. Persistence is handled by the app's own
        // MMKV query cache; Zero only needs enough state for the session.
        kvStore: 'mem',
        onUpdateNeeded: (reason: UpdateNeededReason) => {
          if (
            reason.type === 'SchemaVersionNotSupported' ||
            reason.type === 'VersionNotSupported'
          ) {
            // void dropAllDatabases();
          }
        },
        onClientStateNotFound: () => {
          if (!requestZeroClientRefresh()) return;
          stateMachineActor.send({ type: 'REFRESH_ZERO' });
        },
      });

      if (cancelled) {
        void zeroObj.close();
        return;
      }

      unsubscribeConnectionTimingRef.current?.();
      unsubscribeConnectionTimingRef.current = trackZeroConnectionDuration(zeroObj);

      unsubscribeHeartbeatRef.current?.();
      unsubscribeHeartbeatRef.current = subscribeZeroConnectedHeartbeat(zeroObj);

      zeroRef.current = zeroObj;
      zeroAuthTokenRef.current = authToken;
      setZero(zeroObj);

      if (__DEV__) {
        console.log('[ZeroProvider] Zero instance created');
      }
    };

    void initZero();

    return () => {
      cancelled = true;
      unsubscribeConnectionTimingRef.current?.();
      unsubscribeConnectionTimingRef.current = null;
      unsubscribeHeartbeatRef.current?.();
      unsubscribeHeartbeatRef.current = null;
    };
  }, [
    currentWorkspaceId,
    hasResolvedAuthToken,
    memberId,
    orgRole,
    refreshCount,
    role,
    uid,
    workspaceId,
  ]);

  // Zero supports in-place auth rotation; keep the hydrated replica alive.
  useEffect(() => {
    if (!zero || !resolvedAuthToken || zeroAuthTokenRef.current === resolvedAuthToken) {
      return;
    }

    zeroAuthTokenRef.current = resolvedAuthToken;
    void zero.connection.connect({ auth: resolvedAuthToken }).catch(() => undefined);
  }, [resolvedAuthToken, zero]);

  useEffect(() => {
    if (!zero) {
      return;
    }

    return () => {
      if (__DEV__) {
        console.log('[ZeroProvider] Zero instance closed');
      }
      void zero.close();
      if (zeroRef.current === zero) {
        zeroRef.current = null;
        zeroAuthTokenRef.current = null;
      }
    };
  }, [zero]);

  const zeroMatchesCurrentWorkspace =
    Boolean(workspaceId) &&
    zero?.context.userID === uid &&
    zero?.context.workspaceId === workspaceId;

  if (!zero || !zeroMatchesCurrentWorkspace) {
    if (user && isWorkspaceSwitchInProgress()) {
      return <ProtectedStartupScreen label='Preparing your workspace' progress={0.15} />;
    }

    return null;
  }

  return (
    <ZeroReactProvider zero={zero}>
      <LotusZeroFallbackProvider>{children}</LotusZeroFallbackProvider>
    </ZeroReactProvider>
  );
};

export default ZeroProvider;
