import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync } from 'expo-crypto';
import { apiGet, apiPost, isMtlsRequestError } from './apiClient';
import { setSessionRefresher, type SessionRefreshOutcome } from '@/src/utils/sessionRefreshOn401';
import { API_BASE_URL, API_ORIGIN } from '../config';
import { injectCookiesFromResponse, pointLastWorkspaceAt } from '@/src/utils/cookie-injection';
import { getResponseJson, mtlsFetch, type MtlsResponse } from '../utils/mtlsHttpClient';
import { isLikelyOfflineOrTransientNetworkError } from '@/src/utils/networkConnectivityErrors';
import {
  getCookieValueFromJar,
  REFRESH_SESSION_URL,
  workspaceTokenCookieName,
  XYNE_LAST_WORKSPACE_COOKIE,
} from '@/src/utils/apiCookieHeader';
import { getActiveWorkspaceId } from '../utils/activeWorkspace';
import { isSessionEndedRefusal } from './sessionTokenPolicy';
import { CommunityJoinResultStatus } from './CommunityServices';
import {
  classifyRemoteLogoutResponse,
  remoteLogoutFailed,
  remoteLogoutNotAttempted,
  type RemoteLogoutOutcome,
} from './remoteLogoutOutcome';
import {
  getAuthOperation,
  getAuthSessionGeneration,
  isAuthScopeCurrent,
  trackAuthSessionOperation,
} from './authSessionLifecycle';

export interface User {
  user_id: string;
  email: string;
  name: string;
  photo_url?: string;
  workspaceId: string;
  role: string;
  orgRole: string;
  memberId: string;
}

export interface AuthResponse {
  success: boolean;
  user: User;
  token: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role?: string;
}

export interface WorkspaceItem {
  id: string;
  name: string;
  role: string;
  orgId: string;
  orgName: string;
}

interface WorkspacesResponse {
  workspaces: WorkspaceItem[];
}

export interface WorkspaceNotificationCountItem {
  workspaceId: string;
  userId: string;
  count: number;
}

interface WorkspaceNotificationCountsResponse {
  counts: WorkspaceNotificationCountItem[];
}

interface BaseExchangeResult {
  success: true;
  profile: {
    email: string;
    name: string;
    picture?: string;
  };
  userExistsButRemoved?: boolean;
}

/** One enterprise workspace the user may request access to, from `enterpriseJoinWorkspaces`. */
export interface EnterpriseJoinWorkspace {
  id: string;
  name: string;
}

/**
 * The existing organization that owns the user's email domain.
 *
 * Present only when the backend reports a domain conflict — the user's domain already maps to an
 * active org, so they cannot create their own and must either request access to one of its
 * workspaces or spin up a new workspace inside it. Mirrors the dashboard's `EnterpriseJoinTarget`.
 */
export interface EnterpriseJoinTarget {
  orgName: string;
  workspaces: EnterpriseJoinWorkspace[];
}

/** Extra context the backend attaches when a user lands with no workspace of their own. */
export interface OrgCreationBlockers {
  /** e.g. "An organization already exists for example.com: Example. Ask an admin to invite you." */
  domainConflictError?: string;
  /** Set instead of `domainConflictError` when the address is a personal/public domain. */
  publicEmailDomainError?: string;
  enterpriseJoinTarget?: EnterpriseJoinTarget;
}

export type AuthExchangeResult =
  | (BaseExchangeResult & {
      kind: 'authenticated';
      token: string;
      user: User;
      workspaces: WorkspaceSummary[];
      sessionId?: string;
    })
  | (BaseExchangeResult & {
      kind: 'workspace_selection_required';
      workspaces: WorkspaceSummary[];
    })
  | (BaseExchangeResult &
      OrgCreationBlockers & {
        kind: 'org_creation_required';
        workspaces: [];
      })
  | {
      success: false;
      kind: 'removed_user';
      message: string;
      profile?: {
        email: string;
        name: string;
        picture?: string;
      };
    };

export type GoogleAuthResult = AuthExchangeResult;
export type EmailAuthResult = AuthExchangeResult;
export type MicrosoftAuthResult = AuthExchangeResult;

export interface CreateOrgRequest {
  orgName: string;
  workspaceName: string;
}

/** Response shape from `GET /api/auth/refresh-session` (JWT only via Set-Cookie). */
export interface RefreshSessionResponse {
  success: boolean;
  workspaceId?: string;
  /** Epoch milliseconds. */
  accessTokenExpiresAt?: number;
  message?: string;
}

export interface GetUserResponse {
  success: boolean;
  user: User | null;
  /** True when the request failed for connectivity/DNS/timeout — session should not be cleared. */
  isTransientError?: boolean;
  /** True only when the auth endpoint explicitly rejected the request. */
  isUnauthorized?: boolean;
}

interface BackendUserResponse {
  success: boolean;
  user: {
    id: string;
    name?: string;
    email?: string;
    googleId?: string;
    workspaceId?: string;
    role?: string;
    orgRole?: string;
    memberId?: string;
  };
  token?: string;
}

function mapBackendUserToLotusUser(backendUser: BackendUserResponse['user'], photoUrl = ''): User {
  return {
    user_id: backendUser.id,
    email: backendUser.email ?? '',
    name: backendUser.name ?? '',
    ...(photoUrl ? { photo_url: photoUrl } : {}),
    workspaceId: backendUser.workspaceId ?? '',
    role: backendUser.role ?? '',
    orgRole: backendUser.orgRole ?? '',
    memberId: backendUser.memberId ?? '',
  };
}

