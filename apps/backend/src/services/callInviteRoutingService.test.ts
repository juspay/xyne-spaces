/**
 * Decision-matrix proof for the Unified Smart Call Invite Link router.
 *
 * Exercises the REAL jwtService (genuine HS256 signing, expiry, iss/aud and
 * force-logout enforcement) against a mocked call repository and user-session
 * service, so every row of the routing decision table is verified end-to-end
 * through the actual security logic — not a reimplementation.
 */
const TEST_SECRET = 'unit-test-jwt-secret-000000000000000000000000';
const ISSUER = 'xyne';
const AUDIENCE = 'xyne-user';
const CALL_WS = 'ws_call_alpha';
const OTHER_WS = 'ws_other_beta';
const EXTERNAL_ID = 'call_ext_abc123';
const FRONTEND_URL = 'https://app.xyne.test';
const EXPECTED_REDIRECT = `${FRONTEND_URL}/call/${EXTERNAL_ID}`;

// Mock config BEFORE anything imports it. The factory also plants JWT_SECRET so
// the real jwtService constructor (which reads process.env at module load) is
// happy and signs/verifies with the same key the test uses.
jest.mock('@/config/env', () => {
  process.env.JWT_SECRET = TEST_SECRET;
  return {
    config: {
      jwt: { expirationSeconds: 3600, forceLogoutBefore: 0 },
      frontendUrl: FRONTEND_URL,
      enableUnifiedCallInviteLink: true,
    },
  };
});

jest.mock('@/utils/logger', () => {
  const l = { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() };
  return { logger: { ...l, child: () => l } };
});

// Mocked call repository.
const getCallInviteRoutingInfo = jest.fn();
jest.mock('@/database/repositories', () => ({
  repositories: { calls: { getCallInviteRoutingInfo: (...a: unknown[]) => getCallInviteRoutingInfo(...a) } },
}));

// Mocked user-session service. The routing service does `new UserSessionService()`
// at construction, so the constructor returns our shared spy object.
const getSessionById = jest.fn();
const updateSession = jest.fn();
jest.mock('./userSessionService', () => ({
  UserSessionService: jest.fn().mockImplementation(() => ({ getSessionById, updateSession })),
}));

import jwt from 'jsonwebtoken';
import { config } from '@/config/env';
import { callInviteRoutingService } from './callInviteRoutingService';

function sign(payload: Record<string, unknown>, opts: jwt.SignOptions = {}, secret = TEST_SECRET): string {
  return jwt.sign(payload, secret, { issuer: ISSUER, audience: AUDIENCE, ...opts });
}

function validClaims(workspaceId = CALL_WS) {
  return { sub: 'user-1', email: 'u@xyne.test', name: 'U', workspaceId, memberId: 'm-1' };
}

function makeReqRes(cookies: Record<string, string>, headers: Record<string, string> = {}) {
  const req = { headers, cookies } as any;
  const res = { cookie: jest.fn() } as any;
  return { req, res };
}

const routingInfo = {
  callId: 'call-internal-id',
  externalId: EXTERNAL_ID,
  callType: 'INSTANT',
  status: 'ACTIVE',
  workspaceId: CALL_WS,
};

beforeEach(() => {
  jest.clearAllMocks();
  config.enableUnifiedCallInviteLink = true;
  config.jwt.forceLogoutBefore = 0;
  getCallInviteRoutingInfo.mockResolvedValue(routingInfo);
});

