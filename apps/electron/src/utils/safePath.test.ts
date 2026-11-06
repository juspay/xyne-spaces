import { describe, expect, it } from 'vitest';
import { join, resolve } from 'path';
import { safeChildPath, safePathSegment } from './safePath';

describe('safePathSegment', () => {
  it('strips directories and traversal', () => {
    expect(safePathSegment('../../../../.zshrc', 'f')).toBe('zshrc');
    expect(safePathSegment('..\\..\\Library\\LaunchAgents\\evil.plist', 'f')).toBe('evil.plist');
    expect(safePathSegment('a/b/c.txt', 'f')).toBe('c.txt');
  });

  it('falls back for empty or dot-only names', () => {
    expect(safePathSegment('', 'fallback')).toBe('fallback');
    expect(safePathSegment('..', 'fallback')).toBe('fallback');
    expect(safePathSegment(undefined, 'fallback')).toBe('fallback');
  });

  it('keeps ordinary names', () => {
    expect(safePathSegment('Q3 report-final.pdf', 'f')).toBe('Q3 report-final.pdf');
  });
});

describe('safeChildPath', () => {
  const dir = resolve('/tmp/xyne-test-dir');
  it('allows a child', () => {
    expect(safeChildPath(dir, 'a.txt')).toBe(join(dir, 'a.txt'));
  });
  it('rejects escapes', () => {
    expect(safeChildPath(dir, '../a.txt')).toBeNull();
    expect(safeChildPath(dir, '/etc/passwd')).toBeNull();
    expect(safeChildPath(dir, '')).toBeNull();
  });
});
