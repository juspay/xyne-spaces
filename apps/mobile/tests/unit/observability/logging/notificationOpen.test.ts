import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  PATH_CHAT,
  PATH_DMS,
  PATH_THREAD,
  appendPathSegment,
  pathSegmentForPhase,
  resolveIdealPath,
  surfaceFromTarget,
} from '@/src/observability/logging/notification/notificationPath';
import {
  NOTIFICATION_OPEN_COLD_LAUNCH_WINDOW_MS,
  NOTIFICATION_OPEN_HIGHLIGHT_TIMEOUT_MS,
  NOTIFICATION_OPEN_MARK_BUFFER_TTL_MS,
  NOTIFICATION_OPEN_SKELETON_TIMEOUT_MS,
  abandonNotificationOpen,
  beginNotificationOpen,
  bufferNotificationOpenMark,
  configureNotificationOpenScheduler,
  getPendingNotificationOpenTarget,
  markNotificationMessageHighlighted,
  markNotificationPhase,
  markNotificationChatSkeletonShown,
  resetNotificationOpen,
  resolveNotificationOpenClock,
  subscribeNotificationOpenCompleted,
  type BeginNotificationOpenInput,
  type NotificationOpenTimeoutScheduler,
} from '@/src/observability/logging/notification/notificationOpen';

