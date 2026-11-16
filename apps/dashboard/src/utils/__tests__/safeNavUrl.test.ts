// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { toSafeAppUrl } from '../safeNavUrl';

describe('toSafeAppUrl', () => {
  it('keeps relative and same-origin URLs as paths', () => {
    expect(toSafeAppUrl('/ws1/chat?x=1#m', '/f')).toBe('/ws1/chat?x=1#m');
    expect(toSafeAppUrl(`${window.location.origin}/ws1/tickets`, '/f')).toBe('/ws1/tickets');
  });

  it('rejects script and data URLs', () => {
    expect(toSafeAppUrl('javascript:alert(1)', '/f')).toBe('/f');
    expect(toSafeAppUrl(' JaVaScRiPt:alert(1)', '/f')).toBe('/f');
    expect(toSafeAppUrl('data:text/html,<script>1</script>', '/f')).toBe('/f');
  });

  it('rejects foreign hosts and falls back on empty input', () => {
    expect(toSafeAppUrl('https://attacker.example/phish', '/f')).toBe('/f');
    expect(toSafeAppUrl('//attacker.example/x', '/f')).toBe('/f');
    expect(toSafeAppUrl(undefined, '/f')).toBe('/f');
  });
});
