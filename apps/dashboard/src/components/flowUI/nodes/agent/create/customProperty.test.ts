import { describe, expect, it } from 'vitest';
import { joinTags, mergeTags, splitTags, tagsFromText } from './customProperty';

describe('tags', () => {
  it('reads the stored comma list, dropping blanks', () => {
    expect(splitTags('devesh, platform-team')).toEqual(['devesh', 'platform-team']);
    expect(splitTags(' billing ,, refunds , ')).toEqual(['billing', 'refunds']);
    expect(splitTags('')).toEqual([]);
  });

  it('keeps a multi-word tag that chat wrote', () => {
    expect(splitTags('platform team, on-call')).toEqual(['platform team', 'on-call']);
  });

  it('ends a typed or pasted tag at each space or comma', () => {
    expect(tagsFromText('devesh ')).toEqual(['devesh']);
    expect(tagsFromText('a b,c  d')).toEqual(['a', 'b', 'c', 'd']);
    expect(tagsFromText(' ')).toEqual([]);
  });

  it('adds new tags once, ignoring case', () => {
    expect(mergeTags(['Devesh'], ['devesh', 'ops'])).toEqual(['Devesh', 'ops']);
  });

  it('writes the list back in the stored form', () => {
    expect(joinTags(['devesh', 'platform-team'])).toBe('devesh, platform-team');
  });
});
