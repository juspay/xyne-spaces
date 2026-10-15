import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  NOTIFICATION_HEADER_RESOLVE_TIMEOUT_MS,
  abandonNotificationHeaderResolve,
  beginNotificationHeaderResolve,
  configureNotificationHeaderResolveScheduler,
  observeNotificationHeaderResolve,
  resetNotificationHeaderResolve,
  subscribeNotificationHeaderResolveCompleted,
  type BeginNotificationHeaderResolveInput,
  type CompletedNotificationHeaderResolve,
  type NotificationHeaderResolveTimeoutScheduler,
} from '@/src/observability/logging/notification/notificationHeaderResolve';

class ManualTimeoutScheduler implements NotificationHeaderResolveTimeoutScheduler {
  private readonly items: Array<{
    callback: () => void;
    remaining: number;
    cancelled: boolean;
  }> = [];

  schedule(callback: () => void, durationMs: number): { cancel(): void } {
    const item = { callback, remaining: durationMs, cancelled: false };
    this.items.push(item);
    return {
      cancel: (): void => {
        item.cancelled = true;
      },
    };
  }

  advance(ms: number): void {
    for (const item of this.items) {
      if (item.cancelled) {
        continue;
      }

      item.remaining -= ms;
      if (item.remaining <= 0) {
        item.cancelled = true;
        item.callback();
      }
    }
  }
}

const begin = (
  overrides: Partial<BeginNotificationHeaderResolveInput> = {},
): BeginNotificationHeaderResolveInput => ({
  target: { channelId: 'c1', messageId: 'm1' },
  surface: 'channel',
  baselineUptimeMs: 100,
  nativeAnchor: 'activity',
  ...overrides,
});

describe('notificationHeaderResolve', () => {
  afterEach(() => {
    resetNotificationHeaderResolve();
  });

  it('completes as resolved when the header title lands', () => {
    beginNotificationHeaderResolve(begin());
    const completed = observeNotificationHeaderResolve({
      channelId: 'c1',
      headerStatus: 'resolved',
      channelPresentInVisibleChannels: true,
      visibleChannelListPublished: true,
      userDirectoryPublished: true,
      scopeType: 'DEFAULT',
      atUptimeMs: 280,
    });

    assert.ok(completed);
    assert.equal(completed.outcome, 'resolved');
    assert.equal(completed.headerStatus, 'resolved');
    assert.equal(completed.durationMs, 180);
    assert.equal(completed.channelPresentInVisibleChannels, true);
    assert.equal(completed.surface, 'channel');
    assert.equal(completed.nativeAnchor, 'activity');
    assert.equal(completed.channelId, 'c1');
    assert.equal(completed.messageId, 'm1');
    assert.equal(completed.notificationId, null);
    assert.equal(completed.notificationType, null);
    assert.equal(completed.metadata, null);
  });

  it('completes as missing when lists are ready but the channel is absent', () => {
    beginNotificationHeaderResolve(begin());
    const completed = observeNotificationHeaderResolve({
      channelId: 'c1',
      headerStatus: 'unknown',
      channelPresentInVisibleChannels: false,
      visibleChannelListPublished: true,
      userDirectoryPublished: true,
      scopeType: null,
      atUptimeMs: 400,
    });

    assert.ok(completed);
    assert.equal(completed.outcome, 'missing');
    assert.equal(completed.headerStatus, 'unknown');
    assert.equal(completed.channelPresentInVisibleChannels, false);
    assert.equal(completed.visibleChannelListPublished, true);
  });

  it('waits while pending and times out from first header observation', () => {
    const scheduler = new ManualTimeoutScheduler();
    configureNotificationHeaderResolveScheduler(scheduler);

    let closed: CompletedNotificationHeaderResolve | undefined;
    const unsubscribe = subscribeNotificationHeaderResolveCompleted(event => {
      closed = event;
    });

    beginNotificationHeaderResolve(begin());
    assert.equal(
      observeNotificationHeaderResolve({
        channelId: 'c1',
        headerStatus: 'pending',
        channelPresentInVisibleChannels: false,
        visibleChannelListPublished: false,
        userDirectoryPublished: false,
        scopeType: null,
        atUptimeMs: 200,
      }),
      null,
    );

    scheduler.advance(NOTIFICATION_HEADER_RESOLVE_TIMEOUT_MS - 1);
    scheduler.advance(1);
    unsubscribe();

    if (!closed) {
      throw new Error('expected header resolve timeout');
    }
    assert.equal(closed.outcome, 'timeout');
    assert.equal(closed.headerStatus, 'pending');
    assert.equal(closed.durationMs, 100 + NOTIFICATION_HEADER_RESOLVE_TIMEOUT_MS);
  });

  it('treats group_fallback as resolved', () => {
    beginNotificationHeaderResolve(begin());
    const completed = observeNotificationHeaderResolve({
      channelId: 'c1',
      headerStatus: 'group_fallback',
      channelPresentInVisibleChannels: true,
      visibleChannelListPublished: true,
      userDirectoryPublished: true,
      scopeType: 'GROUP_DM',
      atUptimeMs: 150,
    });

    assert.equal(completed?.outcome, 'resolved');
    assert.equal(completed?.headerStatus, 'group_fallback');
  });

  it('ignores observations for a different channel', () => {
    beginNotificationHeaderResolve(begin());
    assert.equal(
      observeNotificationHeaderResolve({
        channelId: 'other',
        headerStatus: 'resolved',
        channelPresentInVisibleChannels: true,
        visibleChannelListPublished: true,
        userDirectoryPublished: true,
        scopeType: 'DEFAULT',
        atUptimeMs: 200,
      }),
      null,
    );
  });

  it('abandons an in-flight journey when a different target begins', () => {
    beginNotificationHeaderResolve(begin());
    const abandoned = beginNotificationHeaderResolve(
      begin({
        target: { channelId: 'c2', messageId: 'm2' },
        baselineUptimeMs: 180,
      }),
    );

    assert.ok(abandoned);
    assert.equal(abandoned.outcome, 'abandoned');
    assert.equal(abandoned.channelId, 'c1');
  });

  it('abandons on background', () => {
    beginNotificationHeaderResolve(begin());
    const completed = abandonNotificationHeaderResolve(500);
    assert.equal(completed?.outcome, 'abandoned');
    assert.equal(completed?.durationMs, 400);
  });

  it('carries FCM metadata from begin onto the completed event', () => {
    const metadata =
      '{"channelId":"c1","conversationId":"conv1","messageId":"m1","senderName":"Ada","channelTitle":"ms_testing"}';
    beginNotificationHeaderResolve(
      begin({
        notificationId: 'notif-server-1',
        notificationType: 'THREAD_REPLY',
        metadata,
      }),
    );
    const completed = observeNotificationHeaderResolve({
      channelId: 'c1',
      headerStatus: 'resolved',
      channelPresentInVisibleChannels: true,
      visibleChannelListPublished: true,
      userDirectoryPublished: true,
      scopeType: 'DEFAULT',
      atUptimeMs: 280,
    });

    assert.equal(completed?.notificationId, 'notif-server-1');
    assert.equal(completed?.notificationType, 'THREAD_REPLY');
    assert.equal(completed?.metadata, metadata);
  });
});
