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
 * A pending row and the server row that replaced it are the same message: the
 * pending row keeps its local conversation id until the send settles, so
 * matching on only one identity leaves a duplicate on screen after sending.
 */
test('a pending row is dropped once the server row arrives, by either identity', () => {
  const serverRows = [conversation('c1', 10, 'msg-1')];

  assert.deepEqual(
    mergeServerAndPendingConversations(serverRows, [conversation('c1', 11, 'other')]).map(
      row => row.conversationId,
    ),
    ['c1'],
  );
  assert.deepEqual(
    mergeServerAndPendingConversations(serverRows, [conversation('local', 11, 'msg-1')]).map(
      row => row.conversationId,
    ),
    ['c1'],
  );
});

test('an unrelated pending row is kept and sorted by createdAt', () => {
  const merged = mergeServerAndPendingConversations(
    [conversation('c1', 10, 'msg-1')],
    [conversation('local', 20, 'msg-2')],
  );
  assert.deepEqual(
    merged.map(row => row.conversationId),
    ['c1', 'local'],
  );
});

/**
 * Thread replies share one conversation id, so message identity is the only
 * valid render key; the server copy wins and the root stays first.
 */
test('thread pending rows dedupe by messageId, server wins, root stays first', () => {
  const serverReply = threadMessage('reply-1', 110);
  const merged = mergeServerAndPendingThreadMessages(
    [threadMessage('root', 100), serverReply],
    [threadMessage('reply-1', 111), threadMessage('reply-2', 120)],
    'root',
  );
  assert.deepEqual(
    merged.map(message => message.messageId),
    ['root', 'reply-1', 'reply-2'],
  );
  assert.equal(merged[1], serverReply);
});

/**
 * Zero re-emits the viewport query on unrelated deltas and can emit `complete`
 * before the server diff lands. An empty emission is not evidence the channel
 * is empty and must not blank an open chat.
 */
test('an empty viewport emission leaves the window untouched', () => {
  const current = [conversation('c1', 10), conversation('c2', 20)];
  assert.equal(reconcileConversationWindow(current, []), current);
});

test('a viewport emission prunes only inside the range it covers', () => {
  const current = [
    conversation('c0', 5),
    conversation('c1', 10),
    conversation('c2', 20),
    conversation('c3', 30),
    conversation('c4', 40),
  ];
  // The emission covers [10, 30] without c2, so c2 was deleted; c0 and c4 sit
  // outside the range and must survive.
  const reconciled = reconcileConversationWindow(current, [
    conversation('c1', 10),
    conversation('c3', 30),
  ]);
  assert.deepEqual(
    reconciled.map(row => row.conversationId),
    ['c0', 'c1', 'c3', 'c4'],
  );
});

test('the latest tail fills an empty window only when promotion is opted in', () => {
  const latest = [conversation('c9', 90)];

  assert.deepEqual(mergeConversationsWithLatest([], latest, false), {
    merged: [],
    latestClear: false,
  });

  const promoted = mergeConversationsWithLatest([], latest, false, true);
  assert.equal(promoted.latestClear, true);
  assert.deepEqual(
    promoted.merged.map(row => row.conversationId),
    ['c9'],
  );
});

test('promotion changes nothing once the window is populated', () => {
  const fetched = [conversation('c1', 10)];
  const latest = [conversation('c9', 90)];
  assert.deepEqual(
    mergeConversationsWithLatest(fetched, latest, true, true),
    mergeConversationsWithLatest(fetched, latest, true, false),
  );
});