interface ExchangeMobileResponse {
  success: boolean;
  user?: {
    id?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
  userId?: string;
  /** The auth session the backend created; only sent when it logged straight into a single workspace. */
  sessionId?: string;
  email?: string;
  name?: string;
  picture?: string;
  workspaces?: WorkspaceSummary[];
  userExistsButRemoved?: boolean;
  message?: string;
  /**
   * Domain-conflict context, sent when `workspaces` is empty. `enterpriseJoinWorkspaces` arrives as
   * a JSON-encoded string, not an array — the backend stringifies it so the same fields can also
   * travel as OAuth redirect query params on web.
   */
  domainConflictError?: string;
  publicEmailDomainError?: string;
  enterpriseJoinOrgName?: string;
  enterpriseJoinWorkspaces?: string;
}

interface MicrosoftExchangeInput {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

interface EmailLoginResponse {
  success: boolean;
  user?: {
    id?: string;
    email?: string;
    name?: string;
    picture?: string;
    workspaceId?: string;
  };
  workspaces?: WorkspaceSummary[];
  pendingUserData?: {
    email?: string;
    name?: string;
    picture?: string;
  };
  userExistsButRemoved?: boolean;
  invitationPending?: boolean;
  invitationId?: string;
  message?: string;
  error?: string;
  /**
   * Domain-conflict context, sent when `workspaces` is empty. `enterpriseJoinWorkspaces` arrives as
   * a JSON-encoded string, not an array — the backend stringifies it so the same fields can also
   * travel as OAuth redirect query params on web.
   */
  domainConflictError?: string;
  publicEmailDomainError?: string;
  enterpriseJoinOrgName?: string;
  enterpriseJoinWorkspaces?: string;
}

interface PasswordActionResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

/** `POST /v2/auth/email/register` — the code is emailed, never returned in the body. */
interface EmailRegisterResponse {
  success: boolean;
  email?: string;
  message?: string;
  error?: string;
}

/**
 * `POST /v2/auth/email/verify`.
 *
 * Shares the shape of `EmailLoginResponse` because the backend deliberately returns the same
 * payload as the OAuth callback — an empty `workspaces` array when a `workspaceId` was supplied,
 * so the client falls through to the join flow.
 */
type EmailVerifyResponse = EmailLoginResponse;

interface WorkspaceCompletionResponse {
  success: boolean;
  workspaceId?: string;
  user?: {
    id?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
  message?: string;
}

interface SwitchWorkspaceResponse {
  user?: {
    id?: string;
    email?: string;
    name?: string;
    picture?: string;
    workspaceId?: string;
    role?: string;
    memberId?: string;
  };
  selfDmChannelId?: string;
}

interface CommunityJoinResponse {
  success?: boolean;
  status?: CommunityJoinResultStatus;
  workspaceId?: string;
  landingChannelId?: string | null;
  selfDmChannelId?: string | null;
  isNewUser?: boolean;
  user?: {
    id?: string;
    email?: string;
    name?: string;
    picture?: string;
    workspaceId?: string;
  };
  joinRequest?: {
    id?: string;
    status?: string;
    isExisting?: boolean;
  };
}

/** Outcome of `POST /community/:workspaceId/join` — either a live session or a queued request. */
export type CommunityJoinResult =
  | {
      kind: 'joined';
      token: string;
      user: User;
      landingChannelId: string | null;
      selfDmChannelId: string | null;
      isNewUser: boolean;
    }
  | {
      kind: 'request';
      status:
        | typeof CommunityJoinResultStatus.REQUEST_PENDING
        | typeof CommunityJoinResultStatus.REQUEST_REJECTED;
      requestId: string | null;
      isExisting: boolean;
    };

interface CreateWorkspaceResponse {
  workspace?: {
    id?: string;
    name?: string;
  };
  user?: {
    id?: string;
    email?: string;
    name?: string;
    picture?: string;
    workspaceId?: string;
  };
  selfDmChannelId?: string;
}

export type RefreshSessionResult =
  | {
      ok: true;
      token: string;
      /** The workspace the backend minted the JWT for (`data.workspaceId`). */
      workspaceId?: string;
    }
  | {
      ok: false;
      /**
       * `workspace_mismatch`: the backend refreshed a different workspace than the
       * caller asked for; that workspace's token is never handed out as this one's.
       */
      kind:
        'unauthorized' | 'invalid_body' | 'missing_jwt_cookie' | 'workspace_mismatch' | 'transient';
    };

async function readJwtFromJarAfterInjection(workspaceId?: string): Promise<string | undefined> {
  if (workspaceId) {
    const workspaceToken = await getCookieValueFromJar(
      API_ORIGIN,
      workspaceTokenCookieName(workspaceId),
    );
    if (workspaceToken) {
      return workspaceToken;
    }
  }

  const resolvedWorkspaceId = await getCookieValueFromJar(API_ORIGIN, XYNE_LAST_WORKSPACE_COOKIE);
  if (resolvedWorkspaceId) {
    const workspaceToken = await getCookieValueFromJar(
      API_ORIGIN,
      workspaceTokenCookieName(resolvedWorkspaceId),
    );
    if (workspaceToken) {
      return workspaceToken;
    }
  }
  return undefined;
}

async function postAuthJson<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ data: T; headers: Record<string, string | string[]> }> {
  const response = await mtlsFetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Platform': 'mobile',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(body),
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const message = extractErrorMessage(response, response.statusCode);
    throw new Error(message);
  }

  const data = parseResponseJson<T>(response);
  if (!data) {
    throw new Error('Invalid response from server');
  }

