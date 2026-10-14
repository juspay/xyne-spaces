import { describe, expect, it } from 'vitest';
import { answeredByText } from './AnsweredByLabel';

describe('answeredByText', () => {
  it('names the model that answered', () => {
    expect(answeredByText({ provider: 'spaces', model: 'open-large', fellBack: false })).toBe(
      'Answered by open-large',
    );
  });

  it('falls back to the provider name when no model was reported', () => {
    expect(answeredByText({ provider: 'codex' })).toBe('Answered by Codex');
  });

  it('calls out a fallback with the requested model', () => {
    expect(
      answeredByText({
        provider: 'spaces',
        model: 'private-large',
        fellBack: true,
        requestedProvider: 'codex',
        requestedModel: 'gpt-5.5',
      }),
    ).toBe('Answered by private-large · fell back from gpt-5.5');
  });

  it('fallback with no requested info still says so', () => {
    expect(answeredByText({ provider: 'spaces', model: 'private-large', fellBack: true })).toBe(
      'Answered by private-large · fallback',
    );
  });
});
