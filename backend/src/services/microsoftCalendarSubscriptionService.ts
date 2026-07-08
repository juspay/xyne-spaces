/**
 * Microsoft Calendar Subscription Service
 *
 * Manages Microsoft Graph Change Notification subscriptions for calendar events.
 * Uses delegated (user) OAuth permissions to create subscriptions on /me/events.
 *
 * Lifecycle:
 *  1. createSubscriptionForSource()  — Creates a subscription.
 *  2. renewSubscriptionForSource()   — Patches expirationDateTime.
 *  3. deleteSubscriptionForSource()  — DELETE /subscriptions/{id}.
 */

import { AuthProvider } from '@prisma/client';
import { logger } from '@/utils/logger';
import { repositories } from '@/database/repositories';
import { getCalendarCredentialsBySourceId } from '@/services/calendarTokenRefresh';
import { parseCalendarCredentials } from '@/database/repositories/externalSourceRepository';
import { v4 as uuidv4 } from 'uuid';
import { config } from '@/config/env';

const TAG = '[MSCalendarSubscription]';
const DEFAULT_SUBSCRIPTION_TTL_MINUTES = 4190;

function getNotificationUrl(): string {
  const baseUrl = config.backendUrl || 'http://localhost:3000';
  return `${baseUrl}/api/calendar/webhooks/microsoft-calendar`;
}

function getSubscriptionTtlMs(): number {
  const raw = process.env.MICROSOFT_CALENDAR_SUBSCRIPTION_TTL_MINUTES;
  const minutes = raw ? Number(raw) : DEFAULT_SUBSCRIPTION_TTL_MINUTES;

  if (!Number.isFinite(minutes) || minutes <= 0) {
    logger.warn(`${TAG} Invalid MICROSOFT_CALENDAR_SUBSCRIPTION_TTL_MINUTES, using default`, {
      value: raw,
      defaultMinutes: DEFAULT_SUBSCRIPTION_TTL_MINUTES,
    });
    return DEFAULT_SUBSCRIPTION_TTL_MINUTES * 60 * 1000;
  }

  return minutes * 60 * 1000;
}

function parseGraphExpiration(expirationDateTime: string): Date {
  const expiration = new Date(expirationDateTime);
  if (Number.isNaN(expiration.getTime())) {
    throw new Error(`Invalid Microsoft subscription expiration: ${expirationDateTime}`);
  }
  return expiration;
}

export interface SubscriptionSetupResult {
  subscriptionId: string;
  expiration: Date;
  clientState: string;
}

export class MicrosoftCalendarSubscriptionService {
  static async createSubscriptionForSource(sourceId: string): Promise<SubscriptionSetupResult> {
    const credentials = await getCalendarCredentialsBySourceId(sourceId, AuthProvider.MICROSOFT);
    if (!credentials) {
      throw new Error(`No active Microsoft calendar credentials found for source ${sourceId}`);
    }
    const email = credentials.email;

    const clientState = uuidv4();
    const expirationDateTime = new Date(Date.now() + getSubscriptionTtlMs());
    const notificationUrl = getNotificationUrl();

    logger.info(`${TAG} Creating subscription`, { email });

    const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        changeType: 'created,updated,deleted',
        notificationUrl,
        lifecycleNotificationUrl: notificationUrl,
        resource: '/me/events',
        expirationDateTime: expirationDateTime.toISOString(),
        clientState,
        latestSupportedTlsVersion: 'v1_2',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Microsoft subscription create failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      id: string;
      expirationDateTime: string;
    };

    const subscriptionId = data.id;
    const actualExpiration = parseGraphExpiration(data.expirationDateTime);

    const existing = await repositories.externalSources.findById(sourceId);

