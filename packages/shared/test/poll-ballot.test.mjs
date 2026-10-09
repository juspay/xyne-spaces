import test from 'node:test';
import assert from 'node:assert/strict';

import { nextBallotOptionIds } from '../dist/polls/index.js';

test('single choice replaces the previous selection and can be deselected', () => {
  assert.deepEqual(nextBallotOptionIds(['a'], 'b', true, 'SINGLE_CHOICE'), ['b']);
  assert.deepEqual(nextBallotOptionIds(['a'], 'a', false, 'SINGLE_CHOICE'), []);
});

test('multiple choice toggles independently without duplicate IDs', () => {
  assert.deepEqual(nextBallotOptionIds(['a'], 'b', true, 'MULTIPLE_CHOICE'), ['a', 'b']);
  assert.deepEqual(nextBallotOptionIds(['a', 'b'], 'a', false, 'MULTIPLE_CHOICE'), ['b']);
  assert.deepEqual(nextBallotOptionIds(['a', 'b'], 'b', true, 'MULTIPLE_CHOICE'), ['a', 'b']);
});
