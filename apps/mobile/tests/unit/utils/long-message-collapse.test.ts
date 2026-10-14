import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getLongMessageCollapseModel,
  markdownToCollapsedPreviewText,
  shouldCollapseMessageBody,
} from '@/src/components/conversation-composer/utils/longMessageCollapse';

describe('markdownToCollapsedPreviewText', () => {
  it('strips link and image markup down to the label text', () => {
    assert.equal(markdownToCollapsedPreviewText('see [docs](http://x)'), 'see docs');
    assert.equal(markdownToCollapsedPreviewText('![alt](http://img)'), 'alt');
  });

  it('normalizes bullet and ordered list markers to a bullet glyph', () => {
    assert.equal(markdownToCollapsedPreviewText('- item'), '• item');
    assert.equal(markdownToCollapsedPreviewText('1. item'), '• item');
  });

  it('removes heading and blockquote prefixes and inline emphasis', () => {
    assert.equal(markdownToCollapsedPreviewText('## Title'), 'Title');
    assert.equal(markdownToCollapsedPreviewText('> quote'), 'quote');
    assert.equal(markdownToCollapsedPreviewText('**bold** _em_'), 'bold em');
  });
});

describe('getLongMessageCollapseModel', () => {
  it('does not collapse a short message', () => {
    const model = getLongMessageCollapseModel({
      markdown: 'hello world',
      maxWidth: 300,
      viewportHeight: 800,
    });
    assert.equal(model.shouldCollapse, false);
  });

  it('collapses a long, tall block of text', () => {
    const markdown = Array.from({ length: 25 }, (_, i) => `line ${i} ${'x'.repeat(44)}`).join('\n');
    const model = getLongMessageCollapseModel({ markdown, maxWidth: 300, viewportHeight: 800 });
    assert.equal(model.shouldCollapse, true);
    // clamp(floor(800 * 0.46 / 20)=18, 14, 18) === 18
    assert.equal(model.collapsedNumberOfLines, 18);
  });

  it('never collapses content containing a fenced code block', () => {
    const body = Array.from({ length: 25 }, (_, i) => `line ${i} ${'x'.repeat(44)}`).join('\n');
    const markdown = '```\n' + body + '\n```';
    const model = getLongMessageCollapseModel({ markdown, maxWidth: 300, viewportHeight: 800 });
    assert.equal(model.shouldCollapse, false);
  });
});

describe('shouldCollapseMessageBody', () => {
  const baseModel = {
    shouldCollapse: false,
    collapsedNumberOfLines: 14,
    estimatedLineCount: 20,
    readableCharacterCount: 0,
  };

  it('returns true whenever the model already says collapse', () => {
    assert.equal(shouldCollapseMessageBody({ ...baseModel, shouldCollapse: true }), true);
  });

  it('collapses tall BOT/SYSTEM bodies past the line threshold', () => {
    // 20 >= 14 + 3
    assert.equal(shouldCollapseMessageBody(baseModel, 'BOT'), true);
    assert.equal(shouldCollapseMessageBody(baseModel, 'SYSTEM'), true);
  });

  it('does not collapse tall bodies for non BOT/SYSTEM kinds', () => {
    assert.equal(shouldCollapseMessageBody(baseModel, 'USER'), false);
    assert.equal(shouldCollapseMessageBody(baseModel), false);
  });
});
