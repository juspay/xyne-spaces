/**
 * Google Calendar Watch Service
 *
 * Manages Google Calendar push notification channels (webhook watches).
 * Unlike Gmail which supports native Pub/Sub, Calendar only supports
 * `type: "web_hook"` — Google POSTs headers-only to our endpoint when
 * events change.
 *
 * Lifecycle:
 *  1. setupWatchForSource()  — Creates a watch channel (~7 day TTL).
 *  2. renewWatchForSource()  — Called by renewal cron before expiration.
 *  3. stopWatchForSource()   — Stops the channel via channels.stop API.
 */

import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { logger } from '@/utils/logger';
import { AuthProvider } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { getCalendarCredentialsBySourceId } from '@/services/calendarTokenRefresh';
import { parseCalendarCredentials } from '@/database/repositories/externalSourceRepository';
import { v4 as uuidv4 } from 'uuid';
import { config } from '@/config/env';

const TAG = '[CALENDAR_SYNC][GOOGLE][WATCH]';

function getWebhookUrl(): string {
  const baseUrl = config.backendUrl || 'http://localhost:3000';
  return `${baseUrl}/api/calendar/webhooks/google-calendar`;
}

export interface WatchSetupResult {
  channelId: string;
  resourceId: string;
  expiration: Date;
}

export class GoogleCalendarWatchService {
  static async setupWatchForSource(sourceId: string): Promise<WatchSetupResult> {
    const source = await repositories.externalSources.findById(sourceId);
    const credentials = await getCalendarCredentialsBySourceId(sourceId, AuthProvider.GOOGLE);
    if (!credentials) {
      throw new Error(`No active Google calendar credentials found for source ${sourceId}`);
    }
    const email = credentials.email;

    const oauth2Client = createOAuth2Client(credentials.accessToken, credentials.refreshToken);
    const calendar = google.calendar({
      version: 'v3',
      auth: oauth2Client as unknown as calendar_v3.Options['auth'],
    });

    const channelId = uuidv4();
    const channelToken = uuidv4();
    const address = getWebhookUrl();

    logger.info(`${TAG} Setting up calendar watch`, { sourceId, email, channelId });

    const response = await calendar.events.watch({
      calendarId: 'primary',
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address,
        token: channelToken,
        params: { ttl: '604800' },
      },
    });

    const { resourceId, expiration } = response.data;
    if (!resourceId || !expiration) {
      throw new Error('Missing resourceId or expiration in watch response');
    }

    const expirationMs = Number.parseInt(String(expiration), 10);
    if (!Number.isFinite(expirationMs)) {
      throw new Error(`Invalid Google Calendar watch expiration: ${expiration}`);
    }
    const expirationDate = new Date(expirationMs);

    const existing = source ?? (await repositories.externalSources.findById(sourceId));

    if (existing) {
      const existingCreds = parseCalendarCredentials(existing.credentials);
      if (existing.externalIdentifier && existingCreds?.resourceId) {
        try {
          await stopChannel(oauth2Client, existing.externalIdentifier, existingCreds.resourceId);
        } catch (err) {
          logger.warn(`${TAG} Failed to stop old channel during setup`, {
            sourceId,
            email,
            oldChannelId: existing.externalIdentifier,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    await repositories.externalSources.upsertGoogleCalendarWatch({
      email,
      ownerUserId: credentials.userId,
      channelId,
      resourceId,
      channelToken,
      expiration: expirationDate,
      refreshToken: credentials.refreshToken,
      accessToken: credentials.accessToken,
    });

    logger.info(`${TAG} Calendar watch setup complete`, {
      sourceId,
      email,
      channelId,
      resourceId,
      expiration: expirationDate.toISOString(),
    });

    return { channelId, resourceId, expiration: expirationDate };
  }

  static async renewWatchForSource(sourceId: string): Promise<WatchSetupResult> {
    logger.info(`${TAG} Renewing calendar watch`, { sourceId });
    return this.setupWatchForSource(sourceId);
  }

  static async stopWatchForSource(sourceId: string): Promise<void> {
    const subscription = await repositories.externalSources.findById(sourceId);
    const email = subscription?.displayName ?? sourceId;

    if (!subscription?.externalIdentifier) {
      logger.warn(`${TAG} No active watch to stop`, { sourceId });
      return;
    }

    const creds = parseCalendarCredentials(subscription.credentials);
    const resourceId = creds?.resourceId;

    const credentials = await getCalendarCredentialsBySourceId(sourceId, AuthProvider.GOOGLE);

    if (credentials && resourceId) {
      const oauth2Client = createOAuth2Client(credentials.accessToken, credentials.refreshToken);
      try {
        await stopChannel(oauth2Client, subscription.externalIdentifier, resourceId);
      } catch (err) {
        logger.warn(`${TAG} Failed to stop channel via API`, {
          sourceId,
          email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await repositories.externalSources.revokeGoogleCalendarWatchById(sourceId);

    logger.info(`${TAG} Calendar watch stopped`, { email, sourceId });
  }

  static async updateSyncStateBySourceId(
    sourceId: string,
    syncToken?: string | null,
    isActive?: boolean
  ): Promise<void> {
    await repositories.externalSources.updateCalendarSyncStateById(sourceId, {
      syncToken,
      isActive,
    });
  }

  static async findSubscriptionByChannel(channelId: string) {
    return repositories.externalSources.findCalendarSourceByExternalIdentifier(channelId);
  }
}

function createOAuth2Client(accessToken: string, refreshToken: string): OAuth2Client {
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  return client;
}

async function stopChannel(
  oauth2Client: OAuth2Client,
  channelId: string,
  resourceId: string
): Promise<void> {
  const calendar = google.calendar({
    version: 'v3',
    auth: oauth2Client as unknown as calendar_v3.Options['auth'],
  });

  await calendar.channels.stop({
    requestBody: { id: channelId, resourceId },
  });
}
