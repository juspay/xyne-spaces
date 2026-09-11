import { InstalledAppsRepository } from '@/database/repositories/installedAppsRepository';
import { isValidUrl } from '@/utils/urlUtils';
import { BaseAppEvent } from '@/apps/types';
import { logger } from '@/utils/logger';
import { decrypt } from '@/services/encryptionService';
import { prepareAppWebhookDispatch } from './appUrlResolver';
import { safeWebhookFetch } from '@/utils/ssrfGuard';
import crypto from 'crypto';

const installedAppsRepository = new InstalledAppsRepository();


export function signWebhookPayload(payload: string, signingSecret: string): string {
    return crypto
        .createHmac('sha256', signingSecret)
        .update(payload)
        .digest('hex');
}

export async function sendWebhookNotification(
    webhookUrl: string,
    event: BaseAppEvent,
    signingSecret: string,
): Promise<{ status: number; body: unknown }> {
    const payload = JSON.stringify(event);
    const signature = signWebhookPayload(payload, signingSecret);

    const { url, headers, isInternal } = await prepareAppWebhookDispatch(webhookUrl, {
        'Content-Type': 'application/json',
        'X-Xyne-Signature': signature,
        'X-Source': 'XyneSpaces',
    });

    try {
        const init: RequestInit = {
            method: 'POST',
            headers,
            body: payload,
            // 'manual' so a 3xx to an internal host cannot bypass the guard above.
            redirect: 'manual',
        };
        // Internal targets are trusted-config pod URLs (plain client); external
        // targets are user-supplied, so validate + pin the connection (rebinding-safe).
        const response = isInternal
            ? await fetch(url, init)
            : await safeWebhookFetch(url, init);

        const text = await response.text().catch(() => '');

        if (!response.ok) {
            throw new Error(`Webhook request failed with status ${response.status}: ${text || 'Unable to read error response'}`);
        }

        logger.info('[handleAppMentionEvents] Successfully sent webhook notification', {
            webhookUrl,
            eventType: event.eventType,
            status: response.status,
        });

        let body: unknown = text;
        try { body = text ? JSON.parse(text) : undefined; } catch { /* keep raw text */ }
        return { status: response.status, body };
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
            const secretEnc = app.app?.signingSecret;
            if (!secretEnc) {
                logger.warn(`App has no signing secret; skipping webhook`, { userId: app.userId });
                return { success: false, userId: app.userId, webhookUrl: app.webhookUrl };
            }
            const decryptedSigningSecret = decrypt(secretEnc);
            await sendWebhookNotification(app.webhookUrl!, event, decryptedSigningSecret);
            return { success: true, userId: app.userId, webhookUrl: app.webhookUrl };
        } catch (error) {
            logger.error(`Failed to send webhook notification`, {
                userId: app.userId,
                webhookUrl: app.webhookUrl,
                eventType: event.eventType,
                error: error,
            });
            return { success: false, userId: app.userId, webhookUrl: app.webhookUrl, error };
        }
    });
}

/**
 * Emit an event to all apps installed in a workspace.
 * Apps filter on their side based on eventType and payload fields.
 * 
 * @param workspaceId - The workspace ID to find installed apps
 * @param event - The event to emit (includes eventType, payload, timestamp)
 * @param options - Optional: excludeUserId to exclude a specific user (e.g., sender)
 */
export async function emitEventToWorkspaceApps(
    workspaceId: string,
    event: BaseAppEvent,
    options?: { excludeUserId?: string }
): Promise<void> {
    try {
        const installedApps = await installedAppsRepository.findByWorkspaceId(workspaceId);
        
        let appUserIds = installedApps.map(app => app.userId);
        
        if (options?.excludeUserId) {
            appUserIds = appUserIds.filter(id => id !== options.excludeUserId);
        }
        
        if (appUserIds.length === 0) {
            logger.debug(`[emitEventToWorkspaceApps] No apps to notify for ${event.eventType} in workspace ${workspaceId}`);
            return;
        }
        
        await handleEventSubscriptionsForUsers(event, appUserIds);
        
        logger.info(`[emitEventToWorkspaceApps] Emitted ${event.eventType} to ${appUserIds.length} apps`);
    } catch (error) {
        logger.error(`[emitEventToWorkspaceApps] Failed to emit ${event.eventType}:`, error);
        // Don't throw - event emission failures should not break the main flow
    }
}
