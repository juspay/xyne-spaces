import { describe, expect, it } from 'vitest';
import { afterToolBreak } from './draftChat';

describe('afterToolBreak', () => {
  it('starts a new paragraph when text resumes after a tool call', () => {
    expect(afterToolBreak("Quick plan first, then I'll read the file.")).toBe('\n\n');
  });

  it('tops up a single newline and adds nothing after a blank line', () => {
    expect(afterToolBreak('Reading it now.\n')).toBe('\n');
    expect(afterToolBreak('Reading it now.\n\n')).toBe('');
  });

  it('adds nothing when no text came before the tool call', () => {
    expect(afterToolBreak('')).toBe('');
    expect(afterToolBreak('  ')).toBe('');
  });
});
