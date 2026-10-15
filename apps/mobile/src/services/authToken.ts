import { API_ORIGIN } from '../config';
import { decodeAuthJwtClaims, isTokenExpiringSoon } from './authJwtClaims';
import type { AuthJwtClaims } from './authJwtClaims';
import { refreshAuthSession } from './AuthServices';
import {
  getCookieValueFromJar,
  GOOGLE_ACCESS_TOKEN_COOKIE,
  XYNE_LAST_WORKSPACE_COOKIE,
} from '@/src/utils/apiCookieHeader';
import {
  getAuthOperation,
  getAuthSessionGeneration,
  isAuthScopeCurrent,
} from './authSessionLifecycle';
import {
  getStoredAuthToken,
  isStoredAuthTokenSignedOut,
  persistStoredAuthToken,
  type PersistStoredAuthTokenOptions,
} from './protectedAuthTokenStore';

export {
  AUTH_TOKEN_KEY,
  deleteStoredAuthToken,
  getStoredAuthToken,
  isStoredAuthTokenSignedOut,
  markStoredAuthTokenSignedOut,
} from './protectedAuthTokenStore';

export { decodeAuthJwtClaims, isTokenExpiringSoon };
export type { AuthJwtClaims };

export type AccessTokenSource =
  | 'workspace_cookie'
  | 'last_workspace_cookie'
  | 'legacy_google_cookie'
  | 'secure_store'
  | 'refresh_session'
  | 'none';

export interface ResolvedAccessToken {
  token: string | null;
  source: AccessTokenSource;
  cookieWorkspaceId?: string;
  claims: AuthJwtClaims | null;
  preferredWorkspaceId?: string;
  matchesPreferredWorkspace: boolean;
}

function tokenMatchesPreferredWorkspace(
  claims: AuthJwtClaims | null,
  preferredWorkspaceId?: string,
): boolean {
  if (!preferredWorkspaceId) {
    return true;
  }
  return claims?.workspaceId === preferredWorkspaceId;
}

function resolvedCookieMatchesPreferredWorkspace(
  cookieWorkspaceId: string | undefined,
  preferredWorkspaceId?: string,
): boolean {
  return Boolean(preferredWorkspaceId && cookieWorkspaceId === preferredWorkspaceId);
}

export async function persistAuthToken(
  token: string,
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
  options: PersistStoredAuthTokenOptions = {},
): Promise<boolean> {
  if (!isAuthScopeCurrent(generation, operation)) {
    return false;
  }
  return persistStoredAuthToken(token, generation, operation, options);
}

export async function readWorkspaceTokenFromCookieJar(
  workspaceId: string,
): Promise<string | undefined> {
  if (!workspaceId) {
    return undefined;
  }
  return getCookieValueFromJar(API_ORIGIN, `xyne_ws_${workspaceId}_token`);
}

async function readJwtFromCookieJar(preferredWorkspaceId?: string): Promise<{
  token?: string;
  source: AccessTokenSource;
  cookieWorkspaceId?: string;
}> {
  if (preferredWorkspaceId) {
    const preferredWorkspaceToken = await readWorkspaceTokenFromCookieJar(preferredWorkspaceId);
    if (preferredWorkspaceToken) {
      return {
        token: preferredWorkspaceToken,
        source: 'workspace_cookie',
        cookieWorkspaceId: preferredWorkspaceId,
      };
    }
  }

  const lastWorkspaceId = await getCookieValueFromJar(API_ORIGIN, XYNE_LAST_WORKSPACE_COOKIE);
  if (lastWorkspaceId) {
    const lastWorkspaceToken = await readWorkspaceTokenFromCookieJar(lastWorkspaceId);
    if (lastWorkspaceToken) {
      return {
        token: lastWorkspaceToken,
        source: 'last_workspace_cookie',
        cookieWorkspaceId: lastWorkspaceId,
      };
    }
  }

  const legacyToken = await getCookieValueFromJar(API_ORIGIN, GOOGLE_ACCESS_TOKEN_COOKIE);
  if (legacyToken) {
    return {
      token: legacyToken,
      source: 'legacy_google_cookie',
    };
  }

  return { source: 'none' };
}

