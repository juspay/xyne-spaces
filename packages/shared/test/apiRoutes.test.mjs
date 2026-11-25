import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

// Imports the BUILT output on purpose, like the other tests here.
import { API, defineRoute, routeContracts, routeSpecProblems, sourceFieldNames } from '../dist/enc-contracts/index.js';

// defineRoute does not throw (a bad spec must not stop the backend from starting): this is
// where a bad contract is caught.
test('every route contract in the API table is well formed', () => {
  const contracts = routeContracts(API);
  assert.ok(contracts.length > 0);
  for (const contract of contracts) {
    assert.deepEqual(routeSpecProblems(contract), [], contract.key);
    assert.equal(contract.key, `${contract.method} ${contract.path}`);
  }
});

test('no two contracts in the API table share a method and path', () => {
  const keys = routeContracts(API).map((c) => c.key);
  assert.deepEqual(keys, [...new Set(keys)]);
});

test('routeSpecProblems catches bad specs', () => {
  const base = { response: z.object({}) };
  assert.ok(routeSpecProblems({ ...base, method: 'HEAD', path: '/x' }).length > 0);
  assert.ok(routeSpecProblems({ ...base, method: 'ALL', path: '/x' }).length > 0);
  assert.ok(routeSpecProblems({ ...base, method: 'GET', path: '/x/' }).length > 0);
  assert.ok(routeSpecProblems({ ...base, method: 'GET', path: '/api/x' }).length > 0);
  assert.ok(routeSpecProblems({ ...base, method: 'GET', path: 'x' }).length > 0);
  assert.ok(routeSpecProblems({ ...base, method: 'GET', path: '/x/*' }).length > 0);
  assert.deepEqual(routeSpecProblems({ ...base, method: 'GET', path: '/x/:id' }), []);
});

test('apps chat routes: the encrypted fields are fields of the body, as the manifest rules list them', () => {
  const { postMessage, updateMessage } = API.apps.chat;
  assert.equal(postMessage.key, 'POST /apps/chat/postMessage');
  assert.equal(updateMessage.key, 'POST /apps/chat/updateMessage');
  assert.deepEqual(sourceFieldNames(postMessage.encryption), ['markdownText']);
  assert.deepEqual(sourceFieldNames(updateMessage.encryption), ['markdownText']);
  // The encryption contract's own field list (what the encryption service compares with the
  // rule) is unchanged: the body schema only adds fields around it.
  assert.deepEqual(Object.keys(postMessage.encryption.schema.shape).sort(), [
    'attachments', 'channelId', 'channelName', 'conversationId', 'flow', 'markdownText', 'text',
  ]);
});

test('apps postEphemeral: markdownText encrypted, nothing derived, fields as its manifest rule lists them', () => {
  const route = API.apps.chat.postEphemeral;
  assert.equal(route.key, 'POST /apps/chat/postEphemeral');
  assert.deepEqual(sourceFieldNames(route.encryption), ['markdownText']);
  assert.deepEqual(route.encryption.sourceToDerived, { markdownText: {} });
  // Must equal the fields of the private rule (enc_contract_entries, POST /apps/chat/postEphemeral).
  assert.deepEqual(Object.keys(route.encryption.schema.shape).sort(), [
    'attachments', 'channelId', 'channelName', 'conversationId', 'flow', 'markdownText', 'messageDelivery', 'text', 'user',
  ]);
});

test('apps postEphemeral body keeps the controller checks', () => {
  const body = API.apps.chat.postEphemeral.body;
  assert.equal(body.safeParse({ channelId: 'c1', text: 'hi' }).success, false, 'no user');
  assert.equal(body.safeParse({ channelId: 'c1', user: 'u1', text: 'hi', messageDelivery: 'OPENSCREEN' }).success, false, 'popup without flow');
  const ok = body.safeParse({ channelId: 'c1', user: ' u1 ', markdownText: 'hi' });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data, { channelId: 'c1', user: 'u1', markdownText: 'hi', messageDelivery: 'EPHEMERAL' });
});

test('apps deleteMessage and agentProgress: typed, no encryption contract', () => {
  const { deleteMessage, agentProgress } = API.apps.chat;
  assert.equal(deleteMessage.key, 'POST /apps/chat/deleteMessage');
  assert.equal(agentProgress.key, 'POST /apps/chat/agentProgress');
  assert.equal(deleteMessage.encryption, undefined);
  assert.equal(agentProgress.encryption, undefined);
});

test('apps deleteMessage and agentProgress bodies keep the controller checks', () => {
  const del = API.apps.chat.deleteMessage.body;
  assert.equal(del.safeParse({ messageId: 'm1' }).success, false, 'no channel');
  assert.equal(del.safeParse({ channelId: 'c1' }).success, false, 'no messageId');
  assert.deepEqual(del.safeParse({ messageId: ' m1 ', channelName: 'general' }).data, { messageId: 'm1', channelName: 'general' });

  const progress = API.apps.chat.agentProgress.body;
  assert.equal(progress.safeParse({ channelId: 'c1' }).success, false, 'no conversationId');
  assert.equal(progress.safeParse({ conversationId: 'cv1', status: 'paused' }).success, false, 'unknown status');
  assert.deepEqual(progress.safeParse({ conversationId: 'cv1' }).data, { conversationId: 'cv1', status: 'working' });
});

test('apps postMessage body keeps the controller checks', () => {
  const body = API.apps.chat.postMessage.body;
  assert.equal(body.safeParse({ channelId: 'c1' }).success, false, 'no content');
  assert.equal(body.safeParse({ text: 'hi' }).success, false, 'no channel');
  const ok = body.safeParse({ channelId: ' c1 ', text: 'hi', unknown: 1 });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data, { channelId: 'c1', text: 'hi' });
});

test('defineRoute keeps the spec', () => {
  const route = defineRoute({ method: 'GET', path: '/t/:id', response: z.object({ id: z.string() }) });
  assert.equal(route.kind, 'ROUTE');
  assert.equal(route.key, 'GET /t/:id');
  assert.equal(route.encryption, undefined);
});
