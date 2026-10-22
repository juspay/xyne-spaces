import { describe, expect, it } from 'vitest';

import {
  PROJECT_INSTRUCTIONS_MAX_CHARS,
  formatKnowledgeMime,
  formatKnowledgeSize,
  instructionsCounter,
  knowledgeTypeLabel,
} from './projectHome.utils';

describe('instructionsCounter', () => {
  it('counts an empty editor against the full allowance', () => {
    expect(instructionsCounter('')).toEqual({
      used: 0,
      remaining: PROJECT_INSTRUCTIONS_MAX_CHARS,
      overLimit: false,
    });
  });

  it('does not flag a value sitting exactly on the limit', () => {
    const counter = instructionsCounter('x'.repeat(PROJECT_INSTRUCTIONS_MAX_CHARS));
    expect(counter.remaining).toBe(0);
    expect(counter.overLimit).toBe(false);
  });

  it('reports how far past the limit a long paste is', () => {
    const counter = instructionsCounter('x'.repeat(PROJECT_INSTRUCTIONS_MAX_CHARS + 25));
    expect(counter.remaining).toBe(-25);
    expect(counter.overLimit).toBe(true);
  });
});

describe('formatKnowledgeSize', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1.0 MB'],
    [Math.round(1.44 * 1024 * 1024), '1.4 MB'],
    [1024 * 1024 * 1024, '1.0 GB'],
  ])('renders %d bytes as %s', (bytes, expected) => {
    expect(formatKnowledgeSize(bytes)).toBe(expected);
  });

  it('drops the decimal once the number is large enough not to need it', () => {
    expect(formatKnowledgeSize(15 * 1024 * 1024)).toBe('15 MB');
  });

  it.each([null, undefined, -1, Number.NaN])('returns null for %s', value => {
    expect(formatKnowledgeSize(value as number | null)).toBeNull();
  });
});

describe('formatKnowledgeMime', () => {
  it.each([
    ['application/pdf', 'PDF'],
    ['image/png', 'PNG'],
    ['text/csv', 'CSV'],
    ['text/plain; charset=utf-8', 'PLAIN'],
  ])('shortens %s to %s', (mime, expected) => {
    expect(formatKnowledgeMime(mime)).toBe(expected);
  });

  it('keeps a vendor type short', () => {
    expect(
      formatKnowledgeMime(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('DOCUMENT');
  });

  it.each([null, undefined, '', 'application', 'application/'])(
    'returns null for %s rather than an empty badge',
    value => {
      expect(formatKnowledgeMime(value as string | null)).toBeNull();
    },
  );
});

describe('knowledgeTypeLabel', () => {
  it.each([
    ['file', 'File'],
    ['kb_collection', 'Knowledge base'],
    ['channel', 'Channel'],
    ['ticket', 'Ticket'],
    ['canvas', 'Canvas'],
  ])('labels %s as %s', (type, expected) => {
    expect(knowledgeTypeLabel(type)).toBe(expected);
  });

  it('falls back to the raw type it does not know', () => {
    expect(knowledgeTypeLabel('workflow')).toBe('workflow');
  });
});
