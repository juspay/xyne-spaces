import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { NativeModules, Platform } from 'react-native';
import Constants from 'expo-constants';
import CookieManager from '@react-native-cookies/cookies';
import { clearAllAuthCookies } from '@/src/utils/clearAllAuthCookies';
import {
  runBestEffortCleanup,
  summarizeAuthCleanup,
  type CleanupStageResult,
} from '@/src/utils/runBestEffortCleanup';
import {
  authenticateWithEmail,
  authenticateWithGoogle,
  authenticateWithMicrosoft,
  createOrganizationAndWorkspace,
  createWorkspace as createWorkspaceRequest,
  createWorkspaceInExistingOrg,
  getUserById,
  joinCommunityWorkspace,
  refreshAuthSession,
  loginToWorkspace,
  registerWithEmail,
  requestEnterpriseWorkspaceJoin,
  resendRegistrationCode,
  signOutUser,
  switchToWorkspace,
  User,
  verifyEmailRegistration,
  WorkspaceSummary,
} from '../services/AuthServices';
import type {
  AuthExchangeResult,
  CommunityJoinResult,
  OrgCreationBlockers,
} from '../services/AuthServices';
import { CommunityJoinResultStatus } from '../services/CommunityServices';
import {
  clearPendingCommunityWorkspace,
  getPendingCommunityWorkspace,
  setCommunityLandingChannelId,
} from '../services/communityIntent';
import { requestMicrosoftAuthorizationCode } from '../services/microsoftOAuth';
import { deleteKeys, getJson, getString, setJson, setString } from '../services/localStorage';
import {
  decodeAuthJwtClaims,
  deleteStoredAuthToken,
  getStoredAuthToken,
  getValidAccessToken,
  isStoredAuthTokenSignedOut,
  markStoredAuthTokenSignedOut,
  persistAuthToken,
} from '../services/authToken';
import { useSessionTokenKeepAlive } from '../hooks/useSessionTokenKeepAlive';
import { mmkvStorageAdapter } from '../services/mmkvStorageAdapter';
import { clearCustomEmojiCache } from '../services/customEmojiCache';
import { clearDismissedTwinDrafts } from '../features/drafts-sent/twin-draft-dismissed';
import {
  beginWorkspaceSwitch,
  syncResetWorkspaceSessionState,
} from '../services/workspaceSessionReset';
import { customEmojisQueryKey } from '../services/customEmojiQuery';
import { clearMtlsEmojiCache } from '../hooks/useMtlsEmoji';
import {
  clearMtlsAttachmentCache,
  ATTACHMENT_CACHE_NONCE_KEY,
} from '../hooks/useMtlsAttachmentFile';
import { stopProxyAndClearAuth } from '../hooks/useMtlsProxy';
import { clearMediaPreviewCache } from '../features/chat/v2/media/mediaPreviewCache';
import { clearStartupMetricsQueue } from '../services/metrics/metricsQueue';
import { queryClient } from '../services/queryClient';
import { clearPersistentDownloads } from '../modules/downloads/NativeAttachmentDownload';
import { logger, Event } from '../utils/logger';
import { API_BASE_URL } from '../config';
import type { Context } from '@xyne/shared';
import { setActiveWorkspaceId, getActiveWorkspaceId } from '../utils/activeWorkspace';
import { clearMemberWorkspacesCache } from '../services/memberWorkspaces';
import { setLogIdentity, clearLogIdentity } from '@/src/observability/logging/appLogger';
import { isDeadSessionFailure } from '../services/sessionTokenPolicy';
import {
  beginAuthOperation,
  beginAuthSession,
  commitAuthSession,
  getAuthOperation,
  getAuthSessionGeneration,
  enqueueAuthNativeMutation,
  isAuthOperationCurrent,
  isAuthSessionCurrent,
  enqueueAuthCookieMutation,
  trackAuthSessionOperation,
  waitForAuthSessionOperations,
} from '../services/authSessionLifecycle';
import { clearNotificationSessionArtifacts } from '../notifications/sessionCleanup';
import { unregisterDeviceWithBackend } from '../notifications/backend/deviceRegistry';
import { ShareTargetNative } from '../features/share-target/nativeShareTarget';

// Storage keys
const USER_ID_KEY = '@lotus_user_id';
const USER_CACHE_KEY = '@lotus_user_cache';
const PROTECTED_NATIVE_AUTH_CONTEXT_VERSION = 2;
const CLEAR_PENDING_SHARE_TIMEOUT_MS = 1000;
let nativeAuthContextCapability: Promise<boolean> | null = null;

