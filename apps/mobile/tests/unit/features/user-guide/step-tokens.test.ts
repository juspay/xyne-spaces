import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  extractStepIconKeys,
  parseStepTokens,
  stripStepTokens,
} from '@/src/features/user-guide/step-tokens';
import { feedbackStorageKey, isGuideFeedback } from '@/src/features/user-guide/guide-feedback-core';

describe('parseStepTokens', () => {
  it('splits text and icon tokens in order', () => {
    assert.deepEqual(parseStepTokens('Tap [[Plus]] then "Camera".'), [
      { type: 'text', value: 'Tap ' },
      { type: 'icon', value: 'Plus' },
      { type: 'text', value: ' then "Camera".' },
    ]);
  });

  it('returns a single text segment when there are no tokens', () => {
    assert.deepEqual(parseStepTokens('Tap send.'), [{ type: 'text', value: 'Tap send.' }]);
  });

  it('handles adjacent tokens and tokens at the edges', () => {
    assert.deepEqual(parseStepTokens('[[A]][[B]] end'), [
      { type: 'icon', value: 'A' },
      { type: 'icon', value: 'B' },
      { type: 'text', value: ' end' },
    ]);
  });

  it('leaves unbalanced brackets as text', () => {
    assert.deepEqual(parseStepTokens('Tap [[Plus then go'), [
      { type: 'text', value: 'Tap [[Plus then go' },
    ]);
  });
});

describe('extractStepIconKeys', () => {
  it('lists every icon key in a step', () => {
    assert.deepEqual(extractStepIconKeys('Tap [[StartThread]] or [[SendToChannel]].'), [
      'StartThread',
      'SendToChannel',
    ]);
  });
});

describe('stripStepTokens', () => {
  it('replaces tokens with their key for accessibility labels', () => {
    assert.equal(stripStepTokens('Tap [[Plus]] to attach.'), 'Tap Plus to attach.');
  });
});

describe('guide feedback', () => {
  it('namespaces storage keys per guide', () => {
    assert.equal(feedbackStorageKey('gestures'), 'lotus.user-guide.feedback.gestures');
  });

  it('only accepts yes or no', () => {
    assert.equal(isGuideFeedback('yes'), true);
    assert.equal(isGuideFeedback('no'), true);
    assert.equal(isGuideFeedback('maybe'), false);
    assert.equal(isGuideFeedback(null), false);
  });
});
