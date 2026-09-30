import test from 'node:test';
import assert from 'node:assert/strict';

import { nextBallotOptionIds } from '../dist/polls/index.js';

test('single choice replaces the previous selection and can be deselected', () => {
  assert.deepEqual(nextBallotOptionIds(['a'], 'b', true, false), ['b']);
  assert.deepEqual(nextBallotOptionIds(['a'], 'a', false, false), []);
});

test('multiple choice toggles independently without duplicate IDs', () => {
  assert.deepEqual(nextBallotOptionIds(['a'], 'b', true, true), ['a', 'b']);
  assert.deepEqual(nextBallotOptionIds(['a', 'b'], 'a', false, true), ['b']);
  assert.deepEqual(nextBallotOptionIds(['a', 'b'], 'b', true, true), ['a', 'b']);
});
