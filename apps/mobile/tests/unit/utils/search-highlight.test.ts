import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchHighlightSegments,
  collapseSegmentsToPlainText,
  type HighlightSegment,
} from '@/src/utils/searchHighlight';

function segments(actual: HighlightSegment[]): Array<{ text: string; highlighted: boolean }> {
  return actual.map(s => ({ text: s.text, highlighted: s.highlighted }));
}

test('buildSearchHighlightSegments: returns empty for null/undefined/empty', () => {
  assert.deepEqual(buildSearchHighlightSegments(null, 'query'), []);
  assert.deepEqual(buildSearchHighlightSegments(undefined, 'query'), []);
  assert.deepEqual(buildSearchHighlightSegments('', 'query'), []);
});

test('buildSearchHighlightSegments: plain text without query match → all non-highlighted', () => {
  const result = buildSearchHighlightSegments('hello world', 'foo');
  assert.deepEqual(segments(result), [{ text: 'hello world', highlighted: false }]);
});

test('buildSearchHighlightSegments: highlights exact query match case-insensitively', () => {
  const result = buildSearchHighlightSegments('Hello WORLD', 'world');
  assert.deepEqual(segments(result), [
    { text: 'Hello ', highlighted: false },
    { text: 'WORLD', highlighted: true },
  ]);
});

test('buildSearchHighlightSegments: highlights multiple query matches', () => {
  const result = buildSearchHighlightSegments('cat and cat', 'cat');
  assert.deepEqual(segments(result), [
    { text: 'cat', highlighted: true },
    { text: ' and ', highlighted: false },
    { text: 'cat', highlighted: true },
  ]);
});

test('buildSearchHighlightSegments: empty query returns non-highlighted text', () => {
  const result = buildSearchHighlightSegments('hello', '');
  assert.deepEqual(segments(result), [{ text: 'hello', highlighted: false }]);
});

test('buildSearchHighlightSegments: preserves backend <hi> tags as highlighted', () => {
  const result = buildSearchHighlightSegments('<hi>important</hi> text', 'foo');
  assert.deepEqual(segments(result), [
    { text: 'important', highlighted: true },
    { text: ' text', highlighted: false },
  ]);
});

test('buildSearchHighlightSegments: <hi> highlights take precedence over query matching', () => {
  const result = buildSearchHighlightSegments('<hi>cat</hi> and cat', 'cat');
  // When <hi> is present, query matching is skipped for non-highlighted segments
  assert.ok(result.some(s => s.text === 'cat' && s.highlighted));
  // The second "cat" should not be highlighted by query since <hi> is present
  const nonHighlighted = result.filter(s => !s.highlighted);
  assert.ok(nonHighlighted.some(s => s.text.includes('cat')));
});

test('buildSearchHighlightSegments: strips non-hi HTML tags to spaces', () => {
  // <b> and </b> are replaced with spaces by the HTML stripper
  const result = buildSearchHighlightSegments('<b>bold</b> text', 'bold');
  assert.deepEqual(segments(result), [
    { text: ' ', highlighted: false },
    { text: 'bold', highlighted: true },
    { text: '  text', highlighted: false },
  ]);
});

test('buildSearchHighlightSegments: replaces <br> with space', () => {
  const result = buildSearchHighlightSegments('line1<br>line2', 'foo');
  assert.deepEqual(segments(result), [{ text: 'line1 line2', highlighted: false }]);
});

test('buildSearchHighlightSegments: decodes HTML entities', () => {
  const result = buildSearchHighlightSegments('a &amp; b &lt; c', 'foo');
  assert.deepEqual(segments(result), [{ text: 'a & b < c', highlighted: false }]);
});

test('buildSearchHighlightSegments: escapes regex special chars in query', () => {
  const result = buildSearchHighlightSegments('price: $100', '$100');
  assert.deepEqual(segments(result), [
    { text: 'price: ', highlighted: false },
    { text: '$100', highlighted: true },
  ]);
});

test('collapseSegmentsToPlainText: joins segment texts', () => {
  const segs = buildSearchHighlightSegments('hello <hi>world</hi>', 'foo');
  assert.equal(collapseSegmentsToPlainText(segs), 'hello world');
});

test('collapseSegmentsToPlainText: collapses whitespace', () => {
  const segs = buildSearchHighlightSegments('hello<br>world', 'foo');
  assert.equal(collapseSegmentsToPlainText(segs), 'hello world');
});

test('collapseSegmentsToPlainText: returns empty for empty segments', () => {
  assert.equal(collapseSegmentsToPlainText([]), '');
});
