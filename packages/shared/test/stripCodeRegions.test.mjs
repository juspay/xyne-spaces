import test from 'node:test';
import assert from 'node:assert/strict';

// Imports the BUILT output on purpose — this is the module the backend
// notification / automation / radar paths and the dashboard both resolve, so
// src/dist drift shows up here.
import {
  stripCodeRegions,
  extractUserMentions,
} from '../dist/utils/mentionParser.js';

const SPAN =
  '<span data-mention-type="user" data-user-id="cm1">@Bob</span>';

test('strips balanced <code>/<pre> regions', () => {
  assert.equal(extractUserMentions(`<code>${SPAN}</code>`).length, 0);
  assert.equal(extractUserMentions(`<pre>${SPAN}</pre>`).length, 0);
});

test('strips UNCLOSED code/pre openers to end-of-string (DOM parity)', () => {
  // The DOM renderer auto-closes the tag and flattens the mention to inert
  // text, so extraction must not notify either — no notify-without-chip drift.
  assert.equal(extractUserMentions(`<code>${SPAN}`).length, 0);
  assert.equal(extractUserMentions(`<pre>${SPAN}`).length, 0);
});

test('strips MISMATCHED code..</pre> region', () => {
  assert.equal(extractUserMentions(`<code>${SPAN}</pre>`).length, 0);
});

test('preserves real mentions outside code', () => {
  assert.equal(extractUserMentions(`hi ${SPAN} ok`).length, 1);
  // A closed code block does not swallow a later, real mention.
  assert.equal(extractUserMentions(`<code>x</code> ${SPAN}`).length, 1);
  // A mention BEFORE a dangling opener stays; only the opener→EOF is stripped.
  assert.equal(extractUserMentions(`${SPAN} <code>y`).length, 1);
});

test('is linear-time on pathological unterminated openers (no ReDoS)', () => {
  const evil = '<pre'.repeat(80000);
  const started = Date.now();
  stripCodeRegions(evil);
  assert.ok(Date.now() - started < 1000);
});
