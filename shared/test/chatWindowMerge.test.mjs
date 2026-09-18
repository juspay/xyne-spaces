import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output on purpose — this is the module mobile and the
// dashboard resolve, so src/dist drift shows up here.
import {
  mergeConversationsWithLatest,
  mergeServerAndPendingConversations,
  mergeServerAndPendingThreadMessages,
  reconcileConversationWindow,
} from '../dist/messages/channelMessageMerge.js';

const conversation = (id, createdAt, initialMessageId = `m-${id}`) => ({
  conversationId: id,
  createdAt,
  initialMessageId,
});

const threadMessage = (messageId, createdAt) => ({ messageId, createdAt });

/**
 * A pending row and the server row that replaced it are the SAME message shown
 * twice: the pending row keeps its local conversation id until the send
 * settles, so matching only on `initialMessageId` (or only on conversation id)
 * leaves a duplicate on screen right after sending.
 */
test('pending rows are dropped once the server row arrives, by either identity', () => {
  const serverRows = [conversation('c1', 10, 'msg-1')];

  const samePendingConversation = mergeServerAndPendingConversations(serverRows, [
    conversation('c1', 11, 'other'),
  ]);
  assert.deepEqual(
    samePendingConversation.map(row => row.conversationId),
    ['c1'],
  );

  const samePendingMessage = mergeServerAndPendingConversations(serverRows, [
    conversation('pending-local', 11, 'msg-1'),
  ]);
  assert.deepEqual(
    samePendingMessage.map(row => row.conversationId),
    ['c1'],
  );
});

test('an unrelated pending row is kept and sorted by createdAt', () => {
  const merged = mergeServerAndPendingConversations(
    [conversation('c1', 10, 'msg-1')],
    [conversation('pending-local', 20, 'msg-2')],
  );
  assert.deepEqual(
    merged.map(row => row.conversationId),
    ['c1', 'pending-local'],
  );
});

/**
 * Thread replies share one conversation id, so message identity is the only
 * valid render key — using the conversation id would delete every pending
 * reply as soon as any server message for that thread arrived.
 */
test('thread pending rows dedupe by messageId and keep the root first', () => {
  const merged = mergeServerAndPendingThreadMessages(
    [threadMessage('root', 100), threadMessage('reply-1', 110)],
    [threadMessage('reply-1', 111), threadMessage('reply-2', 120)],
  );
  assert.deepEqual(
    merged.map(message => message.messageId),
    ['root', 'reply-1', 'reply-2'],
  );
});

/**
 * Zero re-emits the viewport query on unrelated upstream deltas, and a
 * `complete` emission can be empty before the server diff lands. Treating that
 * as "the channel is empty" blanks an open chat.
 */
test('an empty viewport emission leaves the current window untouched', () => {
  const current = [conversation('c1', 10), conversation('c2', 20)];
  assert.equal(reconcileConversationWindow(current, []), current);
});

test('a viewport emission prunes only inside its own key range', () => {
  const current = [
    conversation('c0', 5),
    conversation('c1', 10),
    conversation('c2', 20),
    conversation('c3', 30),
    conversation('c4', 40),
  ];
  // The emission covers [10, 30] and no longer contains c2, so c2 was deleted.
  // c0 and c4 fall outside that range and must survive untouched.
  const reconciled = reconcileConversationWindow(current, [
    conversation('c1', 10),
    conversation('c3', 30),
  ]);
  assert.deepEqual(
    reconciled.map(row => row.conversationId),
    ['c0', 'c1', 'c3', 'c4'],
  );
});

/**
 * Cold open: the latest tail resolves before the complete page. Without opt-in
 * promotion the list must stay empty (dashboard behavior); with it, the tail
 * paints immediately.
 */
test('latest tail is promoted on an empty window only when opted in', () => {
  const latest = [conversation('c9', 90)];

  const withoutOptIn = mergeConversationsWithLatest([], latest, false);
  assert.deepEqual(withoutOptIn, { merged: [], latestClear: false });

  const withOptIn = mergeConversationsWithLatest([], latest, false, true);
  assert.equal(withOptIn.latestClear, true);
  assert.deepEqual(
    withOptIn.merged.map(row => row.conversationId),
    ['c9'],
  );
});

test('promotion opt-in does not change behavior once the window is populated', () => {
  const fetched = [conversation('c1', 10)];
  const latest = [conversation('c9', 90)];
  assert.deepEqual(
    mergeConversationsWithLatest(fetched, latest, true, true),
    mergeConversationsWithLatest(fetched, latest, true, false),
  );
});
