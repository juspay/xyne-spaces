import type { Request, Response } from 'express';
import { CallStatus, SessionStatus } from '@xyne/shared';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { jwtService } from '@/services/jwtService';
import { resolveRequest } from '@/auth/sessionResolver';
import { applyCookies, lastWorkspaceCookie } from '@/auth/sessionCookies';
import { LEGACY_SESSION_COOKIE, LEGACY_SESSION_HEADER } from '@/auth/constants';
import { logger } from '@/utils/logger';

const JOINABLE_CALL_STATUSES = new Set<CallStatus>([
  CallStatus.SCHEDULED,
  CallStatus.ACTIVE,
  CallStatus.IN_PROGRESS,
]);

/** Lifetime of the workspace pointer written when routing into the internal app. */
const LAST_WORKSPACE_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
      this.claimFromWorkspaceToken(req, callWorkspaceId) ??
      (await this.claimFromSession(req, callWorkspaceId));
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
    applyCookies(res, [
      lastWorkspaceCookie(
        callWorkspaceId,
        new Date(Date.now() + LAST_WORKSPACE_COOKIE_MAX_AGE_MS),
        { sameSite: 'strict', secure: isProduction },
      ),
    ]);

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
   * `xyne_ws_<id>_token` lives JWT_EXPIRATION_SECONDS; the account session
   * (`xyne_session` / `user_session_id`) lives much longer, and every
   * authenticated route quietly mints a fresh access token from it. This route
   * is public, so nothing runs in front of it to do that — reading the access
   * token alone sent signed-in members to the guest lobby for the sole reason
   * that they had not opened Spaces since yesterday.
   *
   * The shared resolver is asked for the call's workspace explicitly (ambient
   * hints are ignored) and may not mint a grant: a session without one for this
   * workspace is a `workspace_forbidden`, which falls back to the raw legacy
   * row so the membership check above still gets a claim to reject. Nothing the
   * resolver computed is written to the response: the dashboard load this
   * routes to is an authenticated request, and refreshes the cookies itself.
   */
  private async claimFromSession(req: Request, callWorkspaceId: string): Promise<CallInviteClaim | null> {
    try {
      const result = await resolveRequest(req, {
        allowBearer: false,
        allowAutoRefresh: true,
        workspaceId: callWorkspaceId,
        allowAutoGrant: false,
      });
      if (result.ok) {
        const { user } = result.auth;
        if (!user.id || !user.memberId) return null;
        return { userId: user.id, memberId: user.memberId };
      }
      if (result.reason !== 'workspace_forbidden') {
        return null;
      }
    } catch (err) {
      logger.warn(`[call-invite-routing] session resolve failed | error=${err}`);
      return null;
    }

    return this.claimFromLegacySession(req);
  }

  /** The raw `workflow.user_sessions` row behind `user_session_id` / `x-session-id`. */
  private async claimFromLegacySession(req: Request): Promise<CallInviteClaim | null> {
    const sessionId =
      (req.headers[LEGACY_SESSION_HEADER] as string | undefined) ||
      (req.cookies?.[LEGACY_SESSION_COOKIE] as string | undefined);
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
