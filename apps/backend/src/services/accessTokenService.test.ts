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
// The auth session row is the source of truth; its lookup is the seam under test.
jest.mock('./authSessionService', () => ({
  authSessionService: { findActiveById: jest.fn() },
}));

import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { readWorkspaceJwt, workspaceTokenCookieName } from './accessTokenService';
import { authSessionService } from './authSessionService';
import { jwtService } from './jwtService';

const findActiveById = authSessionService.findActiveById as jest.Mock;

const WS = 'ws-1';
const claims = { sub: 'user-1', email: 'u@example.com', name: 'U', workspaceId: WS, memberId: 'om-1', sid: 'sess-1' };
const mint = (overrides: Partial<typeof claims> = {}, seconds = 900) =>
  jwtService.generateToken({ ...claims, ...overrides }, seconds);

const request = (opts: { cookies?: Record<string, string>; headers?: Record<string, string> } = {}) =>
  ({ cookies: opts.cookies ?? {}, headers: opts.headers ?? {} }) as unknown as Request;
const withToken = (token: string, workspaceId = WS) =>
  request({ cookies: { [workspaceTokenCookieName(workspaceId)]: token, xyne_last_workspace: workspaceId } });

beforeEach(() => {
  findActiveById.mockReset();
  findActiveById.mockResolvedValue({ id: 'sess-1', orgMemberId: 'om-1', refreshTokenExpiry: new Date(Date.now() + 86_400_000) });
});

describe('readWorkspaceJwt', () => {
  it('accepts a signed token whose auth session is ACTIVE', async () => {
    const token = mint();
    const read = await readWorkspaceJwt(withToken(token));
    expect(read).toMatchObject({ status: 'valid', workspaceId: WS, token, payload: { sub: 'user-1', sid: 'sess-1' } });
    expect(findActiveById).toHaveBeenCalledWith('sess-1', 'om-1');
  });

  it('rejects a token whose auth session is no longer ACTIVE (logout, password reset, superseded, admin revoke)', async () => {
    findActiveById.mockResolvedValue(null);
    const read = await readWorkspaceJwt(withToken(mint()));
    expect(read.status).toBe('revoked');
  });

  it('checks the session on every call: a revoke takes effect on the next request', async () => {
    const req = withToken(mint());
    expect((await readWorkspaceJwt(req)).status).toBe('valid');
    findActiveById.mockResolvedValue(null);
    expect((await readWorkspaceJwt(req)).status).toBe('revoked');
  });

  it('fails closed when the session lookup errors', async () => {
    findActiveById.mockRejectedValue(new Error('db down'));
    await expect(readWorkspaceJwt(withToken(mint()))).rejects.toThrow('db down');
  });

  it('rejects a token without a sid, which could never be revoked', async () => {
    const { sid: _sid, ...noSid } = claims;
    const token = jwtService.generateToken(noSid, 900);
    const read = await readWorkspaceJwt(withToken(token));
    expect(read.status).toBe('invalid');
    expect(findActiveById).not.toHaveBeenCalled();
  });

  it('rejects a token minted for another workspace than the cookie it arrived in', async () => {
    const read = await readWorkspaceJwt(withToken(mint({ workspaceId: 'ws-other' })));
    expect(read.status).toBe('invalid');
    expect(findActiveById).not.toHaveBeenCalled();
  });

  it('reports an expired token as expired (refreshable) without a session lookup', async () => {
    const expired = jwt.sign(
      { ...claims, exp: Math.floor(Date.now() / 1000) - 60 },
      'test-secret-test-secret-test-secret-42',
      { issuer: 'xyne', audience: 'xyne-user' },
    );
    const read = await readWorkspaceJwt(withToken(expired));
    expect(read.status).toBe('expired');
    expect(findActiveById).not.toHaveBeenCalled();
  });

  it('rejects a token signed with another key', async () => {
    const forged = jwt.sign(claims, 'some-other-secret-some-other-secret-00', {
      issuer: 'xyne',
      audience: 'xyne-user',
      expiresIn: 900,
    });
    expect((await readWorkspaceJwt(withToken(forged))).status).toBe('invalid');
  });

  it('reports missing when there is no workspace or no token cookie', async () => {
    expect((await readWorkspaceJwt(request())).status).toBe('missing');
    expect((await readWorkspaceJwt(request({ cookies: { xyne_last_workspace: WS } }))).status).toBe('missing');
  });

  it('picks the workspace from the argument, then x-workspace-id, then xyne_last_workspace', async () => {
    const tokenA = mint({ workspaceId: 'ws-a' });
    const tokenB = mint({ workspaceId: 'ws-b' });
    const cookies = {
      [workspaceTokenCookieName('ws-a')]: tokenA,
      [workspaceTokenCookieName('ws-b')]: tokenB,
      xyne_last_workspace: 'ws-a',
    };
    expect(await readWorkspaceJwt(request({ cookies }))).toMatchObject({ workspaceId: 'ws-a', token: tokenA });
    expect(await readWorkspaceJwt(request({ cookies, headers: { 'x-workspace-id': 'ws-b' } }))).toMatchObject({
      workspaceId: 'ws-b',
      token: tokenB,
    });
    // An empty header falls back to the cookie, as the auth middleware always did.
    expect(await readWorkspaceJwt(request({ cookies, headers: { 'x-workspace-id': '' } }))).toMatchObject({
      workspaceId: 'ws-a',
    });
    expect(await readWorkspaceJwt(request({ cookies, headers: { 'x-workspace-id': 'ws-a' } }), 'ws-b')).toMatchObject({
      workspaceId: 'ws-b',
      token: tokenB,
    });
  });
});
