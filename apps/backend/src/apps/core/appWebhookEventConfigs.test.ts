import { AppEventType } from '@/apps/types';
import {
    findAppWebhookEventConfig,
    resolveAppEventDelivery,
    withSnakeCaseAliases,
} from './appWebhookEventConfigs';
import { config } from '@/config/env';

jest.mock('@/config/env', () => ({
    config: {
        apps: {
            snakeCaseAliasesEnabled: true,
        },
    },
}));

describe('appWebhookEventConfigs', () => {
    describe('findAppWebhookEventConfig', () => {
        it('matches the bot email case-insensitively', () => {
            const appConfig = findAppWebhookEventConfig('VARYS@APP.XYNE.AI');
            expect(appConfig).toBeDefined();
            expect(appConfig?.botEmail).toBe('varys@app.xyne.ai');
            expect(appConfig?.snakeCaseAliasEvents).toContain(AppEventType.APP_MENTION);
        });

        it('returns undefined for unknown or missing emails', () => {
            expect(findAppWebhookEventConfig('nobody@example.com')).toBeUndefined();
            expect(findAppWebhookEventConfig(null)).toBeUndefined();
            expect(findAppWebhookEventConfig(undefined)).toBeUndefined();
            expect(findAppWebhookEventConfig('')).toBeUndefined();
        });
    });

    describe('resolveAppEventDelivery', () => {
        it('delivers alias-listed events when the flag is on', () => {
            expect(resolveAppEventDelivery('varys@app.xyne.ai', AppEventType.APP_MENTION)).toBe('alias');
        });

        it('skips events the app is not subscribed to', () => {
            expect(resolveAppEventDelivery('varys@app.xyne.ai', AppEventType.USER_MENTIONED)).toBe('skip');
            expect(resolveAppEventDelivery('varys@app.xyne.ai', AppEventType.DM)).toBe('skip');
        });

        it('skips alias events when the kill-switch flag is off', () => {
            const original = config.apps.snakeCaseAliasesEnabled;
            try {
                config.apps.snakeCaseAliasesEnabled = false;
                expect(resolveAppEventDelivery('varys@app.xyne.ai', AppEventType.APP_MENTION)).toBe('skip');
            } finally {
                config.apps.snakeCaseAliasesEnabled = original;
            }
        });

        it('delivers every event for unconfigured apps', () => {
            expect(resolveAppEventDelivery('unknown@app.xyne.ai', AppEventType.APP_MENTION)).toBe('direct');
            expect(resolveAppEventDelivery(null, AppEventType.USER_MENTIONED)).toBe('direct');
        });
    });

    describe('withSnakeCaseAliases', () => {
        const event = {
            eventType: AppEventType.APP_MENTION,
            payload: {
                conversationId: 'conv-1',
                channelId: 'chan-1',
                messageId: 'msg-1',
                workspaceId: 'ws-1',
                userId: 'user-1',
                content: 'hello',
                cleanContent: 'hello',
                createdAt: new Date('2026-09-02T10:29:10.000Z'),
                senderName: 'Sender',
                channelName: 'chan',
            },
            timestamp: '2026-09-02T10:29:10.000Z',
        } as unknown as import('@/apps/types').BaseAppEvent;

        it('adds snake_case aliases alongside camelCase fields', () => {
            const aliased = withSnakeCaseAliases(event);
            const payload = aliased.payload as unknown as Record<string, unknown>;
            expect(payload.conversationId).toBe('conv-1');
            expect(payload.conversation_id).toBe('conv-1');
            expect(payload.channel_id).toBe('chan-1');
            expect(payload.message_id).toBe('msg-1');
            expect(payload.workspace_id).toBe('ws-1');
            expect(payload.user_id).toBe('user-1');
        });

        it('never mutates the original event', () => {
            withSnakeCaseAliases(event);
            expect('conversation_id' in event.payload).toBe(false);
            expect(event.payload.conversationId).toBe('conv-1');
        });

        it('keeps pre-existing snake_case fields untouched', () => {
            const aliased = withSnakeCaseAliases({
                ...event,
                payload: { ...event.payload, conversation_id: 'existing' },
            } as unknown as import('@/apps/types').BaseAppEvent);
            const payload = aliased.payload as unknown as Record<string, unknown>;
            expect(payload.conversation_id).toBe('existing');
            expect(payload.conversationId).toBe('conv-1');
        });
    });
});
