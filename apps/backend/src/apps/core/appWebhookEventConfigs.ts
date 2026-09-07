import { AppEventType, BaseAppEvent } from '@/apps/types';
import { config } from '@/config/env';

/**
 * Per-app webhook delivery configuration.
 *
 * Some installed apps (e.g. Bitbot/Varys) do not consume the generic
 * camelCase app-event envelope for every event type — their webhook
 * contract only accepts specific events, or expects snake_case field
 * aliases. This module keys those contracts by the app bot user's email
 * (stable across environments, unlike per-environment user ids) so
 * `eventSubscriptionUtils` can gate delivery per event type.
 */
export interface AppWebhookEventConfig {
    /** Bot user email (lowercase) this config applies to. */
    botEmail: string;
    /**
     * Event types the app's webhook consumes in the generic camelCase
     * envelope. Empty list means the app receives no generic events.
     */
    subscribedEvents: AppEventType[];
    /**
     * Events that must be delivered with snake_case field aliases added
     * alongside the camelCase fields (legacy contract compatibility).
     */
    snakeCaseAliasEvents?: AppEventType[];
    /**
     * Bot-posted reply shown when the app is @mentioned but the event
     * is gated (or delivery failed), telling the user how to invoke it.
     */
    mentionGuidanceMessage?: string;
}

export const APP_WEBHOOK_EVENT_CONFIGS: AppWebhookEventConfig[] = [
    {
        // Varys (Bitbot) — its webhook only accepts the snake_case PR-check
        // contract. Generic events 400 with "Missing required field:
        // conversation_id". Only APP_MENTION is delivered, with aliases.
        botEmail: 'varys@app.xyne.ai',
        subscribedEvents: [],
        snakeCaseAliasEvents: [AppEventType.APP_MENTION],
        mentionGuidanceMessage:
            "👋 I'm Varys. I watch Bitbucket pull requests — I don't respond to plain mentions in chat.\n\n" +
            'To run a PR check, either:\n' +
            '• Use the **Run PR Check** button on a PR-linked ticket, or\n' +
            '• Post the full Bitbucket PR URL as a **new top-level message** in this channel (e.g. `https://bitbucket.org/<workspace>/<repo>/pull-requests/<id>`)',
    },
];

/** How a given (app, event) pair should be delivered. */
export type AppEventDeliveryMode = 'direct' | 'alias' | 'skip';

/**
 * Find the webhook event config for an installed app by its bot user email.
 * Case-insensitive; returns undefined for unknown/unset emails (default
 * behaviour: deliver every event unchanged).
 */
export function findAppWebhookEventConfig(
    botEmail: string | null | undefined,
): AppWebhookEventConfig | undefined {
    if (!botEmail) return undefined;
    const normalized = botEmail.trim().toLowerCase();
    return APP_WEBHOOK_EVENT_CONFIGS.find(
        (appConfig) => appConfig.botEmail.toLowerCase() === normalized,
    );
}

/**
 * Resolve the delivery mode for an (app, event) pair:
 * - 'direct': app is configured and subscribed → send the event as-is
 * - 'alias':  app expects this event with snake_case aliases → send the
 *             aliased copy (only while the flag is enabled; otherwise 'skip')
 * - 'skip':   app does not consume this event → do not call the webhook
 */
export function resolveAppEventDelivery(
    botEmail: string | null | undefined,
    eventType: AppEventType,
): AppEventDeliveryMode {
    const appConfig = findAppWebhookEventConfig(botEmail);
    if (!appConfig) return 'direct';

    if (appConfig.subscribedEvents.includes(eventType)) return 'direct';

    const aliasEvents = appConfig.snakeCaseAliasEvents ?? [];
    if (aliasEvents.includes(eventType)) {
        return config.apps.snakeCaseAliasesEnabled ? 'alias' : 'skip';
    }
    return 'skip';
}

/** camelCase payload field → snake_case alias to add. */
const SNAKE_CASE_ALIASES: Record<string, string> = {
    workspaceId: 'workspace_id',
    orgId: 'org_id',
    orgMemberId: 'org_member_id',
    conversationId: 'conversation_id',
    messageId: 'message_id',
    channelId: 'channel_id',
    userId: 'user_id',
};

/**
 * Return a shallow copy of `event` whose payload carries snake_case aliases
 * alongside the original camelCase fields. Never mutates the input; a
 * pre-existing snake_case field is left untouched.
 */
export function withSnakeCaseAliases(event: BaseAppEvent): BaseAppEvent {
    const payload = { ...(event.payload as unknown as Record<string, unknown>) };
    for (const [camelKey, snakeKey] of Object.entries(SNAKE_CASE_ALIASES)) {
        if (
            camelKey in payload &&
            payload[camelKey] !== undefined &&
            !(snakeKey in payload)
        ) {
            payload[snakeKey] = payload[camelKey];
        }
    }
    return { ...event, payload: payload as unknown as BaseAppEvent['payload'] };
}
