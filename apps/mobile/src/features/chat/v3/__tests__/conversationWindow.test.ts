import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { conversationRefFor, surfaceRemountKey } from '../data/conversationRef';
import { deriveDataFacts, isSameDataFacts } from '../data/deriveDataFacts';
import {
  CHANNEL_PAGE_SIZE,
  createdAtFromSnapshotRows,
  messagesOptionsFor,
} from '../data/messagesOptions';
import {
  EMPTY_WINDOW,
  isSameConversationWindow,
  normalizeConversationWindow,
  type ChannelWindowSource,
  type Conversation,
} from '../data/normalizeConversationWindow';
import { aroundCursorFor } from '../data/useConversationWindow';
import { windowContainsTarget } from '../data/windowContainsTarget';
import type { OpenIntent } from '../intent/openIntent.types';
import { parseOpenIntent } from '../intent/parseOpenIntent';

const mustParse = (raw: Record<string, unknown>): OpenIntent => {
  const result = parseOpenIntent(raw);
  assert.equal(result.ok, true, result.ok ? '' : result.error.reason);
  if (!result.ok) {
    throw new Error('parse failed');
  }
  return result.value;
};

const asConversations = (rows: readonly object[]): readonly Conversation[] =>
  rows as readonly Conversation[];

const channelSource = (over: Partial<ChannelWindowSource> = {}): ChannelWindowSource => ({
  messages: [],
  isInitialLoadComplete: false,
  hasReachedChannelStart: false,
  initialLoadError: null,
  loadOlder: (): void => undefined,
  loadNewer: (): void => undefined,
  retryInitialLoad: (): void => undefined,
  ...over,
});

describe('conversationRefFor', (): void => {
  it('maps a channel surface to a ChannelRef', (): void => {
    const intent = mustParse({ channelId: 'ch-1', source: 'tap' });
    assert.deepEqual(conversationRefFor(intent), {
      kind: 'channel',
      channelId: 'ch-1',
      isMember: true,
    });
  });

  it('maps a thread surface to a ThreadRef keyed by threadId', (): void => {
    const intent = mustParse({
      channelId: 'ch-1',
      threadId: 'thread-9',
      source: 'tap',
    });
    assert.deepEqual(conversationRefFor(intent), {
      kind: 'thread',
      channelId: 'ch-1',
      conversationId: 'thread-9',
      isMember: true,
    });
  });

  it('maps a ticket-thread surface to the same ThreadRef as a plain thread', (): void => {
    const intent = mustParse({
      channelId: 'ch-1',
      threadId: 'thread-9',
      ticketId: 'ticket-1',
      source: 'tap',
    });
    assert.equal(intent.surface.kind, 'ticket-thread');
    assert.deepEqual(conversationRefFor(intent), {
      kind: 'thread',
      channelId: 'ch-1',
      conversationId: 'thread-9',
      isMember: true,
    });
  });
});

describe('surfaceRemountKey (C5)', (): void => {
  it('equals intentKey so screens remount with key=, not an Effect', (): void => {
    const intent = mustParse({ channelId: 'ch-1', source: 'tap' });
    assert.equal(surfaceRemountKey(intent), intent.intentKey);
    assert.equal(surfaceRemountKey(intent), 'channel:ch-1');
  });

  it('does not change when only the landing message changes', (): void => {
    const tail = mustParse({ channelId: 'ch-1', source: 'tap' });
    const anchored = mustParse({
      channelId: 'ch-1',
      origin: 'conversation-99',
      createdAt: 50,
      source: 'deeplink',
    });
    assert.equal(surfaceRemountKey(tail), surfaceRemountKey(anchored));
  });

  it('changes when the surface identity changes', (): void => {
    const channel = mustParse({ channelId: 'ch-1', source: 'tap' });
    const other = mustParse({ channelId: 'ch-2', source: 'tap' });
    const thread = mustParse({ channelId: 'ch-1', threadId: 'th-1', source: 'tap' });
    assert.notEqual(surfaceRemountKey(channel), surfaceRemountKey(other));
    assert.notEqual(surfaceRemountKey(channel), surfaceRemountKey(thread));
  });
});

