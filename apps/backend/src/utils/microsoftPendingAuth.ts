import jwt from 'jsonwebtoken';

export interface MicrosoftPendingAuthIdentity {
  providerUserId: string;
  email: string;
  name: string;
  picture?: string;
}

/**
 * Microsoft access tokens are large enough that embedding one alongside the
 * refresh token can exceed the browser's per-cookie size limit. Invitation
 * acceptance only needs the verified identity, while loginWorkspace can create
 * the new workspace session from the refresh token.
 */
export function signMicrosoftInvitationPendingAuthToken(
  identity: MicrosoftPendingAuthIdentity,
  refreshToken: string | undefined,
  jwtSecret: string
): string {
  return jwt.sign(
    {
      ...identity,
      provider: 'MICROSOFT',
      refreshToken: refreshToken ?? null,
    },
    jwtSecret,
    { expiresIn: '10m' }
  );
}