class ManualTimeoutScheduler implements NotificationOpenTimeoutScheduler {
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

const channelBegin = (
  overrides: Partial<BeginNotificationOpenInput> = {},
): BeginNotificationOpenInput => ({
  target: { channelId: 'c1', messageId: 'm1' },
  surface: 'channel',
  appState: 'cold',
  baselineUptimeMs: 100,
  nativeAnchor: 'activity',
  ...overrides,
});

describe('notificationPath', () => {
  it('builds expo templates for channel and thread destinations', () => {
    assert.equal(resolveIdealPath('channel'), `${PATH_DMS} → ${PATH_CHAT}`);
    assert.equal(resolveIdealPath('thread'), `${PATH_DMS} → ${PATH_THREAD}`);
  });

  it('does not duplicate a path segment that is already last', () => {
    assert.equal(appendPathSegment('', PATH_DMS), PATH_DMS);
    assert.equal(appendPathSegment(PATH_DMS, PATH_DMS), PATH_DMS);
    assert.equal(
      appendPathSegment(`${PATH_DMS} → ${PATH_CHAT}`, PATH_CHAT),
      `${PATH_DMS} → ${PATH_CHAT}`,
    );
  });

  it('picks the surface and path segment from the target', () => {
    assert.equal(surfaceFromTarget({}), 'channel');
    assert.equal(surfaceFromTarget({ threadId: 't1' }), 'thread');
    assert.equal(pathSegmentForPhase('dms_visible', 'channel'), PATH_DMS);
    assert.equal(pathSegmentForPhase('chat_visible', 'channel'), PATH_CHAT);
    assert.equal(pathSegmentForPhase('chat_visible', 'thread'), PATH_THREAD);
  });
});

describe('resolveNotificationOpenClock', () => {
  const nativeBaselineUptimeMs = 1_000;

  it('uses native T0 while splash or protected startup is still in progress', () => {
    const clock = resolveNotificationOpenClock({
      hasSplashHidden: false,
      isProtectedStartupReady: false,
      launchCause: 'direct',
      nativeBaselineUptimeMs,
      nowUptimeMs: nativeBaselineUptimeMs + 1_500,
    });

    assert.equal(clock.appState, 'cold');
    assert.equal(clock.baselineUptimeMs, nativeBaselineUptimeMs);
  });

  it('uses native T0 for a notification launch whose intent arrives after splash', () => {
    const clock = resolveNotificationOpenClock({
      hasSplashHidden: true,
      isProtectedStartupReady: true,
      launchCause: 'notification',
      nativeBaselineUptimeMs,
      nowUptimeMs: nativeBaselineUptimeMs + 4_000,
    });

    assert.equal(clock.appState, 'cold');
    assert.equal(clock.baselineUptimeMs, nativeBaselineUptimeMs);
  });

  it('uses tap uptime on a later tap of a process that was started by a notification', () => {
    const nowUptimeMs = nativeBaselineUptimeMs + 5 * 60 * 60 * 1000;
    const clock = resolveNotificationOpenClock({
      hasSplashHidden: true,
      isProtectedStartupReady: true,
      launchCause: 'notification',
      nativeBaselineUptimeMs,
      nowUptimeMs,
    });

    assert.equal(clock.appState, 'warm');
    assert.equal(clock.baselineUptimeMs, nowUptimeMs);
  });

  it('does not treat a workspace-switch ready=false hours later as a cold launch', () => {
    const nowUptimeMs = nativeBaselineUptimeMs + NOTIFICATION_OPEN_COLD_LAUNCH_WINDOW_MS + 1;
    const clock = resolveNotificationOpenClock({
      hasSplashHidden: true,
      isProtectedStartupReady: false,
      launchCause: 'notification',
      nativeBaselineUptimeMs,
      nowUptimeMs,
    });

    assert.equal(clock.appState, 'warm');
    assert.equal(clock.baselineUptimeMs, nowUptimeMs);
  });

  it('uses tap uptime when a ready app was launched directly', () => {
    const nowUptimeMs = nativeBaselineUptimeMs + 8_000;
    const clock = resolveNotificationOpenClock({
      hasSplashHidden: true,
      isProtectedStartupReady: true,
      launchCause: 'direct',
      nativeBaselineUptimeMs,
      nowUptimeMs,
    });

    assert.equal(clock.appState, 'warm');
    assert.equal(clock.baselineUptimeMs, nowUptimeMs);
  });

  it('uses tap uptime when the Activity restarted on a process older than the cold window', () => {
    const processBaselineUptimeMs = 1_000;
    const activityBaselineUptimeMs = 90_000;
    const nowUptimeMs = activityBaselineUptimeMs + 200;
    const clock = resolveNotificationOpenClock({
      hasSplashHidden: false,
      isProtectedStartupReady: false,
      launchCause: 'notification',
      nativeBaselineUptimeMs: activityBaselineUptimeMs,
      nowUptimeMs,
      processBaselineUptimeMs,
    });

    assert.equal(clock.appState, 'warm');
    assert.equal(clock.baselineUptimeMs, nowUptimeMs);
  });
});

describe('notificationOpen', () => {
  afterEach(() => {
    resetNotificationOpen();
  });

  it('completes a skeleton-then-highlight channel open (case 1)', () => {
    assert.equal(beginNotificationOpen(channelBegin()), null);

    markNotificationPhase('splash_hidden', 200);
    markNotificationPhase('dms_visible', 300);
    markNotificationPhase('chat_visible', 400);
    markNotificationChatSkeletonShown(410);
    markNotificationPhase('list_ready', 800);

    const completed = markNotificationMessageHighlighted(850);
    assert.ok(completed);
    assert.equal(completed.outcome, 'highlighted');
    assert.equal(completed.durationMs, 750);
    assert.equal(completed.chatSkeletonShown, true);
    assert.equal(completed.messageHighlighted, true);
    assert.equal(completed.pathMatched, true);
    assert.equal(completed.idealPath, `${PATH_DMS} → ${PATH_CHAT}`);
    assert.equal(completed.realPath, `${PATH_DMS} → ${PATH_CHAT}`);
    assert.equal(getPendingNotificationOpenTarget(), null);
  });

  it('completes a cache-hit open that never shows a skeleton (case 2)', () => {
    beginNotificationOpen(channelBegin());
    markNotificationPhase('splash_hidden', 180);
    markNotificationPhase('dms_visible', 250);
    markNotificationPhase('chat_visible', 320);
    markNotificationPhase('list_ready', 330);

    const completed = markNotificationMessageHighlighted(340);
    assert.ok(completed);
    assert.equal(completed.outcome, 'highlighted');
    assert.equal(completed.chatSkeletonShown, false);
  });

  it('closes on the skeleton watchdog when the placeholder never leaves (case 3)', () => {
    const scheduler = new ManualTimeoutScheduler();
    configureNotificationOpenScheduler(scheduler);

    let closed = null as ReturnType<typeof markNotificationChatSkeletonShown>;
    const unsubscribe = subscribeNotificationOpenCompleted(event => {
      closed = event;
    });

    beginNotificationOpen(channelBegin());
    markNotificationPhase('splash_hidden', 200);
    markNotificationPhase('dms_visible', 300);
    markNotificationPhase('chat_visible', 400);
    assert.equal(markNotificationChatSkeletonShown(410), null);

    scheduler.advance(NOTIFICATION_OPEN_SKELETON_TIMEOUT_MS - 1);
    assert.ok(getPendingNotificationOpenTarget());

    scheduler.advance(1);
    unsubscribe();

    assert.ok(closed);
    assert.equal(closed.outcome, 'skeleton_timeout');
    assert.equal(closed.chatSkeletonShown, true);
    assert.equal(closed.messageHighlighted, false);
    assert.equal(closed.durationMs, 310 + NOTIFICATION_OPEN_SKELETON_TIMEOUT_MS);
  });

  it('closes on highlight timeout after the list is ready but the row never lands', () => {
    const scheduler = new ManualTimeoutScheduler();
    configureNotificationOpenScheduler(scheduler);

    let closed = null as ReturnType<typeof markNotificationMessageHighlighted>;
    const unsubscribe = subscribeNotificationOpenCompleted(event => {
      closed = event;
    });

    beginNotificationOpen(channelBegin());
    markNotificationPhase('chat_visible', 400);
    markNotificationPhase('list_ready', 500);
    scheduler.advance(NOTIFICATION_OPEN_HIGHLIGHT_TIMEOUT_MS);
    unsubscribe();

    assert.ok(closed);
    assert.equal(closed.outcome, 'highlight_timeout');
    assert.equal(closed.messageHighlighted, false);
    assert.equal(closed.durationMs, 400 + NOTIFICATION_OPEN_HIGHLIGHT_TIMEOUT_MS);
  });

  it('treats list_ready as T2 when the payload has no messageId', () => {
    beginNotificationOpen(
      channelBegin({
        target: { channelId: 'c1' },
      }),
    );
    markNotificationPhase('chat_visible', 200);
    const completed = markNotificationPhase('list_ready', 260);
    assert.ok(completed);
    assert.equal(completed.outcome, 'highlighted');
    assert.equal(completed.messageId, null);
    assert.equal(completed.messageHighlighted, false);
  });

  it('ignores a second begin for the same target', () => {
    beginNotificationOpen(channelBegin());
    assert.equal(beginNotificationOpen(channelBegin()), null);
    assert.equal(getPendingNotificationOpenTarget()?.channelId, 'c1');
  });

  it('abandons an in-flight journey when a different target begins', () => {
    beginNotificationOpen(channelBegin());
    markNotificationPhase('dms_visible', 150);

    const abandoned = beginNotificationOpen(
      channelBegin({
        target: { channelId: 'c2', messageId: 'm2' },
        already: { nowUptimeMs: 180 },
      }),
    );

    assert.ok(abandoned);
    assert.equal(abandoned.outcome, 'abandoned');
    assert.equal(abandoned.channelId, 'c1');
    assert.equal(getPendingNotificationOpenTarget()?.channelId, 'c2');
  });

  it('records already-reached phases on a warm begin and does not require DMs', () => {
    beginNotificationOpen(
      channelBegin({
        appState: 'warm',
        baselineUptimeMs: 5_000,
        already: {
          nowUptimeMs: 5_000,
          splashHidden: true,
          chatVisible: true,
        },
      }),
    );

    const completed = markNotificationMessageHighlighted(5_120);
    assert.ok(completed);
    assert.equal(completed.appState, 'warm');
    assert.equal(completed.pathMatched, false);
    assert.equal(completed.realPath, PATH_CHAT);
  });

  it('still completes when list_ready arrives before chat_visible', () => {
    beginNotificationOpen(channelBegin());
    markNotificationPhase('list_ready', 220);
    markNotificationPhase('chat_visible', 230);
    const completed = markNotificationMessageHighlighted(240);
    assert.ok(completed);
    assert.equal(completed.outcome, 'highlighted');
    assert.equal(completed.realPath, PATH_CHAT);
  });

  it('returns null from every mark when no journey is pending', () => {
    assert.equal(markNotificationPhase('dms_visible', 10), null);
    assert.equal(markNotificationChatSkeletonShown(10), null);
    assert.equal(markNotificationMessageHighlighted(10), null);
    assert.equal(abandonNotificationOpen(10), null);
  });

  it('applies buffered list-ready and highlight marks that arrived before begin', () => {
    bufferNotificationOpenMark({
      kind: 'list_ready',
      atUptimeMs: 5_040,
      channelId: 'c1',
      messageId: 'm1',
    });
    bufferNotificationOpenMark({
      kind: 'highlighted',
      atUptimeMs: 5_080,
      channelId: 'c1',
      messageId: 'm1',
    });

    const completed = beginNotificationOpen(
      channelBegin({
        appState: 'warm',
        baselineUptimeMs: 5_000,
        already: { nowUptimeMs: 5_100, chatVisible: true },
      }),
    );

    assert.ok(completed);
    assert.equal(completed.outcome, 'highlighted');
    assert.equal(completed.durationMs, 80);
    assert.equal(completed.messageHighlighted, true);
    assert.equal(getPendingNotificationOpenTarget(), null);
  });

  it('does not apply buffered marks from a different channel or past the TTL', () => {
    bufferNotificationOpenMark({
      kind: 'highlighted',
      atUptimeMs: 100,
      channelId: 'other',
      messageId: 'm1',
    });
    bufferNotificationOpenMark({
      kind: 'highlighted',
      atUptimeMs: 5_000 - NOTIFICATION_OPEN_MARK_BUFFER_TTL_MS - 1,
      channelId: 'c1',
      messageId: 'm1',
    });

    assert.equal(
      beginNotificationOpen(
        channelBegin({
          appState: 'warm',
          baselineUptimeMs: 5_000,
          already: { nowUptimeMs: 5_000 },
        }),
      ),
      null,
    );
    assert.equal(getPendingNotificationOpenTarget()?.channelId, 'c1');
  });

  it('builds a thread ideal path and records threadId', () => {
    beginNotificationOpen(
      channelBegin({
        surface: 'thread',
        target: { channelId: 'c1', threadId: 't1', messageId: 'm1' },
      }),
    );
    markNotificationPhase('dms_visible', 200);
    markNotificationPhase('chat_visible', 260);
    const completed = markNotificationMessageHighlighted(300);
    assert.ok(completed);
    assert.equal(completed.surface, 'thread');
    assert.equal(completed.threadId, 't1');
    assert.equal(completed.idealPath, `${PATH_DMS} → ${PATH_THREAD}`);
    assert.equal(completed.realPath, `${PATH_DMS} → ${PATH_THREAD}`);
    assert.equal(completed.pathMatched, true);
  });
});
