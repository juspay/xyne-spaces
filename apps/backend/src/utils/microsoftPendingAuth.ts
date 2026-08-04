import jwt from 'jsonwebtoken';

export interface MicrosoftPendingAuthIdentity {
  providerUserId: string;
  email: string;
  name: string;
  picture?: string;
}

/**
 * Invitation acceptance needs the verified identity. Provider tokens remain in
 * Redis and this JWT carries only their short-lived lookup key.
 */
export function signMicrosoftInvitationPendingAuthToken(
  identity: MicrosoftPendingAuthIdentity,
  tokenKey: string,
  jwtSecret: string
): string {
  return jwt.sign(
    {
      ...identity,
      provider: 'MICROSOFT',
      tokenKey,
    },
    jwtSecret,
    { expiresIn: '10m' }
  );
}
