import { ExternalSource } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import type { Request } from 'express';
import { decrypt, encrypt } from '@/services/encryptionService';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import { logger } from '@/utils/logger';
import {
  DEFAULT_GOOGLE_MAIL_SCOPES,
  type GoogleMailResolvedProviderConfig,
  type GoogleMailSourceCredentials,
} from './types';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const normalizeScopes = (scopes?: string[]): string[] => {
  const baseScopes = scopes && scopes.length > 0 ? scopes : DEFAULT_GOOGLE_MAIL_SCOPES;
  return Array.from(
    new Set(
      baseScopes
        .map(scope => scope.trim())
        .filter(Boolean)
        .concat(DEFAULT_GOOGLE_MAIL_SCOPES)
    )
  );
};

export const buildGoogleMailSourceCredentials = (params?: {
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
}): GoogleMailSourceCredentials => {
  return {
    provider: {
      clientId: params?.clientId?.trim() || undefined,
      clientSecret: params?.clientSecret?.trim() || undefined,
      scopes: normalizeScopes(params?.scopes),
    },
    status: 'pending_auth',
    lastError: null,
  };
};

export const parseGoogleMailSourceCredentials = (
  encryptedCredentials: string
): GoogleMailSourceCredentials => {
  try {
    const raw = decrypt(encryptedCredentials);
    const parsed = JSON.parse(raw) as Partial<GoogleMailSourceCredentials>;

    return {
      provider: {
        clientId: parsed.provider?.clientId?.trim() || undefined,
        clientSecret: parsed.provider?.clientSecret?.trim() || undefined,
        scopes: normalizeScopes(parsed.provider?.scopes),
      },
      tokens: parsed.tokens
        ? {
            accessToken: parsed.tokens.accessToken,
            refreshToken: parsed.tokens.refreshToken,
            accessTokenExpiresAt: parsed.tokens.accessTokenExpiresAt ?? null,
          }
        : undefined,
      mailbox: parsed.mailbox
        ? {
            emailAddress: parsed.mailbox.emailAddress,
            historyId: parsed.mailbox.historyId ?? null,
            lastSyncedAt: parsed.mailbox.lastSyncedAt ?? null,
            syncProcessedMessages: parsed.mailbox.syncProcessedMessages ?? null,
            syncTotalMessages: parsed.mailbox.syncTotalMessages ?? null,
            syncStartedAt: parsed.mailbox.syncStartedAt ?? null,
            syncMode: parsed.mailbox.syncMode ?? null,
          }
        : undefined,
      status: parsed.status || 'pending_auth',
      lastError: parsed.lastError ?? null,
    };
  } catch (error) {
    logger.error('[GOOGLE_MAIL] Failed to parse source credentials:', error);
    throw new Error('Invalid Google Mail source credentials');
  }
};

export const encryptGoogleMailSourceCredentials = (
  credentials: GoogleMailSourceCredentials
): string => {
  return encrypt(JSON.stringify(credentials));
};

export const resolveGoogleMailProviderConfig = (
  storedCredentials: GoogleMailSourceCredentials
): GoogleMailResolvedProviderConfig => {
  const clientId = storedCredentials.provider.clientId || process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret =
    storedCredentials.provider.clientSecret || process.env.GOOGLE_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) {
    throw new Error(
      'Google OAuth client configuration is missing. Provide clientId/clientSecret for the source or set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.'
    );
  }

  return {
    clientId,
    clientSecret,
    scopes: normalizeScopes(storedCredentials.provider.scopes),
  };
};

export const getGoogleMailRedirectUri = (req?: Request | null): string => {
  if (req) {
    const originalHost = req.headers['x-original-host'];
    if (originalHost && typeof originalHost === 'string') {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      return `${protocol}://${originalHost}/api/google-mail/oauth/callback`;
    }
  }

  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3001';
  return `${backendUrl.replace(/\/$/, '')}/api/google-mail/oauth/callback`;
};

export const saveGoogleMailSourceCredentials = async (
  sourceId: string,
  credentials: GoogleMailSourceCredentials
): Promise<void> => {
  const repository = new ExternalSourceRepository();
  await repository.updateCredentials(sourceId, encryptGoogleMailSourceCredentials(credentials));
};

export const updateGoogleMailSourceState = async (
  source: ExternalSource,
  updater: (current: GoogleMailSourceCredentials) => GoogleMailSourceCredentials
): Promise<GoogleMailSourceCredentials> => {
  const current = parseGoogleMailSourceCredentials(source.credentials);
  const next = updater(current);
  await saveGoogleMailSourceCredentials(source.id, next);
  return next;
};

const needsAccessTokenRefresh = (storedCredentials: GoogleMailSourceCredentials): boolean => {
  const accessToken = storedCredentials.tokens?.accessToken;
  const refreshToken = storedCredentials.tokens?.refreshToken;
  const expiryIso = storedCredentials.tokens?.accessTokenExpiresAt;

  if (!refreshToken) {
    return false;
  }

  if (!accessToken || !expiryIso) {
    return true;
  }

  const expiryTime = new Date(expiryIso).getTime();
  if (Number.isNaN(expiryTime)) {
    return true;
  }

  return Date.now() + TOKEN_REFRESH_BUFFER_MS >= expiryTime;
};

export const getAuthorizedGoogleMailClient = async (
  source: ExternalSource
): Promise<{ oauthClient: OAuth2Client; storedCredentials: GoogleMailSourceCredentials }> => {
  const repository = new ExternalSourceRepository();
  const storedCredentials = parseGoogleMailSourceCredentials(source.credentials);
  const providerConfig = resolveGoogleMailProviderConfig(storedCredentials);
  const redirectUri = getGoogleMailRedirectUri();
  const oauthClient = new OAuth2Client(
    providerConfig.clientId,
    providerConfig.clientSecret,
    redirectUri
  );

  const refreshToken = storedCredentials.tokens?.refreshToken;
  if (!refreshToken) {
    throw new Error(`Google Mail source ${source.id} is not authenticated`);
  }

  let nextStoredCredentials = storedCredentials;

  if (needsAccessTokenRefresh(storedCredentials)) {
    oauthClient.setCredentials({ refresh_token: refreshToken });

    const refreshResponse = await oauthClient.refreshAccessToken();
    const refreshed = refreshResponse.credentials;

    nextStoredCredentials = {
      ...storedCredentials,
      tokens: {
        accessToken: refreshed.access_token || storedCredentials.tokens?.accessToken,
        refreshToken: refreshed.refresh_token || refreshToken,
        accessTokenExpiresAt: refreshed.expiry_date
          ? new Date(refreshed.expiry_date).toISOString()
          : storedCredentials.tokens?.accessTokenExpiresAt ?? null,
      },
      status: storedCredentials.status === 'pending_auth' ? 'authenticated' : storedCredentials.status,
      lastError: null,
    };

    await repository.updateCredentials(
      source.id,
      encryptGoogleMailSourceCredentials(nextStoredCredentials)
    );
  }

  oauthClient.setCredentials({
    access_token: nextStoredCredentials.tokens?.accessToken,
    refresh_token: nextStoredCredentials.tokens?.refreshToken,
    expiry_date: nextStoredCredentials.tokens?.accessTokenExpiresAt
      ? new Date(nextStoredCredentials.tokens.accessTokenExpiresAt).getTime()
      : undefined,
  });

  return {
    oauthClient,
    storedCredentials: nextStoredCredentials,
  };
};
