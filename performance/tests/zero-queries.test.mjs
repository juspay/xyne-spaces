import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ZERO_QUERY_CATALOG,
  buildTransformMessage,
  isTransformFailure,
  selectQueries,
  transformEntries,
} from '../k6/zero-queries.mjs';

const user = {
  userId: 'user-1',
  token: 'token-1',
  workspaceId: 'workspace-1',
  conversationId: 'conversation-1',
};

test('every catalogued query names a real backend query and its fixture needs', () => {
  assert.ok(ZERO_QUERY_CATALOG.length >= 3);
  for (const descriptor of ZERO_QUERY_CATALOG) {
    assert.equal(typeof descriptor.name, 'string');
    assert.ok(Array.isArray(descriptor.requires));
    assert.equal(typeof descriptor.args, 'function');
  }
});

test('selects only the queries the fixture identity can satisfy', () => {
  const names = selectQueries(user).map(({ name }) => name);

  assert.ok(names.includes('conversationMessagesV2'));
  assert.ok(names.includes('allTickets'));
  assert.ok(
    !names.includes('channelConversationsV2'),
    'a channel query needs a channelId the fixture did not supply',
  );
});

test('includes channel reads once the fixture supplies a channelId', () => {
  const names = selectQueries({ ...user, channelId: 'channel-1' }).map(({ name }) => name);
  assert.ok(names.includes('channelConversationsV2'));
});

test('wraps the batch in the transform tuple the endpoint parses', () => {
  // zero-protocol/src/custom-queries.js:
  //   tuple([literal('transform'), array({id, name, args: array(json)})])
  const message = buildTransformMessage(
    [ZERO_QUERY_CATALOG.find(({ name }) => name === 'conversationMessagesV2')],
    user,
  );

  assert.deepEqual(message, [
    'transform',
    [
      {
        id: 'conversationMessagesV2-0',
        name: 'conversationMessagesV2',
        args: [{ conversationId: 'conversation-1' }],
      },
    ],
  ]);
});

test('array-wraps each query argument, because the server reads args[0]', () => {
  // zero-server/src/queries/process-queries.js: handler(name, args[0])
  const [, queries] = buildTransformMessage(selectQueries(user), user);
  for (const query of queries) {
    assert.ok(Array.isArray(query.args));
    assert.equal(query.args.length, 1);
    assert.equal(typeof query.args[0], 'object');
  }
});

test('gives every query in a batch a distinct id', () => {
  const [, queries] = buildTransformMessage(selectQueries(user), user);
  assert.equal(new Set(queries.map(({ id }) => id)).size, queries.length);
});

test('reads the per-query entries out of a QueryResponse', () => {
  assert.deepEqual(
    transformEntries({ kind: 'QueryResponse', queries: [{ id: 'a', name: 'n', ast: {} }] }),
    [{ id: 'a', name: 'n', ast: {} }],
  );
  assert.equal(transformEntries(undefined), undefined);
  assert.equal(transformEntries({ kind: 'TransformFailed' }), undefined);
});

test('recognises a TransformFailed body, which the endpoint returns with HTTP 200', () => {
  assert.equal(
    isTransformFailure({ kind: 'TransformFailed', reason: 'parse', message: 'bad' }),
    true,
  );
  assert.equal(isTransformFailure({ kind: 'QueryResponse', queries: [] }), false);
  assert.equal(isTransformFailure(undefined), false);
});