  return { data, headers: response.headers };
}

export async function getUserById(_userId: string, token: string): Promise<GetUserResponse> {
  try {
    const data = await apiGet<BackendUserResponse>('/v2/auth/me', { token });

    if (data.success && data.user) {
      return {
        success: true,
        user: mapBackendUserToLotusUser(data.user),
      };
    }

    return { success: false, user: null };
  } catch (err: unknown) {
    if (isMtlsRequestError(err) && (err.statusCode === 401 || err.statusCode === 403)) {
      return { success: false, user: null, isUnauthorized: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    if (isLikelyOfflineOrTransientNetworkError(message)) {
      return { success: false, user: null, isTransientError: true };
    }
    return { success: false, user: null };
  }
}

export async function authenticateWithGoogle(
  serverAuthCode: string,
  userInfo: {
    email: string;
    name: string;
    photo?: string;
  },
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
): Promise<GoogleAuthResult> {
  const url = `${API_BASE_URL}/v2/auth/exchange-mobile?platform=mobile`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Platform': 'mobile',
    'X-Requested-With': 'XMLHttpRequest',
  };
  const body = JSON.stringify({ code: serverAuthCode });

  const response = await mtlsFetch(url, {
    method: 'POST',
    headers,
    body,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const parsed = parseResponseJson<{ message?: string }>(response);
    throw new Error(parsed?.message || `Authentication failed: ${response.statusCode}`);
  }

  await injectCookiesFromResponse(API_ORIGIN, response.headers, {
    waitForPropagation: true,
    generation,
    operation,
  });
  if (!isAuthScopeCurrent(generation, operation)) {
    throw new Error('Authentication session superseded');
  }

  const data = parseResponseJson<ExchangeMobileResponse>(response);
  if (!data) {
    throw new Error('Invalid response from server');
  }

  if (!data.success) {
    throw new Error(data.message || 'Backend authentication failed');
  }

  return resolveMobileAuthExchangeResult(data, userInfo, generation, operation);
}

/**
 * Lifts the backend's flat domain-conflict fields into the shape the login screen renders.
 *
 * `enterpriseJoinWorkspaces` is a JSON string; a malformed or non-array payload is dropped rather
 * than thrown, since a missing request-to-join list must never block the rest of the sign-in.
 */
function readOrgCreationBlockers(data: {
  domainConflictError?: string;
  publicEmailDomainError?: string;
  enterpriseJoinOrgName?: string;
  enterpriseJoinWorkspaces?: string;
}): OrgCreationBlockers {
  const blockers: OrgCreationBlockers = {};

  if (data.domainConflictError) {
    blockers.domainConflictError = data.domainConflictError;
  }
  if (data.publicEmailDomainError) {
    blockers.publicEmailDomainError = data.publicEmailDomainError;
  }

  if (!data.enterpriseJoinOrgName) {
    return blockers;
  }

  let workspaces: EnterpriseJoinWorkspace[] = [];
  if (data.enterpriseJoinWorkspaces) {
    try {
      const parsed: unknown = JSON.parse(data.enterpriseJoinWorkspaces);
      if (Array.isArray(parsed)) {
        workspaces = parsed.filter(
          (entry): entry is EnterpriseJoinWorkspace =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as { id?: unknown }).id === 'string' &&
            typeof (entry as { name?: unknown }).name === 'string',
        );
      }
    } catch {
      workspaces = [];
    }
  }

  blockers.enterpriseJoinTarget = { orgName: data.enterpriseJoinOrgName, workspaces };
  return blockers;
}

async function resolveMobileAuthExchangeResult(
  data: ExchangeMobileResponse,
  fallbackProfile: {
    email: string;
    name: string;
    photo?: string;
  },
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
): Promise<AuthExchangeResult> {
  const profilePicture = data.user?.picture || data.picture || fallbackProfile.photo;
  const profile = {
    email: data.user?.email || data.email || fallbackProfile.email,
    name: data.user?.name || data.name || fallbackProfile.name,
    ...(profilePicture ? { picture: profilePicture } : {}),
  };
  const workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
  const userExistsButRemoved = data.userExistsButRemoved === true;
  // Why the user cannot create their own org (domain already claimed / personal domain), plus the
  // workspaces they may request access to. Only meaningful on the `org_creation_required` returns.
  const blockers = readOrgCreationBlockers(data);

  if (userExistsButRemoved && workspaces.length === 0) {
    return {
      success: false,
      kind: 'removed_user',
      message: 'Your account exists but is not active in any workspace.',
      profile,
    };
  }

  const hasResolvedUser = typeof data.user?.id === 'string' || typeof data.userId === 'string';
  const sessionId = data.sessionId;

  if (!hasResolvedUser && !sessionId) {
    if (workspaces.length > 0) {
      return {
        success: true,
        kind: 'workspace_selection_required',
        profile,
        workspaces,
        ...(userExistsButRemoved ? { userExistsButRemoved } : {}),
      };
    }
    return {
      success: true,
      kind: 'org_creation_required',
      profile,
      workspaces: [],
      ...blockers,
      ...(userExistsButRemoved ? { userExistsButRemoved } : {}),
    };
  }

  const token = await ensureTokenFromSession(undefined, generation, operation);
  if (!token) {
    if (hasResolvedUser) {
      throw new Error('Authentication succeeded but workspace token was not available');
    }
    // Session cookie present but no usable JWT (e.g. stale cookies from a prior login) —
    // fall back to the selection flow instead of crashing.
    if (workspaces.length > 0) {
      return {
        success: true,
        kind: 'workspace_selection_required',
        profile,
        workspaces,
        ...(userExistsButRemoved ? { userExistsButRemoved } : {}),
      };
    }
    return {
      success: true,
      kind: 'org_creation_required',
      profile,
      workspaces: [],
      ...blockers,
      ...(userExistsButRemoved ? { userExistsButRemoved } : {}),
    };
  }

  const userIdHint = data.user?.id || data.userId;
  let user: User;
  try {
    user = await resolveAuthenticatedUser(
      token,
      {
        email: profile.email,
        name: profile.name,
        ...(profile.picture ? { photo: profile.picture } : {}),
      },
      userIdHint,
    );
  } catch (err) {
    if (!hasResolvedUser) {
      // Token present but /me returned 401 — likely a stale workspace token from a
      // previous session. Direct the user through workspace/org selection instead of
      // showing "Unable to resolve authenticated user profile".
      if (workspaces.length > 0) {
        return {
          success: true,
          kind: 'workspace_selection_required',
          profile,
          workspaces,
          ...(userExistsButRemoved ? { userExistsButRemoved } : {}),
        };
      }
      return {
        success: true,
        kind: 'org_creation_required',
        profile,
        workspaces: [],
        ...blockers,
        ...(userExistsButRemoved ? { userExistsButRemoved } : {}),
      };
    }
    throw err;
  }

  if (!user.workspaceId) {
    if (workspaces.length > 0) {
      return {
        success: true,
        kind: 'workspace_selection_required',
        profile,
        workspaces,
        ...(userExistsButRemoved ? { userExistsButRemoved } : {}),
      };
    }
    return {
      success: true,
      kind: 'org_creation_required',
      profile,
      workspaces: [],
      ...blockers,
      ...(userExistsButRemoved ? { userExistsButRemoved } : {}),
    };
  }

  return {
    success: true,
    kind: 'authenticated',
    token,
    user,
    workspaces,
    profile,
    ...(sessionId ? { sessionId } : {}),
    ...(userExistsButRemoved ? { userExistsButRemoved } : {}),
  };
}

export async function authenticateWithMicrosoft(
  input: MicrosoftExchangeInput,
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
): Promise<MicrosoftAuthResult> {
  const code = input.code.trim();
  const codeVerifier = input.codeVerifier.trim();
  const redirectUri = input.redirectUri.trim();

  if (!code || !codeVerifier || !redirectUri) {
    throw new Error('Microsoft authorization code, verifier, and redirect URI are required');
  }

  const exchangeBody: Record<string, unknown> = { code };
  exchangeBody['code_verifier'] = codeVerifier;
  exchangeBody['redirect_uri'] = redirectUri;

  const { data, headers } = await postAuthJson<ExchangeMobileResponse>(
    '/v2/auth/microsoft/exchange-mobile',
    exchangeBody,
  );

  if (!data.success) {
    throw new Error(data.message || 'Microsoft authentication failed');
  }

  await injectCookiesFromResponse(API_ORIGIN, headers, {
    waitForPropagation: true,
    generation,
    operation,
  });
  if (!isAuthScopeCurrent(generation, operation)) {
    throw new Error('Authentication session superseded');
  }

  return resolveMobileAuthExchangeResult(
    data,
    {
      email: data.user?.email || data.email || '',
      name: data.user?.name || data.name || '',
      ...(data.user?.picture || data.picture ? { photo: data.user?.picture || data.picture } : {}),
    },
    generation,
    operation,
  );
}

export async function authenticateWithEmail(
  input: {
    email: string;
    password: string;
  },
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
): Promise<EmailAuthResult> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const { data, headers } = await postAuthJson<EmailLoginResponse>('/v2/auth/email/login', {
    email,
    password,
  });

  if (!data.success) {
    throw new Error(data.message || data.error || 'Email login failed');
  }

  if (data.invitationPending) {
    throw new Error('Please finish accepting your invitation before signing in on mobile.');
  }

  await injectCookiesFromResponse(API_ORIGIN, headers, {
    waitForPropagation: true,
    generation,
    operation,
  });
  if (!isAuthScopeCurrent(generation, operation)) {
    throw new Error('Authentication session superseded');
  }

  const profilePicture = data.pendingUserData?.picture || data.user?.picture;
  const profile = {
    email: data.pendingUserData?.email || data.user?.email || email,
    name: data.pendingUserData?.name || data.user?.name || email.split('@')[0] || email,
    ...(profilePicture ? { picture: profilePicture } : {}),
  };
  const workspaces = Array.isArray(data.workspaces) ? data.workspaces : [];
  const userExistsButRemoved = data.userExistsButRemoved === true;

  if (userExistsButRemoved && workspaces.length === 0) {
    return {
      success: false,
      kind: 'removed_user',
      message: 'Your account exists but is not active in any workspace.',
      profile,
    };
  }

  if (workspaces.length > 1) {
    return {
      success: true,
      kind: 'workspace_selection_required',
      profile,
      workspaces,
      ...(userExistsButRemoved ? { userExistsButRemoved } : {}),
    };
  }

  const workspaceId = data.user?.workspaceId || workspaces[0]?.id;
  const token = await ensureTokenFromSession(workspaceId, generation, operation);
  if (!token) {
    // No workspace and no token means the account exists but owns nothing yet — the same state the
    // OAuth exchange reports as `org_creation_required`. Surface it (with any domain-conflict
    // context) instead of failing, so the login screen can offer create-org / request-access.
    if (workspaces.length === 0) {
      return {
        success: true,
        kind: 'org_creation_required',
        profile,
        workspaces: [],
        ...readOrgCreationBlockers(data),
        ...(userExistsButRemoved ? { userExistsButRemoved } : {}),
      };
    }
    throw new Error('Email login succeeded but workspace token was not available');
  }

  const user = await resolveAuthenticatedUser(
    token,
    {
      email: profile.email,
      name: profile.name,
      ...(profile.picture ? { photo: profile.picture } : {}),
    },
    data.user?.id,
  );

  return {
    success: true,
    kind: 'authenticated',
    token,
    user,
    workspaces,
    profile,
    ...(userExistsButRemoved ? { userExistsButRemoved } : {}),
  };
}

/**
 * Client-side password digest for registration.
 *
 * `POST /v2/auth/email/register` requires `hashedPassword` and rejects anything that is not a
 * lowercase SHA-256 hex string (`isClientPasswordHash` in the backend's `passwordUtils.ts`).
 * This mirrors the dashboard's `hashPasswordForAuth` exactly so both clients produce the same
 * credential for the same password.
 *
 * Note the asymmetry: only *register* takes a hash. `email/login` and `email/reset-password`
 * take the plaintext password and hash it server-side — do not pass this value to those.
 */
async function hashPasswordForAuth(password: string): Promise<string> {
  return (
    await digestStringAsync(CryptoDigestAlgorithm.SHA256, password, {
      encoding: CryptoEncoding.HEX,
    })
  ).toLowerCase();
}

/**
 * Starts email registration: emails a 6-digit code and stores the pending credential server-side.
 *
 * The backend answers 200 with the same generic message whether or not the address is already
 * registered, so this deliberately cannot be used to probe for existing accounts. Completion
 * happens in `verifyEmailRegistration`.
 *
 * `workspaceId` scopes the registration to a community; when supplied, `verify` returns an empty
 * `workspaces` array so the caller falls through to the join flow.
 *
 * Rate-limited server-side to one request per email per 60s (429).
 */
export async function registerWithEmail(input: {
  email: string;
  password: string;
  name: string;
  workspaceId?: string;
}): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!email || !input.password || !name) {
    throw new Error('Name, email, and password are required');
  }

  const { data } = await postAuthJson<EmailRegisterResponse>('/v2/auth/email/register', {
    email,
    name,
    hashedPassword: await hashPasswordForAuth(input.password),
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
  });

  if (!data.success) {
    throw new Error(data.message || data.error || 'Registration failed');
  }

  return data.message || 'Enter the verification code we sent to your email.';
}

