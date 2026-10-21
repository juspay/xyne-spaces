import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getLongMessageCollapseModel,
  LONG_MESSAGE_LINE_BUFFER,
  LONG_MESSAGE_MAX_COLLAPSED_LINES,
  LONG_MESSAGE_MIN_COLLAPSED_LINES,
  markdownToCollapsedPreviewText,
  shouldCollapseMessageBody,
  type LongMessageCollapseModel,
} from '@/src/features/chat/v2/components/conversation-composer/utils/longMessageCollapse';

describe('longMessageCollapse / markdownToCollapsedPreviewText', () => {
  it('rewrites xemoji tokens to shortcodes and strips markdown', () => {
    const out = markdownToCollapsedPreviewText('xemoji:1:smile:emojix hello **bold**');
    assert.match(out, /:smile:/);
    assert.match(out, /hello/);
    assert.match(out, /bold/);
    assert.doesNotMatch(out, /\*\*/);
  });

  it('drops xemoji tokens that carry no name', () => {
    assert.equal(markdownToCollapsedPreviewText('xemoji:1::emojix'), '');
  });
});

describe('longMessageCollapse / getLongMessageCollapseModel', () => {
  it('does not collapse short content', () => {
    const model = getLongMessageCollapseModel({
      markdown: 'hello world',
      maxWidth: 300,
      viewportHeight: 800,
    });
    assert.equal(model.shouldCollapse, false);
    assert.equal(model.estimatedLineCount, 1);
  });

  it('collapses a clearly long single paragraph', () => {
    const model = getLongMessageCollapseModel({
      markdown: 'a'.repeat(900),
      maxWidth: 300,
      viewportHeight: 800,
    });
    assert.equal(model.shouldCollapse, true);
    assert.ok(model.readableCharacterCount >= 650);
  });

  it('collapses a tall block with many explicit lines', () => {
    const markdown = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    const model = getLongMessageCollapseModel({ markdown, maxWidth: 300, viewportHeight: 800 });
    assert.equal(model.shouldCollapse, true);
  });

  it('clamps collapsedNumberOfLines within the configured bounds', () => {
    const tiny = getLongMessageCollapseModel({ markdown: 'x', maxWidth: 300, viewportHeight: 100 });
    const huge = getLongMessageCollapseModel({
      markdown: 'x',
      maxWidth: 300,
      viewportHeight: 100000,
    });
    assert.equal(tiny.collapsedNumberOfLines, LONG_MESSAGE_MIN_COLLAPSED_LINES);
    assert.equal(huge.collapsedNumberOfLines, LONG_MESSAGE_MAX_COLLAPSED_LINES);
  });
});

describe('longMessageCollapse / shouldCollapseMessageBody', () => {
  const base: LongMessageCollapseModel = {
    shouldCollapse: false,
    collapsedNumberOfLines: LONG_MESSAGE_MIN_COLLAPSED_LINES,
    estimatedLineCount: LONG_MESSAGE_MIN_COLLAPSED_LINES + LONG_MESSAGE_LINE_BUFFER,
    readableCharacterCount: 0,
  };

  it('always collapses when the model already says so', () => {
    assert.equal(shouldCollapseMessageBody({ ...base, shouldCollapse: true }, 'USER'), true);
  });

  it('collapses tall BOT and SYSTEM messages even when the model is undecided', () => {
    assert.equal(shouldCollapseMessageBody(base, 'BOT'), true);
    assert.equal(shouldCollapseMessageBody(base, 'SYSTEM'), true);
  });

  it('does not collapse tall messages of other kinds', () => {
    assert.equal(shouldCollapseMessageBody(base, 'USER'), false);
    assert.equal(shouldCollapseMessageBody(base, undefined), false);
  });

  it('does not collapse a short BOT message', () => {
    assert.equal(shouldCollapseMessageBody({ ...base, estimatedLineCount: 1 }, 'BOT'), false);
  });
});
