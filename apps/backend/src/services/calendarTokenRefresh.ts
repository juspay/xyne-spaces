/**
 * Calendar Token Refresh & Credential Retrieval
 *
 * Shared utilities for both Google and Microsoft calendar sync.
 * Credentials are stored in ExternalSource.credentials; this module
 * refreshes access tokens when needed and updates the stored copy.
 */

import { AuthProvider } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  getCalendarSourceType,
  parseCalendarCredentials,
  serializeCalendarCredentials,
  type CalendarProvider,
  type CalendarSourceCredentials,
} from '@/database/repositories/externalSourceRepository';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_RETRY_DELAY_MS = 500;

export interface CalendarCredentials {
  refreshToken: string;
  accessToken: string;
  sourceId: string;
  userId: string;
  email: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTokenWithRetry(url: string, initFactory: () => RequestInit): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, initFactory());
      if (res.status < 500 || attempt === 1) {
        return res;
      }
      lastError = new Error(`Token endpoint returned ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === 1) throw err;
    }

    await sleep(TOKEN_REFRESH_RETRY_DELAY_MS);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function refreshGoogleToken(
  refreshToken: string
): Promise<{ accessToken: string; accessTokenExpiry: Date }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
  }

  const res = await fetchTokenWithRetry('https://oauth2.googleapis.com/token', () => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  }));

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed: ${res.status} ${text}`);
  }

  const tokens = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: tokens.access_token,
    accessTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
  };
}

