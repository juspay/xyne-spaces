import { describe, expect, it } from 'vitest';
import { parseAnsweredBy } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import { answeredByFallbackNote, answeredByModelLabel, answeredByTitle } from './answeredByLabel';

describe('answeredBy labels', () => {
  it('shows the model that answered', () => {
    const a = parseAnsweredBy({ provider: 'spaces', model: 'open-large' })!;
    expect(answeredByModelLabel(a)).toBe('open-large');
    expect(answeredByFallbackNote(a)).toBeNull();
    expect(answeredByTitle(a)).toBe('Answered by open-large (Xyne)');
  });

  it('notes the fallback with the requested model and reason (XYNE-66319)', () => {
    const a = parseAnsweredBy({
      provider: 'spaces',
      model: 'private-large',
      fallbackFrom: { fromProvider: 'codex', fromModel: 'gpt-5.5', reason: 'auth' },
    })!;
    expect(answeredByFallbackNote(a)).toBe('Fell back from gpt-5.5 (Codex): credential rejected');
  });

  it('falls back to the provider label when no model is known', () => {
    expect(answeredByModelLabel(parseAnsweredBy({ provider: 'codex' })!)).toBe('Codex');
  });

  it('rejects malformed payloads', () => {
    expect(parseAnsweredBy(null)).toBeUndefined();
    expect(parseAnsweredBy({ model: 'x' })).toBeUndefined();
    expect(parseAnsweredBy({ provider: 'spaces', fallbackFrom: { reason: 'quota' } })).toEqual({
      provider: 'spaces',
    });
  });
});
