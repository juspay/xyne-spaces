import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8');

void describe('create canvas write cues', () => {
  void it('shimmers in CSS, left to right, in theme colours (Thinking states)', () => {
    const highlight = read('./ChatFillHighlight.tsx');
    const css = read('./thinking-shimmer.css');
    assert.match(highlight, /import '\.\/thinking-shimmer\.css';/);
    assert.match(highlight, /active && 't-think-field'/);
    // No per-frame JS: the sweep is a CSS animation.
    assert.equal(/from 'motion\/react'|from 'framer-motion'/.test(highlight), false);
    // 100% → 0% over a 400% gradient carries the band from the left edge to the right.
    assert.match(css, /background-size: 400% 100%/);
    assert.match(
      css,
      /0% \{\s*background-position: 100% 0;\s*\}\s*100% \{\s*background-position: 0% 0;/,
    );
    assert.match(css, /animation: t-think-shimmer var\(--think-shimmer\) linear infinite/);
    assert.equal(/#ff8904/i.test(css + highlight), false, 'no orange band');
    assert.equal(/ring-2/.test(highlight), false);
  });

  void it('only dims under reduced motion', () => {
    const css = read('./thinking-shimmer.css');
    assert.match(
      css,
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation: none;[\s\S]*-webkit-text-fill-color: var\(--think-base\);/,
    );
  });

  void it('has no traveling pointer', () => {
    assert.equal(existsSync(new URL('./WritingFieldPointer.tsx', import.meta.url)), false);
    assert.equal(/WritingFieldPointer/.test(read('./AgentCreateCanvas.tsx')), false);
  });

  void it('animates rows with Motion under the user reduced-motion setting', () => {
    const canvas = read('./AgentCreateCanvas.tsx');
    assert.match(canvas, /from 'motion\/react'/);
    assert.match(canvas, /<MotionConfig reducedMotion='user'>/);
    assert.match(canvas, /<AnimatePresence initial=\{false\} mode='popLayout'>/);
  });
});