describe('windowContainsTarget', (): void => {
  it('is false for an empty window', (): void => {
    assert.equal(windowContainsTarget([], { kind: 'tail' }), false);
    assert.equal(
      windowContainsTarget([], {
        kind: 'anchor',
        conversationId: 'c1',
        messageId: 'c1',
        createdAt: 1,
      }),
      false,
    );
  });

  it('treats any row as a tail hit', (): void => {
    const rows = [{ conversationId: 'c1' }];
    assert.equal(windowContainsTarget(rows, { kind: 'tail' }), true);
  });

  it('matches an anchor by conversationId, initialMessageId, or messageId', (): void => {
    const target = {
      kind: 'anchor' as const,
      conversationId: 'hit',
      messageId: 'hit',
      createdAt: 1,
    };
    assert.equal(windowContainsTarget([{ conversationId: 'hit' }], target), false);
    assert.equal(windowContainsTarget([{ initialMessageId: 'hit' }], target), true);
    assert.equal(windowContainsTarget([{ messageId: 'hit' }], target), true);
    assert.equal(windowContainsTarget([{ conversationId: 'miss' }], target), false);
  });

  it('requires the exact messageId when one is requested', (): void => {
    const target = {
      kind: 'anchor' as const,
      conversationId: 'thread-root',
      createdAt: 1,
      messageId: 'reply-msg',
    };
    assert.equal(
      windowContainsTarget([{ conversationId: 'thread-root', messageId: 'parent-msg' }], target),
      false,
    );
    assert.equal(windowContainsTarget([{ messageId: 'reply-msg' }], target), true);
  });
});

describe('deriveDataFacts', (): void => {
  it('derives live facts from the window, never stored state', (): void => {
    const empty = deriveDataFacts(EMPTY_WINDOW, { kind: 'tail' });
    assert.equal(empty.hasPaintableRows, false);
    assert.equal(empty.containsTarget, false);
    assert.equal(empty.liveIsAuthoritative, false);
    assert.equal(empty.expansionExhausted, false);
    assert.equal(empty.hasWarmWindow, false);

    const loaded = deriveDataFacts(
      {
        conversations: [{ conversationId: 'c1' }],
        isInitialLoadComplete: true,
        hasReachedStart: true,
      },
      { kind: 'tail' },
    );
    assert.equal(loaded.hasPaintableRows, true);
    assert.equal(loaded.containsTarget, true);
    assert.equal(loaded.liveIsAuthoritative, true);
    assert.equal(loaded.expansionExhausted, true);
    assert.equal(isSameDataFacts(empty, deriveDataFacts(EMPTY_WINDOW, { kind: 'tail' })), true);
  });

  it('folds a warm window into facts until live is settled', (): void => {
    const warm = {
      kind: 'channel' as const,
      id: 'ch',
      rows: [{ conversationId: 'c1' }],
      records: [{ conversationId: 'c1', initialMessageMd: 'hello' }],
      fingerprint: 'c1',
      readAt: 1,
      containsTarget: true,
    };
    const facts = deriveDataFacts(EMPTY_WINDOW, { kind: 'tail' }, warm);
    assert.equal(facts.hasWarmWindow, true);
    assert.equal(facts.hasPaintableRows, true);
    assert.equal(facts.liveIsAuthoritative, false);
  });

  it('does not treat id-only warm rows as paintable', (): void => {
    const warm = {
      kind: 'channel' as const,
      id: 'ch',
      rows: [{ conversationId: 'c1' }],
      records: [{ conversationId: 'c1' }],
      fingerprint: 'c1',
      readAt: 1,
      containsTarget: true,
    };
    const facts = deriveDataFacts(EMPTY_WINDOW, { kind: 'tail' }, warm);
    assert.equal(facts.hasWarmWindow, true);
    assert.equal(facts.hasPaintableRows, false);
  });

  it('treats thread cache content as paintable, matching v2', (): void => {
    const warm = {
      kind: 'thread' as const,
      id: 'th',
      rows: [{ messageId: 'm1' }],
      records: [{ messageId: 'm1', content: '<p>hello</p>' }],
      fingerprint: 'm1',
      readAt: 1,
      containsTarget: true,
    };
    const facts = deriveDataFacts(EMPTY_WINDOW, { kind: 'tail' }, warm);
    assert.equal(facts.hasPaintableRows, true);
  });

  it('surfaces a live subscribe failure as liveLoadFailed', (): void => {
    const facts = deriveDataFacts(
      { ...EMPTY_WINDOW, initialLoadError: 'network' },
      { kind: 'tail' },
    );
    assert.equal(facts.liveLoadFailed, true);
  });
});