    if (existing) {
      if (existing.externalIdentifier) {
        try {
          await deleteSubscriptionApi(credentials.accessToken, existing.externalIdentifier);
        } catch (err) {
          logger.warn(`${TAG} Failed to delete old subscription during setup`, {
            email,
            oldSubId: existing.externalIdentifier,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    await repositories.externalSources.upsertMicrosoftCalendarSubscription({
      email,
      ownerUserId: credentials.userId,
      subscriptionId,
      expiration: actualExpiration,
      clientState,
      refreshToken: credentials.refreshToken,
      accessToken: credentials.accessToken,
    });

    logger.info(`${TAG} Subscription created`, {
      email,
      subscriptionId,
      expiration: actualExpiration.toISOString(),
    });

    return { subscriptionId, expiration: actualExpiration, clientState };
  }

  static async renewSubscriptionForSource(sourceId: string): Promise<SubscriptionSetupResult> {
    const subscription = await repositories.externalSources.findById(sourceId);
    const email = subscription?.displayName ?? sourceId;

    if (!subscription?.externalIdentifier) {
      logger.info(`${TAG} No existing subscription, creating new one`, { email, sourceId });
      return this.createSubscriptionForSource(sourceId);
    }

    const credentials = await getCalendarCredentialsBySourceId(sourceId, AuthProvider.MICROSOFT);
    if (!credentials) {
      throw new Error(`No active Microsoft calendar credentials found for source ${sourceId}`);
    }

    const newExpiration = new Date(Date.now() + getSubscriptionTtlMs());

    logger.info(`${TAG} Renewing subscription`, { email, subscriptionId: subscription.externalIdentifier });

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/subscriptions/${subscription.externalIdentifier}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expirationDateTime: newExpiration.toISOString(),
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      logger.warn(`${TAG} Renewal failed, recreating subscription`, {
        email,
        status: response.status,
        error: text,
      });

      await repositories.externalSources.clearMicrosoftSubscriptionFields(subscription.id);

      return this.createSubscriptionForSource(sourceId);
    }

    const data = (await response.json()) as { expirationDateTime: string };
    const actualExpiration = parseGraphExpiration(data.expirationDateTime);
    const creds = parseCalendarCredentials(subscription.credentials);

    await repositories.externalSources.renewMicrosoftSubscription(subscription.id, actualExpiration);

    logger.info(`${TAG} Subscription renewed`, {
      email,
      subscriptionId: subscription.externalIdentifier,
      expiration: actualExpiration.toISOString(),
    });

    return {
      subscriptionId: subscription.externalIdentifier,
      expiration: actualExpiration,
      clientState: creds?.clientState || '',
    };
  }

  static async deleteSubscriptionForSource(sourceId: string): Promise<void> {
    const subscription = await repositories.externalSources.findById(sourceId);
    const email = subscription?.displayName ?? sourceId;

    if (!subscription?.externalIdentifier) {
      logger.warn(`${TAG} No active subscription to delete`, { email, sourceId });
      return;
    }

    const credentials = await getCalendarCredentialsBySourceId(sourceId, AuthProvider.MICROSOFT);
    if (credentials) {
      try {
        await deleteSubscriptionApi(credentials.accessToken, subscription.externalIdentifier);
      } catch (err) {
        logger.warn(`${TAG} Failed to delete subscription via API`, {
          email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await repositories.externalSources.revokeMicrosoftCalendarSubscriptionById(sourceId);

    logger.info(`${TAG} Subscription deleted`, { email, sourceId });
  }

  static async updateSyncStateBySourceId(
    sourceId: string,
    syncToken?: string | null,
    isActive?: boolean,
  ): Promise<void> {
    await repositories.externalSources.updateCalendarSyncStateById(sourceId, {
      syncToken,
      isActive,
    });
  }

  static async findSubscriptionByMsSubscriptionId(msSubscriptionId: string) {
    return repositories.externalSources.findCalendarSourceByExternalIdentifier(msSubscriptionId);
  }
}

async function deleteSubscriptionApi(accessToken: string, subscriptionId: string): Promise<void> {
  const response = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const text = await response.text();
    throw new Error(`Microsoft subscription delete failed: ${response.status} ${text}`);
  }
}
