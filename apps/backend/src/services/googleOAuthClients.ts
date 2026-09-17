/**
 * Declarative registry of the Google OAuth clients this app uses.
 *
 * A Google refresh token is bound to the client_id that minted it: refreshing it
 * with any other client returns `unauthorized_client` regardless of account
 * state. So both minting (login) and verification (refresh) must agree on which
 * client owns a given token. This module is the single source of that mapping.
 */

import { logger } from '../utils/logger';

export type GoogleClientKey = 'web' | 'new' | 'mobile';

export interface GoogleClientCreds {
  id?: string;
  secret?: string;
  label: string;
}

// key → the env credentials that mint and refresh that client's tokens.
// Read lazily so tests / env reloads see current values.
export const GOOGLE_CLIENTS: Record<GoogleClientKey, () => GoogleClientCreds> = {
  web: () => ({ id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, label: 'web' }),
  new: () => ({ id: process.env.GOOGLE_CLIENT_ID_NEW, secret: process.env.GOOGLE_CLIENT_SECRET_NEW, label: 'new/electron' }),
  mobile: () => ({ id: process.env.GOOGLE_MOBILE_CLIENT_ID, secret: process.env.GOOGLE_MOBILE_CLIENT_SECRET, label: 'mobile' }),
};

const ALL_KEYS: GoogleClientKey[] = ['web', 'new', 'mobile'];

/**
 * Surface an implicit fail-open at boot: if zero Google clients are configured,
 * Google refresh-token verification silently passes (no creds → no revocation
 * signal), so a misconfigured deployment would never detect a revoked Google
 * user. The old authV2Middleware constructor threw on missing creds; this warns
 * instead (throwing would take down non-Google deployments that legitimately run
 * without them).
 */
export function warnIfNoGoogleClientsConfigured(): void {
  const configured = ALL_KEYS.filter((key) => GOOGLE_CLIENTS[key]().id);
  if (configured.length === 0) {
    logger.warn(
      '[GoogleOAuth] No Google OAuth clients configured (GOOGLE_CLIENT_ID / _NEW / MOBILE all empty) — ' +
        'Google refresh-token verification will fail open (never detect a revoked Google user).'
    );
  }
}

export function isGoogleClientKey(value: unknown): value is GoogleClientKey {
  return value === 'web' || value === 'new' || value === 'mobile';
}

/**
 * Which client mints the token for a given login flow.
 * Mobile flow uses the mobile client; the `isNy` ("new") web/electron flow uses
 * the new client; everything else uses the default web client.
 */
export function googleClientKeyForLogin(opts: { isNy?: boolean; mobile?: boolean }): GoogleClientKey {
  if (opts.mobile) return 'mobile';
  return opts.isNy ? 'new' : 'web';
}

/**
 * Verification order: the known owner first (usually a single call), then the
 * rest as fallback for sessions minted before we recorded the key.
 */
export function orderedGoogleClientKeys(preferred?: GoogleClientKey | null): GoogleClientKey[] {
  if (!preferred) return [...ALL_KEYS];
  return [preferred, ...ALL_KEYS.filter((k) => k !== preferred)];
}

// Map a session's recorded platform to its client key, when the explicit key
// isn't present (older sessions).
export function googleClientKeyForPlatform(platform: unknown): GoogleClientKey | undefined {
  if (platform === 'mobile') return 'mobile';
  if (platform === 'electron') return 'new';
  if (platform === 'web') return 'web';
  return undefined;
}

/**
 * Recover the minting client from a session's stored deviceInfo JSON: the
 * explicit `googleClientKey` if recorded, else the `platform` mapping. Used both
 * at refresh (to verify with the owning client) and when a new session reuses an
 * existing refresh token (to carry its key forward).
 */
export function googleClientKeyFromDeviceInfo(deviceInfo?: string | null): GoogleClientKey | undefined {
  try {
    const info = JSON.parse(deviceInfo ?? '{}');
    if (isGoogleClientKey(info.googleClientKey)) return info.googleClientKey;
    return googleClientKeyForPlatform(info.platform);
  } catch {
    return undefined;
  }
}