describe('messagesOptionsFor', (): void => {
  it('derives notification, anchor, and unread options from intent + target', (): void => {
    const notified = mustParse({
      channelId: 'ch-1',
      messageId: 'm-99',
      source: 'notification',
    });
    assert.deepEqual(
      messagesOptionsFor(notified, {
        kind: 'anchor',
        conversationId: 'm-99',
        messageId: 'm-99',
        createdAt: 1,
      }).notificationTargetMessageId,
      'm-99',
    );

    const anchored = messagesOptionsFor(mustParse({ channelId: 'ch-1', source: 'tap' }), {
      kind: 'anchor',
      conversationId: 'c-2',
      messageId: 'c-2',
      createdAt: 40,
    });
    assert.equal(anchored.linkedConversationId, 'c-2');
    assert.deepEqual(anchored.linkedItemCreatedAt, { createdAt: 40 });
    assert.equal(anchored.enabled, true);

    const unread = messagesOptionsFor(
      mustParse({
        channelId: 'ch-1',
        source: 'tap',
        unreadOpen: '1',
        unreadLastViewedAt: '1700000000000',
      }),
      { kind: 'tail' },
    );
    assert.equal(unread.lastViewedAt, 1700000000000);
    assert.equal(unread.channelPageSize, CHANNEL_PAGE_SIZE);
    assert.equal(unread.promoteLatestTailOnColdOpen, true);
    assert.equal(anchored.enabled, true);

    const ordinary = messagesOptionsFor(mustParse({ channelId: 'ch-1', source: 'tap' }), {
      kind: 'tail',
    });
    assert.equal(ordinary.lastViewedAt, null);
  });

  it('does not pass a notification target for a non-notification open', (): void => {
    const intent = mustParse({ channelId: 'ch-1', messageId: 'm-1', source: 'tap' });
    assert.equal(messagesOptionsFor(intent, { kind: 'tail' }).notificationTargetMessageId, null);
  });

  it('puts an around-cursor on the list query only when the message timestamp is known', (): void => {
    const intent = mustParse({
      channelId: 'ch-1',
      conversationId: 'c-1',
      messageId: 'm-1',
      source: 'notification',
    });
    const pending = {
      kind: 'anchor' as const,
      conversationId: 'c-1',
      messageId: 'm-1',
      createdAt: 0,
    };
    assert.equal(aroundCursorFor(intent, pending), 0);
    const tap = mustParse({ channelId: 'ch-1', source: 'tap' });
    assert.equal(aroundCursorFor(tap, { kind: 'tail' }), 0);
    const held = messagesOptionsFor(intent, pending);
    assert.equal(held.linkedItemCreatedAt, null);
    const ready = messagesOptionsFor(intent, { ...pending, createdAt: 90 });
    assert.deepEqual(ready.linkedItemCreatedAt, { createdAt: 90 });
    assert.equal(aroundCursorFor(intent, { ...pending, createdAt: 90 }), 90);
  });

  it('links a deeplink thread to the thread id, not the reply message id', (): void => {
    const intent = mustParse({
      channelId: 'ch-1',
      threadId: 'th-1',
      messageId: 'reply-1',
      createdAt: '40',
      source: 'deeplink',
    });
    const target = {
      kind: 'anchor' as const,
      conversationId: intent.hint.conversationId ?? 'th-1',
      createdAt: 40,
      messageId: 'reply-1',
    };
    const options = messagesOptionsFor(intent, target);
    assert.equal(options.linkedConversationId, 'th-1');
    assert.deepEqual(options.linkedItemCreatedAt, { createdAt: 40 });
    assert.equal(options.notificationTargetMessageId, 'reply-1');
  });

  it('seeds around-query from snapshot when the locked target has no createdAt', (): void => {
    const intent = mustParse({
      channelId: 'ch-1',
      threadId: 'th-1',
      messageId: 'reply-1',
      source: 'notification',
    });
    const options = messagesOptionsFor(
      intent,
      { kind: 'anchor', conversationId: 'th-1', createdAt: 0, messageId: 'reply-1' },
      90,
    );
    assert.deepEqual(options.linkedItemCreatedAt, { createdAt: 90 });
    assert.equal(options.notificationTargetMessageId, 'reply-1');
  });

  it('uses a resolved intent cursor when the locked target is still pending', (): void => {
    const intent = mustParse({
      channelId: 'ch-1',
      threadId: 'th-1',
      messageId: 'reply-1',
      source: 'notification',
    });
    const resolved = {
      ...intent,
      hint: { ...intent.hint, createdAt: 90 },
    };
    const options = messagesOptionsFor(
      resolved,
      { kind: 'anchor', conversationId: 'th-1', createdAt: 0, messageId: 'reply-1' },
      90,
    );
    assert.deepEqual(options.linkedItemCreatedAt, { createdAt: 90 });
  });

  it('prefers a locked target cursor over a snapshot cursor', (): void => {
    const intent = mustParse({
      channelId: 'ch-1',
      threadId: 'th-1',
      messageId: 'reply-1',
      createdAt: '40',
      source: 'notification',
    });
    const options = messagesOptionsFor(
      intent,
      { kind: 'anchor', conversationId: 'th-1', createdAt: 40, messageId: 'reply-1' },
      90,
    );
    assert.deepEqual(options.linkedItemCreatedAt, { createdAt: 40 });
  });
});