async function refreshMicrosoftToken(
  refreshToken: string
): Promise<{ accessToken: string; accessTokenExpiry: Date }> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenantId = process.env.MICROSOFT_TENANT_ID || 'common';

  if (!clientId || !clientSecret) {
    throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are required');
  }

  const res = await fetchTokenWithRetry(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: 'openid email profile User.Read Calendars.Read offline_access',
      }),
      signal: AbortSignal.timeout(15_000),
    })
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft token refresh failed: ${res.status} ${text}`);
  }

  const tokens = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: tokens.access_token,
    accessTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
  };
}

function toCalendarProvider(provider: AuthProvider): CalendarProvider {
  if (provider === AuthProvider.GOOGLE) return 'GOOGLE';
  if (provider === AuthProvider.MICROSOFT) return 'MICROSOFT';
  throw new Error(`Unsupported calendar provider: ${provider}`);
}

function tokenLogTag(provider: AuthProvider): string {
  return provider === AuthProvider.GOOGLE
    ? '[CALENDAR_SYNC][GOOGLE][TOKEN]'
    : '[CALENDAR_SYNC][MICROSOFT][TOKEN]';
}

async function readStoredCalendarSource(
  provider: AuthProvider,
  params: { ownerUserId?: string; sourceId?: string }
) {
  const sourceType = getCalendarSourceType(toCalendarProvider(provider));
  const db = DatabaseClient.getInstance();

  if (params.sourceId) {
    return db.externalSource.findFirst({
      where: { id: params.sourceId, sourceType },
    });
  }

  if (!params.ownerUserId) return null;

  return db.externalSource.findFirst({
    where: { sourceType, ownerUserId: params.ownerUserId },
    orderBy: { updatedAt: 'desc' },
  });
}

function buildCredentials(
  tokens: { refreshToken: string; accessToken?: string; accessTokenExpiry?: Date },
  existingCreds: CalendarSourceCredentials | null
): CalendarSourceCredentials {
  return {
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken ?? existingCreds?.accessToken,
    accessTokenExpiry: tokens.accessTokenExpiry?.toISOString() ?? existingCreds?.accessTokenExpiry,
    resourceId: existingCreds?.resourceId,
    channelToken: existingCreds?.channelToken,
    clientState: existingCreds?.clientState,
    expiration: existingCreds?.expiration,
  };
}

function calendarSourceName(ownerUserId: string, provider: AuthProvider): string {
  const suffix = provider === AuthProvider.GOOGLE ? 'google' : 'microsoft';
  return `calendar-${suffix}-${ownerUserId}`;
}

async function persistCalendarCredentials(
  sourceId: string | null,
  params: {
    provider: AuthProvider;
    email: string;
    refreshToken: string;
    accessToken?: string;
    accessTokenExpiry?: Date;
    ownerUserId: string;
  }
): Promise<string> {
  const db = DatabaseClient.getInstance();
  const sourceType = getCalendarSourceType(toCalendarProvider(params.provider));

  if (sourceId) {
    const existing = await db.externalSource.findUnique({ where: { id: sourceId } });
    const existingCreds = existing ? parseCalendarCredentials(existing.credentials) : null;
    const credentials = buildCredentials(params, existingCreds);

    await db.externalSource.update({
      where: { id: sourceId },
      data: {
        name: calendarSourceName(params.ownerUserId, params.provider),
        displayName: params.email,
        credentials: serializeCalendarCredentials(credentials),
        ownerUserId: params.ownerUserId,
      },
    });
    return sourceId;
  }

  const owner = await db.user.findUniqueOrThrow({
    where: { id: params.ownerUserId },
    select: { workspaceId: true },
  });

  const created = await db.externalSource.create({
    data: {
      name: calendarSourceName(params.ownerUserId, params.provider),
      sourceType,
      displayName: params.email,
      credentials: serializeCalendarCredentials(buildCredentials(params, null)),
      ownerUserId: params.ownerUserId,
      isActive: true,
      workspaceId: owner.workspaceId,
    },
  });

  return created.id;
}

export async function persistCalendarOAuthCredentials(params: {
  provider: AuthProvider;
  email: string;
  refreshToken?: string | null;
  accessToken?: string | null;
  accessTokenExpiry?: Date;
  ownerUserId?: string;
}): Promise<string | null> {
  if (!params.ownerUserId) return null;

  const source = await readStoredCalendarSource(params.provider, {
    ownerUserId: params.ownerUserId,
  });
  const existingCreds = source ? parseCalendarCredentials(source.credentials) : null;
  const refreshToken = params.refreshToken ?? existingCreds?.refreshToken;

  if (!refreshToken) return null;

  return persistCalendarCredentials(source?.id ?? null, {
    provider: params.provider,
    email: params.email,
    refreshToken,
    accessToken: params.accessToken ?? existingCreds?.accessToken,
    accessTokenExpiry: params.accessTokenExpiry,
    ownerUserId: params.ownerUserId,
  });
}

export async function getCalendarCredentialsBySourceId(
  sourceId: string,
  provider: AuthProvider
): Promise<CalendarCredentials | null> {
  const source = await readStoredCalendarSource(provider, { sourceId });

  if (source) {
    const creds = parseCalendarCredentials(source.credentials);
    if (creds?.refreshToken) {
      const resolvedUserId = source.ownerUserId;

      if (!resolvedUserId) return null;

      let accessToken = creds.accessToken;
      const isExpired =
        !accessToken ||
        !creds.accessTokenExpiry ||
        new Date(creds.accessTokenExpiry).getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS;

      if (isExpired) {
        logger.info(`${tokenLogTag(provider)} Refreshing access token`, {
          sourceId: source.id,
          userId: resolvedUserId,
          email: source.displayName,
        });
        const refreshed = await (provider === AuthProvider.GOOGLE
          ? refreshGoogleToken(creds.refreshToken)
          : refreshMicrosoftToken(creds.refreshToken));
        accessToken = refreshed.accessToken;
        await persistCalendarCredentials(source.id, {
          provider,
          email: source.displayName,
          refreshToken: creds.refreshToken,
          accessToken,
          accessTokenExpiry: refreshed.accessTokenExpiry,
          ownerUserId: resolvedUserId,
        });
        logger.info(`${tokenLogTag(provider)} Access token refreshed`, {
          sourceId: source.id,
          userId: resolvedUserId,
          email: source.displayName,
          accessTokenExpiry: refreshed.accessTokenExpiry,
        });
      }

      if (!accessToken) return null;

      return {
        refreshToken: creds.refreshToken,
        accessToken,
        sourceId: source.id,
        userId: resolvedUserId,
        email: source.displayName,
      };
    }
  }

  return null;
}
