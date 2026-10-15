import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { softWrapLongCodeFenceLines } from '@/src/utils/markdownSoftWrap';

const ZWSP = '\u200B';

describe('softWrapLongCodeFenceLines', () => {
  it('returns text unchanged when there is no code context', () => {
    const md = 'Just a normal paragraph with several words and no code at all.';
    assert.equal(softWrapLongCodeFenceLines(md), md);
  });

  it('leaves a long line untouched when it is outside any code block', () => {
    const longWord = 'a'.repeat(120);
    // No fence / no indented code anywhere → early return, nothing wrapped.
    assert.equal(softWrapLongCodeFenceLines(longWord), longWord);
  });

  it('inserts zero-width breaks into a long unbroken run inside a fence', () => {
    const run = 'x'.repeat(100);
    const wrapped = softWrapLongCodeFenceLines('```\n' + run + '\n```');
    const line = wrapped.split('\n')[1];
    // A break is emitted after every 48 chars: 48 + ZWSP + 48 + ZWSP + 4.
    assert.equal(line, 'x'.repeat(48) + ZWSP + 'x'.repeat(48) + ZWSP + 'x'.repeat(4));
    // Only zero-width breaks are added — stripping them restores the original run.
    assert.equal(line.split(ZWSP).join(''), run);
  });

  it('leaves short fenced lines untouched', () => {
    const md = '```\nconst a = 1;\n```';
    assert.equal(softWrapLongCodeFenceLines(md), md);
  });

  it('wraps long runs in indented code blocks even without fences', () => {
    const run = 'y'.repeat(80);
    const wrapped = softWrapLongCodeFenceLines('    ' + run);
    assert.ok(wrapped.includes(ZWSP));
    assert.equal(wrapped.split(ZWSP).join(''), '    ' + run);
  });

  it('does not wrap a long run once the fence has closed', () => {
    const run = 'z'.repeat(100);
    // Fence is opened and closed; the long run afterwards sits in prose.
    const md = '```\nshort\n```\n' + run;
    const wrapped = softWrapLongCodeFenceLines(md);
    assert.equal(wrapped.split('\n').pop(), run);
    assert.ok(!wrapped.includes(ZWSP));
  });
});
