import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';

// Imports the BUILT output on purpose, like the other tests here.
import {
  UnreadableString,
  reveal,
  makeUnreadable,
  replyToConversationClient,
  conversationsSendClient,
} from '../dist/enc-contracts/index.js';

test('an UnreadableString shows nothing through any way of printing it', () => {
  const s = UnreadableString.make('hunter2');
  assert.equal(String(s), '<redacted>');
  assert.equal(`${s}`, '<redacted>');
  assert.equal(s + '', '<redacted>');
  assert.equal(JSON.stringify({ s }), '{"s":"<redacted>"}');
  assert.equal(inspect(s), 'UnreadableString(<redacted>)');
  assert.equal(inspect({ nested: { s } }), '{ nested: { s: UnreadableString(<redacted>) } }');
  assert.deepEqual(Object.keys(s), []);
  assert.deepEqual({ ...s }, {});
  assert.ok(!JSON.stringify(structuredClone({ ...s })).includes('hunter2'));
});

test('reveal returns the value and rejects anything that is not an UnreadableString', () => {
  assert.equal(reveal(UnreadableString.make('hunter2')), 'hunter2');
  assert.throws(() => reveal('hunter2'), TypeError);
  assert.throws(() => reveal({ toString: () => '<redacted>' }), TypeError);
});

test('contracts list their unreadable fields, through .optional() too', () => {
  assert.deepEqual(replyToConversationClient.unreadableFields, ['content']);
  assert.deepEqual(conversationsSendClient.unreadableFields, ['content']);
});

test('makeUnreadable wraps only the unreadable fields and leaves the input untouched', () => {
  const body = { content: 'hello', msgType: 'USER', showInChannel: 'true' };
  const wrapped = makeUnreadable(replyToConversationClient, body);
  assert.ok(wrapped.content instanceof UnreadableString);
  assert.equal(reveal(wrapped.content), 'hello');
  assert.equal(wrapped.msgType, 'USER');
  assert.equal(wrapped.showInChannel, 'true');
  assert.equal(body.content, 'hello');
  assert.equal(JSON.stringify(wrapped), '{"content":"<redacted>","msgType":"USER","showInChannel":"true"}');
});

test('makeUnreadable keeps absent fields absent and does not wrap twice', () => {
  assert.equal(makeUnreadable(replyToConversationClient, {}).content, undefined);
  const once = makeUnreadable(replyToConversationClient, { content: '' });
  assert.equal(reveal(once.content), '');
  assert.equal(makeUnreadable(replyToConversationClient, once).content, once.content);
});

test('the contract schema still validates the plain body', () => {
  assert.ok(replyToConversationClient.schema.safeParse({ content: 'hello' }).success);
  assert.ok(!replyToConversationClient.schema.safeParse({ content: 42 }).success);
});
