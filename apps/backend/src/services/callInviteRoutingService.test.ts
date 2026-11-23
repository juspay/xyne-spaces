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
jest.mock('@xyne/shared', () => ({
  CallStatus: { PENDING: 'PENDING', SCHEDULED: 'SCHEDULED', ACTIVE: 'ACTIVE', IN_PROGRESS: 'IN_PROGRESS', ENDED: 'ENDED' },
}));
jest.mock('@/database/client', () => ({ db: { user: { findUnique: jest.fn() } } }));
jest.mock('@/database/repositories', () => ({
  repositories: { calls: { getCallInviteRoutingInfo: jest.fn() } },
}));
jest.mock('@/services/authSessionService', () => ({
  authSessionService: { findActiveById: jest.fn() },
}));

import type { Request, Response } from 'express';
import { callInviteRoutingService } from './callInviteRoutingService';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { authSessionService } from '@/services/authSessionService';
import { jwtService } from '@/services/jwtService';
import { workspaceTokenCookieName } from '@/services/accessTokenService';

const findActiveById = authSessionService.findActiveById as jest.Mock;
const WS = 'ws-1';

const resolve = async (jwt: string) => {
  const req = { headers: {}, cookies: { [workspaceTokenCookieName(WS)]: jwt } } as unknown as Request;
  const res = { cookie: jest.fn() } as unknown as Response & { cookie: jest.Mock };
  const result = await callInviteRoutingService.resolve(req, res, 'ext-call-1');
  return { result, cookie: res.cookie };
};
const token = (seconds = 900) =>
  jwtService.generateToken(
    { sub: 'user-1', email: 'u@example.com', name: 'U', workspaceId: WS, memberId: 'om-1', sid: 'sess-1' },
    seconds,
  );

beforeEach(() => {
  jest.clearAllMocks();
  (repositories.calls.getCallInviteRoutingInfo as jest.Mock).mockResolvedValue({ workspaceId: WS, status: 'ACTIVE' });
  (db.user.findUnique as jest.Mock).mockResolvedValue({
    workspaceId: WS, orgMemberId: 'om-1', leftAt: null, orgMember: { memberId: 'om-1', leftAt: null },
  });
  findActiveById.mockResolvedValue({ id: 'sess-1', orgMemberId: 'om-1', refreshTokenExpiry: new Date(Date.now() + 86_400_000) });
});

describe('callInviteRoutingService.resolve', () => {
  it('routes a member with a live session into the internal app', async () => {
    const { result, cookie } = await resolve(token());
    expect(result).toEqual({ result: 'internal', workspaceId: WS });
    expect(cookie).toHaveBeenCalled();
  });

  it('treats a token whose auth session was revoked as a guest', async () => {
    findActiveById.mockResolvedValue(null);
    const { result, cookie } = await resolve(token());
    expect(result).toEqual({ result: 'external' });
    expect(cookie).not.toHaveBeenCalled();
  });

  it('still asks for a refresh when the token is merely expired', async () => {
    const { result } = await resolve(token(-60));
    expect(result).toEqual({ result: 'needs-refresh' });
  });
});
