import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output on purpose, like the other tests here.
import {
  derivedNames,
  appsChatPostMessageClient,
  appsChatUpdateMessageClient,
  conversationsSendClient,
} from '../dist/enc-contracts/index.js';

test('apps postMessage asks for the same markdownText facts as conversations.send asks for content', () => {
  // Both end in the same message insert job: its side effects read derived.fields.content with
  // conversations.send's facts, so the two lists must not drift apart.
  assert.deepEqual(derivedNames(appsChatPostMessageClient), {
    markdownText: derivedNames(conversationsSendClient).content,
  });
  assert.ok(derivedNames(appsChatPostMessageClient).markdownText.includes('userIds'));
});

test('apps updateMessage still extracts nothing from markdownText', () => {
  assert.deepEqual(derivedNames(appsChatUpdateMessageClient), { markdownText: [] });
});