describe('createdAtFromSnapshotRows', (): void => {
  it('reads the notified message timestamp from cached rows', (): void => {
    assert.equal(
      createdAtFromSnapshotRows(
        [
          { messageId: 'other', createdAt: 10 },
          { messageId: 'reply-1', createdAt: 90 },
        ],
        'reply-1',
      ),
      90,
    );
    assert.equal(
      createdAtFromSnapshotRows([{ initialMessageId: 'm-1', createdAt: 40 }], 'm-1'),
      40,
    );
    assert.equal(createdAtFromSnapshotRows([{ messageId: 'reply-1' }], 'reply-1'), 0);
    assert.equal(createdAtFromSnapshotRows([], 'reply-1'), 0);
  });
});

describe('normalizeConversationWindow', (): void => {
  it('maps channel useMessages fields onto the §5.4 window', (): void => {
    const loadOlder = (): void => undefined;
    const retry = (): void => undefined;
    const window = normalizeConversationWindow(
      { kind: 'channel', channelId: 'ch-1', isMember: true },
      channelSource({
        messages: asConversations([{ conversationId: 'c1', createdAt: 1 }]),
        isInitialLoadComplete: true,
        hasReachedChannelStart: true,
        initialLoadError: 'boom',
        loadOlder,
        retryInitialLoad: retry,
      }),
    );
    assert.equal(window.conversations[0]?.conversationId, 'c1');
    assert.equal(window.isInitialLoadComplete, true);
    assert.equal(window.hasReachedStart, true);
    assert.equal(window.initialLoadError, 'boom');
    assert.equal(window.loadOlder, loadOlder);
    assert.equal(window.retry, retry);
  });

  it('treats a thread query as a complete unpaginated window', (): void => {
    const window = normalizeConversationWindow(
      { kind: 'thread', channelId: 'ch-1', conversationId: 'th-1', isMember: true },
      { messages: asConversations([{ messageId: 'm1', createdAt: 2 }]) },
    );
    assert.equal((window.conversations[0] as { messageId?: string }).messageId, 'm1');
    assert.equal(window.isInitialLoadComplete, true);
    assert.equal(window.hasReachedStart, true);
    assert.equal(window.initialLoadError, null);
    window.loadOlder();
    window.loadNewer();
    window.retry();
    const emptyThread = normalizeConversationWindow(
      { kind: 'thread', channelId: 'ch-1', conversationId: 'th-1', isMember: true },
      { messages: [] },
    );
    assert.equal(emptyThread.isInitialLoadComplete, false);
    assert.equal(emptyThread.hasReachedStart, false);
  });

  it('maps a null thread snapshot to a stable empty thread window', (): void => {
    const ref = {
      kind: 'thread' as const,
      channelId: 'ch-1',
      conversationId: 'th-1',
      isMember: true,
    };
    const first = normalizeConversationWindow(ref, null);
    const second = normalizeConversationWindow(ref, null);
    assert.equal(first, second);
    assert.deepEqual(first.conversations, []);
    assert.equal(first.isInitialLoadComplete, false);
    assert.equal(first.hasReachedStart, false);
  });

  it('treats two windows with the same field identities as equal', (): void => {
    const source = channelSource();
    const first = normalizeConversationWindow(
      { kind: 'channel', channelId: 'ch-1', isMember: true },
      source,
    );
    const second = normalizeConversationWindow(
      { kind: 'channel', channelId: 'ch-1', isMember: true },
      source,
    );
    assert.notEqual(first, second);
    assert.equal(isSameConversationWindow(first, second), true);
  });
});

describe('v3/data ownership rules (C4, B6)', (): void => {
  it('holds no message useState, copying effects, or second pending window', (): void => {
    const dataDir = join(fileURLToPath(new URL('../data', import.meta.url)));
    const files = readdirSync(dataDir).filter(name => name.endsWith('.ts'));
    assert.ok(files.length > 0);
    const forbidden = [
      'useState',
      'useEffect',
      'useLayoutEffect',
      'usePendingForChannel',
      'usePendingForThread',
      'subscribePending',
    ];
    for (const name of files) {
      const source = readFileSync(join(dataDir, name), 'utf8');
      for (const token of forbidden) {
        assert.equal(source.includes(token), false, `${name} must not contain ${token}`);
      }
    }
  });
});
