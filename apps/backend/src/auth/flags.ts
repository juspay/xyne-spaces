import { config } from '@/config/env';
import type { AuthCookieMode, AuthSessionFlags, AuthSessionWriteMode } from './types';

export function getAuthSessionFlags(): AuthSessionFlags {
  const a = config.authSessions;
  return {
    writeMode: a.writeMode,
    readMode: a.readMode,
    cookieMode: a.cookieMode,
    tokenMode: a.tokenMode,
    v3Orgs: a.v3Orgs,
  };
}

/**
 * Allowed flag combinations. Mirrors the rollout runbook: each stage only ever flips one flag,
 * and every combination here is one a stage can legitimately sit on.
 */
export function validateAuthSessionFlagsFor(flags: AuthSessionFlags): void {
  const { writeMode, readMode, cookieMode, tokenMode, v3Orgs } = flags;
  const fail = (msg: string): never => {
    throw new Error(`[auth flags] ${msg}`);
  };
  if (writeMode === 'v3') {
    fail(
      'AUTH_SESSION_WRITE_MODE=v3 is blocked until push tokens leave sessions and claw stops reading user_sessions',
    );
  }
  if (writeMode === 'legacy' && cookieMode !== 'legacy') {
    fail('AUTH_COOKIE_MODE must be legacy while AUTH_SESSION_WRITE_MODE=legacy (no xyne_session to set)');
  }
  if (writeMode === 'legacy' && readMode === 'v3') {
    fail('AUTH_SESSION_READ_MODE=v3 requires AUTH_SESSION_WRITE_MODE=dual (nothing would be readable)');
  }
  if (readMode === 'v3' && v3Orgs !== 'all') {
    fail('AUTH_SESSION_READ_MODE=v3 requires AUTH_V3_ORGS=all (legacy-only orgs could never log in)');
  }
  if (tokenMode === 'hashed' && writeMode === 'legacy') {
    fail('SESSION_TOKEN_MODE=hashed requires AUTH_SESSION_WRITE_MODE=dual');
  }
}

export function validateAuthSessionFlags(): void {
  validateAuthSessionFlagsFor(getAuthSessionFlags());
}

export function isV3Org(orgId: string | null | undefined, flags: AuthSessionFlags = getAuthSessionFlags()): boolean {
  if (flags.writeMode === 'legacy') return false;
  if (flags.v3Orgs === 'all') return true;
  return !!orgId && flags.v3Orgs.includes(orgId);
}

/**
 * Modes in force at ISSUANCE (login / switch / backfill) for one org. The resolver is
 * allowlist-agnostic; only issuance consults the canary list.
 */
export function effectiveIssuanceModes(
  orgId: string | null | undefined,
  flags: AuthSessionFlags = getAuthSessionFlags(),
): { write: AuthSessionWriteMode; cookie: AuthCookieMode } {
  if (!isV3Org(orgId, flags)) return { write: 'legacy', cookie: 'legacy' };
  return { write: flags.writeMode, cookie: flags.cookieMode };
}
