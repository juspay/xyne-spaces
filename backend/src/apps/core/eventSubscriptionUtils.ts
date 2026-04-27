import { InstalledAppsRepository } from '@/database/repositories/installedAppsRepository';
import { isValidUrl } from '@/utils/urlUtils';
import { BaseAppEvent } from '@/apps/types';
import { logger } from '@/utils/logger';
import { decrypt } from '@/services/encryptionService';
import crypto from 'crypto';

const installedAppsRepository = new InstalledAppsRepository();


function signWebhookPayload(payload: string, signingSecret: string): string {
    return crypto
        .createHmac('sha256', signingSecret)
        .update(payload)
        .digest('hex');
}

async function sendWebhookNotification(
    webhookUrl: string,
    event: BaseAppEvent,
    signingSecret: string
): Promise<void> {
    const payload = JSON.stringify(event);
    const signature = signWebhookPayload(payload, signingSecret);

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Xyne-Signature': signature,
                'X-Source': 'XyneSpaces'
            },
            body: payload,
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unable to read error response');
            throw new Error(`Webhook request failed with status ${response.status}: ${errorText}`);
        }

        logger.info('[handleAppMentionEvents] Successfully sent webhook notification', {
            webhookUrl,
            eventType: event.eventType,
            status: response.status,
        });
    } catch (error) {
        throw error;
    }
}

export async function handleEventSubscriptionsForUsers(
    event: BaseAppEvent,
    userIds: string[],
): Promise<void> {
    if (userIds.length === 0) {
        return;
    }

    const installedAppsWithWebhooks = await installedAppsRepository.findWithWebhooksByUserIds(userIds);

    const appsWithValidWebhooks = installedAppsWithWebhooks.filter(
        app => app.webhookUrl && isValidUrl(app.webhookUrl)
    );

    const senderId = 'userId' in event.payload ? event.payload.userId : undefined;
    const appsToNotify = senderId
        ? appsWithValidWebhooks.filter(app => app.userId !== senderId)
        : appsWithValidWebhooks;

    if (appsToNotify.length === 0) {
        logger.info(`No apps with valid webhooks found (excluding sender)`, {
            userIds,
            senderId,
        });
        return;
    }

    appsToNotify.map(async (app) => {
        try {
            const decryptedSigningSecret = decrypt(app.signingSecret);
            await sendWebhookNotification(app.webhookUrl!, event, decryptedSigningSecret);
            return { success: true, userId: app.userId, webhookUrl: app.webhookUrl };
        } catch (error) {
            logger.error(`Failed to send webhook notification`, {
                userId: app.userId,
                webhookUrl: app.webhookUrl,
                eventType: event.eventType,
                error: error instanceof Error ? error.message : String(error),
            });
            return { success: false, userId: app.userId, webhookUrl: app.webhookUrl, error };
        }
    });
}