/** Re-sends the registration code. Subject to the same 60s server-side rate limit (429). */
export async function resendRegistrationCode(email: string): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('Email is required');
  }

  const { data } = await postAuthJson<PasswordActionResponse>('/v2/auth/email/resend-code', {
    email: normalizedEmail,
  });

  return data.message || 'A new verification code has been sent.';
}

/**
 * Completes registration with the emailed code.
 *
 * On success the backend sets the `xyne_pending_auth` pending-auth cookie — the same cookie the
 * OAuth callback issues — which is what lets `joinCommunityWorkspace()` authenticate immediately
 * afterwards without a separate sign-in. That cookie is short-lived (10 minutes, single-use), so
 * the caller should complete the join promptly.
 *
 * The response mirrors the OAuth callback, so it is resolved through the shared
 * `resolveMobileAuthExchangeResult` and can be handed straight to `applyAuthenticationResult`.
 */
export async function verifyEmailRegistration(input: {
  email: string;
  code: string;
}): Promise<EmailAuthResult> {
  const email = input.email.trim().toLowerCase();
  const code = input.code.trim();

  if (!email || !code) {
    throw new Error('Email and verification code are required');
  }

  const { data, headers } = await postAuthJson<EmailVerifyResponse>('/v2/auth/email/verify', {
    email,
    code,
  });

  if (!data.success) {
    throw new Error(data.message || data.error || 'Verification failed');
  }

  await injectCookiesFromResponse(API_ORIGIN, headers);

  return resolveMobileAuthExchangeResult(
    {
      success: data.success,
      ...(data.user ? { user: data.user } : {}),
      ...(data.workspaces ? { workspaces: data.workspaces } : {}),
      ...(data.userExistsButRemoved !== undefined
        ? { userExistsButRemoved: data.userExistsButRemoved }
        : {}),
      // Registration verification is the one email endpoint that reports a domain conflict — the
      // backend runs the same org-domain check the OAuth callback does when no workspaceId was sent.
      ...(data.domainConflictError ? { domainConflictError: data.domainConflictError } : {}),
      ...(data.publicEmailDomainError
        ? { publicEmailDomainError: data.publicEmailDomainError }
        : {}),
      ...(data.enterpriseJoinOrgName ? { enterpriseJoinOrgName: data.enterpriseJoinOrgName } : {}),
      ...(data.enterpriseJoinWorkspaces
        ? { enterpriseJoinWorkspaces: data.enterpriseJoinWorkspaces }
        : {}),
    },
    {
      email: data.pendingUserData?.email || email,
      name: data.pendingUserData?.name || email.split('@')[0] || email,
      ...(data.pendingUserData?.picture ? { photo: data.pendingUserData.picture } : {}),
    },
  );
}

