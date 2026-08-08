import type { Request, Response } from 'express';
import { jwtService } from './jwtService';
import { UserSessionService } from './userSessionService';
import { repositories } from '@/database/repositories';
import { config } from '@/config/env';
import { logger as baseLogger } from '@/utils/logger';
import { db } from '@/database/client';

const logger = baseLogger.child({ module: 'CallInviteRoutingService' });
const JOINABLE_CALL_STATUSES = new Set(['SCHEDULED', 'ACTIVE', 'IN_PROGRESS']);

export type DetectInternalCallInviteResult =
  | { result: 'internal'; redirectUrl: string; workspaceId: string }
  | { result: 'external' };

/**
 * Unified Smart Call Invite Link — server-side routing detector.
 *
 * Given a public call invite (`externalId`), decides whether the *current
 * browser* already has a live, internal Xyne session **in the call's own
 * workspace**. If so, the public `/external/call/:externalId` page can bounce
 * the user straight into the internal app instead of the external lobby.
 *
 * Hard security / correctness rules (see PRD §Unifying-Share-Call-Link):
 *   1. Key ONLY on `call.workspaceId`. Never trust the browser's ambient
 *      workspace signals (`x-workspace-id` header or `xyne_last_workspace`
 *      cookie) — a multi-workspace user's "last active" workspace is unrelated
 *      to which workspace *this* call belongs to.
 *   2. Read ONLY the `xyne_ws_<call.workspaceId>_token` cookie. Presenting a
 *      validly-signed token whose `workspaceId` matches the call proves an
 *      authenticated session in that workspace; the internal app still runs its
 *      own per-call ACL, so this is a routing hint, not an authorization grant.
 *   3. Fail closed to `internal: false` on ANY uncertainty. The external lobby
 *      is always a safe fallback and never reveals call existence or workspace.
 *   4. When a targeted refresh mints a fresh cookie, NEVER rewrite
 *      `xyne_last_workspace` — that pointer belongs to the user's real active
 *      session, not to this call.
 */
class CallInviteRoutingService {
  private userSessionService = new UserSessionService();

  /** Global (not workspace-scoped) session id, mirroring authV2Middleware. */
  private getSessionId(req: Request): string | undefined {
    const headerSessionId = req.headers['x-session-id'] as string | undefined;
    if (headerSessionId) return headerSessionId;
    return req.cookies?.user_session_id;
  }

  /**
   * Decide routing for a public invite link without leaking whether the call
   * exists. Expected misses resolve to the same opaque external result;
   * unexpected failures are handled by the controller as a generic 500.
   *
   * @returns an opaque external result unless the browser holds a live or
   *          refreshable internal session in the call's workspace.
   */
  async detect(
    req: Request,
    res: Response,
    externalId: string,
  ): Promise<DetectInternalCallInviteResult> {
    try {
      if (!config.enableUnifiedCallInviteLink) {
        return { result: 'external' };
      }

      const routing = await repositories.calls.getCallInviteRoutingInfo(externalId);
      // Opaque: unknown call, or a call with no workspace, is indistinguishable
      // from "not internal".
      if (
        !routing ||
        !routing.workspaceId ||
        !JOINABLE_CALL_STATUSES.has(routing.status)
      ) {
        return { result: 'external' };
      }

      const callWorkspaceId = routing.workspaceId;

      // Rule 2: read ONLY the workspace-scoped cookie for the CALL's workspace.
      const wsToken = req.cookies?.[`xyne_ws_${callWorkspaceId}_token`] as string | undefined;
      if (!wsToken) {
        return { result: 'external' };
      }

      let tokenWorkspaceId: string | null = null;
      let tokenUserId: string | null = null;
      let tokenMemberId: string | null = null;
      let tokenExpired = false;
      try {
        // Fast path: fully valid (unexpired) token.
        const payload = jwtService.verifyToken(wsToken);
        tokenWorkspaceId = payload.workspaceId;
        tokenUserId = payload.sub;
        tokenMemberId = payload.memberId;
      } catch {
        // Slow path: signature/iss/aud still valid but past `exp`. A short access
        // token expiring is normal for an otherwise-live session.
        try {
          const payload = jwtService.verifyIgnoringExpiry(wsToken);
          tokenWorkspaceId = payload.workspaceId;
          tokenUserId = payload.sub;
          tokenMemberId = payload.memberId;
          tokenExpired = true;
        } catch {
          // Bad signature / wrong iss-aud / force-logged-out → not internal.
          return { result: 'external' };
        }
      }

      // Defense in depth: the cookie name already encodes the workspace, but the
      // token's own claim MUST also match the call's workspace.
      if (tokenWorkspaceId !== callWorkspaceId) {
        return { result: 'external' };
      }

      if (!tokenUserId || !tokenMemberId) {
        return { result: 'external' };
      }

      // A signed token is not enough: membership may have been removed after
      // it was minted. Re-check the active workspace user before routing in.
      if (!tokenExpired) {
        const active = await this.isActiveWorkspaceUser(
          tokenUserId,
          tokenMemberId,
          callWorkspaceId,
        );
        if (!active) return { result: 'external' };
        return {
          result: 'internal',
          workspaceId: callWorkspaceId,
          redirectUrl: this.buildInternalUrl(externalId, routing.callType),
        };
      }

      // Expired token: only route internal if the GLOBAL session is genuinely
      // still active for THIS workspace. Confirm before committing so we never
      // dump the user onto the internal app's login screen.
      const refreshed = await this.confirmAndRefreshForWorkspace(
        req,
        res,
        callWorkspaceId,
        tokenUserId,
        tokenMemberId,
      );
      if (!refreshed) {
        return { result: 'external' };
      }
      return {
        result: 'internal',
        workspaceId: callWorkspaceId,
        redirectUrl: this.buildInternalUrl(externalId, routing.callType),
      };
    } catch (err) {
      // Expected misses return the opaque external result above. Unexpected
      // failures are surfaced as 500 by the controller; the client still
      // fails open into the external lobby without exposing the reason.
      logger.error('[call-invite] unexpected detect failure');
      throw err;
    }
  }

