import { describe, expect, it } from 'vitest';
import { getFlowJsonPreviewText } from '../flowPreview';
import { getReactionMessagePreview } from '../../components/Activity/reactionMessagePreview';

describe('getFlowJsonPreviewText', () => {
  // Regression: XYNE-65862 — an activity whose related message has no `content`
  // crashed the whole Activity page with "reading 'includes'".
  it('returns null instead of throwing when content is missing', () => {
    expect(getFlowJsonPreviewText(undefined)).toBeNull();
    expect(getFlowJsonPreviewText(null)).toBeNull();
    expect(getFlowJsonPreviewText(42 as unknown as string)).toBeNull();
  });

  it('returns null for plain (non-flow) message content', () => {
    expect(getFlowJsonPreviewText('hello <b>world</b>')).toBeNull();
  });

  it('extracts the title from a FlowJSON message', () => {
    const json = JSON.stringify({ title: 'Deploy approval', components: [] }).replace(
      /"/g,
      '&quot;',
    );
    expect(getFlowJsonPreviewText(`<div data-flow-json="${json}">Flow JSON</div>`)).toBe(
      'Deploy approval',
    );
  });
});

describe('getReactionMessagePreview', () => {
  it('returns an empty preview instead of throwing when content is missing', () => {
    expect(getReactionMessagePreview(undefined)).toBe('');
    expect(getReactionMessagePreview(null)).toBe('');
  });

  it('passes plain content through', () => {
    expect(getReactionMessagePreview('hi')).toBe('hi');
  });
});
