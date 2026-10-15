import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyNotificationCategory,
  getNotificationDeliveryFields,
  isIosOperatingSystemPresentedBanner,
} from '@/src/observability/logging/notification/notificationDelivery';
import type { RawPushMessage } from '@/src/notifications/types';

function message(overrides: Partial<RawPushMessage> = {}): RawPushMessage {
  return {
    messageId: 'fcm-1',
    sentTime: 1_700_000_000_000,
    data: {},
    ...overrides,
  } as RawPushMessage;
}

describe('classifyNotificationCategory', () => {
  it('classifies SOS from notificationType or metadata', () => {
    assert.equal(classifyNotificationCategory({ notificationType: 'sos_alert' }), 'sos');
    assert.equal(
      classifyNotificationCategory({
        metadata: JSON.stringify({ notificationType: 'sos_alert' }),
      }),
      'sos',
    );
  });

  it('classifies control, call, reminder, chat, and prefetch', () => {
    assert.equal(classifyNotificationCategory({ type: 'CHANNEL_READ' }), 'control');
    assert.equal(classifyNotificationCategory({ type: 'INCOMING_CALL' }), 'call');
    assert.equal(classifyNotificationCategory({ type: 'CALL_UPDATED' }), 'reminder');
    assert.equal(classifyNotificationCategory({ type: 'CHANNEL_MESSAGE' }), 'chat');
    assert.equal(classifyNotificationCategory({ type: 'TICKET_PRIORITY_CHANGED' }), 'ticket');
    assert.equal(classifyNotificationCategory({ category: 'TICKET_STATUS_CHANGE' }), 'ticket');
    assert.equal(
      classifyNotificationCategory({ type: 'CHANNEL_MESSAGE', prefetchOnly: '1' }),
      'prefetch',
    );
  });

  it('falls back to unknown', () => {
    assert.equal(classifyNotificationCategory({ type: 'SOMETHING_ELSE' }), 'unknown');
    assert.equal(classifyNotificationCategory({}), 'unknown');
  });
});

describe('getNotificationDeliveryFields', () => {
  it('reads notificationId from top-level data', () => {
    const fields = getNotificationDeliveryFields(
      message({
        data: { notificationId: 'n-1', type: 'CHANNEL_MESSAGE' },
      }),
      'foreground',
    );
    assert.equal(fields.notificationId, 'n-1');
    assert.equal(fields.category, 'chat');
    assert.equal(fields.deliveryContext, 'foreground');
    assert.equal(fields.fcmMessageId, 'fcm-1');
    assert.equal(fields.hasNotificationPayload, false);
  });

  it('reads notificationId from metadata JSON or object', () => {
    const fromJson = getNotificationDeliveryFields(
      message({
        data: { metadata: JSON.stringify({ notificationId: 'n-json' }) },
      }),
      'background',
    );
    assert.equal(fromJson.notificationId, 'n-json');

    const fromObject = getNotificationDeliveryFields(
      message({
        data: { metadata: { notificationId: 'n-obj' } as unknown as string },
      }),
      'background',
    );
    assert.equal(fromObject.notificationId, 'n-obj');
  });

  it('treats empty strings as null and records an OS alert block', () => {
    const fields = getNotificationDeliveryFields(
      message({
        messageId: '   ',
        data: { notificationId: '  ', type: '   ' },
        notification: { title: 'hi' },
        sentTime: Number.NaN,
      }),
      'background',
    );
    assert.equal(fields.notificationId, null);
    assert.equal(fields.notificationType, null);
    assert.equal(fields.fcmMessageId, null);
    assert.equal(fields.fcmSentTime, null);
    assert.equal(fields.hasNotificationPayload, true);
    assert.equal('metadata' in fields, false);
  });

  it('does not serialize full notification metadata into telemetry fields', () => {
    const fields = getNotificationDeliveryFields(
      message({
        data: {
          notificationId: 'n-keep',
          type: 'CHANNEL_MESSAGE',
          metadata: JSON.stringify({
            notificationId: 'n-keep',
            body: 'secret chat preview',
            email: 'user@example.com',
          }),
        },
      }),
      'foreground',
    );

    assert.equal(fields.notificationId, 'n-keep');
    assert.equal(fields.notificationType, 'CHANNEL_MESSAGE');
    assert.equal(fields.category, 'chat');
    assert.equal('metadata' in fields, false);
    assert.equal(JSON.stringify(fields).includes('secret chat preview'), false);
    assert.equal(JSON.stringify(fields).includes('user@example.com'), false);
  });
});

describe('isIosOperatingSystemPresentedBanner', () => {
  it('is true only for iOS background payloads that include an APNS alert', () => {
    const withAlert = message({ notification: { title: 'hi' } });
    const dataOnly = message();

    assert.equal(isIosOperatingSystemPresentedBanner(withAlert, 'background', 'ios'), true);
    assert.equal(isIosOperatingSystemPresentedBanner(withAlert, 'foreground', 'ios'), false);
    assert.equal(isIosOperatingSystemPresentedBanner(dataOnly, 'background', 'ios'), false);
    assert.equal(isIosOperatingSystemPresentedBanner(withAlert, 'background', 'android'), false);
  });
});
