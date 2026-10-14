import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSearchHighlightSegments,
  collapseSegmentsToPlainText,
} from '@/src/utils/searchHighlight';

describe('buildSearchHighlightSegments', () => {
  it('returns an empty array for nullish input', () => {
    assert.deepEqual(buildSearchHighlightSegments(null, 'x'), []);
    assert.deepEqual(buildSearchHighlightSegments(undefined, 'x'), []);
    assert.deepEqual(buildSearchHighlightSegments('', 'x'), []);
  });

  it('preserves backend <hi> highlights and ignores the query', () => {
    const segments = buildSearchHighlightSegments('foo <hi>bar</hi> baz', 'zzz');
    assert.deepEqual(segments, [
      { text: 'foo ', highlighted: false },
      { text: 'bar', highlighted: true },
      { text: ' baz', highlighted: false },
    ]);
  });

  it('adds case-insensitive exact-query highlights when no <hi> is present', () => {
    const segments = buildSearchHighlightSegments('Hello world', 'world');
    assert.deepEqual(segments, [
      { text: 'Hello ', highlighted: false },
      { text: 'world', highlighted: true },
    ]);
  });

  it('decodes html entities in the source text', () => {
    const segments = buildSearchHighlightSegments('a &amp; b', 'zzz');
    assert.equal(segments.length, 1);
    assert.equal(segments[0]?.text, 'a & b');
    assert.equal(segments[0]?.highlighted, false);
  });
});

describe('collapseSegmentsToPlainText', () => {
  it('joins segment text and normalizes whitespace', () => {
    assert.equal(
      collapseSegmentsToPlainText([
        { text: 'Hello ', highlighted: false },
        { text: 'world', highlighted: true },
      ]),
      'Hello world',
    );
    assert.equal(
      collapseSegmentsToPlainText([
        { text: '  a  ', highlighted: false },
        { text: '  b ', highlighted: false },
      ]),
      'a b',
    );
  });
});
