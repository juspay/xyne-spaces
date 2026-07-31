import type { CallStatus, CallType } from '@prisma/client';
import type { TargetWorkspaceSessionResult } from '@/services/targetWorkspaceSessionService';
import { isCallLobbyJoinable } from '@/services/callLobbyPolicy';

export type DetectInternalExternalReason =
  | 'no_call'
  | 'not_joinable'
  | 'no_workspace'
  | 'no_cookie'
  | 'invalid_token'
  | 'refresh_failed'
  | 'inactive_user';

export type InternalCallInviteDetectionOutcome =
  | {
      result: 'internal';
      workspaceId: string;
      externalId: string;
      callType: CallType;
      refresh: 'not_attempted' | 'succeeded';
      refreshedToken?: string;
    }
  | {
      result: 'external';
      reason: DetectInternalExternalReason;
      refresh: 'not_attempted' | 'failed';
    };

export interface CallInviteRoutingRepository {
  getCallInviteRoutingInfo(externalId: string): Promise<{
    id: string;
    externalId: string;
    callType: CallType;
    status: CallStatus;
    workspaceId: string | null;
  } | null>;
}

export interface TargetWorkspaceAuthenticator {
  authenticate(params: {
    token: string;
    targetWorkspaceId: string;
    sessionId?: string;
  }): Promise<TargetWorkspaceSessionResult>;
}

export class InternalCallInviteDetectionService {
  constructor(
    private readonly calls: CallInviteRoutingRepository,
    private readonly sessionAuthenticator: TargetWorkspaceAuthenticator
  ) {}

  async detect(params: {
    externalId: string;
    cookies?: Record<string, unknown>;
    sessionId?: string;
  }): Promise<InternalCallInviteDetectionOutcome> {
    const call = await this.calls.getCallInviteRoutingInfo(params.externalId);
    if (!call) {
      return { result: 'external', reason: 'no_call', refresh: 'not_attempted' };
    }
    if (!isCallLobbyJoinable(call.status)) {
      return { result: 'external', reason: 'not_joinable', refresh: 'not_attempted' };
    }
    if (!call.workspaceId) {
      return { result: 'external', reason: 'no_workspace', refresh: 'not_attempted' };
    }

    const cookieName = `xyne_ws_${call.workspaceId}_token`;
    const cookieValue = params.cookies?.[cookieName];
    if (typeof cookieValue !== 'string' || cookieValue.length === 0) {
      return { result: 'external', reason: 'no_cookie', refresh: 'not_attempted' };
    }

    const authResult = await this.sessionAuthenticator.authenticate({
      token: cookieValue,
      targetWorkspaceId: call.workspaceId,
      sessionId: params.sessionId,
    });
    if (authResult.status === 'external') {
      return {
        result: 'external',
        reason: authResult.reason,
        refresh: authResult.refreshAttempted ? 'failed' : 'not_attempted',
      };
    }

    return {
      result: 'internal',
      workspaceId: call.workspaceId,
      externalId: call.externalId,
      callType: call.callType,
      refresh: authResult.status === 'refreshed' ? 'succeeded' : 'not_attempted',
      ...(authResult.status === 'refreshed' ? { refreshedToken: authResult.token } : {}),
    };
  }
}