export async function requestPasswordResetCode(email: string): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('Email is required');
  }

  const { data } = await postAuthJson<PasswordActionResponse>('/v2/auth/email/forgot-password', {
    email: normalizedEmail,
  });

  return data.message || 'If an account exists, a reset code has been sent.';
}

export async function resetPasswordWithCode(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const code = input.code.trim();
  const newPassword = input.newPassword;

  if (!email || !code || !newPassword) {
    throw new Error('Email, code, and new password are required');
  }

  const { data } = await postAuthJson<PasswordActionResponse>('/v2/auth/email/reset-password', {
    email,
    code,
    newPassword,
  });

  return data.message || 'Password reset successful. You can now log in.';
}

function mapSwitchWorkspaceUserToLotusUser(
  backendUser: NonNullable<SwitchWorkspaceResponse['user']>,
): User | null {
  if (
    typeof backendUser.id !== 'string' ||
    typeof backendUser.email !== 'string' ||
    typeof backendUser.name !== 'string' ||
    typeof backendUser.workspaceId !== 'string'
  ) {
    return null;
  }

  return {
    user_id: backendUser.id,
    email: backendUser.email,
    name: backendUser.name,
    ...(backendUser.picture ? { photo_url: backendUser.picture } : {}),
    workspaceId: backendUser.workspaceId,
    role: backendUser.role ?? '',
    orgRole: '',
    memberId: backendUser.memberId ?? '',
  };
}

export async function loginToWorkspace(
  workspaceId: string,
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
): Promise<AuthResponse> {
  const url = `${API_BASE_URL}/auth/login-workspace`;
  const response = await mtlsFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Platform': 'mobile',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({ workspaceId }),
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const message = extractErrorMessage(response, response.statusCode);
    throw new Error(message);
  }

  await injectCookiesFromResponse(API_ORIGIN, response.headers, {
    waitForPropagation: true,
    generation,
    operation,
  });
  if (!isAuthScopeCurrent(generation, operation)) {
    throw new Error('Authentication session superseded');
  }
  const token = await ensureTokenFromSession(undefined, generation, operation);
  if (!token) {
    throw new Error('Workspace login succeeded but token was not available');
  }

  const parsed = parseResponseJson<WorkspaceCompletionResponse>(response);
  const userIdHint = parsed?.user?.id;
  const user = await resolveAuthenticatedUser(token, { email: '', name: '' }, userIdHint);

  return {
    success: true,
    token,
    user,
  };
}

/**
 * Joins a public community workspace.
 *
 * Identity comes from the cookie jar: the backend accepts either the short-lived
 * `xyne_pending_auth` pending-auth cookie (brand-new user, not yet in any workspace) or a
 * workspace JWT cookie (returning user). On success the response sets the same
 * workspace cookies as `POST /auth/login-workspace`, so the token is resolved the same way.
 *
 * An empty body is sent deliberately, matching the dashboard, so the workspace's own
 * `landingChannelId` is used rather than a client-supplied one.
 */
export async function joinCommunityWorkspace(workspaceId: string): Promise<CommunityJoinResult> {
  const url = `${API_BASE_URL}/community/${encodeURIComponent(workspaceId)}/join`;
  const response = await mtlsFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Platform': 'mobile',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({}),
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const message = extractErrorMessage(response, response.statusCode);
    throw new Error(message);
  }

  await injectCookiesFromResponse(API_ORIGIN, response.headers);

  const parsed = parseResponseJson<CommunityJoinResponse>(response);

  if (
    parsed?.status === CommunityJoinResultStatus.REQUEST_PENDING ||
    parsed?.status === CommunityJoinResultStatus.REQUEST_REJECTED
  ) {
    return {
      kind: 'request',
      status: parsed.status,
      requestId: parsed.joinRequest?.id ?? null,
      isExisting: parsed.joinRequest?.isExisting === true,
    };
  }

  const token = await ensureTokenFromSession(workspaceId);
  if (!token) {
    throw new Error('Joined the community but the workspace token was not available');
  }

  const userIdHint = parsed?.user?.id;
  const user = await resolveAuthenticatedUser(token, { email: '', name: '' }, userIdHint);

  return {
    kind: 'joined',
    token,
    user,
    landingChannelId: parsed?.landingChannelId ?? null,
    selfDmChannelId: parsed?.selfDmChannelId ?? null,
    isNewUser: parsed?.isNewUser === true,
  };
}

/**
 * Asks an existing **enterprise** workspace for access — the mobile counterpart of the dashboard's
 * "Request to join" button on the "Organization Already Exists" screen.
 *
 * Same endpoint as a community join, but `workspaceType: 'ENTERPRISE'` makes the backend queue a
 * join request for admin review rather than granting membership. Identity comes from the
 * short-lived `xyne_pending_auth` pending-auth cookie already in the jar, so this must run while
 * that cookie is still valid (10 minutes from sign-in).
 */