  private buildInternalUrl(externalId: string, callType: string): string {
    return `${config.frontendUrl}/call/${encodeURIComponent(externalId)}?type=${encodeURIComponent(callType)}`;
  }

  private async isActiveWorkspaceUser(
    userId: string,
    memberId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        workspaceId: true,
        orgMemberId: true,
        leftAt: true,
        orgMember: { select: { memberId: true, leftAt: true } },
      },
    });
    return !!(
      user &&
      user.workspaceId === workspaceId &&
      user.orgMemberId === memberId &&
      user.orgMember?.memberId === memberId &&
      !user.leftAt &&
      !user.orgMember.leftAt
    );
  }

  /**
   * Confirm the global session is live for `targetWorkspaceId` and, if so, mint
   * a fresh workspace-scoped access-token cookie. Returns true on success.
   *
   * IMPORTANT: only ever writes `xyne_ws_<targetWorkspaceId>_token`. It does NOT
   * touch `xyne_last_workspace`, so a user browsing an invite for workspace A
   * while actively in workspace B keeps B as their active workspace.
   */
  private async confirmAndRefreshForWorkspace(
    req: Request,
    res: Response,
    targetWorkspaceId: string,
    expectedUserId: string,
    expectedMemberId: string,
  ): Promise<boolean> {
    const sessionId = this.getSessionId(req);
    if (!sessionId) return false;

    const session = await this.userSessionService.getSessionById(sessionId);
    if (!session || !session.user) return false;

    // The global session must belong to the SAME workspace as the call. A user
    // with a stale cookie for workspace A but whose live session is workspace B
    // must NOT be routed into A.
    if (
      session.user.id !== expectedUserId ||
      session.user.orgMemberId !== expectedMemberId ||
      session.user.workspaceId !== targetWorkspaceId
    ) return false;

    const now = new Date();
    if (session.status !== 'ACTIVE' || now >= session.refreshTokenExpiry) return false;
    if (session.user.leftAt || session.user.orgMember?.leftAt) return false;

    const customToken = jwtService.generateToken({
      sub: session.user.id,
      email: session.user.email,
      name: session.user.name,
      picture: session.user.picture,
      workspaceId: session.user.workspaceId,
      memberId: session.user.orgMemberId,
    });

    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie(`xyne_ws_${targetWorkspaceId}_token`, customToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/',
      maxAge: config.jwt.expirationSeconds * 1000,
    });
    // Deliberately NOT setting xyne_last_workspace.

    await this.userSessionService.updateSession(session.id, { lastActivity: new Date() });
    return true;
  }
}

export const callInviteRoutingService = new CallInviteRoutingService();
