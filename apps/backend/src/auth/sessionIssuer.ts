/**
 * Session issuance: mint the opaque token, pick the device key, insert the row. Also the one
 * place a workspace access JWT is minted from (`mintWorkspaceJwt`), so every token carries the
 * same claim set (`SessionJwtClaims`) and is bound to its session (`sid`).
 */
import type { Request } from 'express';
import { config } from '@/config/env';
import { jwtService } from '@/services/jwtService';
import { encrypt } from '@/services/encryptionService';
import { authSessionRepository } from '@/bypassAcl/authSessionServices';
import { APP_VERSION_HEADER } from './constants';
import { resolveDeviceKey } from './deviceKey';
import { mintSessionToken } from './sessionTokens';
import type { IssueSessionInput, IssueSessionResult, MintWorkspaceJwtInput, RequestPlatform, SessionRepository } from './types';

export function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production';
}

function headerString(req: Pick<Request, 'headers'>, name: string): string | undefined {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s ? s : undefined;
}

export function buildDeviceInfo(req: Pick<Request, 'headers'>, platform: RequestPlatform | 'sdk' | string, now: Date = new Date()): string {
  return JSON.stringify({
    userAgent: headerString(req, 'user-agent'),
    acceptLanguage: headerString(req, 'accept-language'),
    timestamp: now.toISOString(),
    platform: platform.toLowerCase(),
    appVersion: headerString(req, APP_VERSION_HEADER),
  });
}

export function ipFromRequest(req: Request): string | undefined {
  return req.ip || req.socket?.remoteAddress || undefined;
}

export function sessionExpiryFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + config.session.expiryDays * 24 * 60 * 60 * 1000);
}

/** Workspace access JWT bound to a session (`sid`). TTL defaults to JWT_EXPIRATION_SECONDS. */
export function mintWorkspaceJwt(input: MintWorkspaceJwtInput): string {
  const { user } = input;
  return jwtService.generateToken(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      sid: input.sid,
      role: user.role,
      orgRole: input.orgRole,
      orgId: input.orgId,
      platform: input.platform,
    },
    input.expiresInSeconds ? { expiresInSeconds: input.expiresInSeconds } : undefined,
  );
}

/**
 * Create a session row for an account. The device key comes from the `x-device-id` header, else
 * the `xd` cookie (minted when absent, except for SDK which has no jar); other ACTIVE rows of that
 * device are revoked by the repository. Returns the opaque token to put in the cookies / JSON.
 */
export async function issueSession(input: IssueSessionInput, repo: SessionRepository = authSessionRepository): Promise<IssueSessionResult> {
  const now = new Date();
  // `xd` is not a credential: Lax so it still travels on the cross-site OAuth callback navigation
  // (a Strict cookie would not, and every Google re-login would mint a new device key). Mobile jars need None.
  const device = resolveDeviceKey(input.req, {
    sameSite: input.platform === 'MOBILE' ? 'none' : 'lax',
    secure: secureCookies(),
    persist: input.platform !== 'SDK',
  });
  const minted = mintSessionToken();
  const session = await repo.createSession({
    accountId: input.accountId,
    orgId: input.orgId,
    tokenHash: minted.tokenHash,
    deviceKey: device.deviceKey,
    platform: input.platform,
    absoluteExpiry: input.absoluteExpiry ?? sessionExpiryFrom(now),
    deviceInfo: encrypt(buildDeviceInfo(input.req, input.platform, now)),
    appVersion: input.appVersion ?? headerString(input.req, APP_VERSION_HEADER) ?? null,
  });
  return { session, token: minted.token, deviceCookie: device.cookie };
}
