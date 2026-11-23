/**
 * POST /api/auth/login-workspace, already-signed-in branch (no pending-auth cookie): the
 * workspace JWT is the only credential, and the branch ends in completeLogin, which mints a new
 * long-lived auth session. A JWT whose session was revoked must never get that far.
 */
jest.mock('@/config/env', () => ({
  config: {
    env: 'test',
    jwt: { secret: 'test-secret-test-secret-test-secret-42', expirationSeconds: 900, forceLogoutBefore: undefined },
    session: { expiryDays: 180 },
    email: { clientId: 'client', clientSecret: 'secret', mobileClientId: 'mobile', mobileClientSecret: 'mobile-secret' },
    pendingOAuthTokens: { redisKeyPrefix: 'pending-oauth:', ttlSeconds: 600 },
  },
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
// @xyne/shared ships ESM that jest's transform ignores — stub the enums used.
jest.mock('@xyne/shared', () => ({
  WorkspaceType: {},
  AuthProvider: { GOOGLE: 'GOOGLE', MICROSOFT: 'MICROSOFT', EMAIL: 'EMAIL' },
  UserStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' },
  OrgRole: { OWNER: 'OWNER', ADMIN: 'ADMIN', MEMBER: 'MEMBER' },
}));
jest.mock('@/database/client', () => {
  const prisma = { orgMember: { findUnique: jest.fn() }, user: { findFirst: jest.fn() } };
  return { DatabaseClient: { getInstance: () => prisma }, db: prisma };
});
jest.mock('@/services/authSessionService', () => ({
  authSessionService: { findActiveById: jest.fn() },
  AuthSessionRevokeReason: {},
  MissingDeviceKeyError: class MissingDeviceKeyError extends Error {},
}));
jest.mock('@/services/loginCompletionService', () => ({
  completeLogin: jest.fn(),
  respondDeviceKeyRequired: () => false,
  trackLogout: jest.fn(),
}));
jest.mock('@/services/userService', () => ({
  UserService: class {
    createOrGetWorkspaceUser = jest.fn().mockResolvedValue({
      user: { id: 'user-2', email: 'u@example.com', name: 'U', status: 'ACTIVE', leftAt: null, orgMemberId: 'om-1', workspaceId: 'ws-2' },
      isNewUser: false,
    });
    ensureUserPresence = jest.fn();
    getOrgRole = jest.fn().mockResolvedValue('MEMBER');
  },
}));
jest.mock('@/bypassAcl/authServices', () => ({
  ensureSelfDmForUserData: jest.fn().mockResolvedValue(null),
  getWorkspaceLandingChannelData: jest.fn().mockResolvedValue(null),
  switchWorkspaceData: jest.fn(),
  getRefreshTargetUserData: jest.fn(),
}));
jest.mock('@/services/emailDomainPolicy', () => ({
  isEmailDomainAllowed: () => true,
  getProviderLoginDenial: () => null,
  EMAIL_DOMAIN_NOT_ALLOWED_ERROR: 'x',
  EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE: 'x',
}));
// Not reached on this branch.
jest.mock('google-auth-library', () => ({ OAuth2Client: class {}, CodeChallengeMethod: {} }));
jest.mock('@/controllers/microsoftAuthController', () => ({ MicrosoftAuthController: class {} }));
jest.mock('@/utils/pendingAuthToken', () => ({ signPendingAuthToken: jest.fn(), verifyPendingAuthToken: jest.fn() }));
jest.mock('@/services/oauthStateServiceV2', () => ({ oauthStateServiceV2: {} }));
jest.mock('@/services/pkceServiceV2', () => ({ pkceServiceV2: {} }));
jest.mock('@/utils/publicUrls', () => ({ getFrontendUrl: () => 'http://app', resolveConfiguredOAuthRedirectUrl: () => '' }));
jest.mock('@/services/organizationDomainService', () => ({}));
jest.mock('@/services/legacyIdentityMigrationHelper', () => ({}));
jest.mock('@/services/redisService', () => ({ redisService: { del: jest.fn() } }));
jest.mock('@/utils/onboardingCookie', () => ({ setOnboardingCookie: jest.fn() }));

import type { Request, Response } from 'express';
import { AuthV2Controller } from './authV2Controller';
import { DatabaseClient } from '@/database/client';
import { authSessionService } from '@/services/authSessionService';
import { completeLogin } from '@/services/loginCompletionService';
import { jwtService } from '@/services/jwtService';
import { workspaceTokenCookieName } from '@/services/accessTokenService';

const findActiveById = authSessionService.findActiveById as jest.Mock;
const prisma = DatabaseClient.getInstance() as unknown as {
  orgMember: { findUnique: jest.Mock };
  user: { findFirst: jest.Mock };
};
const WS = 'ws-1';

async function loginWorkspace() {
  const jwt = jwtService.generateToken(
    { sub: 'user-1', email: 'u@example.com', name: 'U', workspaceId: WS, memberId: 'om-1', sid: 'sess-1' },
    900,
  );
  const req = {
    body: { workspaceId: 'ws-2' },
    headers: { 'x-workspace-id': WS, 'x-device-id': 'other-device' },
    cookies: { [workspaceTokenCookieName(WS)]: jwt },
  } as unknown as Request;
  const out: { status?: number; body?: { code?: string } } = {};
  const res = {
    status(code: number) { out.status = code; return this; },
    json(body: { code?: string }) { out.body = body; return this; },
    clearCookie: jest.fn(),
    cookie: jest.fn(),
  } as unknown as Response;
  await new AuthV2Controller().loginWorkspace(req, res);
  return out;
}

beforeEach(() => {
  jest.clearAllMocks();
  findActiveById.mockResolvedValue({ id: 'sess-1', orgMemberId: 'om-1', refreshTokenExpiry: new Date(Date.now() + 86_400_000) });
  prisma.orgMember.findUnique.mockResolvedValue({ leftAt: null });
  prisma.user.findFirst.mockResolvedValue({
    email: 'u@example.com', name: 'U', providerUserId: 'p-1', picture: null, authProvider: 'EMAIL',
  });
  (completeLogin as jest.Mock).mockResolvedValue({ sessionId: 'sess-new', accessToken: { expiresAt: Date.now() + 900_000 } });
});

describe('login-workspace (already signed in)', () => {
  it('does not mint a new session from a JWT whose auth session was revoked', async () => {
    findActiveById.mockResolvedValue(null);
    const out = await loginWorkspace();
    expect(out).toMatchObject({ status: 401, body: { code: 'SESSION_REVOKED' } });
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it('switches workspace for a JWT whose session is ACTIVE', async () => {
    const out = await loginWorkspace();
    expect(out.status).toBe(200);
    expect(completeLogin).toHaveBeenCalledTimes(1);
    expect(findActiveById).toHaveBeenCalledWith('sess-1', 'om-1');
  });
});