export async function resolveAccessToken(options?: {
  preferredWorkspaceId?: string;
  minValiditySeconds?: number;
}): Promise<ResolvedAccessToken> {
  const generation = getAuthSessionGeneration();
  const operation = getAuthOperation();
  const preferredWorkspaceId = options?.preferredWorkspaceId;
  const minValiditySeconds = options?.minValiditySeconds ?? 300;

  // Cookies can outlive a failed local logout. A durable signed-out barrier
  // must win over any residual cookie until an explicit login persists a new
  // session through AuthContext.
  if (isStoredAuthTokenSignedOut()) {
    return {
      token: null,
      source: 'none',
      claims: null,
      ...(preferredWorkspaceId ? { preferredWorkspaceId } : {}),
      matchesPreferredWorkspace: false,
    };
  }

  const cookieResolution = await readJwtFromCookieJar(preferredWorkspaceId);
  if (!isAuthScopeCurrent(generation, operation)) {
    return {
      token: null,
      source: 'none',
      claims: null,
      ...(preferredWorkspaceId ? { preferredWorkspaceId } : {}),
      matchesPreferredWorkspace: false,
    };
  }
  if (cookieResolution.token && !isTokenExpiringSoon(cookieResolution.token, minValiditySeconds)) {
    const claims = decodeAuthJwtClaims(cookieResolution.token);
    const matchesPreferredWorkspace =
      tokenMatchesPreferredWorkspace(claims, preferredWorkspaceId) ||
      (!claims?.workspaceId &&
        resolvedCookieMatchesPreferredWorkspace(
          cookieResolution.cookieWorkspaceId,
          preferredWorkspaceId,
        ));
    if (!preferredWorkspaceId || matchesPreferredWorkspace) {
      const persisted = await persistAuthToken(cookieResolution.token, generation, operation);
      if (
        !persisted ||
        !isAuthScopeCurrent(generation, operation) ||
        isStoredAuthTokenSignedOut()
      ) {
        return {
          token: null,
          source: 'none',
          claims: null,
          ...(preferredWorkspaceId ? { preferredWorkspaceId } : {}),
          matchesPreferredWorkspace: false,
        };
      }
      return {
        token: cookieResolution.token,
        source: cookieResolution.source,
        ...(cookieResolution.cookieWorkspaceId
          ? { cookieWorkspaceId: cookieResolution.cookieWorkspaceId }
          : {}),
        claims,
        ...(preferredWorkspaceId ? { preferredWorkspaceId } : {}),
        matchesPreferredWorkspace,
      };
    }
  }

  const storedToken = await getStoredAuthToken(generation, operation);
  if (!isAuthScopeCurrent(generation, operation)) {
    return {
      token: null,
      source: 'none',
      claims: null,
      ...(preferredWorkspaceId ? { preferredWorkspaceId } : {}),
      matchesPreferredWorkspace: false,
    };
  }
  if (storedToken && !isTokenExpiringSoon(storedToken, minValiditySeconds)) {
    const claims = decodeAuthJwtClaims(storedToken);
    const matchesPreferredWorkspace = tokenMatchesPreferredWorkspace(claims, preferredWorkspaceId);
    if (!preferredWorkspaceId || matchesPreferredWorkspace) {
      return {
        token: storedToken,
        source: 'secure_store',
        claims,
        ...(preferredWorkspaceId ? { preferredWorkspaceId } : {}),
        matchesPreferredWorkspace,
      };
    }
  }

  const refreshResult = await refreshAuthSession(preferredWorkspaceId, generation, operation);
  if (!isAuthScopeCurrent(generation, operation)) {
    return {
      token: null,
      source: 'none',
      claims: null,
      ...(preferredWorkspaceId ? { preferredWorkspaceId } : {}),
      matchesPreferredWorkspace: false,
    };
  }
  if (!refreshResult.ok) {
    return {
      token: null,
      source: 'none',
      claims: null,
      ...(preferredWorkspaceId ? { preferredWorkspaceId } : {}),
      matchesPreferredWorkspace: false,
    };
  }

  const refreshedClaims = decodeAuthJwtClaims(refreshResult.token);
  const refreshedCookieWorkspaceId =
    preferredWorkspaceId &&
    (await readWorkspaceTokenFromCookieJar(preferredWorkspaceId)) === refreshResult.token
      ? preferredWorkspaceId
      : undefined;
  const matchesPreferredWorkspace =
    tokenMatchesPreferredWorkspace(refreshedClaims, preferredWorkspaceId) ||
    (!refreshedClaims?.workspaceId &&
      resolvedCookieMatchesPreferredWorkspace(refreshedCookieWorkspaceId, preferredWorkspaceId));

  if (preferredWorkspaceId && !matchesPreferredWorkspace) {
    return {
      token: null,
      source: 'none',
      claims: null,
      preferredWorkspaceId,
      matchesPreferredWorkspace: false,
    };
  }

  const persisted = await persistAuthToken(refreshResult.token, generation, operation);
  if (!persisted || !isAuthScopeCurrent(generation, operation) || isStoredAuthTokenSignedOut()) {
    return {
      token: null,
      source: 'none',
      claims: null,
      ...(preferredWorkspaceId ? { preferredWorkspaceId } : {}),
      matchesPreferredWorkspace: false,
    };
  }

  return {
    token: refreshResult.token,
    source: 'refresh_session',
    claims: refreshedClaims,
    ...(refreshedCookieWorkspaceId ? { cookieWorkspaceId: refreshedCookieWorkspaceId } : {}),
    ...(preferredWorkspaceId ? { preferredWorkspaceId } : {}),
    matchesPreferredWorkspace,
  };
}

export async function getValidAccessToken(
  minValiditySeconds: number = 300,
  preferredWorkspaceId?: string,
): Promise<string | null> {
  const resolved = await resolveAccessToken({
    minValiditySeconds,
    ...(preferredWorkspaceId ? { preferredWorkspaceId } : {}),
  });
  return resolved.token;
}

export async function buildAuthenticatedHeaders(
  minValiditySeconds: number = 300,
  preferredWorkspaceId?: string,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = await getValidAccessToken(minValiditySeconds, preferredWorkspaceId);

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}
