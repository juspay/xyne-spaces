import { db } from '@/database/client';
import { jwtService, type JwtPayload } from '@/services/jwtService';
import { UserSessionService } from '@/services/userSessionService';
import { TargetWorkspaceSessionService } from './targetWorkspaceSessionService';

const VALID_PAYLOAD: JwtPayload = {
  sub: 'workspace-a-user',
  email: 'user@example.test',
  name: 'Test User',
  workspaceId: 'workspace-a',
  memberId: 'org-member',
  exp: Math.floor(Date.now() / 1000) + 600,
};

const ACTIVE_SESSION = {
  id: 'session-a',
  userId: 'workspace-a-user',
  workspaceId: 'workspace-a',
  status: 'ACTIVE',
  refreshToken: 'refresh-token',
  refreshTokenExpiry: new Date(Date.now() + 60_000),
  accessToken: null,
  accessTokenExpiry: null,
  deviceInfo: null,
  deviceId: null,
  fcmToken: null,
  voipToken: null,
  ipAddress: null,
  lastActivity: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  user: {
    id: 'workspace-a-user',
    email: 'user@example.test',
    name: 'Test User',
    picture: null,
    workspaceId: 'workspace-a',
    orgMemberId: 'org-member',
    providerUserId: 'provider-user',
    authProvider: 'EMAIL',
    status: 'ACTIVE',
    leftAt: null,
    orgMember: { leftAt: null },
  },
};

describe('TargetWorkspaceSessionService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts a signed matching token only for an active workspace user', async () => {
    jest.spyOn(jwtService, 'verifyToken').mockReturnValue(VALID_PAYLOAD);
    jest.spyOn(db.user, 'findFirst').mockResolvedValue({
      orgMember: { leftAt: null },
    } as never);

    await expect(
      new TargetWorkspaceSessionService().authenticate({
        token: 'valid-token',
        targetWorkspaceId: 'workspace-a',
      })
    ).resolves.toEqual({ status: 'valid' });
  });

  it('rejects a cookie whose signed workspace claim does not match its name', async () => {
    jest.spyOn(jwtService, 'verifyToken').mockReturnValue({
      ...VALID_PAYLOAD,
      workspaceId: 'workspace-b',
    });
    const userLookup = jest.spyOn(db.user, 'findFirst');

    await expect(
      new TargetWorkspaceSessionService().authenticate({
        token: 'workspace-b-token',
        targetWorkspaceId: 'workspace-a',
      })
    ).resolves.toEqual({ status: 'external', reason: 'invalid_token' });
    expect(userLookup).not.toHaveBeenCalled();
  });

  it('rejects inactive or removed users after token validation', async () => {
    jest.spyOn(jwtService, 'verifyToken').mockReturnValue(VALID_PAYLOAD);
    jest.spyOn(db.user, 'findFirst').mockResolvedValue(null);

    await expect(
      new TargetWorkspaceSessionService().authenticate({
        token: 'valid-token',
        targetWorkspaceId: 'workspace-a',
      })
    ).resolves.toEqual({ status: 'external', reason: 'inactive_user' });
  });

  it('does not refresh an invalid or tampered token', async () => {
    jest.spyOn(jwtService, 'verifyToken').mockImplementation(() => {
      throw new Error('Invalid JWT token');
    });
    const expiredVerification = jest.spyOn(jwtService, 'verifyTokenIgnoringExpiration');
    const sessionLookup = jest.spyOn(UserSessionService.prototype, 'getSessionById');

    await expect(
      new TargetWorkspaceSessionService().authenticate({
        token: 'tampered-token',
        targetWorkspaceId: 'workspace-a',
        sessionId: 'session-a',
      })
    ).resolves.toEqual({ status: 'external', reason: 'invalid_token' });
    expect(expiredVerification).not.toHaveBeenCalled();
    expect(sessionLookup).not.toHaveBeenCalled();
  });

  it('refreshes once when the signed expired token and global session bind to the target workspace', async () => {
    jest.spyOn(jwtService, 'verifyToken').mockImplementation(() => {
      throw new Error('JWT token has expired');
    });
    jest.spyOn(jwtService, 'verifyTokenIgnoringExpiration').mockReturnValue({
      ...VALID_PAYLOAD,
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    const sessionLookup = jest
      .spyOn(UserSessionService.prototype, 'getSessionById')
      .mockResolvedValue(ACTIVE_SESSION as never);
    const sessionUpdate = jest
      .spyOn(UserSessionService.prototype, 'updateSession')
      .mockResolvedValue(ACTIVE_SESSION as never);
    jest.spyOn(jwtService, 'generateToken').mockReturnValue('fresh-workspace-a-token');

    await expect(
      new TargetWorkspaceSessionService().authenticate({
        token: 'expired-workspace-a-token',
        targetWorkspaceId: 'workspace-a',
        sessionId: 'session-a',
      })
    ).resolves.toEqual({ status: 'refreshed', token: 'fresh-workspace-a-token' });
    expect(sessionLookup).toHaveBeenCalledTimes(1);
    expect(sessionLookup).toHaveBeenCalledWith('session-a');
    expect(sessionUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not refresh from a global session bound to another workspace', async () => {
    jest.spyOn(jwtService, 'verifyToken').mockImplementation(() => {
      throw new Error('JWT token has expired');
    });
    jest.spyOn(jwtService, 'verifyTokenIgnoringExpiration').mockReturnValue({
      ...VALID_PAYLOAD,
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    jest.spyOn(UserSessionService.prototype, 'getSessionById').mockResolvedValue({
      ...ACTIVE_SESSION,
      workspaceId: 'workspace-b',
      user: { ...ACTIVE_SESSION.user, workspaceId: 'workspace-b' },
    } as never);
    const generateToken = jest.spyOn(jwtService, 'generateToken');

    await expect(
      new TargetWorkspaceSessionService().authenticate({
        token: 'expired-workspace-a-token',
        targetWorkspaceId: 'workspace-a',
        sessionId: 'session-b',
      })
    ).resolves.toEqual({
      status: 'external',
      reason: 'refresh_failed',
      refreshAttempted: true,
    });
    expect(generateToken).not.toHaveBeenCalled();
  });
});
