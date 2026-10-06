/**
 * The one place a login / switch / create / join handler finishes: issue the session (or a
 * grant on the existing one), apply cookies, set the onboarding cookie, clear the pending
 * OAuth identity. Session failures propagate — a JWT-only "login" is not a login.
 */
import type { Request } from 'express';
import { logger } from '@/utils/logger';
import { setOnboardingCookie } from '@/utils/onboardingCookie';
import { findOrgMember } from '@/bypassAcl/authSessionServices';
import { clearPendingAuth } from './pendingAuth';
import { applyCookies } from './sessionCookies';
import { ExistingSessionUnusableError, issueLogin, issueWorkspaceSwitch } from './sessionIssuer';
import type { CompleteLoginInput, CompleteLoginResult, ExistingSessionRef, Issuance, IssueWorkspaceSwitchInput } from './types';

/** The caller's current session as a switch/create/join handler should pass it. */
export function existingSessionFromRequest(req: Request): ExistingSessionRef | null {
  if (req.authSession) {
    return { sessionId: req.authSession.sessionId, legacySessionId: req.authSession.legacySessionId };
  }
  if (req.authenticatedSessionId) {
    return { sessionId: null, legacySessionId: req.authenticatedSessionId };
  }
  return null;
}

function switchKind(loginMethod: CompleteLoginInput['loginMethod']): NonNullable<IssueWorkspaceSwitchInput['kind']> {
  if (loginMethod === 'WORKSPACE_CREATED') return 'create';
  if (loginMethod === 'WORKSPACE_JOINED') return 'join';
  return 'switch';
}

function hasRef(ref: ExistingSessionRef | null | undefined): ref is ExistingSessionRef {
  return !!ref && (!!ref.sessionId || !!ref.legacySessionId);
}

export async function completeLogin(input: CompleteLoginInput): Promise<CompleteLoginResult> {
  const { req, res, workspaceUser, loginMethod, platform, sameSite, isNewUser } = input;

  let issuance: Issuance | null = null;
  let switched = false;
  if (hasRef(input.existingSession)) {
    try {
      issuance = await issueWorkspaceSwitch({
        current: input.existingSession,
        targetUser: workspaceUser,
        req,
        platform,
        loginMethod,
        sameSite,
        kind: switchKind(loginMethod),
      });
      switched = true;
    } catch (error) {
      if (!(error instanceof ExistingSessionUnusableError)) throw error;
      // The caller proved its identity some other way (pending cookie, test login); a stale
      // session reference must not block the login — issue a fresh one.
      logger.warn('[AUTH] [completeLogin] existing session unusable, issuing a fresh login', {
        reason: error.message,
        sessionId: input.existingSession.sessionId ?? null,
        legacySessionId: input.existingSession.legacySessionId ?? null,
        loginMethod,
      });
    }
  }

  if (!issuance) {
    const orgMember = await findOrgMember(workspaceUser.orgMemberId);
    if (!orgMember) {
      throw new Error(`[auth] org member ${workspaceUser.orgMemberId} not found for user ${workspaceUser.id}`);
    }
    if (orgMember.leftAt) {
      throw new Error(`[auth] org member ${workspaceUser.orgMemberId} has left the organization`);
    }
    issuance = await issueLogin({
      user: workspaceUser,
      orgMember: { memberId: orgMember.memberId, orgId: orgMember.orgId },
      req,
      platform,
      loginMethod,
      amr: input.amr,
      sameSite,
      isNewUser,
    });
  }

  applyCookies(res, issuance.cookies);
  setOnboardingCookie(res, isNewUser, {
    secure: process.env.NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
    maxAge: input.onboardingMaxAgeMs,
  });
  if (input.pending) clearPendingAuth(res);

  logger.info('[AUTH] [completeLogin] done', {
    userId: workspaceUser.id,
    workspaceId: issuance.workspaceId,
    sessionId: issuance.session?.id ?? null,
    legacySessionId: issuance.legacySessionId,
    loginMethod,
    platform,
    viaExistingSession: switched,
    isNewUser,
  });

  return {
    session: issuance.session,
    grant: issuance.grant,
    jwt: issuance.jwt,
    legacySessionId: issuance.legacySessionId,
    workspaceId: issuance.workspaceId,
    sessionToken: issuance.sessionToken,
  };
}