export async function requestEnterpriseWorkspaceJoin(
  workspaceId: string,
): Promise<{ status: string | null; isExisting: boolean }> {
  const url = `${API_BASE_URL}/community/${encodeURIComponent(workspaceId)}/join`;
  const response = await mtlsFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Platform': 'mobile',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({ workspaceType: 'ENTERPRISE' }),
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(extractErrorMessage(response, response.statusCode));
  }

  await injectCookiesFromResponse(API_ORIGIN, response.headers);

  const parsed = parseResponseJson<CommunityJoinResponse>(response);
  return {
    status: parsed?.joinRequest?.status ?? parsed?.status ?? null,
    isExisting: parsed?.joinRequest?.isExisting === true,
  };
}

/**
 * Creates a new workspace inside the organization that already owns the user's email domain.
 *
 * `POST /auth/create-workspace-pending` differs from `POST /auth/create-workspace` in that it
 * authenticates off the pending-auth cookie rather than a bearer token — which is the only
 * credential available at this point, since the user has no workspace to hold a JWT for. It
 * responds with the same workspace cookies as a normal login, so the token is read from the jar.
 */
export async function createWorkspaceInExistingOrg(workspaceName: string): Promise<AuthResponse> {
  const trimmedName = workspaceName.trim();
  if (!trimmedName) {
    throw new Error('Workspace name is required');
  }

  const url = `${API_BASE_URL}/auth/create-workspace-pending`;
  const response = await mtlsFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Platform': 'mobile',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify({ workspaceName: trimmedName, workspaceType: 'ENTERPRISE' }),
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(extractErrorMessage(response, response.statusCode));
  }

  await injectCookiesFromResponse(API_ORIGIN, response.headers);
  const parsed = parseResponseJson<CreateWorkspaceResponse>(response);
  const workspaceId = parsed?.workspace?.id ?? parsed?.user?.workspaceId;
  const nextToken =
    (workspaceId ? await readJwtFromJarAfterInjection(workspaceId) : undefined) ??
    (await ensureTokenFromSession(workspaceId));
  if (!nextToken) {
    throw new Error('Workspace creation succeeded but token was not available');
  }

  const user = await resolveAuthenticatedUser(nextToken, { email: '', name: '' }, parsed?.user?.id);

  return { success: true, token: nextToken, user };
}

export async function switchToWorkspace(
  workspaceId: string,
  token: string,
  /** The workspace the caller is signed in to; its cookie authenticates the switch. */
  currentWorkspaceId: string | undefined,
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
): Promise<AuthResponse> {
  const url = `${API_BASE_URL}/auth/switch-workspace`;
  const response = await mtlsFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Platform': 'mobile',
      'X-Requested-With': 'XMLHttpRequest',
      Authorization: `Bearer ${token}`,
      ...(currentWorkspaceId ? { 'x-workspace-id': currentWorkspaceId } : {}),
    },
    body: JSON.stringify({ workspaceId }),
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const message = extractErrorMessage(response, response.statusCode);
    throw new Error(message);
  }

  await injectCookiesFromResponse(API_ORIGIN, response.headers, {
    waitForPropagation: true,
    generation,
    operation,
  });
  if (!isAuthScopeCurrent(generation, operation)) {
    throw new Error('Authentication session superseded');
  }
  const nextToken =
    (await readJwtFromJarAfterInjection(workspaceId)) ??
    (await ensureTokenFromSession(workspaceId, generation, operation));
  if (!nextToken) {
    throw new Error('Workspace switch succeeded but token was not available');
  }

  const parsed = parseResponseJson<SwitchWorkspaceResponse>(response);
  const user = parsed?.user ? mapSwitchWorkspaceUserToLotusUser(parsed.user) : null;
  if (!user || user.workspaceId !== workspaceId) {
    throw new Error('Workspace switch succeeded but target user was not available');
  }

  return {
    success: true,
    token: nextToken,
    user,
  };
}

export async function createWorkspace(
  workspaceName: string,
  token: string,
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
): Promise<AuthResponse> {
  const trimmedName = workspaceName.trim();
  if (!trimmedName) {
    throw new Error('Workspace name is required');
  }

  const url = `${API_BASE_URL}/auth/create-workspace`;
  const response = await mtlsFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Platform': 'mobile',
      'X-Requested-With': 'XMLHttpRequest',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ workspaceName: trimmedName }),
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const message = extractErrorMessage(response, response.statusCode);
    throw new Error(message);
  }

  await injectCookiesFromResponse(API_ORIGIN, response.headers, {
    waitForPropagation: true,
    generation,
    operation,
  });
  if (!isAuthScopeCurrent(generation, operation)) {
    throw new Error('Authentication session superseded');
  }
  const parsed = parseResponseJson<CreateWorkspaceResponse>(response);
  const workspaceId = parsed?.workspace?.id ?? parsed?.user?.workspaceId;
  const nextToken =
    (workspaceId ? await readJwtFromJarAfterInjection(workspaceId) : undefined) ??
    (await ensureTokenFromSession(workspaceId, generation, operation));
  if (!nextToken) {
    throw new Error('Workspace creation succeeded but token was not available');
  }

  const userIdHint = parsed?.user?.id;
  const user = await resolveAuthenticatedUser(nextToken, { email: '', name: '' }, userIdHint);

  return {
    success: true,
    token: nextToken,
    user,
  };
}

/**
 * `POST /auth/create-org` refused because the email domain already maps to an active organization.
 *
 * Carries the org name so the caller can switch to the "Organization Already Exists" screen. Note
 * the backend's conflict body reports `existingOrg` only — it does **not** list that org's
 * workspaces, so `enterpriseJoinTarget.workspaces` cannot be recovered from this path.
 */
export class OrganizationDomainConflictError extends Error {
  readonly orgName: string | null;
  readonly domain: string | null;

  constructor(message: string, orgName: string | null, domain: string | null) {
    super(message);
    this.name = 'OrganizationDomainConflictError';
    this.orgName = orgName;
    this.domain = domain;
  }
}

/** `POST /auth/create-org` refused because the address is a personal/public email domain. */
export class PublicEmailDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicEmailDomainError';
  }
}

interface CreateOrgErrorResponse {
  code?: string;
  domain?: string;
  existingOrg?: { orgId?: string; name?: string };
}

