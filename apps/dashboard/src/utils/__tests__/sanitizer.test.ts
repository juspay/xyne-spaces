// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeHtmlString } from '../sanitizer';

describe('sanitizeHtmlString', () => {
  it('sanitises children of an unwrapped disallowed tag', () => {
    const out = sanitizeHtmlString(
      '<section><img src="https://x.test/a.png" onerror="alert(1)"></section>',
    );
    expect(out).not.toContain('onerror');
  });

  it('keeps sanitising elements after the first disallowed tag', () => {
    const out = sanitizeHtmlString(
      '<font>t</font><p onclick="z()">p</p><a href="javascript:alert(1)">a</a>',
    );
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('javascript:');
  });

  it('drops script and style elements with their content', () => {
    const out = sanitizeHtmlString('<p>ok</p><script>alert(1)</script><style>p{}</style>');
    expect(out).toContain('ok');
    expect(out).not.toContain('alert(1)');
    expect(out).not.toContain('p{}');
  });

  it('keeps allowed markup and text', () => {
    expect(sanitizeHtmlString('<p><strong>hi</strong> there</p>')).toBe(
      '<p><strong>hi</strong> there</p>',
    );
  });
});
