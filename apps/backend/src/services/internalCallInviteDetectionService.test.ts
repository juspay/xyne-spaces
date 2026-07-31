import { CallStatus, CallType } from '@prisma/client';
import {
  InternalCallInviteDetectionService,
  type InternalCallInviteDetectionOutcome,
} from './internalCallInviteDetectionService';
import type { TargetWorkspaceSessionResult } from './targetWorkspaceSessionService';

interface RoutingCall {
  id: string;
  externalId: string;
  callType: CallType;
  status: CallStatus;
  workspaceId: string | null;
}

const ROUTABLE_CALL: RoutingCall = {
  id: 'call-id',
  externalId: 'public-call-id',
  callType: CallType.VIDEO,
  status: CallStatus.ACTIVE,
  workspaceId: 'workspace-a',
};

function createSubject(params?: {
  call?: RoutingCall | null;
  authResult?: TargetWorkspaceSessionResult;
}): {
  subject: InternalCallInviteDetectionService;
  authenticate: jest.Mock;
} {
  const getCallInviteRoutingInfo = jest
    .fn()
    .mockResolvedValue(params && 'call' in params ? params.call : ROUTABLE_CALL);
  const authenticate = jest
    .fn()
    .mockResolvedValue(params?.authResult ?? ({ status: 'valid' } as const));

  return {
    subject: new InternalCallInviteDetectionService({ getCallInviteRoutingInfo }, { authenticate }),
    authenticate,
  };
}

describe('InternalCallInviteDetectionService', () => {
  it.each([
    ['not found', null, 'no_call'],
    ['ended', { ...ROUTABLE_CALL, status: CallStatus.ENDED }, 'not_joinable'],
    ['without workspace', { ...ROUTABLE_CALL, workspaceId: null }, 'no_workspace'],
  ])('keeps a %s call external', async (_label, call, reason) => {
    const { subject, authenticate } = createSubject({ call });

    await expect(subject.detect({ externalId: 'public-call-id' })).resolves.toMatchObject({
      result: 'external',
      reason,
    });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('uses only the cookie named for the call workspace', async () => {
    const { subject, authenticate } = createSubject();

    await expect(
      subject.detect({
        externalId: 'public-call-id',
        cookies: {
          xyne_last_workspace: 'workspace-b',
          'xyne_ws_workspace-b_token': 'valid-b-token',
        },
      })
    ).resolves.toMatchObject({ result: 'external', reason: 'no_cookie' });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('uses a matching token even when the last-workspace pointer differs', async () => {
    const { subject, authenticate } = createSubject();

    const outcome = await subject.detect({
      externalId: 'public-call-id',
      cookies: {
        xyne_last_workspace: 'workspace-b',
        'xyne_ws_workspace-b_token': 'workspace-b-token',
        'xyne_ws_workspace-a_token': 'workspace-a-token',
      },
      sessionId: 'workspace-a-session',
    });

    expect(outcome).toMatchObject({
      result: 'internal',
      workspaceId: 'workspace-a',
      externalId: 'public-call-id',
    });
    expect(authenticate).toHaveBeenCalledWith({
      token: 'workspace-a-token',
      targetWorkspaceId: 'workspace-a',
      sessionId: 'workspace-a-session',
    });
  });

  it.each<Extract<TargetWorkspaceSessionResult, { status: 'external' }>>([
    { status: 'external', reason: 'invalid_token' },
    { status: 'external', reason: 'inactive_user' },
    { status: 'external', reason: 'refresh_failed', refreshAttempted: true },
  ])('does not expose authentication misses for $reason', async (authResult) => {
    const { subject } = createSubject({ authResult });

    const outcome = await subject.detect({
      externalId: 'public-call-id',
      cookies: { 'xyne_ws_workspace-a_token': 'matching-token' },
      sessionId: 'session-id',
    });

    expect(outcome).toMatchObject({ result: 'external', reason: authResult.reason });
  });

  it('returns only the matching refreshed token to its controller', async () => {
    const { subject } = createSubject({
      authResult: { status: 'refreshed', token: 'fresh-workspace-a-token' },
    });

    const outcome: InternalCallInviteDetectionOutcome = await subject.detect({
      externalId: 'public-call-id',
      cookies: { 'xyne_ws_workspace-a_token': 'expired-workspace-a-token' },
      sessionId: 'workspace-a-session',
    });

    expect(outcome).toMatchObject({
      result: 'internal',
      workspaceId: 'workspace-a',
      refresh: 'succeeded',
      refreshedToken: 'fresh-workspace-a-token',
    });
  });
});