export async function createOrganizationAndWorkspace(
  input: CreateOrgRequest,
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
): Promise<AuthResponse> {
  const url = `${API_BASE_URL}/auth/create-org`;
  const response = await mtlsFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Platform': 'mobile',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(input),
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const message = extractErrorMessage(response, response.statusCode);
    const details = parseResponseJson<CreateOrgErrorResponse>(response);
    const lowerMessage = message.toLowerCase();

    // Same string matching the dashboard uses to pick its screen — the backend signals these two
    // policy refusals through the message, and only sometimes through `code`.
    if (details?.existingOrg || lowerMessage.includes('organization already exists for')) {
      throw new OrganizationDomainConflictError(
        message,
        details?.existingOrg?.name ?? null,
        details?.domain ?? null,
      );
    }
    if (lowerMessage.includes('public email domains')) {
      throw new PublicEmailDomainError(message);
    }
    throw new Error(message);
  }

  await injectCookiesFromResponse(API_ORIGIN, response.headers, {
    waitForPropagation: true,
    generation,
    operation,
  });
  if (!isAuthScopeCurrent(generation, operation)) {
    throw new Error('Authentication session superseded');
  }
  const token = await ensureTokenFromSession(undefined, generation, operation);
  if (!token) {
    throw new Error('Organization creation succeeded but token was not available');
  }

  const parsed = parseResponseJson<WorkspaceCompletionResponse>(response);
  const userIdHint = parsed?.user?.id;
  const user = await resolveAuthenticatedUser(token, { email: '', name: '' }, userIdHint);

  return {
    success: true,
    token,
    user,
  };
}

async function ensureTokenFromSession(
  workspaceId?: string,
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
): Promise<string | undefined> {
  if (!isAuthScopeCurrent(generation, operation)) {
    return undefined;
  }
  const existingToken = await readJwtFromJarAfterInjection(workspaceId);
  if (!isAuthScopeCurrent(generation, operation)) {
    return undefined;
  }
  if (existingToken) {
    return existingToken;
  }
  const refreshedToken = await refreshTokenFromSessionCookie(generation, operation);
  return refreshedToken;
}

async function resolveAuthenticatedUser(
  token: string,
  fallback: { email: string; name: string; photo?: string },
  userIdHint?: string,
): Promise<User> {
  if (userIdHint) {
    const byIdResponse = await getUserById(userIdHint, token);
    if (byIdResponse.success && byIdResponse.user) {
      return byIdResponse.user;
    }
  }

  const meResponse = await getCurrentUser(token);
  if (meResponse.success && meResponse.user) {
    return meResponse.user;
  }

  if (userIdHint) {
    return {
      user_id: userIdHint,
      email: fallback.email,
      name: fallback.name,
      workspaceId: '',
      role: '',
      orgRole: '',
      memberId: '',
      ...(fallback.photo ? { photo_url: fallback.photo } : {}),
    };
  }

  throw new Error('Unable to resolve authenticated user profile');
}

function parseResponseJson<T>(response: MtlsResponse): T | null {
  try {
    return getResponseJson<T>(response);
  } catch {
    return null;
  }
}

function extractErrorMessage(response: MtlsResponse, statusCode: number): string {
  const parsed = parseResponseJson<{ message?: string; error?: string }>(response);
  if (parsed?.message) {
    return parsed.message;
  }
  if (parsed?.error) {
    return parsed.error;
  }
  return `Request failed: ${statusCode}`;
}

/** Goes through `refreshAuthSession` so it shares the in-flight request. */
async function refreshTokenFromSessionCookie(
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
): Promise<string | undefined> {
  const result = await refreshAuthSession(undefined, generation, operation);
  return result.ok ? result.token : undefined;
}

export async function getWorkspaces(token: string): Promise<WorkspaceItem[]> {
  const data = await apiGet<WorkspacesResponse>('/auth/workspaces', { token });
  return data.workspaces;
}

export async function getWorkspaceActivityCounts(
  token: string,
): Promise<WorkspaceNotificationCountItem[]> {
  const data = await apiGet<WorkspaceNotificationCountsResponse>('/activity/workspace-counts', {
    token,
  });
  return data.counts ?? [];
}

