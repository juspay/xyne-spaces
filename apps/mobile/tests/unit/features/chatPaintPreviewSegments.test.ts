import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPlainTextPreviewSegments,
  ensureSpacingBetweenAdjacentMentions,
} from '@/src/features/chat/v2/paint/chatPaintPreviewSegments';

type Segments = Parameters<typeof ensureSpacingBetweenAdjacentMentions>[0];

const asSegments = (value: unknown): Segments => value as Segments;

describe('buildPlainTextPreviewSegments', () => {
  it('returns an empty array for empty text', () => {
    assert.deepEqual(buildPlainTextPreviewSegments(''), []);
  });

  it('keeps plain text without tokens as a single text segment', () => {
    assert.deepEqual(buildPlainTextPreviewSegments('hello world'), [
      { text: 'hello world', kind: 'text' },
    ]);
  });

  it('splits out an http link as a link segment', () => {
    assert.deepEqual(buildPlainTextPreviewSegments('see https://x.com now'), [
      { text: 'see ', kind: 'text' },
      { text: 'https://x.com', kind: 'link' },
      { text: ' now', kind: 'text' },
    ]);
  });

  it('splits out a user mention as a mention segment', () => {
    assert.deepEqual(buildPlainTextPreviewSegments('hi @alice'), [
      { text: 'hi ', kind: 'text' },
      { text: '@alice', kind: 'mention' },
    ]);
  });

  it('marks broadcast mentions as mentionsYou', () => {
    assert.deepEqual(buildPlainTextPreviewSegments('@channel'), [
      { text: '@channel', kind: 'mention', mentionsYou: true },
    ]);
  });
});

describe('ensureSpacingBetweenAdjacentMentions', () => {
  it('inserts a spacer between two adjacent mentions', () => {
    const result = ensureSpacingBetweenAdjacentMentions(
      asSegments([
        { text: '@a', kind: 'mention' },
        { text: '@b', kind: 'mention' },
      ]),
    );
    assert.deepEqual(result, [
      { text: '@a', kind: 'mention' },
      { text: ' ', kind: 'text' },
      { text: '@b', kind: 'mention' },
    ]);
  });

  it('inserts a spacer between a mention and glued text', () => {
    const result = ensureSpacingBetweenAdjacentMentions(
      asSegments([
        { text: '@a', kind: 'mention' },
        { text: 'hello', kind: 'text' },
      ]),
    );
    assert.deepEqual(result, [
      { text: '@a', kind: 'mention' },
      { text: ' ', kind: 'text' },
      { text: 'hello', kind: 'text' },
    ]);
  });

  it('does not insert a spacer before whitespace or punctuation', () => {
    const leadingSpace = ensureSpacingBetweenAdjacentMentions(
      asSegments([
        { text: '@a', kind: 'mention' },
        { text: ' rest', kind: 'text' },
      ]),
    );
    assert.equal(leadingSpace.length, 2);

    const punctuation = ensureSpacingBetweenAdjacentMentions(
      asSegments([
        { text: '@a', kind: 'mention' },
        { text: ', rest', kind: 'text' },
      ]),
    );
    assert.equal(punctuation.length, 2);
  });
});
