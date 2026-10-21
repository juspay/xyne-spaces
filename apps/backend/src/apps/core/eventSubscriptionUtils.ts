import { InstalledAppsRepository, type InstalledAppEventGrant } from '@/database/repositories/installedAppsRepository';
import { isValidUrl } from '@/utils/urlUtils';
import { AppEventType, BaseAppEvent } from '@/apps/types';
import { AppPermissionStatus } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { decrypt } from '@/services/encryptionService';
import { prepareAppWebhookDispatch } from './appUrlResolver';
import { safeWebhookFetch } from '@/utils/ssrfGuard';
import crypto from 'crypto';
import { repositories } from '@/database/repositories';

const installedAppsRepository = new InstalledAppsRepository();


export function signWebhookPayload(payload: string, signingSecret: string): string {
    return crypto
        .createHmac('sha256', signingSecret)
        .update(payload)
        .digest('hex');
}

/** Thrown by sendWebhookNotification when the install has not subscribed to the event. */
export class EventNotSubscribedError extends Error {
    constructor(public readonly eventType: AppEventType) {
        super(`Installed app is not subscribed to ${eventType}`);
        this.name = 'EventNotSubscribedError';
    }
}

/**
 * Whether an install should receive an event, from its SUBSCRIBE rows (see eventGrantsSelect).
 * No rows at all = never configured = every event (legacy behaviour, so no backfill is needed).
 * Otherwise, same "effective" rule as API permissions: APPROVED or PENDINGDELETE (removal not
 * yet activated) count; UNAPPROVED (addition not yet activated) does not.
 */
export function isEventSubscribed(grants: InstalledAppEventGrant[], eventType: AppEventType): boolean {
    if (grants.length === 0) return true;
    const name = eventType.toLowerCase();
    return grants.some(
        g => g.permission.name === name
            && (g.status === AppPermissionStatus.APPROVED || g.status === AppPermissionStatus.PENDINGDELETE),
    );
}

export async function sendWebhookNotification(
    webhookUrl: string,
    event: BaseAppEvent,
    signingSecret: string,
    // Required so every sender passes the install's subscriptions; callers check
    // isEventSubscribed first to choose their own skip behaviour — this is the backstop.
    eventGrants: InstalledAppEventGrant[],
): Promise<{ status: number; body: unknown }> {
    if (!isEventSubscribed(eventGrants, event.eventType)) {
        throw new EventNotSubscribedError(event.eventType);
    }
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
            && isEventSubscribed(app.installedAppPermissions, event.eventType)
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
            await sendWebhookNotification(app.webhookUrl!, event, decryptedSigningSecret, app.installedAppPermissions);
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

/**
 * Emit an event only to the apps that are participants of a channel — the same
 * scoping EMAIL uses (dispatchEmailEventForEmailId). Use this instead of
 * emitEventToWorkspaceApps for channel-bound events so a single edit does not
 * fan out to every install in the workspace.
 *
 * @param channelId - The channel the event belongs to; no-op when empty
 * @param event - The event to emit (includes eventType, payload, timestamp)
 * @param options - Optional: excludeUserId to exclude a specific user (e.g., sender)
 */
export async function emitEventToChannelApps(
    channelId: string,
    event: BaseAppEvent,
    options?: { excludeUserId?: string }
): Promise<void> {
    try {
        if (!channelId) {
            logger.debug(`[emitEventToChannelApps] No channelId for ${event.eventType}; skipping`);
            return;
        }

        let appUserIds = await repositories.channelParticipants.getAppParticipantUserIds(channelId);

        if (options?.excludeUserId) {
            appUserIds = appUserIds.filter(id => id !== options.excludeUserId);
        }

        if (appUserIds.length === 0) {
            logger.debug(`[emitEventToChannelApps] No apps to notify for ${event.eventType} in channel ${channelId}`);
            return;
        }

        await handleEventSubscriptionsForUsers(event, appUserIds);

        logger.info(`[emitEventToChannelApps] Emitted ${event.eventType} to ${appUserIds.length} apps in channel ${channelId}`);
    } catch (error) {
        logger.error(`[emitEventToChannelApps] Failed to emit ${event.eventType}:`, error);
        // Don't throw - event emission failures should not break the main flow
    }
}
