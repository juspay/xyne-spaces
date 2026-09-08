import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output on purpose — this is the module the Spaces backend
// notification path resolves, so src/dist drift shows up here.
import { extractUserMentions, extractGroupMentions } from '../dist/utils/mentionParser.js';

const userSpan = (id) =>
  `<span data-mention data-mention-type="user" data-user-id="${id}">@Juspay</span>`;
const groupSpan = (id) =>
  `<span data-mention data-mention-type="group" data-group-id="${id}">#team</span>`;

test('extractUserMentions returns a real mention outside code', () => {
  assert.deepEqual(extractUserMentions(`<p>hey ${userSpan('u1')}</p>`), ['u1']);
});

test('extractUserMentions ignores a mention nested inside a code block', () => {
  const html = `<pre><code>guruprasad.bhosale${userSpan('u1')}.in</code></pre>`;
  assert.deepEqual(extractUserMentions(html), []);
});

test('extractUserMentions ignores a mention inside inline code', () => {
  const html = `<p>run <code>${userSpan('u1')}</code></p>`;
  assert.deepEqual(extractUserMentions(html), []);
});

test('extractUserMentions still fires for mentions outside code when code is also present', () => {
  const html = `<p>${userSpan('u1')}</p><pre><code>${userSpan('u2')}</code></pre>`;
  assert.deepEqual(extractUserMentions(html), ['u1']);
});

test('extractGroupMentions ignores a group mention inside a code block', () => {
  const html = `<pre><code>${groupSpan('g1')}</code></pre>`;
  assert.deepEqual(extractGroupMentions(html), []);
});
