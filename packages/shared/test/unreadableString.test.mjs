import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';

// Imports the BUILT output on purpose, like the other tests here.
import {
  UnreadableString,
  reveal,
  makeUnreadable,
  mutatorContracts,
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
  assert.deepEqual(mutatorContracts['conversations.send'].unreadableFields, ['content']);
  assert.deepEqual(mutatorContracts['messages.update'].unreadableFields, ['content']);
});

test('makeUnreadable wraps only the unreadable fields and leaves the input untouched', () => {
  const body = { messageId: 'm1', content: 'hello' };
  const wrapped = makeUnreadable(mutatorContracts['messages.update'], body);
  assert.ok(wrapped.content instanceof UnreadableString);
  assert.equal(reveal(wrapped.content), 'hello');
  assert.equal(wrapped.messageId, 'm1');
  assert.equal(body.content, 'hello');
  assert.equal(JSON.stringify(wrapped), '{"messageId":"m1","content":"<redacted>"}');
});

test('makeUnreadable keeps absent fields absent and does not wrap twice', () => {
  const contract = mutatorContracts['messages.update'];
  assert.equal(makeUnreadable(contract, {}).content, undefined);
  const once = makeUnreadable(contract, { content: '' });
  assert.equal(reveal(once.content), '');
  assert.equal(makeUnreadable(contract, once).content, once.content);
});

test('the contract schema still validates the plain body', () => {
  const { schema } = mutatorContracts['messages.update'];
  assert.ok(schema.safeParse({ messageId: 'm1', content: 'hello' }).success);
  assert.ok(!schema.safeParse({ messageId: 'm1', content: 42 }).success);
});
