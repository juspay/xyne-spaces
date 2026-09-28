import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MUTATOR_NAME,
  PUSH_VERSION,
  buildClientIdentity,
  buildMutatePath,
  buildPushBody,
  isPushFailure,
  mutationResults,
} from '../k6/zero-push.mjs';

test('pins the protocol constants read from the library source', () => {
  // zero-protocol/src/push.js -> pushVersion; replicache/src/sync/push.js asserts === 1
  assert.equal(PUSH_VERSION, 1);
  // zql/src/mutate/mutator-registry.js: getValueAtPath(registry, name, '.')
  assert.equal(MUTATOR_NAME, 'messages.send');
});

test('gives each virtual user its own client and group, so ids never collide', () => {
  const a = buildClientIdentity('run-1', 1);
  const b = buildClientIdentity('run-1', 2);

  assert.notEqual(a.clientID, b.clientID);
  assert.notEqual(a.clientGroupID, b.clientGroupID);
  assert.match(a.clientID, /run-1/);
  // Same VU in the same run must be stable, or mutation ids would restart mid-run.
  assert.deepEqual(buildClientIdentity('run-1', 1), a);
});

test('builds the querystring the endpoint parses', () => {
  // zero-protocol/src/mutate-server.js: mutateParamsSchema = { schema, appID }
  assert.equal(
    buildMutatePath({ schema: 'xyne', appID: 'zero' }),
    '/api/zero/push?schema=xyne&appID=zero',
  );
});

test('refuses to build a path without both required parameters', () => {
  assert.throws(() => buildMutatePath({ schema: 'xyne' }), /appID/);
  assert.throws(() => buildMutatePath({ appID: 'zero' }), /schema/);
});

test('builds a push body matching pushBodySchema', () => {
  const body = buildPushBody({
    clientGroupID: 'g1',
    clientID: 'c1',
    mutationId: 7,
    timestamp: 1700000000000,
    requestID: 'req-1',
    args: { conversationId: 'conv-1', content: 'hello', messageId: 'm1' },
  });

  assert.equal(body.clientGroupID, 'g1');
  assert.equal(body.pushVersion, 1);
  assert.equal(body.timestamp, 1700000000000);
  assert.equal(body.requestID, 'req-1');
  assert.equal(body.mutations.length, 1);

  const [mutation] = body.mutations;
  assert.equal(mutation.type, 'custom');
  assert.equal(mutation.id, 7);
  assert.equal(mutation.clientID, 'c1');
  assert.equal(mutation.name, 'messages.send');
  assert.equal(mutation.timestamp, 1700000000000);
  // customMutationSchema: args is an array of JSON
  assert.ok(Array.isArray(mutation.args));
  assert.equal(mutation.args.length, 1);
  assert.equal(mutation.args[0].conversationId, 'conv-1');
});

test('rejects a non-positive mutation id, which the server would treat as out of order', () => {
  const base = {
    clientGroupID: 'g', clientID: 'c', timestamp: 1, requestID: 'r',
    args: { conversationId: 'c1', content: 'x', messageId: 'm' },
  };
  assert.throws(() => buildPushBody({ ...base, mutationId: 0 }), /mutation id/i);
  assert.throws(() => buildPushBody({ ...base, mutationId: -1 }), /mutation id/i);
});

test('reads per-mutation results out of a MutateResponse', () => {
  assert.deepEqual(
    mutationResults({ kind: 'MutateResponse', mutations: [{ id: { id: 1, clientID: 'c' }, result: {} }] }),
    [{ id: { id: 1, clientID: 'c' }, result: {} }],
  );
  assert.equal(mutationResults({ kind: 'PushFailed' }), undefined);
  assert.equal(mutationResults(undefined), undefined);
});

test('recognises a PushFailed body, which can arrive with HTTP 200', () => {
  assert.equal(isPushFailure({ kind: 'PushFailed', reason: 'parse', message: 'bad' }), true);
  assert.equal(isPushFailure({ kind: 'MutateResponse', mutations: [] }), false);
  assert.equal(isPushFailure(undefined), false);
});
