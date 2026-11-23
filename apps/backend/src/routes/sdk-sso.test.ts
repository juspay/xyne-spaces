/**
 * POST /api/sdk/auth/sso/approve: the first JWT handed to the SDK must carry the approving
 * session's sid, so it is accepted only while that session is ACTIVE and dies with it.
 */
jest.mock('@/config/env', () => ({
  config: {
    env: 'test',
    jwt: { secret: 'test-secret-test-secret-test-secret-42', expirationSeconds: 900, forceLogoutBefore: undefined },
    session: { expiryDays: 180 },
  },
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
// @xyne/shared ships ESM that jest's transform ignores — stub the enum used.
jest.mock('@xyne/shared', () => ({ UserStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' } }));
jest.mock('@/database/client', () => ({ db: { user: { findFirst: jest.fn() } } }));
jest.mock('@/services/authSessionService', () => ({
  authSessionService: { findActiveById: jest.fn() },
}));
jest.mock('@/services/sdkSsoService', () => ({
  sdkSsoService: { getDeviceAuthByUserCode: jest.fn(), approveOrDeny: jest.fn() },
}));
jest.mock('@/middleware/rateLimiters', () => {
  const pass = (_req: unknown, _res: unknown, next: () => void) => next();
  return { sdkSsoInitLimiter: pass, sdkSsoPollLimiter: pass, sdkSsoRefreshLimiter: pass };
});
// authMiddleware already verified the approver; the route sees its result on req.user.
jest.mock('@/middleware/auth', () => ({
  authMiddleware: {
    authenticate: (req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.user = { id: 'user-1', sid: req.headers['x-test-sid'] || undefined };
      next();
    },
  },
}));

import express from 'express';
import request from 'supertest';
import router from './sdk-sso';
import { db } from '@/database/client';
import { authSessionService } from '@/services/authSessionService';
import { sdkSsoService } from '@/services/sdkSsoService';
import { jwtService } from '@/services/jwtService';

const findActiveById = authSessionService.findActiveById as jest.Mock;
const approveOrDeny = sdkSsoService.approveOrDeny as jest.Mock;

const app = express().use(express.json()).use('/', router);
const approve = (sid = 'sess-1') =>
  request(app).post('/approve').set('x-test-sid', sid).send({ userCode: 'ABCD-EFGH', approved: true });

beforeEach(() => {
  jest.clearAllMocks();
  (sdkSsoService.getDeviceAuthByUserCode as jest.Mock).mockResolvedValue({ status: 'pending' });
  approveOrDeny.mockResolvedValue(true);
  (db.user.findFirst as jest.Mock).mockResolvedValue({
    id: 'user-1', email: 'u@example.com', name: 'U', picture: null, workspaceId: 'ws-1', orgMemberId: 'om-1',
  });
  findActiveById.mockResolvedValue({ id: 'sess-1', orgMemberId: 'om-1', refreshTokenExpiry: new Date(Date.now() + 86_400_000) });
});

describe('POST /approve', () => {
  it("binds the SDK's first JWT to the approving auth session", async () => {
    const res = await approve();
    expect(res.status).toBe(200);
    expect(findActiveById).toHaveBeenCalledWith('sess-1', 'om-1');
    const session = approveOrDeny.mock.calls[0][1] as { token: string };
    expect(jwtService.verifyToken(session.token)).toMatchObject({ sub: 'user-1', sid: 'sess-1', memberId: 'om-1' });
  });

  it('refuses to approve when the approving session is no longer ACTIVE', async () => {
    findActiveById.mockResolvedValue(null);
    const res = await approve();
    expect(res.status).toBe(401);
    expect(approveOrDeny).not.toHaveBeenCalled();
  });

  it('refuses to approve from a request without a session id', async () => {
    const res = await approve('');
    expect(res.status).toBe(401);
    expect(findActiveById).not.toHaveBeenCalled();
    expect(approveOrDeny).not.toHaveBeenCalled();
  });
});
