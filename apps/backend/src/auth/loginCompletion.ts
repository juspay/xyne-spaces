/**
 * The one place a login / switch / create / join handler finishes: reuse the caller's session
 * when it already belongs to the same account, otherwise issue a new one; mint the workspace
 * access JWT; apply cookies per platform; set the onboarding cookie; clear the pending OAuth
 * identity; track the login. Session failures propagate — a JWT-only "login" is not a login.
 */
import type { Request, Response } from 'express';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { setOnboardingCookie } from '@/utils/onboardingCookie';
import { userActivityTrackingService } from '@/services/userActivityTrackingService';
import { authSessionRepository } from '@/bypassAcl/authSessionServices';
import { recordSessionIssued, recordTokenMinted } from '@/services/otel/authMetrics';
import { clearPendingAuth } from './pendingAuth';
import { legacyCookieMirror, toSessionPlatform } from './platform';
import { applyCookies, cookiesForLogout, cookiesForSession } from './sessionCookies';
import { issueSession, mintWorkspaceJwt, secureCookies } from './sessionIssuer';
import { resolveSessionFromRequest } from './sessionResolver';
import { readSessionCredential } from './sessionTokens';
import type { AuthSessionRow, CompleteLoginInput, CompleteLoginResult, SessionPlatform, SessionRevokeReason } from './types';

/** Platform enum value for activity tracking (`WEB` | `ELECTRON` | `MOBILE`; SDK logs as WEB). */
function activityPlatform(platform: string): 'WEB' | 'ELECTRON' | 'MOBILE' {
  return platform === 'ELECTRON' || platform === 'MOBILE' ? platform : 'WEB';
}

export async function completeLogin(input: CompleteLoginInput): Promise<CompleteLoginResult> {
  const { req, res, workspaceUser, orgMember, loginMethod, sameSite, isNewUser } = input;
  const requested = toSessionPlatform(input.platform);

  // Reuse: the request already carries a live session of this account (switch / create / join /
  // second-workspace auto-login). Never for SDK issuance.
  let session: AuthSessionRow | null = null;
  let sessionToken: string | null = null;
  if (requested !== 'SDK') {
    const existing = await resolveSessionFromRequest(req);
    if (existing.ok && existing.session.session.accountId === orgMember.memberId) {
      session = existing.session.session;
      sessionToken = existing.session.credential;
    } else if (req.authSession?.accountId === orgMember.memberId) {
      // Resolved earlier through a Bearer JWT with `sid` (mobile switch) and no cookie travelled.
      session = await authSessionRepository.findById(req.authSession.sessionId);
      sessionToken = readSessionCredential(req)?.value ?? null;
      if (session && (session.status !== 'ACTIVE' || session.absoluteExpiry.getTime() <= Date.now())) session = null;
    }
  }
  const reused = !!session;

  let deviceCookie = null;
  if (!session) {
    const issued = await issueSession({ accountId: orgMember.memberId, orgId: orgMember.orgId, platform: requested, req });
    session = issued.session;
    sessionToken = issued.token;
    deviceCookie = issued.deviceCookie;
  }
  const platform = session.platform as SessionPlatform;

  // Requirement: a fresh access token on every login / switch / create / join.
  const token = mintWorkspaceJwt({
    user: workspaceUser,
    memberId: orgMember.memberId,
    workspaceId: workspaceUser.workspaceId,
    sid: session.id,
    orgId: orgMember.orgId,
    orgRole: orgMember.role,
    platform,
  });
  recordTokenMinted({ audience: 'cookie' });

  if (sessionToken) {
    applyCookies(
      res,
      cookiesForSession({
        platform,
        sessionToken,
        sessionExpiresAt: session.absoluteExpiry,
        workspaceId: workspaceUser.workspaceId,
        jwt: token,
        jwtTtlSeconds: config.jwt.expirationSeconds,
        sameSite,
        secure: secureCookies(),
        deviceCookie,
        writeSessionCookies: !reused,
        writeLastWorkspace: true,
        legacyMirror: platform === 'MOBILE' && legacyCookieMirror(req),
      }),
    );
  }
  if (reused) recordSessionIssued({ kind: 'reuse', platform });

  setOnboardingCookie(res, isNewUser, {
    secure: secureCookies() || sameSite === 'none',
    sameSite,
    maxAge: input.onboardingMaxAgeMs,
  });
  if (input.clearPending) clearPendingAuth(res);

  void userActivityTrackingService.trackLogin(workspaceUser.id, {
    sessionId: session.id,
    method: loginMethod,
    platform: activityPlatform(platform) as never,
    metadata: { authProvider: workspaceUser.authProvider, reused },
  });

  logger.info('[AUTH] [completeLogin] done', {
    userId: workspaceUser.id,
    workspaceId: workspaceUser.workspaceId,
    sessionId: session.id,
    loginMethod,
    platform,
    reused,
    isNewUser,
  });

  return { sessionId: session.id, sessionToken, token, workspaceId: workspaceUser.workspaceId, platform, reused };
}

/**
 * Revoke the caller's session and clear every auth cookie (never `xd`). Encryption key
 * revocation stays in the controller (it owns the fingerprint ↔ key-store contract).
 */
export async function logoutSession(req: Request, res: Response, reason: SessionRevokeReason): Promise<{ sessionId: string | null }> {
  let sessionId = req.authSession?.sessionId ?? null;
  if (!sessionId) {
    const resolved = await resolveSessionFromRequest(req);
    if (resolved.ok) sessionId = resolved.session.session.id;
  }
  if (sessionId) {
    await authSessionRepository.revokeSession(sessionId, reason);
    if (req.user) {
      void userActivityTrackingService.trackLogout(req.user.id, {
        sessionId,
        reason,
        platform: activityPlatform(req.authSession?.platform ?? 'WEB') as never,
      });
    }
  }
  applyCookies(res, cookiesForLogout(Object.keys(req.cookies ?? {})));
  return { sessionId };
}