describe('callInviteRoutingService.detect — decision matrix', () => {
  it('Row 1 — feature flag OFF → external, and never touches the DB', async () => {
    config.enableUnifiedCallInviteLink = false;
    const { req, res } = makeReqRes({ [`xyne_ws_${CALL_WS}_token`]: sign(validClaims()) });
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: false });
    expect(getCallInviteRoutingInfo).not.toHaveBeenCalled();
  });

  it('Row 2 — unknown / non-existent call → external (opaque, no leak)', async () => {
    getCallInviteRoutingInfo.mockResolvedValue(null);
    const { req, res } = makeReqRes({ [`xyne_ws_${CALL_WS}_token`]: sign(validClaims()) });
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: false });
  });

  it('Row 3 — anonymous visitor (no workspace cookie) → external', async () => {
    const { req, res } = makeReqRes({});
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: false });
  });

  it('Row 4 — valid, unexpired token for the call workspace → internal + redirect', async () => {
    const { req, res } = makeReqRes({ [`xyne_ws_${CALL_WS}_token`]: sign(validClaims(), { expiresIn: 3600 }) });
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: true, redirectUrl: EXPECTED_REDIRECT });
    expect(res.cookie).not.toHaveBeenCalled(); // no refresh needed for a live token
  });

  it('Row 5 — cross-workspace: only a DIFFERENT workspace cookie present → external', async () => {
    // Browser is signed into OTHER_WS, not the call's workspace. We only read the
    // call-workspace cookie, so this must not route internal.
    const { req, res } = makeReqRes(
      { [`xyne_ws_${OTHER_WS}_token`]: sign(validClaims(OTHER_WS), { expiresIn: 3600 }) },
      { 'x-workspace-id': OTHER_WS, 'xyne_last_workspace': OTHER_WS } as any,
    );
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: false });
  });

  it('Row 6 — token workspace claim mismatches the call workspace → external (defense in depth)', async () => {
    // Cookie is stored under the call-workspace name but its signed claim is for
    // another workspace. Must be rejected.
    const { req, res } = makeReqRes({ [`xyne_ws_${CALL_WS}_token`]: sign(validClaims(OTHER_WS), { expiresIn: 3600 }) });
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: false });
  });

  it('Row 7 — tampered token (bad signature) → external', async () => {
    const forged = sign(validClaims(), { expiresIn: 3600 }, 'attacker-key-attacker-key-attacker-key');
    const { req, res } = makeReqRes({ [`xyne_ws_${CALL_WS}_token`]: forged });
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: false });
  });

  it('Row 8 — expired token + live session in SAME workspace → internal, mints fresh cookie, leaves xyne_last_workspace alone', async () => {
    getSessionById.mockResolvedValue({
      id: 'sess-1',
      status: 'ACTIVE',
      refreshTokenExpiry: new Date(Date.now() + 86_400_000),
      user: {
        id: 'user-1', email: 'u@xyne.test', name: 'U', picture: null,
        workspaceId: CALL_WS, orgMemberId: 'm-1', leftAt: null, orgMember: { leftAt: null },
      },
    });
    const { req, res } = makeReqRes({
      [`xyne_ws_${CALL_WS}_token`]: sign(validClaims(), { expiresIn: -10 }), // already expired
      user_session_id: 'sess-1',
    });
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: true, redirectUrl: EXPECTED_REDIRECT });

    const cookieNames = res.cookie.mock.calls.map((c: unknown[]) => c[0]);
    expect(cookieNames).toContain(`xyne_ws_${CALL_WS}_token`); // fresh access token minted
    expect(cookieNames).not.toContain('xyne_last_workspace'); // active-workspace pointer untouched
    expect(updateSession).toHaveBeenCalled();
  });

  it('Row 9 — expired token + live session in a DIFFERENT workspace → external', async () => {
    getSessionById.mockResolvedValue({
      id: 'sess-1', status: 'ACTIVE', refreshTokenExpiry: new Date(Date.now() + 86_400_000),
      user: { id: 'user-1', email: 'u@xyne.test', name: 'U', picture: null,
        workspaceId: OTHER_WS, orgMemberId: 'm-1', leftAt: null, orgMember: { leftAt: null } },
    });
    const { req, res } = makeReqRes({
      [`xyne_ws_${CALL_WS}_token`]: sign(validClaims(), { expiresIn: -10 }),
      user_session_id: 'sess-1',
    });
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: false });
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('Row 10 — expired token + no recoverable session → external', async () => {
    getSessionById.mockResolvedValue(null);
    const { req, res } = makeReqRes({
      [`xyne_ws_${CALL_WS}_token`]: sign(validClaims(), { expiresIn: -10 }),
      user_session_id: 'sess-1',
    });
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: false });
  });

  it('Row 11 — expired token + session revoked (status !== ACTIVE) → external', async () => {
    getSessionById.mockResolvedValue({
      id: 'sess-1', status: 'REVOKED', refreshTokenExpiry: new Date(Date.now() + 86_400_000),
      user: { id: 'user-1', email: 'u@xyne.test', name: 'U', picture: null,
        workspaceId: CALL_WS, orgMemberId: 'm-1', leftAt: null, orgMember: { leftAt: null } },
    });
    const { req, res } = makeReqRes({
      [`xyne_ws_${CALL_WS}_token`]: sign(validClaims(), { expiresIn: -10 }),
      user_session_id: 'sess-1',
    });
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: false });
  });

  it('Row 12 — expired token + user has left the workspace → external', async () => {
    getSessionById.mockResolvedValue({
      id: 'sess-1', status: 'ACTIVE', refreshTokenExpiry: new Date(Date.now() + 86_400_000),
      user: { id: 'user-1', email: 'u@xyne.test', name: 'U', picture: null,
        workspaceId: CALL_WS, orgMemberId: 'm-1', leftAt: new Date(), orgMember: { leftAt: null } },
    });
    const { req, res } = makeReqRes({
      [`xyne_ws_${CALL_WS}_token`]: sign(validClaims(), { expiresIn: -10 }),
      user_session_id: 'sess-1',
    });
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: false });
  });

  it('Row 13 — force-logout watermark invalidates an otherwise-valid token → external', async () => {
    // Token issued now; watermark set to the future so decoded.iat < forceLogoutBefore.
    config.jwt.forceLogoutBefore = Math.floor(Date.now() / 1000) + 3600;
    const { req, res } = makeReqRes({ [`xyne_ws_${CALL_WS}_token`]: sign(validClaims(), { expiresIn: 3600 }) });
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: false });
  });

  it('Row 14 — garbage cookie value (not a JWT) → external', async () => {
    const { req, res } = makeReqRes({ [`xyne_ws_${CALL_WS}_token`]: 'not-a-jwt' });
    const out = await callInviteRoutingService.detect(req, res, EXTERNAL_ID);
    expect(out).toEqual({ internal: false });
  });
});
