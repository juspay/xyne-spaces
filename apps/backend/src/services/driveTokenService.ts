/**
 * Google Drive OAuth Credential Storage & Retrieval
 *
 * Backs the KB "Connect Google Drive" flow. Credentials are stored per-user in
 * ExternalSource.credentials (encrypted) under sourceType `google-drive`. This
 * module persists the tokens returned by the OAuth callback and, on demand,
 * returns a valid access token — auto-refreshing via the stored refresh token
 * (no re-consent needed). Mirrors the recording-doc token pattern
 * (recordingGoogleDocController.getRecordingDocAccessToken).
 */

import { google } from 'googleapis';
import { repositories } from '@/database/repositories';
import { decrypt, encrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';

export const DRIVE_SOURCE_TYPE = 'google-drive';

interface DriveCredentials {
  accessToken?: string;
  refreshToken?: string;
  email?: string;
}

function driveSourceName(userId: string): string {
  return `${DRIVE_SOURCE_TYPE}-${userId}`;
}

/**
 * True when Google rejected the refresh token because the grant is gone (user
 * revoked access, or the token was expired/reused) — distinct from a transient
 * network error. google-auth-library surfaces this as `invalid_grant` on the
 * error's `response.data.error` and/or in the message.
 */
function isInvalidGrant(error: unknown): boolean {
  const err = error as {
    message?: string;
    response?: { data?: { error?: string } };
  };
  return (
    err?.response?.data?.error === 'invalid_grant' ||
    (typeof err?.message === 'string' && err.message.includes('invalid_grant'))
  );
}

/**
 * Upsert the encrypted Drive OAuth credentials for a user. Falls back to the
 * previously stored refresh token when Google omits one on re-consent.
 */
export async function persistDriveOAuthCredentials(params: {
  ownerUserId: string;
  workspaceId: string;
  email: string;
  accessToken: string;
  refreshToken?: string | null;
}): Promise<string> {
  const existing = await repositories.externalSources.findActiveByOwnerAndSourceType(
    params.ownerUserId,
    DRIVE_SOURCE_TYPE,
  );
  const existingCreds: DriveCredentials | null = existing
    ? (JSON.parse(decrypt(existing.credentials)) as DriveCredentials)
    : null;

  const refreshToken = params.refreshToken ?? existingCreds?.refreshToken;
  if (!refreshToken) {
    throw new Error('Google did not return a Drive refresh token');
  }

  const credentials = encrypt(
    JSON.stringify({
      accessToken: params.accessToken,
      refreshToken,
      email: params.email,
    } satisfies DriveCredentials),
  );

  if (existing) {
    const updated = await repositories.externalSources.update(existing.id, {
      displayName: params.email,
      credentials,
      isActive: true,
    });
    return updated.id;
  }

  const created = await repositories.externalSources.create({
    name: driveSourceName(params.ownerUserId),
    sourceType: DRIVE_SOURCE_TYPE,
    displayName: params.email,
    credentials,
    ownerUserId: params.ownerUserId,
    workspaceId: params.workspaceId,
    isActive: true,
  });
  return created.id;
}

/**
 * Return a valid Drive access token for the user, refreshing it if needed and
 * persisting the refreshed token. Returns null when the user has not connected
 * Google Drive.
 */
export async function getDriveAccessToken(userId: string): Promise<string | null> {
  const source = await repositories.externalSources.findActiveByOwnerAndSourceType(
    userId,
    DRIVE_SOURCE_TYPE,
  );
  if (!source) return null;

  const credentials = JSON.parse(decrypt(source.credentials)) as DriveCredentials;
  if (!credentials.refreshToken) return null;

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  // Set ONLY the refresh token. If we also pass the stored access token, google-auth-
  // library's getAccessToken() sees a present access_token and — because we never store
  // an expiry_date — isTokenExpiring() returns false, so `shouldRefresh` is false and it
  // hands back that token WITHOUT refreshing (oauth2client.js: shouldRefresh =
  // !access_token || isTokenExpiring()). The stored token then dies ~1h after connect,
  // Drive 401s, and we wrongly clear the credentials. Omitting access_token forces a
  // fresh mint from the refresh token on every call.
  client.setCredentials({ refresh_token: credentials.refreshToken });

  let accessToken: string | null | undefined;
  try {
    accessToken = (await client.getAccessToken()).token;
  } catch (error) {
    // Google's response is the source of truth. `invalid_grant` means the user
    // revoked access (or the refresh token expired) — the stored row is now stale,
    // so delete it and report "not connected" (the caller re-prompts to connect).
    // For transient/network errors we keep the row and just fail this attempt.
    if (isInvalidGrant(error)) {
      logger.info('[DRIVE_IMPORT] Drive access revoked upstream; clearing stale credentials', {
        userId,
        sourceId: source.id,
      });
      await repositories.externalSources.delete(source.id).catch(() => undefined);
    } else {
      logger.warn('[DRIVE_IMPORT] Failed to refresh Drive access token', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
  if (!accessToken) return null;

  await repositories.externalSources.update(source.id, {
    credentials: encrypt(JSON.stringify({ ...credentials, accessToken } satisfies DriveCredentials)),
  });
  return accessToken;
}

/**
 * Delete the stored Drive credentials for a user. Called when the Drive API rejects
 * the token (401) — the grant is gone on Google's side, so our row is stale. Keeps
 * the DB in sync with the API's answer instead of trusting a cached row.
 */
export async function clearDriveCredentials(userId: string): Promise<void> {
  const source = await repositories.externalSources.findActiveByOwnerAndSourceType(
    userId,
    DRIVE_SOURCE_TYPE,
  );
  if (source) {
    await repositories.externalSources.delete(source.id).catch(() => undefined);
  }
}
