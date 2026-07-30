import crypto from 'crypto';
import { redisService } from '@/services/redisService';

const PENDING_AUTH_TTL_SECONDS = 10 * 60; // matches the 10-minute pending-auth cookie window

/**
 * Registers a single-use ID for a pending-auth JWT (the short-lived
 * `google_access_token` cookie issued between OAuth/email login and
 * workspace login or invitation acceptance). The ID is embedded in the JWT
 * as `jwtId` and consumed (deleted) the first time it's used — anything
 * without a registered jwtId is treated as invalid/replayed.
 */
export async function registerPendingAuthJwtId(email: string): Promise<string> {
  const jwtId = crypto.randomUUID();
  await redisService.set(`pendingauth:jwtid:${jwtId}`, email, PENDING_AUTH_TTL_SECONDS);
  return jwtId;
}
