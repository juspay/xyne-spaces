import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { activeMention, insertMention } from '@/src/features/xyne-ai/model/mentionTrigger';

describe('activeMention', () => {
  it('finds a trigger at the start of the text', () => {
    assert.deepEqual(activeMention('@', 1), { indicator: '@', query: '', start: 0 });
    assert.deepEqual(activeMention('#gen', 4), { indicator: '#', query: 'gen', start: 0 });
  });

  it('finds a trigger after whitespace', () => {
    assert.deepEqual(activeMention('ask @jo', 7), { indicator: '@', query: 'jo', start: 4 });
    assert.deepEqual(activeMention('a\n#x', 4), { indicator: '#', query: 'x', start: 2 });
  });

  it('ignores an indicator inside a word', () => {
    assert.equal(activeMention('a@b', 3), null);
    assert.equal(activeMention('issue#12', 8), null);
  });

  it('ends at whitespace before the cursor', () => {
    assert.equal(activeMention('@john smith', 11), null);
    assert.equal(activeMention('plain text', 10), null);
  });

  it('reads only up to the cursor', () => {
    assert.deepEqual(activeMention('hi @jo and more', 5), { indicator: '@', query: 'j', start: 3 });
  });

  it('gives up on a query that is too long', () => {
    assert.equal(activeMention(`@${'a'.repeat(41)}`, 42), null);
  });
});

describe('insertMention', () => {
  it('replaces the trigger with the label and a space', () => {
    const trigger = { indicator: '@', query: 'jo', start: 4 } as const;
    assert.deepEqual(insertMention('ask @jo', trigger, 7, 'John Doe'), {
      text: 'ask @John Doe ',
      cursor: 14,
    });
  });

  it('keeps the text after the cursor', () => {
    const trigger = { indicator: '#', query: 'ge', start: 0 } as const;
    assert.deepEqual(insertMention('#ge about this', trigger, 3, 'general'), {
      text: '#general about this',
      cursor: 9,
    });
  });

  it('replaces the whole word when the cursor is inside it', () => {
    const trigger = { indicator: '@' as const, query: 'jo', start: 3 };
    assert.deepEqual(insertMention('hi @john there', trigger, 6, 'John Doe'), {
      text: 'hi @John Doe there',
      cursor: 13,
    });
  });
});
