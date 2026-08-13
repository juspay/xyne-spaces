import type { Request, Response } from 'express';
import { CallStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { jwtService } from '@/services/jwtService';

const JOINABLE_CALL_STATUSES = new Set<CallStatus>([
  CallStatus.SCHEDULED,
  CallStatus.ACTIVE,
  CallStatus.IN_PROGRESS,
]);

export type InternalCallRouteResolution =
  | { result: 'internal'; workspaceId: string }
  | { result: 'external' };

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
    const token = req.cookies?.[`xyne_ws_${callWorkspaceId}_token`] as string | undefined;
    if (!token) {
      return { result: 'external' };
    }

    let payload;
    try {
      payload = jwtService.verifyToken(token);
    } catch {
      return { result: 'external' };
    }

    if (payload.workspaceId !== callWorkspaceId || !payload.sub || !payload.memberId) {
      return { result: 'external' };
    }

    // Membership may have been removed after the JWT was issued, so the
    // signed cookie alone is not enough to route into the internal app.
    const user = await db.user.findUnique({
      where: { id: payload.sub },
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
      user.orgMemberId !== payload.memberId ||
      user.orgMember?.memberId !== payload.memberId ||
      user.leftAt ||
      user.orgMember.leftAt
    ) {
      return { result: 'external' };
    }

    // The following hard navigation loads the dashboard in the call's
    // workspace. Update the server-side workspace pointer as well so Zero and
    // endpoints that do not carry x-workspace-id resolve the same workspace.
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('xyne_last_workspace', callWorkspaceId, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return { result: 'internal', workspaceId: callWorkspaceId };
  }
}

export const callInviteRoutingService = new CallInviteRoutingService();