export async function getCurrentUser(token: string): Promise<GetUserResponse> {
  try {
    const data = await apiGet<BackendUserResponse>('/v2/auth/me', { token });

    if (data.success && data.user) {
      return {
        success: true,
        user: mapBackendUserToLotusUser(data.user),
      };
    }

    return { success: false, user: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (isLikelyOfflineOrTransientNetworkError(message)) {
      return { success: false, user: null, isTransientError: true };
    }
    return { success: false, user: null };
  }
}

const SIGN_OUT_REQUEST_TIMEOUT_MS = 5_000;

export async function signOutUser(userId: string): Promise<RemoteLogoutOutcome> {
  if (!userId.trim()) {
    return remoteLogoutNotAttempted();
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        reject(new Error('Remote logout timed out'));
      }, SIGN_OUT_REQUEST_TIMEOUT_MS);
    });
    const response = await Promise.race([
      apiPost<{ success: boolean }>('/v2/auth/logout', { userId }),
      timeout,
    ]);
    return classifyRemoteLogoutResponse(response);
  } catch {
    return remoteLogoutFailed(timedOut ? 'timed_out' : 'failed');
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * The one refresh on the wire. `xs` is a single token for the whole session, whatever
 * workspace a caller wants, so there is exactly one of these, not one per workspace.
 */
let inFlightRefresh: {
  generation: number;
  operation: number;
  promise: Promise<RefreshSessionResult>;
} | null = null;

/**
 * Refresh the workspace JWT using the `xs` refresh cookie (same endpoint as the dashboard).
 * Does not rely on JWT in the JSON body.
 *
 * Every caller (keep-alive, Zero recovery, start-up check, 401 retry, token
 * resolution) shares one in-flight request, whatever `workspaceId` it asks for, so a
 * burst of callers costs one request. `workspaceId` only picks which workspace's
 * JWT is read from the jar afterwards; the request itself is identical for everyone.
 */
export function refreshAuthSession(
  workspaceId?: string,
  generation = getAuthSessionGeneration(),
  operation = getAuthOperation(),
): Promise<RefreshSessionResult> {
  const shared = joinOrStartRefresh(generation, operation);
  if (workspaceId === undefined) {
    return shared;
  }
  return shared.then(async result => {
    if (!result.ok) {
      return result;
    }
    // Never hand out another workspace's token as this one's: its retry would carry
    // `x-workspace-id` for this workspace, earn the same 401 and refresh
    // again on every request.
    if (result.workspaceId !== undefined) {
      return result.workspaceId === workspaceId
        ? result
        : { ok: false, kind: 'workspace_mismatch' };
    }
    const token = await getCookieValueFromJar(API_ORIGIN, workspaceTokenCookieName(workspaceId));
    if (!isAuthScopeCurrent(generation, operation)) {
      return { ok: false, kind: 'transient' };
    }
    return token ? { ok: true, token, workspaceId } : { ok: false, kind: 'missing_jwt_cookie' };
  });
}

function joinOrStartRefresh(generation: number, operation: number): Promise<RefreshSessionResult> {
  const current = inFlightRefresh;
  if (current && current.generation === generation && current.operation === operation) {
    return current.promise;
  }

  // A refresh from an older auth scope may still be on the wire with the same `xs`.
  // Start after it settles rather than beside it, so requests never overlap.
  const previous: Promise<unknown> = current
    ? current.promise.catch(() => undefined)
    : Promise.resolve();
  const request = trackAuthSessionOperation(
    generation,
    previous
      .then(() => performRefreshAuthSession(generation, operation))
      .then(result => {
        // Announced here, before any caller resumes, so whichever path triggered the
        // refresh (keep-alive, Zero recovery, start-up check, 401 retry), the app keeps
        // the new token and ends a dead session the same way, exactly once.
        if (isAuthScopeCurrent(generation, operation)) {
          if (result.ok) {
            notifySessionRefreshed(result.token, generation, operation);
          } else if (result.kind === 'unauthorized') {
            notifySessionEnded();
          }
        }
        return result;
      }),
  );
  const entry = { generation, operation, promise: request };
  inFlightRefresh = entry;
  const clear = (): void => {
    if (inFlightRefresh === entry) inFlightRefresh = null;
  };
  void request.then(clear, clear);
  return request;
}

async function performRefreshAuthSession(
  generation: number,
  operation: number,
): Promise<RefreshSessionResult> {
  if (!isAuthScopeCurrent(generation, operation)) {
    return { ok: false, kind: 'transient' };
  }
  const activeWorkspaceIdAtStart = getActiveWorkspaceId();

  // The backend refreshes the workspace `xyne_last_workspace` names, not `x-workspace-id`.
  // Make it name the workspace the app is in before asking.
  const activeWorkspaceId = getActiveWorkspaceId();
  if (activeWorkspaceId) {
    await pointLastWorkspaceAt(API_ORIGIN, activeWorkspaceId, { generation, operation });
  }

  // No local check for the refresh cookie: `xs` is httpOnly and path-scoped, so only the
  // backend can say whether it is there. A missing one comes back as 401 REFRESH_INVALID.
  try {
    const response = await mtlsFetch(REFRESH_SESSION_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      skipSessionRefresh: true,
    });

    if (!isAuthScopeCurrent(generation, operation)) {
      return { ok: false, kind: 'transient' };
    }

    // Only the backend's session-ended codes end the session. A bare 401/403 from a
    // gateway, WAF or mTLS ingress, any 5xx and network errors
    // keep it: the caller fails this attempt and tries later.
    if (response.statusCode === 401 || response.statusCode === 403) {
      return isSessionEndedRefusal(response.statusCode, parseResponseJson<unknown>(response))
        ? { ok: false, kind: 'unauthorized' }
        : { ok: false, kind: 'transient' };
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return { ok: false, kind: 'transient' };
    }

    // Org login / workspace switch already moved the cookie jar. Do not write
    // the old session on top of it.
    if (getActiveWorkspaceId() !== activeWorkspaceIdAtStart) {
      return { ok: false, kind: 'transient' };
    }

    await injectCookiesFromResponse(API_ORIGIN, response.headers, {
      waitForPropagation: true,
      generation,
      operation,
    });
    if (!isAuthScopeCurrent(generation, operation)) {
      return { ok: false, kind: 'transient' };
    }

    const data = parseResponseJson<RefreshSessionResponse>(response);
    if (!data) {
      return { ok: false, kind: 'invalid_body' };
    }

    if (!data.success) {
      return { ok: false, kind: 'invalid_body' };
    }

    // Read the token of the workspace the backend says it refreshed, not whatever the
    // jar falls back to, so callers can tell when that is not the one they wanted.
    const mintedWorkspaceId =
      typeof data.workspaceId === 'string' && data.workspaceId ? data.workspaceId : undefined;
    const token = mintedWorkspaceId
      ? await getCookieValueFromJar(API_ORIGIN, workspaceTokenCookieName(mintedWorkspaceId))
      : await readJwtFromJarAfterInjection();
    if (
      isAuthScopeCurrent(generation, operation) &&
      typeof token === 'string' &&
      token.length > 0
    ) {
      return mintedWorkspaceId
        ? { ok: true, token, workspaceId: mintedWorkspaceId }
        : { ok: true, token };
    }

    return { ok: false, kind: 'missing_jwt_cookie' };
  } catch {
    return { ok: false, kind: 'transient' };
  }
}

type SessionEndedListener = () => void;

const sessionEndedListeners = new Set<SessionEndedListener>();

/**
 * Fires when any refresh is refused with a session-ended code (see
 * `isSessionEndedRefusal`): the session is over and the user has to sign in again.
 */
export function subscribeToSessionEnded(listener: SessionEndedListener): () => void {
  sessionEndedListeners.add(listener);
  return (): void => {
    sessionEndedListeners.delete(listener);
  };
}

function notifySessionEnded(): void {
  for (const listener of sessionEndedListeners) {
    listener();
  }
}

type SessionRefreshedListener = (token: string, generation: number, operation: number) => void;

const sessionRefreshedListeners = new Set<SessionRefreshedListener>();

/**
 * Fires with the new JWT after every successful refresh, whoever triggered it, so the
 * app's token and its stored copy never lag behind the cookie jar. Without this a 401
 * retry renewed only the jar, and the keep-alive (still holding the expired token)
 * refreshed again at once.
 */
export function subscribeToSessionRefreshed(listener: SessionRefreshedListener): () => void {
  sessionRefreshedListeners.add(listener);
  return (): void => {
    sessionRefreshedListeners.delete(listener);
  };
}

function notifySessionRefreshed(token: string, generation: number, operation: number): void {
  for (const listener of sessionRefreshedListeners) {
    listener(token, generation, operation);
  }
}

// API calls that get a refreshable 401 renew the session here, then retry once.
// refreshAuthSession is single-flight, so a burst of 401s shares one refresh, and it
// announces a session-ended refusal itself.
setSessionRefresher(async (generation, operation): Promise<SessionRefreshOutcome> => {
  // Refreshed under the request's own auth scope, so a refresh for a session that has
  // since been signed out or switched away from neither applies nor announces anything.
  const result = await refreshAuthSession(
    getActiveWorkspaceId() ?? undefined,
    generation,
    operation,
  );
  if (result.ok) {
    return 'refreshed';
  }
  return result.kind === 'unauthorized' ? 'session-ended' : 'unavailable';
});
