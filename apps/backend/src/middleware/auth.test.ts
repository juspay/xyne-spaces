jest.mock('@/config/env', () => ({
  config: {
    env: 'test',
    jwt: { secret: 'test-secret-test-secret-test-secret-42', expirationSeconds: 900, forceLogoutBefore: undefined },
    session: { expiryDays: 180 },
  },
}));
jest.mock('@/utils/logger', () => {
  const logger = { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn(), child: () => logger };
  return { logger, loggerContext: { getStore: () => ({}), run: (_ctx: unknown, fn: () => unknown) => fn() } };
});
// @xyne/shared ships ESM that jest's transform ignores — stub the enums used.
jest.mock('@xyne/shared', () => ({
  UserStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' },
  OrgRole: { OWNER: 'OWNER', ADMIN: 'ADMIN', MEMBER: 'MEMBER' },
  WorkspaceRole: { ADMIN: 'ADMIN', MEMBER: 'MEMBER' },
}));
jest.mock('@/database/client', () => ({
  db: { user: { findUnique: jest.fn() }, orgMember: { findUnique: jest.fn() } },
}));
jest.mock('@/services/authSessionService', () => ({
  authSessionService: { findActiveById: jest.fn() },
}));
jest.mock('@/middleware/decryptionMiddleware', () => ({
  decryptRequestBodyMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('@/services/emailDomainPolicy', () => ({
  isEmailDomainAllowed: () => true,
  EMAIL_DOMAIN_NOT_ALLOWED_ERROR: 'Email domain not allowed',
  EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE: 'Email domain not allowed',
}));

import type { Request, Response } from 'express';
import { AuthMiddleware } from './auth';
import { db } from '@/database/client';
import { authSessionService } from '@/services/authSessionService';
import { jwtService } from '@/services/jwtService';
import { workspaceTokenCookieName } from '@/services/accessTokenService';

const findActiveById = authSessionService.findActiveById as jest.Mock;
const findUser = db.user.findUnique as jest.Mock;
const findOrgMember = db.orgMember.findUnique as jest.Mock;

const WS = 'ws-1';
const token = (overrides: Record<string, unknown> = {}) =>
  jwtService.generateToken(
    { sub: 'user-1', email: 'u@example.com', name: 'U', workspaceId: WS, memberId: 'om-1', sid: 'sess-1', ...overrides },
    900,
  );

async function authenticate(jwt?: string) {
  const req = {
    method: 'GET',
    path: '/api/v1/tickets',
    headers: { 'x-workspace-id': WS },
    cookies: jwt ? { [workspaceTokenCookieName(WS)]: jwt } : {},
  } as unknown as Request;
  const out: { status?: number; body?: { code?: string }; next: boolean } = { next: false };
  const res = {
    setHeader: jest.fn(),
    cookie: jest.fn(),
    status(code: number) { out.status = code; return this; },
    json(body: { code?: string }) { out.body = body; return this; },
  } as unknown as Response;
  await new AuthMiddleware().authenticate(req, res, () => { out.next = true; });
  return { ...out, req };
}

beforeEach(() => {
  jest.clearAllMocks();
  findActiveById.mockResolvedValue({ id: 'sess-1', orgMemberId: 'om-1', refreshTokenExpiry: new Date(Date.now() + 86_400_000) });
  findUser.mockResolvedValue({
    id: 'user-1', role: 'MEMBER', email: 'u@example.com', name: 'U', displayName: 'U', status: 'ACTIVE',
    leftAt: null, workspaceId: WS, orgMemberId: 'om-1', providerUserId: 'p-1', authProvider: 'EMAIL',
  });
  findOrgMember.mockResolvedValue({ role: 'MEMBER', leftAt: null });
});

describe('AuthMiddleware.authenticate', () => {
  it('lets a live session through and records the verified token', async () => {
    const jwt = token();
    const result = await authenticate(jwt);
    expect(result.next).toBe(true);
    expect(result.req.user).toMatchObject({ id: 'user-1', sid: 'sess-1', workspaceId: WS });
    expect(result.req.authToken).toBe(jwt);
  });

  it('rejects a token whose auth session was revoked with the final SESSION_REVOKED', async () => {
    findActiveById.mockResolvedValue(null);
    const result = await authenticate(token());
    expect(result).toMatchObject({ next: false, status: 401, body: { code: 'SESSION_REVOKED' } });
    expect(findUser).not.toHaveBeenCalled();
  });

  it('answers 500, not a pass, when the session lookup fails', async () => {
    findActiveById.mockRejectedValue(new Error('db down'));
    const result = await authenticate(token());
    expect(result).toMatchObject({ next: false, status: 500 });
  });

  it('rejects a token without a sid as TOKEN_INVALID', async () => {
    const result = await authenticate(token({ sid: undefined }));
    expect(result).toMatchObject({ next: false, status: 401, body: { code: 'TOKEN_INVALID' } });
  });

  it('keeps the refreshable codes for a missing or expired token', async () => {
    expect(await authenticate()).toMatchObject({ next: false, status: 401, body: { code: 'TOKEN_MISSING' } });
    const expired = jwtService.generateToken(
      { sub: 'user-1', email: 'u@example.com', name: 'U', workspaceId: WS, memberId: 'om-1', sid: 'sess-1' },
      -60,
    );
    expect(await authenticate(expired)).toMatchObject({ next: false, status: 401, body: { code: 'TOKEN_EXPIRED' } });
  });

  it('still re-checks the user after the session: a deactivated user is USER_REMOVED', async () => {
    findUser.mockResolvedValue({
      id: 'user-1', role: 'MEMBER', email: 'u@example.com', name: 'U', displayName: 'U', status: 'INACTIVE',
      leftAt: new Date(), workspaceId: WS, orgMemberId: 'om-1', providerUserId: 'p-1', authProvider: 'EMAIL',
    });
    const result = await authenticate(token());
    expect(result).toMatchObject({ next: false, status: 401, body: { code: 'USER_REMOVED' } });
  });
});
