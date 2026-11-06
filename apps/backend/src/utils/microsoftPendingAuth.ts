import { signPendingAuthToken } from './pendingAuthToken';

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
): string {
  return signPendingAuthToken({
    ...identity,
    provider: 'MICROSOFT',
    tokenKey,
  });
}