async function clearPendingShareArtifacts(): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error('Pending share cleanup timed out'));
    }, CLEAR_PENDING_SHARE_TIMEOUT_MS);
  });

  try {
    const cleanup = ShareTargetNative.clearAllPendingShares().then(cleared => {
      if (!cleared) {
        throw new Error('Pending share cleanup was not confirmed');
      }
    });
    await Promise.race([cleanup, timeout]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

function supportsProtectedNativeAuthContext(): Promise<boolean> {
  if (nativeAuthContextCapability) return nativeAuthContextCapability;
  nativeAuthContextCapability = (async (): Promise<boolean> => {
    const module = NativeModules['AuthContextModule'];
    if (typeof module?.getAuthContextStorageVersion !== 'function') return false;
    try {
      const version = await module.getAuthContextStorageVersion();
      return Number(version) >= PROTECTED_NATIVE_AUTH_CONTEXT_VERSION;
    } catch {
      return false;
    }
  })();
  return nativeAuthContextCapability;
}

function makeWorkspaceSessionKey(nextUser: User | null): string {
  if (!nextUser) {
    return 'anonymous';
  }
  return `${nextUser.workspaceId}:${nextUser.user_id}`;
}

/** OAuth client IDs from `app.config.js` → `extra` (driven by `APP_VARIANT` / `config/variants.cjs`). */
function getGoogleSignInClientIdsFromConfig(): { iosClientId: string; webClientId: string } {
  const extra = Constants.expoConfig?.extra as
    { googleSignInIosClientId?: string; googleSignInWebClientId?: string } | undefined;
  const iosClientId =
    typeof extra?.googleSignInIosClientId === 'string' ? extra.googleSignInIosClientId : '';
  const webClientId =
    typeof extra?.googleSignInWebClientId === 'string' ? extra.googleSignInWebClientId : '';
  return { iosClientId, webClientId };
}

// Type-only import
import type { SignInSuccessResponse } from '@react-native-google-signin/google-signin';
import { callLaunchHandler } from '../services/CallLaunchHandler';
import { recordUserLogin, recordUserLogout } from '../services/metrics';

function parseCachedUser(json: string | null, expectedUserId: string): User | null {
  if (!json) {
    return null;
  }
  try {
    const u = JSON.parse(json) as Partial<User>;
    if (
      typeof u.user_id === 'string' &&
      u.user_id === expectedUserId &&
      typeof u.email === 'string' &&
      typeof u.name === 'string'
    ) {
      return {
        user_id: u.user_id,
        email: u.email,
        name: u.name,
        workspaceId: typeof u.workspaceId === 'string' ? u.workspaceId : '',
        role: typeof u.role === 'string' ? u.role : '',
        orgRole: typeof u.orgRole === 'string' ? u.orgRole : '',
        memberId: typeof u.memberId === 'string' ? u.memberId : '',
        ...(typeof u.photo_url === 'string' && u.photo_url ? { photo_url: u.photo_url } : {}),
      };
    }
  } catch {
    // ignore invalid cache
  }
  return null;
}

function readCachedAuthSnapshot(): {
  user: User | null;
  token: string | null;
  hasSession: boolean;
} {
  // The reusable bearer token is protected and asynchronous. Never authorize
  // from a synchronous MMKV snapshot; initializeAuth reads SecureStore before
  // restoring the cached user below.
  return { user: null, token: null, hasSession: false };
}

let cachedAuthSnapshot = readCachedAuthSnapshot();

function invalidateCachedAuthSnapshot(): void {
  cachedAuthSnapshot = { user: null, token: null, hasSession: false };
}

function updateCachedAuthSnapshot(user: User, token: string): void {
  cachedAuthSnapshot = { user, token, hasSession: true };
}

function applyStructuredLogIdentity(user: User): void {
  setLogIdentity({
    userId: user.user_id,
    email: user.email,
    workspaceId: user.workspaceId,
  });
}

// Lazy-load Google Sign-In so the app doesn't crash in Expo Go
let GoogleSignin: typeof import('@react-native-google-signin/google-signin').GoogleSignin | null =
  null;
let statusCodes: typeof import('@react-native-google-signin/google-signin').statusCodes | null =
  null;
let isSuccessResponse: (response: unknown) => boolean = () => false;
let googleSignInAvailable = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lib = require('@react-native-google-signin/google-signin');
  GoogleSignin = lib.GoogleSignin;
  statusCodes = lib.statusCodes;
  isSuccessResponse = lib.isSuccessResponse;
  googleSignInAvailable = true;
} catch {
  console.warn(
    '[Auth] Google Sign-In native module not available (e.g. Expo Go). Use a development build: npx expo run:ios or npx expo run:android',
  );
}

type GoogleUser = SignInSuccessResponse | null;
type SignInProvider = 'google' | 'email' | 'microsoft';

type PendingAuthState =
  | {
      kind: 'workspace_selection_required';
      provider: SignInProvider;
      workspaces: WorkspaceSummary[];
      profile: {
        email: string;
        name: string;
        picture?: string;
      };
      userExistsButRemoved?: boolean;
    }
  | (OrgCreationBlockers & {
      kind: 'org_creation_required';
      provider: SignInProvider;
      profile: {
        email: string;
        name: string;
        picture?: string;
      };
      userExistsButRemoved?: boolean;
    });

/** A community join that the backend queued for admin review instead of granting immediately. */
export interface CommunityJoinRequestState {
  workspaceId: string;
  status:
    | typeof CommunityJoinResultStatus.REQUEST_PENDING
    | typeof CommunityJoinResultStatus.REQUEST_REJECTED;
  isExisting: boolean;
}

/** What the caller should render after asking to join a community. */
export type CommunityJoinOutcome =
  { kind: 'joined' } | { kind: 'request'; request: CommunityJoinRequestState };

interface AuthContextType {
  user: User | null;
  googleUser: GoogleUser;
  isLoading: boolean;
  isSignedIn: boolean;
  pendingAuth: PendingAuthState | null;
  communityJoinRequest: CommunityJoinRequestState | null;
  /** Set when a pending community join failed during sign-in and the flow fell through. */
  communityJoinError: string | null;
  joinCommunityAndSwitch: (workspaceId: string) => Promise<CommunityJoinOutcome>;
  clearCommunityJoinRequest: () => void;
  signIn: () => Promise<void>;
  signInWithMicrosoft: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (input: { email: string; password: string; name: string }) => Promise<string>;
  confirmEmailSignUp: (email: string, code: string) => Promise<void>;
  resendSignUpCode: (email: string) => Promise<string>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  createWorkspace: (workspaceName: string) => Promise<void>;
  createOrganization: (input: { orgName: string; workspaceName: string }) => Promise<void>;
  /** Asks an existing enterprise workspace for access; resolves to the queued request's status. */
  requestEnterpriseJoin: (
    workspaceId: string,
  ) => Promise<{ status: string | null; isExisting: boolean }>;
  /** Creates a workspace inside the org that already owns the user's email domain, then signs in. */
  createEnterpriseWorkspace: (workspaceName: string) => Promise<void>;
  clearPendingAuth: () => void;
  signOut: () => Promise<void>;
  token: string | null;
  applyRefreshedToken: (
    newToken: string,
    generation?: number,
    operation?: number,
  ) => Promise<boolean>;
  workspaceSessionKey: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

let googleSignInConfigured = false;
const configureGoogleSignIn = (): void => {
  if (googleSignInConfigured || !googleSignInAvailable || !GoogleSignin) {
    return;
  }

  const { iosClientId, webClientId } = getGoogleSignInClientIdsFromConfig();
  if (!iosClientId || !webClientId) {
    console.warn(
      '[Auth] Google Sign-In: missing googleSignInIosClientId / googleSignInWebClientId in app config extra. Set APP_VARIANT when running Metro, or run prebuild for this variant.',
    );
    return;
  }

  logger.debug(Event.LOTUS_AUTH_CHECK, {
    stage: 'google_configure',
    iosClientId,
    webClientId,
  });

  try {
    GoogleSignin.configure({
      iosClientId,
      webClientId,
      offlineAccess: true,
      forceCodeForRefreshToken: true,
      scopes: ['profile', 'email'],
    });
    googleSignInConfigured = true;
  } catch (error) {
    console.warn('[Auth] Google Sign-In configuration failed:', error);
  }
};

function recordLoginForProvider(provider: SignInProvider): void {
  recordUserLogin(provider === 'google' ? 'google' : 'other');
}

interface AuthProviderProps {
  children: ReactNode;
}

type ClearStoredAuthOptions = {
  dropUserDatabases?: boolean;
  generation?: number;
  operation?: number;
  waitForOperations?: boolean;
};

export function AuthProvider({ children }: AuthProviderProps): React.JSX.Element {
  const [user, setUser] = useState<User | null>(cachedAuthSnapshot.user);
  const [googleUser, setGoogleUser] = useState<GoogleUser>(null);
  const [token, setToken] = useState<string | null>(cachedAuthSnapshot.token);
  const [workspaceSessionKey, setWorkspaceSessionKey] = useState(() =>
    makeWorkspaceSessionKey(cachedAuthSnapshot.user),
  );
  const [pendingAuth, setPendingAuth] = useState<PendingAuthState | null>(null);
  const [communityJoinRequest, setCommunityJoinRequest] =
    useState<CommunityJoinRequestState | null>(null);
  const [communityJoinError, setCommunityJoinError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!cachedAuthSnapshot.hasSession);
  const initialAuthGeneration = useRef(getAuthSessionGeneration()).current;

  const clearNativeAuthContext = (generation: number, operation: number): Promise<void> =>
    enqueueAuthNativeMutation(
      generation,
      async (): Promise<void> => {
        await NativeModules['AuthContextModule']?.clearAuthContext?.();
      },
      () => isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation),
    );

  const clearStoredAuth = async ({
    dropUserDatabases = false,
    generation = getAuthSessionGeneration(),
    operation = getAuthOperation(),
    waitForOperations = true,
  }: ClearStoredAuthOptions = {}): Promise<CleanupStageResult[]> => {
    if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) {
      return [];
    }
    invalidateCachedAuthSnapshot();
    setActiveWorkspaceId(null);
    let storedUserId: string | null | undefined;
    const logCleanupError = (stage: string, error: unknown): void => {
      logger.error(Event.LOTUS_LOGOUT_FAILED, { error, stage });
    };

    const stages = await runBestEffortCleanup(
      [
        {
          stage: 'mark_protected_auth_token_signed_out',
          run: markStoredAuthTokenSignedOut,
        },
        ...(waitForOperations
          ? [
              {
                stage: 'wait_for_auth_operations',
                run: async (): Promise<void> => {
                  await waitForAuthSessionOperations(generation);
                },
              },
            ]
          : []),
        {
          stage: 'read_stored_user',
          run: (): void => {
            storedUserId = getString(USER_ID_KEY);
          },
        },
        {
          stage: 'clear_notification_session_artifacts',
          run: clearNotificationSessionArtifacts,
        },
        {
          stage: 'clear_pending_share_artifacts',
          run: clearPendingShareArtifacts,
        },
        {
          stage: 'stop_proxy_and_clear_auth',
          run: stopProxyAndClearAuth,
        },
        {
          stage: 'clear_cookies',
          run: (): Promise<void> =>
            enqueueAuthCookieMutation(
              generation,
              () =>
                clearAllAuthCookies(
                  CookieManager,
                  Platform.OS,
                  () => isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation),
                ),
              () => isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation),
            ),
        },
        {
          stage: 'clear_user_cache',
          run: (): void => {
            if (storedUserId) {
              clearCustomEmojiCache(storedUserId);
              queryClient.removeQueries({ queryKey: customEmojisQueryKey });
            }
          },
        },
        {
          stage: 'clear_runtime_caches',
          run: async (): Promise<void> => {
            await Promise.all([
              clearMtlsAttachmentCache(),
              clearMtlsEmojiCache(),
              clearMediaPreviewCache(),
              ...(Platform.OS === 'android' ? [clearPersistentDownloads()] : []),
            ]);
            clearStartupMetricsQueue();
            clearDismissedTwinDrafts();
          },
        },
        {
          stage: 'clear_persistent_downloads',
          run: (): void => {
            if (Platform.OS === 'android') {
              void clearPersistentDownloads();
            }
          },
        },
        {
          stage: 'close_user_database',
          run: (): void => mmkvStorageAdapter.close(),
        },
        {
          stage: 'drop_user_databases',
          run: async (): Promise<void> => {
            if (dropUserDatabases) {
              // A person can have a different user_id in each workspace. Explicit
              // sign-out must remove every workspace-scoped database, not only the
              // last active workspace identity stored in local auth.
              await mmkvStorageAdapter.dropAllUserDatabases();
            }
          },
        },
        {
          stage: 'delete_mmkv_user_id',
          run: (): void => deleteKeys([USER_ID_KEY, ATTACHMENT_CACHE_NONCE_KEY]),
        },
        {
          stage: 'delete_mmkv_user_cache',
          run: (): void => deleteKeys([USER_CACHE_KEY]),
        },
        {
          stage: 'delete_protected_auth_token',
          run: (): Promise<void> =>
            deleteStoredAuthToken(generation, operation, {
              onDeleted: (): Promise<void> => clearNativeAuthContext(generation, operation),
            }),
        },
        {
          stage: 'clear_global_auth_token',
          run: (): void => mmkvStorageAdapter.clearGlobalAuthToken(),
        },
        {
          stage: 'clear_global_user_context',
          run: (): void => mmkvStorageAdapter.clearGlobalUserContext(),
        },
        {
          stage: 'clear_native_auth_context',
          run: (): void => {
            if (Platform.OS === 'android') {
              NativeModules['AuthContextModule']?.clearAuthContext?.();
            }
          },
        },
        {
          stage: 'clear_in_memory_auth',
          run: (): void => {
            setUser(null);
            setGoogleUser(null);
            setToken(null);
            setActiveWorkspaceId(null);
            setPendingAuth(null);
            setCommunityJoinRequest(null);
            setCommunityJoinError(null);
          },
        },
        { stage: 'clear_member_workspaces', run: clearMemberWorkspacesCache },
        { stage: 'clear_log_identity', run: clearLogIdentity },
        {
          stage: 'clear_logger_email',
          run: async (): Promise<void> => {
            await logger.clearEmailId();
          },
        },
      ],
      logCleanupError,
      () => isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation),
    );

    return stages;
  };

  const tryRestoreGoogleSession = async (
    generation = getAuthSessionGeneration(),
    operation = getAuthOperation(),
  ): Promise<void> => {
    try {
      if (googleSignInAvailable && googleSignInConfigured && GoogleSignin) {
        const currentGoogleUser = await GoogleSignin.getCurrentUser();
        if (isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation)) {
          setGoogleUser(currentGoogleUser ? { type: 'success', data: currentGoogleUser } : null);
        }
      }
    } catch {
      logger.debug(Event.LOTUS_AUTH_CHECK, { stage: 'google_session_not_available' });
    }
  };

  const persistUserCache = async (
    profile: User,
    generation = getAuthSessionGeneration(),
    operation = getAuthOperation(),
  ): Promise<void> => {
    if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) {
      return;
    }
    setString(USER_ID_KEY, profile.user_id);
    setJson(USER_CACHE_KEY, profile);
  };

  const persistTokenCache = async (
    authToken: string,
    generation = getAuthSessionGeneration(),
    operation = getAuthOperation(),
    allowSignedOutRecovery = false,
  ): Promise<boolean> => {
    if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) {
      return false;
    }
    return persistAuthToken(authToken, generation, operation, {
      allowSignedOutRecovery,
      onPersisted: async () => {
        // Native background readers receive the token only through their
        // platform-protected handoff. A missing native module (for example,
        // Expo Go) is a safe degradation for notification actions. A native
        // storage failure is fail-closed: clear any previous handoff and do
        // not accept a session whose background credential is ambiguous.
        try {
          if (!(await supportsProtectedNativeAuthContext())) {
            // An older native binary may expose AuthContextModule but still
            // write plaintext. Clear it and wait for a rebuilt binary rather
            // than sending a new token through the old API.
            await clearNativeAuthContext(generation, operation);
            return;
          }
          await enqueueAuthNativeMutation(
            generation,
            async (): Promise<void> => {
              await NativeModules['AuthContextModule']?.setAuthContext?.(authToken, API_BASE_URL);
            },
            () => isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation),
          );
        } catch (error) {
          try {
            await clearNativeAuthContext(generation, operation);
          } catch (clearError) {
            logger.error(Event.LOTUS_AUTH_CHECK, {
              stage: 'native_background_auth_handoff_clear_failed',
              error: clearError,
            });
          }
          logger.warn(Event.LOTUS_AUTH_CHECK, {
            stage: 'native_background_auth_handoff_failed',
            error,
          });
          throw error;
        } finally {
          // Remove the legacy iOS App Group value after the protected handoff
          // attempt. The extension no longer reads this key.
          mmkvStorageAdapter.clearGlobalAuthToken();
        }
      },
    });
  };

  const initializeAuth = async (): Promise<void> => {
    const generation = initialAuthGeneration;
    const operation = getAuthOperation();
    try {
      logger.info(Event.LOTUS_AUTH_CHECK, { stage: 'initialization_start' });

      const verifyUserWithRefresh = async (
        userId: string,
        accessToken: string,
        operationGeneration: number,
        operationId: number,
      ): Promise<
        | { status: 'verified'; user: User; token: string }
        | { status: 'transient' }
        | { status: 'invalid' }
      > => {
        if (!isAuthSessionCurrent(operationGeneration) || !isAuthOperationCurrent(operationId)) {
          return { status: 'transient' };
        }
        const initialResponse = await getUserById(userId, accessToken);

        if (!isAuthSessionCurrent(operationGeneration) || !isAuthOperationCurrent(operationId)) {
          return { status: 'transient' };
        }

        if (initialResponse.success && initialResponse.user) {
          return { status: 'verified', user: initialResponse.user, token: accessToken };
        }

        if (initialResponse.isTransientError) {
          return { status: 'transient' };
        }

        const refreshResult = await refreshAuthSession(undefined, operationGeneration, operationId);
        if (!isAuthSessionCurrent(operationGeneration) || !isAuthOperationCurrent(operationId)) {
          return { status: 'transient' };
        }
        if (!refreshResult.ok) {
          return isDeadSessionFailure(refreshResult.kind)
            ? { status: 'invalid' }
            : { status: 'transient' };
        }

        const refreshedResponse = await getUserById(userId, refreshResult.token);

        if (!isAuthSessionCurrent(operationGeneration) || !isAuthOperationCurrent(operationId)) {
          return { status: 'transient' };
        }

        if (refreshedResponse.success && refreshedResponse.user) {
          return { status: 'verified', user: refreshedResponse.user, token: refreshResult.token };
        }

        if (refreshedResponse.isTransientError) {
          logger.debug(Event.LOTUS_AUTH_CHECK, { stage: 'verify_after_refresh_transient' });
          return { status: 'transient' };
        }

        return refreshedResponse.isUnauthorized ? { status: 'invalid' } : { status: 'transient' };
      };

      // Background auth verification - runs after UI renders
      const verifyAuthInBackground = (
        userId: string,
        accessToken: string,
        operationGeneration: number,
        operationId: number,
      ): Promise<void> =>
        trackAuthSessionOperation(
          operationGeneration,
          (async (): Promise<void> => {
            try {
              const verified = await verifyUserWithRefresh(
                userId,
                accessToken,
                operationGeneration,
                operationId,
              );
              if (verified.status === 'verified') {
                if (
                  !isAuthSessionCurrent(operationGeneration) ||
                  !isAuthOperationCurrent(operationId)
                ) {
                  return;
                }
                setUser(verified.user);
                setToken(verified.token);
                if (!(await persistTokenCache(verified.token, operationGeneration, operationId)))
                  return;
                await persistUserCache(verified.user, operationGeneration, operationId);
                if (
                  !isAuthSessionCurrent(operationGeneration) ||
                  !isAuthOperationCurrent(operationId)
                ) {
                  return;
                }
                updateCachedAuthSnapshot(verified.user, verified.token);
                setActiveWorkspaceId(verified.user.workspaceId || null);
                void logger.setEmailId(verified.user.email);
                applyStructuredLogIdentity(verified.user);
              } else if (verified.status === 'invalid') {
                if (
                  !isAuthSessionCurrent(operationGeneration) ||
                  !isAuthOperationCurrent(operationId)
                ) {
                  return;
                }
                const cleanupGeneration = beginAuthSession();
                await clearStoredAuth({
                  generation: cleanupGeneration,
                  operation: getAuthOperation(),
                  waitForOperations: false,
                });
              }
              // Transient errors are ignored - user stays logged in.
            } catch (error) {
              // Network errors don't affect UI.
              logger.debug(Event.LOTUS_AUTH_CHECK, { stage: 'background_verify_error', error });
            }
          })(),
        );

      // The reusable bearer token is protected and asynchronous, so startup
      // restores the non-secret user cache only after SecureStore authorizes it.
      if (cachedAuthSnapshot.hasSession && cachedAuthSnapshot.user && cachedAuthSnapshot.token) {
        const cachedUser = cachedAuthSnapshot.user;
        const cachedToken = cachedAuthSnapshot.token;

        setActiveWorkspaceId(cachedUser.workspaceId);
        void logger.setEmailId(cachedUser.email);
        applyStructuredLogIdentity(cachedUser);
        void tryRestoreGoogleSession(generation, operation);
        setTimeout(
          () => void verifyAuthInBackground(cachedUser.user_id, cachedToken, generation, operation),
          0,
        );
        return;
      }

      // Slow path: MMKV cache incomplete, read from storage
      const [storedUserId, initialStoredToken, cachedUserJson] = await Promise.all([
        Promise.resolve(getString(USER_ID_KEY)),
        getStoredAuthToken(generation, operation),
        Promise.resolve(getJson<User>(USER_CACHE_KEY)).then(v => (v ? JSON.stringify(v) : null)),
      ]);

      if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) {
        return;
      }

      if (!storedUserId) {
        try {
          await clearNativeAuthContext(generation, operation);
        } catch (error) {
          logger.warn(Event.LOTUS_AUTH_CHECK, {
            stage: 'native_background_auth_cleanup_failed',
            error,
          });
        }
        logger.debug(Event.LOTUS_AUTH_CHECK, { stage: 'no_stored_credentials' });
        return;
      }

      const cachedUser = parseCachedUser(cachedUserJson, storedUserId);
      let storedToken = initialStoredToken;

      // App updates can move or temporarily invalidate one local token store.
      // Recover from the durable session cookie before presenting the login UI.
      if (!storedToken && !isStoredAuthTokenSignedOut()) {
        const refreshResult = await refreshAuthSession(
          cachedUser?.workspaceId,
          generation,
          operation,
        );
        if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) {
          return;
        }
        if (!refreshResult.ok) {
          logger.debug(Event.LOTUS_AUTH_CHECK, {
            stage: 'stored_token_missing_refresh_failed',
            kind: refreshResult.kind,
          });
          return;
        }
        storedToken = refreshResult.token;
      }

      if (!storedToken) {
        try {
          await clearNativeAuthContext(generation, operation);
        } catch (error) {
          logger.warn(Event.LOTUS_AUTH_CHECK, {
            stage: 'native_background_auth_cleanup_failed',
            error,
          });
        }
        await clearMtlsAttachmentCache();
        logger.debug(Event.LOTUS_AUTH_CHECK, { stage: 'no_stored_credentials' });
        return;
      }

      // Upgrade the native background handoff from the already protected main
      // app token before backend verification. Invalid sessions are cleaned up
      // below, while valid sessions stop depending on the old shared-MMKV key.
      if (!(await persistTokenCache(storedToken, generation, operation))) return;

      logger.debug(Event.LOTUS_AUTH_CHECK, { stage: 'found_stored_user_id', userId: storedUserId });

      const runBlockingVerification = async (): Promise<void> => {
        const verified = await verifyUserWithRefresh(
          storedUserId,
          storedToken,
          generation,
          operation,
        );
        logger.debug(Event.LOTUS_AUTH_CHECK, {
          stage: 'blocking_verify_response',
          status: verified.status,
        });
        if (verified.status === 'verified') {
          if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) return;
          setUser(verified.user);
          setToken(verified.token);
          setString(USER_ID_KEY, storedUserId);
          if (!(await persistTokenCache(verified.token, generation, operation))) return;
          await persistUserCache(verified.user, generation, operation);
          if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) return;
          updateCachedAuthSnapshot(verified.user, verified.token);
          void logger.setEmailId(verified.user.email);
          applyStructuredLogIdentity(verified.user);
          await tryRestoreGoogleSession(generation, operation);
        } else if (verified.status === 'transient') {
          return;
        } else {
          if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) return;
          logger.info(Event.LOTUS_AUTH_CHECK, {
            stage: 'user_not_found_clearing_storage',
            userId: storedUserId,
          });
          const cleanupGeneration = beginAuthSession();
          await clearStoredAuth({ generation: cleanupGeneration, operation: getAuthOperation() });
        }
      };

      if (cachedUser) {
        setUser(cachedUser);
        setToken(storedToken);
        setActiveWorkspaceId(cachedUser.workspaceId);
        setString(USER_ID_KEY, storedUserId);
        setJson(USER_CACHE_KEY, cachedUser);
        void logger.setEmailId(cachedUser.email);
        applyStructuredLogIdentity(cachedUser);
        setIsLoading(false);
        void tryRestoreGoogleSession(generation, operation);
        setTimeout(
          () => void verifyAuthInBackground(storedUserId, storedToken, generation, operation),
          0,
        );
      } else {
        logger.debug(Event.LOTUS_AUTH_CHECK, { stage: 'no_user_cache_verifying_backend' });
        await runBlockingVerification();
      }
    } catch (error) {
      logger.error(Event.LOTUS_LOGIN_FAILED, { stage: 'initialization_error', error });
      if (isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation)) {
        const cleanupGeneration = beginAuthSession();
        await clearStoredAuth({ generation: cleanupGeneration, operation: getAuthOperation() });
      }
    } finally {
      if (isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation)) {
        setIsLoading(false);
      }
    }
  };

  const clearWorkspaceRuntimeCaches = (userId: string): void => {
    clearCustomEmojiCache(userId);
    queryClient.removeQueries({ queryKey: customEmojisQueryKey });
    queryClient.clear();
  };

  const applyRefreshedToken = async (
    newToken: string,
    operationGeneration = getAuthSessionGeneration(),
    operation = getAuthOperation(),
  ): Promise<boolean> => {
    const generation = operationGeneration;
    if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) {
      return false;
    }
    const tokenWorkspaceId = decodeAuthJwtClaims(newToken)?.workspaceId;
    const activeWorkspaceId = getActiveWorkspaceId();
    if (tokenWorkspaceId && activeWorkspaceId && tokenWorkspaceId !== activeWorkspaceId) {
      logger.warn(Event.LOTUS_AUTH_CHECK, {
        stage: 'ignore_stale_refreshed_token',
        tokenWorkspaceId,
        activeWorkspaceId,
      });
      return false;
    }
    if (!(await persistTokenCache(newToken, generation, operation))) {
      return false;
    }
    if (isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation)) {
      setToken(newToken);
      return true;
    }
    return false;
  };

  useSessionTokenKeepAlive(
    user && !isLoading ? token : null,
    user?.workspaceId ?? null,
    applyRefreshedToken,
  );

  const applyAuthenticatedSession = async (
    nextUser: User,
    nextToken: string,
    operation?: number,
  ): Promise<boolean> => {
    if (operation !== undefined && !isAuthOperationCurrent(operation)) {
      return false;
    }
    const generation = getAuthSessionGeneration();
    const committedOperation = getAuthOperation();
    if (!(await persistTokenCache(nextToken, generation, committedOperation, true))) {
      return false;
    }
    await persistUserCache(nextUser, generation, committedOperation);
    if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(committedOperation)) {
      return false;
    }
    commitAuthSession();
    updateCachedAuthSnapshot(nextUser, nextToken);
    setString(USER_ID_KEY, nextUser.user_id);
    void logger.setEmailId(nextUser.email);
    applyStructuredLogIdentity(nextUser);
    setUser(nextUser);
    setToken(nextToken);
    setActiveWorkspaceId(nextUser.workspaceId);
    setPendingAuth(null);
    return true;
  };

  const applyCommunityJoinResult = async (
    workspaceId: string,
    result: CommunityJoinResult,
    provider: SignInProvider,
    operation?: number,
  ): Promise<CommunityJoinOutcome | null> => {
    // A newer sign-in or a logout superseded this join while it was in flight.
    if (operation !== undefined && !isAuthOperationCurrent(operation)) {
      return null;
    }
    setCommunityJoinError(null);
    if (result.kind === 'request') {
      const request: CommunityJoinRequestState = {
        workspaceId,
        status: result.status,
        isExisting: result.isExisting,
      };
      // The pending selection is deliberately kept so a later sign-in re-checks the request's
      // status; "Continue with work email" is the escape hatch that purges it.
      setCommunityJoinRequest(request);
      setPendingAuth(null);
      setUser(null);
      setToken(null);
      return { kind: 'request', request };
    }

    if (result.landingChannelId) {
      setCommunityLandingChannelId(result.landingChannelId);
    }
    clearPendingCommunityWorkspace();
    setCommunityJoinRequest(null);
    const applied = await applyAuthenticatedSession(result.user, result.token, operation);
    if (!applied) {
      return null;
    }
    recordLoginForProvider(provider);
    logger.info(Event.LOTUS_LOGIN_SUCCESS, {
      provider,
      stage: 'community_join',
      workspaceId,
      userId: result.user.user_id,
    });
    return { kind: 'joined' };
  };

  const applyAuthenticationResult = async (
    provider: SignInProvider,
    authResponse: AuthExchangeResult,
    operation?: number,
  ): Promise<boolean> => {
    const generation = getAuthSessionGeneration();
    if (
      (operation !== undefined && !isAuthOperationCurrent(operation)) ||
      !isAuthSessionCurrent(generation)
    ) {
      return false;
    }
    logger.debug(Event.LOTUS_AUTH_CHECK, {
      stage: 'auth_response_received',
      provider,
      success: authResponse.success,
    });

    if (!authResponse.success) {
      throw new Error(authResponse.message || 'Backend authentication failed');
    }

    // A community was picked before signing in, so complete that join instead of dropping the user
    // into workspace selection. Mirrors the dashboard's `hasPendingCommunityWorkspace` guard, which
    // also runs ahead of auto-login. Identity is already in the cookie jar at this point.
    const pendingCommunity = getPendingCommunityWorkspace();
    if (pendingCommunity) {
      try {
        const result = await joinCommunityWorkspace(pendingCommunity.id);
        const outcome = await applyCommunityJoinResult(
          pendingCommunity.id,
          result,
          provider,
          operation,
        );
        return outcome !== null;
      } catch (error) {
        // The community is closed, or the user already has access. Either way, drop the selection
        // and let the normal workspace/org handling below take over so they are not stranded.
        logger.warn(Event.LOTUS_LOGIN_FAILED, {
          reason: 'community_join_failed',
          workspaceId: pendingCommunity.id,
          error,
        });
        clearPendingCommunityWorkspace();
        setCommunityJoinError(error instanceof Error ? error.message : 'Failed to join community');
      }
    }

    if (authResponse.kind === 'authenticated') {
      const applied = await applyAuthenticatedSession(
        authResponse.user,
        authResponse.token,
        operation,
      );
      if (applied) {
        logger.info(Event.LOTUS_LOGIN_SUCCESS, {
          provider,
          userId: authResponse.user.user_id,
          email: authResponse.user.email,
        });
        recordLoginForProvider(provider);
      }
      return applied;
    }

    if (
      !isAuthSessionCurrent(generation) ||
      (operation !== undefined && !isAuthOperationCurrent(operation))
    ) {
      return false;
    }
    setActiveWorkspaceId(null);
    if (authResponse.kind === 'workspace_selection_required') {
      setPendingAuth({
        kind: 'workspace_selection_required',
        provider,
        profile: authResponse.profile,
        workspaces: authResponse.workspaces,
        ...(authResponse.userExistsButRemoved ? { userExistsButRemoved: true } : {}),
      });
    } else {
      setPendingAuth({
        kind: 'org_creation_required',
        provider,
        profile: authResponse.profile,
        // Why org creation is blocked, and which workspaces can be asked for access — drives the
        // "Organization Already Exists" screen, matching the dashboard.
        ...(authResponse.domainConflictError
          ? { domainConflictError: authResponse.domainConflictError }
          : {}),
        ...(authResponse.publicEmailDomainError
          ? { publicEmailDomainError: authResponse.publicEmailDomainError }
          : {}),
        ...(authResponse.enterpriseJoinTarget
          ? { enterpriseJoinTarget: authResponse.enterpriseJoinTarget }
          : {}),
        ...(authResponse.userExistsButRemoved ? { userExistsButRemoved: true } : {}),
      });
    }

    setUser(null);
    setToken(null);
    return true;
  };

  /**
   * Persists a workspace token before committing the shell remount. A switch
   * must not report success while a restart would restore a different session.
   */
  const applyWorkspaceSwitchSession = async (
    nextUser: User,
    nextToken: string,
    operation?: number,
  ): Promise<boolean> => {
    if (operation !== undefined && !isAuthOperationCurrent(operation)) {
      return false;
    }
    const generation = getAuthSessionGeneration();
    const committedOperation = operation ?? getAuthOperation();
    if (!(await persistTokenCache(nextToken, generation, committedOperation, true))) {
      return false;
    }
    await persistUserCache(nextUser, generation, committedOperation);
    if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(committedOperation)) {
      return false;
    }

    commitAuthSession();
    const nextKey = makeWorkspaceSessionKey(nextUser);
    setString(USER_ID_KEY, nextUser.user_id);
    setUser(nextUser);
    setToken(nextToken);
    setActiveWorkspaceId(nextUser.workspaceId);
    setPendingAuth(null);
    setWorkspaceSessionKey(nextKey);
    if (Platform.OS === 'android') {
      void clearPersistentDownloads();
    }
    void logger.setEmailId(nextUser.email);
    applyStructuredLogIdentity(nextUser);
    updateCachedAuthSnapshot(nextUser, nextToken);
    return true;
  };

  useEffect(() => {
    configureGoogleSignIn();
    void initializeAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (): Promise<void> => {
    const operation = beginAuthOperation();
    const generation = getAuthSessionGeneration();
    setIsLoading(true);
    try {
      if (!googleSignInAvailable || !GoogleSignin) {
        throw new Error(
          'Google Sign-In is not available. Please rebuild the native app with: npx expo run:ios or npx expo run:android',
        );
      }

      if (!googleSignInConfigured) {
        configureGoogleSignIn();
      }

      logger.info(Event.LOTUS_AUTH_CHECK, { stage: 'signin_start', provider: 'google' });

      try {
        await GoogleSignin.signOut();
      } catch {
        logger.debug(Event.LOTUS_AUTH_CHECK, { stage: 'google_signout_skipped' });
      }

      try {
        await GoogleSignin.revokeAccess();
      } catch {
        logger.debug(Event.LOTUS_AUTH_CHECK, { stage: 'google_revoke_skipped' });
      }

      await GoogleSignin.hasPlayServices();
      const googleUserInfo = await GoogleSignin.signIn();

      logger.debug(Event.LOTUS_AUTH_CHECK, { stage: 'google_signin_backend_auth' });

      const serverAuthCode = googleUserInfo.data?.serverAuthCode;

      if (!serverAuthCode) {
        throw new Error(
          'No serverAuthCode received. Make sure offlineAccess and forceCodeForRefreshToken are enabled in Google Sign-In config.',
        );
      }

      logger.debug(Event.LOTUS_AUTH_CHECK, { stage: 'google_server_auth_code' });

      const userPhoto = googleUserInfo.data?.user.photo;
      const authResponse = await authenticateWithGoogle(
        serverAuthCode,
        {
          email: googleUserInfo.data?.user.email ?? '',
          name: googleUserInfo.data?.user.name ?? '',
          ...(userPhoto ? { photo: userPhoto } : {}),
        },
        generation,
        operation,
      );

      const applied = await applyAuthenticationResult('google', authResponse, operation);

      if (applied && isAuthOperationCurrent(operation)) {
        setGoogleUser(
          isSuccessResponse(googleUserInfo) ? (googleUserInfo as SignInSuccessResponse) : null,
        );
      }
    } catch (error: unknown) {
      if (statusCodes && error && typeof error === 'object' && 'code' in error) {
        const err = error as { code: string };
        if (err.code === statusCodes.SIGN_IN_CANCELLED) {
          logger.info(Event.LOTUS_LOGIN_FAILED, { reason: 'cancelled' });
        } else if (err.code === statusCodes.IN_PROGRESS) {
          logger.info(Event.LOTUS_LOGIN_FAILED, { reason: 'in_progress' });
        } else if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          logger.warn(Event.LOTUS_LOGIN_FAILED, { reason: 'play_services_not_available' });
        } else {
          logger.error(Event.LOTUS_LOGIN_FAILED, { reason: 'unknown_code', error });
        }
      } else {
        logger.error(Event.LOTUS_LOGIN_FAILED, { reason: 'unknown_error', error });
      }
      throw error;
    } finally {
      if (isAuthOperationCurrent(operation)) {
        setIsLoading(false);
      }
    }
  };

  const signInWithMicrosoft = async (): Promise<void> => {
    const operation = beginAuthOperation();
    const generation = getAuthSessionGeneration();
    setIsLoading(true);
    try {
      logger.info(Event.LOTUS_AUTH_CHECK, { stage: 'signin_start', provider: 'microsoft' });
      setGoogleUser(null);

      const authorization = await requestMicrosoftAuthorizationCode();
      logger.debug(Event.LOTUS_AUTH_CHECK, { stage: 'microsoft_authorization_code_received' });

      const authResponse = await authenticateWithMicrosoft(authorization, generation, operation);
      await applyAuthenticationResult('microsoft', authResponse, operation);
    } catch (error: unknown) {
      logger.error(Event.LOTUS_LOGIN_FAILED, { reason: 'microsoft_auth_failed', error });
      throw error;
    } finally {
      if (isAuthOperationCurrent(operation)) {
        setIsLoading(false);
      }
    }
  };

  const signInWithEmail = async (email: string, password: string): Promise<void> => {
    const operation = beginAuthOperation();
    const generation = getAuthSessionGeneration();
    setIsLoading(true);
    try {
      logger.info(Event.LOTUS_AUTH_CHECK, { stage: 'signin_start', provider: 'email' });
      setGoogleUser(null);
      const authResponse = await authenticateWithEmail({ email, password }, generation, operation);
      await applyAuthenticationResult('email', authResponse, operation);
    } catch (error: unknown) {
      logger.error(Event.LOTUS_LOGIN_FAILED, { reason: 'email_auth_failed', error });
      throw error;
    } finally {
      if (isAuthOperationCurrent(operation)) {
        setIsLoading(false);
      }
    }
  };

  /**
   * Starts email sign-up. Returns the message to show above the code entry field.
   *
   * The pending community selection is forwarded as `workspaceId` so the backend scopes the
   * registration to it; `confirmEmailSignUp` then completes the join.
   */
  const signUpWithEmail = async (input: {
    email: string;
    password: string;
    name: string;
  }): Promise<string> => {
    setIsLoading(true);
    try {
      logger.info(Event.LOTUS_AUTH_CHECK, { stage: 'signup_start', provider: 'email' });
      const pendingCommunity = getPendingCommunityWorkspace();
      return await registerWithEmail({
        ...input,
        ...(pendingCommunity ? { workspaceId: pendingCommunity.id } : {}),
      });
    } catch (error: unknown) {
      logger.error(Event.LOTUS_LOGIN_FAILED, { reason: 'email_registration_failed', error });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Completes email sign-up with the emailed code.
   *
   * Verification leaves a pending-auth cookie behind, so this reuses `applyAuthenticationResult` —
   * the same path as every other provider — which picks up any pending community selection and
   * finishes the join without a second sign-in.
   */
  const confirmEmailSignUp = async (email: string, code: string): Promise<void> => {
    setIsLoading(true);
    try {
      setGoogleUser(null);
      const authResponse = await verifyEmailRegistration({ email, code });
      await applyAuthenticationResult('email', authResponse);
    } catch (error: unknown) {
      logger.error(Event.LOTUS_LOGIN_FAILED, { reason: 'email_verification_failed', error });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const resendSignUpCode = async (email: string): Promise<string> => resendRegistrationCode(email);

  const selectWorkspace = async (workspaceId: string): Promise<void> => {
    const operation = beginAuthOperation();
    const generation = getAuthSessionGeneration();
    const provider = pendingAuth?.provider ?? 'google';
    const previousWorkspaceId = getActiveWorkspaceId();
    setIsLoading(true);
    setActiveWorkspaceId(workspaceId);
    try {
      const response = await loginToWorkspace(workspaceId, generation, operation);
      if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) return;
      if (!response.success || !response.user || !response.token) {
        throw new Error('Workspace login failed');
      }
      const applied = await applyAuthenticatedSession(response.user, response.token, operation);
      if (applied) {
        recordLoginForProvider(provider);
      }
    } catch (error) {
      if (isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation)) {
        setActiveWorkspaceId(previousWorkspaceId);
      }
      throw error;
    } finally {
      if (isAuthOperationCurrent(operation)) {
        setIsLoading(false);
      }
    }
  };

  const switchWorkspace = async (workspaceId: string): Promise<void> => {
    const previousUserId = user?.user_id;
    const currentToken = token;

    if (!currentToken) {
      throw new Error('Not authenticated');
    }
    if (user?.workspaceId === workspaceId) {
      return;
    }

    const operation = beginAuthOperation();
    const generation = getAuthSessionGeneration();
    const previousWorkspaceId = getActiveWorkspaceId();
    setIsLoading(true);
    setActiveWorkspaceId(workspaceId);
    try {
      const response = await switchToWorkspace(workspaceId, currentToken, generation, operation);
      if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) return;
      if (!response.success || !response.user || !response.token) {
        throw new Error('Workspace switch failed');
      }

      beginWorkspaceSwitch();

      if (previousUserId) {
        clearWorkspaceRuntimeCaches(previousUserId);
      }

      const nextUserId = response.user.user_id;
      if (nextUserId) {
        clearWorkspaceRuntimeCaches(nextUserId);
      }

      syncResetWorkspaceSessionState();

      callLaunchHandler.reset();
      if (!isAuthOperationCurrent(operation)) return;
      const applied = await applyWorkspaceSwitchSession(response.user, response.token, operation);
      if (!applied) return;

      logger.info(Event.LOTUS_AUTH_CHECK, {
        stage: 'workspace_switch',
        workspaceId,
        userId: response.user.user_id,
      });
    } catch (error) {
      if (isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation)) {
        setActiveWorkspaceId(previousWorkspaceId);
      }
      throw error;
    } finally {
      if (isAuthOperationCurrent(operation)) {
        setIsLoading(false);
      }
    }
  };

  /**
   * Joins a community while already signed in to another workspace (invite link). Tears down the
   * current workspace session the same way `switchWorkspace` does before applying the new one.
   */
  const joinCommunityAndSwitch = async (workspaceId: string): Promise<CommunityJoinOutcome> => {
    if (user?.workspaceId === workspaceId) {
      clearPendingCommunityWorkspace();
      return { kind: 'joined' };
    }

    const previousUserId = user?.user_id;
    const operation = beginAuthOperation();
    const generation = getAuthSessionGeneration();
    setIsLoading(true);
    try {
      const result = await joinCommunityWorkspace(workspaceId);
      if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) {
        throw new Error('Authentication session superseded');
      }

      if (result.kind === 'request') {
        const request: CommunityJoinRequestState = {
          workspaceId,
          status: result.status,
          isExisting: result.isExisting,
        };
        setCommunityJoinRequest(request);
        clearPendingCommunityWorkspace();
        return { kind: 'request', request };
      }

      beginWorkspaceSwitch();

      if (previousUserId) {
        clearWorkspaceRuntimeCaches(previousUserId);
      }
      if (result.user.user_id) {
        clearWorkspaceRuntimeCaches(result.user.user_id);
      }

      syncResetWorkspaceSessionState();
      callLaunchHandler.reset();
      if (!isAuthOperationCurrent(operation)) {
        throw new Error('Authentication session superseded');
      }

      if (result.landingChannelId) {
        setCommunityLandingChannelId(result.landingChannelId);
      }
      clearPendingCommunityWorkspace();
      setCommunityJoinRequest(null);
      setCommunityJoinError(null);
      applyWorkspaceSwitchSession(result.user, result.token, operation);

      logger.info(Event.LOTUS_AUTH_CHECK, {
        stage: 'community_join_switch',
        workspaceId,
        userId: result.user.user_id,
      });
      return { kind: 'joined' };
    } finally {
      if (isAuthOperationCurrent(operation)) {
        setIsLoading(false);
      }
    }
  };

  const createWorkspace = async (workspaceName: string): Promise<void> => {
    const trimmedName = workspaceName.trim();
    if (!trimmedName) {
      throw new Error('Workspace name is required');
    }

    const previousUserId = user?.user_id;
    const currentToken = token;

    if (!currentToken) {
      throw new Error('Not authenticated');
    }

    const operation = beginAuthOperation();
    const generation = getAuthSessionGeneration();
    const previousWorkspaceId = getActiveWorkspaceId();
    setActiveWorkspaceId(null);
    try {
      const response = await createWorkspaceRequest(
        trimmedName,
        currentToken,
        generation,
        operation,
      );
      if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) return;
      if (!response.success || !response.user || !response.token) {
        throw new Error('Workspace creation failed');
      }

      beginWorkspaceSwitch();

      if (previousUserId) {
        clearWorkspaceRuntimeCaches(previousUserId);
      }

      const nextUserId = response.user.user_id;
      if (nextUserId) {
        clearWorkspaceRuntimeCaches(nextUserId);
      }

      syncResetWorkspaceSessionState();

      callLaunchHandler.reset();
      if (!isAuthOperationCurrent(operation)) return;
      const applied = await applyWorkspaceSwitchSession(response.user, response.token, operation);
      if (!applied) return;

      logger.info(Event.LOTUS_AUTH_CHECK, {
        stage: 'workspace_create',
        workspaceId: response.user.workspaceId,
        userId: response.user.user_id,
      });
    } catch (error) {
      if (isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation)) {
        setActiveWorkspaceId(previousWorkspaceId);
      }
      throw error;
    }
  };

  const createOrganization = async (input: {
    orgName: string;
    workspaceName: string;
  }): Promise<void> => {
    const operation = beginAuthOperation();
    const generation = getAuthSessionGeneration();
    const provider = pendingAuth?.provider ?? 'google';
    const previousWorkspaceId = getActiveWorkspaceId();
    setIsLoading(true);
    setActiveWorkspaceId(null);
    try {
      const response = await createOrganizationAndWorkspace(input, generation, operation);
      if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) return;
      if (!response.success || !response.user || !response.token) {
        throw new Error('Organization creation failed');
      }
      const applied = await applyAuthenticatedSession(response.user, response.token, operation);
      if (applied) {
        recordLoginForProvider(provider);
      }
    } catch (error) {
      if (isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation)) {
        setActiveWorkspaceId(previousWorkspaceId);
      }
      throw error;
    } finally {
      if (isAuthOperationCurrent(operation)) {
        setIsLoading(false);
      }
    }
  };

  const createEnterpriseWorkspace = async (workspaceName: string): Promise<void> => {
    const provider = pendingAuth?.provider ?? 'google';
    const operation = beginAuthOperation();
    setIsLoading(true);
    try {
      const response = await createWorkspaceInExistingOrg(workspaceName);
      if (!isAuthOperationCurrent(operation)) {
        return;
      }
      if (!response.success || !response.user || !response.token) {
        throw new Error('Workspace creation failed');
      }
      const applied = await applyAuthenticatedSession(response.user, response.token, operation);
      if (applied) {
        recordLoginForProvider(provider);
      }
    } finally {
      if (isAuthOperationCurrent(operation)) {
        setIsLoading(false);
      }
    }
  };

  const logAuthCleanupSummary = (
    stages: readonly CleanupStageResult[],
    remoteRevocationConfirmed: boolean,
    remoteRevocationAttempted: boolean,
  ): void => {
    const summary = summarizeAuthCleanup(stages, {
      remoteRevocationConfirmed,
      remoteRevocationAttempted,
    });
    logger.info(Event.LOTUS_LOGOUT_SUCCESS, {
      stage: 'signout_cleanup_summary',
      localInvalidationCompleted: summary.localInvalidationCompleted,
      localDeletionAttempted: summary.localDeletionAttempted,
      localDeletionConfirmed: summary.localDeletionConfirmed,
      remoteRevocationConfirmed: summary.remoteRevocationConfirmed,
      failedOrTimedOut: summary.failedOrTimedOut,
    });
  };

  const signOut = async (): Promise<void> => {
    const userId = user?.user_id;
    const sessionToken = token;
    const remoteRevocationAttempted = Boolean(userId);
    let generation = beginAuthSession();
    let operation = getAuthOperation();
    let remoteRevocationConfirmed = false;
    let preRemoteStages: CleanupStageResult[] = [];
    invalidateCachedAuthSnapshot();
    try {
      logger.info(Event.LOTUS_LOGOUT_SUCCESS, { stage: 'signout_start', userId });

      preRemoteStages = await runBestEffortCleanup(
        [
          {
            stage: 'mark_protected_auth_token_signed_out_before_remote_logout',
            run: markStoredAuthTokenSignedOut,
          },
          {
            stage: 'clear_notification_session_artifacts',
            run: clearNotificationSessionArtifacts,
          },
          {
            stage: 'clear_pending_share_artifacts',
            run: clearPendingShareArtifacts,
          },
          {
            stage: 'clear_global_auth_token_before_remote_logout',
            run: (): void => mmkvStorageAdapter.clearGlobalAuthToken(),
          },
          {
            stage: 'clear_global_user_context_before_remote_logout',
            run: (): void => mmkvStorageAdapter.clearGlobalUserContext(),
          },
          {
            stage: 'clear_shared_auth_identity_before_remote_logout',
            run: (): void => deleteKeys([USER_ID_KEY, USER_CACHE_KEY, ATTACHMENT_CACHE_NONCE_KEY]),
          },
          {
            stage: 'delete_protected_auth_token_before_remote_logout',
            run: (): Promise<void> =>
              deleteStoredAuthToken(generation, operation, {
                onDeleted: (): Promise<void> => clearNativeAuthContext(generation, operation),
              }),
          },
          {
            stage: 'unregister_push_device',
            run: (): Promise<void> => unregisterDeviceWithBackend(sessionToken ?? ''),
          },
          {
            stage: 'stop_proxy_and_clear_auth',
            run: stopProxyAndClearAuth,
          },
        ],
        (stage, error) => logger.error(Event.LOTUS_LOGOUT_FAILED, { error, stage }),
        () => isAuthSessionCurrent(generation) && isAuthOperationCurrent(operation),
      );

      if (userId) {
        const remoteLogout = await signOutUser(userId);
        remoteRevocationConfirmed = remoteLogout.confirmed;
        if (!remoteLogout.confirmed) {
          // Local invalidation remains non-blocking, but remote revocation must
          // be observable instead of being mistaken for a confirmed logout.
          logger.warn(Event.LOTUS_AUTH_CHECK, {
            stage: 'remote_logout_unconfirmed',
            reason: remoteLogout.reason,
          });
        }
        clearCustomEmojiCache(userId);
        queryClient.removeQueries({ queryKey: customEmojisQueryKey });
      }

      // The remote request is bounded and may still settle later. Advance the
      // session before local cleanup so any late response cookie injection is
      // rejected by the auth lifecycle guard.
      generation = beginAuthSession();
      operation = getAuthOperation();

      try {
        if (googleSignInAvailable && googleSignInConfigured && GoogleSignin) {
          await GoogleSignin.signOut();
        }
      } catch {
        logger.debug(Event.LOTUS_AUTH_CHECK, { stage: 'google_signout_failed' });
      }

      const storedStages = await clearStoredAuth({
        dropUserDatabases: true,
        generation,
        operation,
      });
      logAuthCleanupSummary(
        [...preRemoteStages, ...storedStages],
        remoteRevocationConfirmed,
        remoteRevocationAttempted,
      );
      if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) {
        return;
      }
      recordUserLogout();

      // Reset call launch handler state
      callLaunchHandler.reset();

      logger.info(Event.LOTUS_LOGOUT_SUCCESS, { stage: 'signout_complete', userId });
    } catch (error) {
      logger.error(Event.LOTUS_LOGOUT_FAILED, { error, userId });
      generation = beginAuthSession();
      operation = getAuthOperation();
      const storedStages = await clearStoredAuth({
        dropUserDatabases: true,
        generation,
        operation,
      });
      logAuthCleanupSummary(
        [...preRemoteStages, ...storedStages],
        remoteRevocationConfirmed,
        remoteRevocationAttempted,
      );
      if (!isAuthSessionCurrent(generation) || !isAuthOperationCurrent(operation)) {
        return;
      }
      recordUserLogout();
      callLaunchHandler.reset();
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        googleUser,
        isLoading,
        isSignedIn: !!user,
        pendingAuth,
        communityJoinRequest,
        communityJoinError,
        joinCommunityAndSwitch,
        clearCommunityJoinRequest: () => {
          setCommunityJoinRequest(null);
          setCommunityJoinError(null);
        },
        signIn,
        signInWithMicrosoft,
        signInWithEmail,
        signUpWithEmail,
        confirmEmailSignUp,
        resendSignUpCode,
        selectWorkspace,
        switchWorkspace,
        createWorkspace,
        createOrganization,
        requestEnterpriseJoin: requestEnterpriseWorkspaceJoin,
        createEnterpriseWorkspace,
        clearPendingAuth: () => setPendingAuth(null),
        signOut,
        token,
        applyRefreshedToken,
        workspaceSessionKey,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useAuthContextValues(): Context {
  const { user } = useAuth();
  if (!user) {
    throw new Error('useAuthContextValues must be used within an AuthProvider');
  }
  return {
    userID: user.user_id,
    workspaceId: user.workspaceId,
    role: user.role,
    orgRole: user.orgRole,
    memberId: user.memberId,
  };
}

/**
 * Retrieves the stored auth token outside of React component context.
 */
export async function getAuthToken(): Promise<string | null> {
  return getValidAccessToken();
}
