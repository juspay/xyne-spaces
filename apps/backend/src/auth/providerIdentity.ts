/**
 * `googleId` / `authProvider` for the two endpoints that still report them (`/auth/me`,
 * `/auth/validate`).
 *
 * Neither rides in the access JWT any more — nothing on a hot path reads them — so they cost one
 * `users` read here instead of ~400 bytes on every request. The claims stay the fallback: API-key
 * and dev users have no `users` row behind them.
 */
import type { Request } from 'express';
import { findUserById } from '@/bypassAcl/authSessionServices';

export interface ProviderIdentity {
  googleId: string;
  authProvider?: string;
}

export async function providerIdentity(req: Request): Promise<ProviderIdentity> {
  const user = req.user!;
  if (user.isApiKeyUser) return { googleId: user.googleId, authProvider: user.authProvider };
  const row = await findUserById(user.id);
  return {
    googleId: row?.providerUserId ?? user.googleId,
    authProvider: row?.authProvider ?? user.authProvider,
  };
}
