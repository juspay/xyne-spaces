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
// @xyne/shared ships ESM that jest's transform ignores — stub the enums used.
jest.mock('@xyne/shared', () => ({
  UserStatus: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' },
  WorkspaceJoinRequestAction: { APPROVE: 'APPROVE', REJECT: 'REJECT' },
  WorkspaceJoinRequestStatus: { PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' },
}));
jest.mock('@/database/client', () => ({ db: { user: { findUnique: jest.fn() } } }));
jest.mock('@/services/workspaceJoinRequestService', () => ({
  workspaceJoinRequestService: { requestJoin: jest.fn() },
}));
jest.mock('@/utils/pendingAuthToken', () => ({ verifyPendingAuthToken: () => null }));
jest.mock('@/services/authSessionService', () => ({
  authSessionService: { findActiveById: jest.fn() },
}));

import type { Request, Response } from 'express';
import { workspaceJoinRequestController } from './workspaceJoinRequestController';
import { db } from '@/database/client';
import { workspaceJoinRequestService } from '@/services/workspaceJoinRequestService';
import { authSessionService } from '@/services/authSessionService';
import { jwtService } from '@/services/jwtService';
import { workspaceTokenCookieName } from '@/services/accessTokenService';

const findActiveById = authSessionService.findActiveById as jest.Mock;
const findUser = db.user.findUnique as jest.Mock;
const requestJoin = workspaceJoinRequestService.requestJoin as jest.Mock;
const WS = 'ws-1';

const activeUser = {
  email: 'member@example.com', status: 'ACTIVE', leftAt: null, workspaceId: WS, orgMemberId: 'om-1',
  orgMember: { leftAt: null },
};

async function postJoin() {
  const jwt = jwtService.generateToken(
    { sub: 'user-1', email: 'member@example.com', name: 'M', workspaceId: WS, memberId: 'om-1', sid: 'sess-1' },
    900,
  );
  const req = {
    params: { workspaceId: 'ws-2' },
    headers: {},
    cookies: { [workspaceTokenCookieName(WS)]: jwt, xyne_last_workspace: WS },
  } as unknown as Request;
  const out: { status?: number } = {};
  const res = {
    status(code: number) { out.status = code; return this; },
    json() { return this; },
  } as unknown as Response;
  await workspaceJoinRequestController.requestJoin(req, res);
  return out.status;
}

beforeEach(() => {
  jest.clearAllMocks();
  findActiveById.mockResolvedValue({ id: 'sess-1', orgMemberId: 'om-1', refreshTokenExpiry: new Date(Date.now() + 86_400_000) });
  findUser.mockResolvedValue(activeUser);
  requestJoin.mockResolvedValue({ id: 'req-1', status: 'PENDING', isExisting: false });
});

describe('workspaceJoinRequestController.requestJoin (signed-in requester)', () => {
  it('files the request for an active member with a live session', async () => {
    expect(await postJoin()).toBe(202);
    expect(requestJoin).toHaveBeenCalledWith({ workspaceId: 'ws-2', email: 'member@example.com' });
  });

  it('refuses a token whose auth session was revoked', async () => {
    findActiveById.mockResolvedValue(null);
    expect(await postJoin()).toBe(401);
    expect(requestJoin).not.toHaveBeenCalled();
  });

  it('refuses a deactivated user', async () => {
    findUser.mockResolvedValue({ ...activeUser, status: 'INACTIVE', leftAt: new Date() });
    expect(await postJoin()).toBe(401);
    expect(requestJoin).not.toHaveBeenCalled();
  });

  it('refuses a user who left the organisation', async () => {
    findUser.mockResolvedValue({ ...activeUser, orgMember: { leftAt: new Date() } });
    expect(await postJoin()).toBe(401);
    expect(requestJoin).not.toHaveBeenCalled();
  });
});
