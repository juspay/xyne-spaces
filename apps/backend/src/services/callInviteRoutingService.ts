import type { Request, Response } from 'express';
import { CallStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { readWorkspaceJwt } from '@/services/accessTokenService';
import { config } from '@/config/env';

const JOINABLE_CALL_STATUSES = new Set<CallStatus>([
  CallStatus.SCHEDULED,
  CallStatus.ACTIVE,
  CallStatus.IN_PROGRESS,
]);

export type InternalCallRouteResolution =
  | { result: 'internal'; workspaceId: string }
  /** The call workspace's JWT cookie is present but expired: refresh via /auth/refresh-session and probe again. */
  | { result: 'needs-refresh' }
  | { result: 'external' };

/**
 * Who the caller claims to be. Either credential below produces one, and the
 * membership check that follows is the same either way — a claim on its own
 * decides nothing.
 */
type CallInviteClaim = { userId: string; memberId: string };

class CallInviteRoutingService {
  /**
   * Resolve a public call invite against the session for the call's workspace.
   * Ambient workspace signals are intentionally ignored: a user browsing
   * workspace B may still have a valid workspace A cookie for an A call.
   *
   * This is only a routing decision. /api/calls/join remains responsible for
   * the host/invitee/channel-member authorization check.
   */
  async resolve(
    req: Request,
    res: Response,
    externalId: string
  ): Promise<InternalCallRouteResolution> {
    const routing = await repositories.calls.getCallInviteRoutingInfo(externalId);
    if (!routing || !JOINABLE_CALL_STATUSES.has(routing.status)) {
      return { result: 'external' };
    }

    const callWorkspaceId = routing.workspaceId;

    // The workspace access token is the only credential sent here: the refresh
    // token (`xs`) travels solely to /auth/refresh-session. An expired token is
    // reported as such so the client refreshes and probes again, instead of a
    // signed-in member landing in the guest lobby for not having opened Spaces
    // since yesterday.
    const claim = this.claimFromWorkspaceToken(req, callWorkspaceId);
    if (claim === 'expired') {
      return { result: 'needs-refresh' };
    }
    if (!claim) {
      return { result: 'external' };
    }

    // Membership may have been revoked after the credential was issued, so
    // holding one is not enough to route into the internal app.
    const user = await db.user.findUnique({
      where: { id: claim.userId },
      select: {
        workspaceId: true,
        orgMemberId: true,
        leftAt: true,
        orgMember: { select: { memberId: true, leftAt: true } },
      },
    });
    if (
      !user ||
      user.workspaceId !== callWorkspaceId ||
      user.orgMemberId !== claim.memberId ||
      user.orgMember?.memberId !== claim.memberId ||
      user.leftAt ||
      user.orgMember.leftAt
    ) {
      return { result: 'external' };
    }

    // The following hard navigation loads the dashboard in the call's
    // workspace. Update the server-side workspace pointer as well so Zero and
    // endpoints that do not carry x-workspace-id resolve the same workspace.
    const isProduction = config.env === 'production';
    res.cookie('xyne_last_workspace', callWorkspaceId, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return { result: 'internal', workspaceId: callWorkspaceId };
  }

  /** The workspace-scoped access token for the call's own workspace; `'expired'` when present but past its exp. */
  private claimFromWorkspaceToken(req: Request, callWorkspaceId: string): CallInviteClaim | 'expired' | null {
    const read = readWorkspaceJwt(req, callWorkspaceId);
    if (read.status === 'expired') {
      return 'expired';
    }
    if (read.status !== 'valid') {
      return null;
    }
    const { payload } = read;
    if (payload.workspaceId !== callWorkspaceId || !payload.sub || !payload.memberId) {
      return null;
    }
    return { userId: payload.sub, memberId: payload.memberId };
  }
}

export const callInviteRoutingService = new CallInviteRoutingService();
