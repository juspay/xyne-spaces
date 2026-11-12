/**
 * Spaces → claw-auth delegation tokens.
 *
 * When the backend calls claw-auth for a user, it signs a short-lived ES256 JWT
 * naming that user. claw-auth verifies it with the public key
 * (SPACES_DELEGATION_PUBLIC_KEYS there) and takes the user from the token
 * instead of from a header the caller chose, so a leaked shared key can no
 * longer act as an arbitrary user.
 *
 * Claims: iss "xyne-spaces", aud "xyne-claw-auth", sub <Spaces user id>,
 * ws <workspace id>, prp <purpose>, iat, exp (iat + 5 min), jti.
 * Signing lives in src/claw/jwt.ts (one Spaces key, CLAW_DELEGATION_PRIVATE_KEY).
 */

import { randomUUID } from 'crypto';
import { CLAW_AUTH_AUDIENCE, SPACES_ISSUER, signSpacesJwt } from '@/claw/jwt';

export const CLAW_DELEGATION_HEADER = 'x-spaces-delegation';
const LIFETIME_SECONDS = 300;

/**
 * A delegation token for `spacesUserId`, or undefined when no signing key is
 * configured. `extra` adds claims (e.g. `bh`, the body hash on outbound events).
 */
export function mintClawDelegationToken(args: {
  spacesUserId: string;
  workspaceId?: string;
  purpose?: string;
  extra?: Record<string, string>;
  typ?: string;
}): string | undefined {
  const sub = args.spacesUserId?.trim();
  if (!sub) return undefined;
  const now = Math.floor(Date.now() / 1000);
  return signSpacesJwt(
    {
      ...(args.extra ?? {}),
      iss: SPACES_ISSUER,
      aud: CLAW_AUTH_AUDIENCE,
      sub,
      ...(args.workspaceId ? { ws: args.workspaceId } : {}),
      ...(args.purpose ? { prp: args.purpose } : {}),
      iat: now,
      exp: now + LIFETIME_SECONDS,
      jti: randomUUID(),
    },
    args.typ ?? 'JWT'
  );
}

/** `{ 'x-spaces-delegation': <token> }`, or `{}` when delegation is not configured. */
export function clawDelegationHeaders(
  spacesUserId: string | undefined,
  workspaceId?: string,
  purpose?: string
): Record<string, string> {
  if (!spacesUserId) return {};
  const token = mintClawDelegationToken({ spacesUserId, ...(workspaceId ? { workspaceId } : {}), ...(purpose ? { purpose } : {}) });
  return token ? { [CLAW_DELEGATION_HEADER]: token } : {};
}
