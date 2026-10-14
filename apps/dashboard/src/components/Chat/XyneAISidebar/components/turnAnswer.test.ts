import { describe, expect, it } from 'vitest';
import { isErrorOnlyContent, needsFallbackAnswer } from './turnAnswer';

const errorInfo = {
  code: 'RUN_FAILED',
  title: 'Something went wrong',
  message: 'The agent could not finish this reply.',
};

describe('needsFallbackAnswer', () => {
  it('renders content for a legacy message with no ordered parts', () => {
    expect(needsFallbackAnswer({ ordered: false, streaming: false, hasText: false })).toBe(true);
  });

  it('renders content when a finished turn has steps but no text (failed run)', () => {
    expect(needsFallbackAnswer({ ordered: true, streaming: false, hasText: false })).toBe(true);
  });

  it('does not duplicate the answer when the parts already carry text', () => {
    expect(needsFallbackAnswer({ ordered: true, streaming: false, hasText: true })).toBe(false);
  });

  it('does not fall back while the turn is still streaming', () => {
    expect(needsFallbackAnswer({ ordered: true, streaming: true, hasText: false })).toBe(false);
  });
});

describe('isErrorOnlyContent', () => {
  it('is false without errorInfo', () => {
    expect(isErrorOnlyContent({ content: 'An answer' })).toBe(false);
  });

  it('is true when content is just the error message', () => {
    expect(isErrorOnlyContent({ content: ` ${errorInfo.message}\n`, errorInfo })).toBe(true);
  });

  it('is true when a failed reply has no content at all', () => {
    expect(isErrorOnlyContent({ content: '', errorInfo })).toBe(true);
  });

  it('keeps a partial answer that streamed before the failure', () => {
    expect(isErrorOnlyContent({ content: 'Here is what I found so far', errorInfo })).toBe(false);
  });
});
