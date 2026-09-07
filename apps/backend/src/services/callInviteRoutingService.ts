import type { Request, Response } from 'express';
import { CallStatus, SessionStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { jwtService } from '@/services/jwtService';
import { logger } from '@/utils/logger';

const JOINABLE_CALL_STATUSES = new Set<CallStatus>([
  CallStatus.SCHEDULED,
  CallStatus.ACTIVE,
  CallStatus.IN_PROGRESS,
]);

export type InternalCallRouteResolution =
  | { result: 'internal'; workspaceId: string }
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

    // The access token first, the login session behind it — the same two
    // credentials, in the same order, that every authenticated route accepts.
    const claim =
      this.claimFromWorkspaceToken(req, callWorkspaceId) ?? (await this.claimFromSession(req));
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

  /** The workspace-scoped access token for the call's own workspace. */
  private claimFromWorkspaceToken(req: Request, callWorkspaceId: string): CallInviteClaim | null {
    const token = req.cookies?.[`xyne_ws_${callWorkspaceId}_token`] as string | undefined;
    if (!token) {
      return null;
    }

    try {
      const payload = jwtService.verifyToken(token);
      if (payload.workspaceId !== callWorkspaceId || !payload.sub || !payload.memberId) {
        return null;
      }
      return { userId: payload.sub, memberId: payload.memberId };
    } catch {
      return null;
    }
  }

  /**
   * The login session, which is what actually keeps a user signed in.
   *
   * `xyne_ws_<id>_token` lives JWT_EXPIRATION_SECONDS (a day by default);
   * `user_session_id` lives a year, and every authenticated route quietly mints
   * a fresh access token from it (authV2Middleware.attemptRefresh). This route
   * is public, so nothing runs in front of it to do that — reading the access
   * token alone sent signed-in members to the guest lobby for the sole reason
   * that they had not opened Spaces since yesterday.
   *
   * Nothing is minted here either: the dashboard load this routes to is an
   * authenticated request, and refreshes the cookie itself.
   */
  private async claimFromSession(req: Request): Promise<CallInviteClaim | null> {
    const sessionId =
      (req.headers['x-session-id'] as string | undefined) ||
      (req.cookies?.user_session_id as string | undefined);
    if (!sessionId) {
      return null;
    }

    try {
      const session = await db.userSession.findUnique({
        where: { id: sessionId },
        select: {
          status: true,
          refreshTokenExpiry: true,
          user: { select: { id: true, orgMemberId: true } },
        },
      });
      if (!session?.user?.id || !session.user.orgMemberId) {
        return null;
      }
      if (session.status !== SessionStatus.ACTIVE || new Date() >= session.refreshTokenExpiry) {
        return null;
      }
      return { userId: session.user.id, memberId: session.user.orgMemberId };
    } catch (err) {
      logger.warn(`[call-invite-routing] session lookup failed | error=${err}`);
      return null;
    }
  }
}

export const callInviteRoutingService = new CallInviteRoutingService();
