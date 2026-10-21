import { describe, expect, it } from 'vitest';
import { D2_SAFE_URI_REGEXP } from './D2Block.sanitize';

// DOMPurify strips whitespace/control chars before testing ALLOWED_URI_REGEXP, so the
// values here are already in the normalized form the regexp actually sees.
describe('D2_SAFE_URI_REGEXP (XYNE-65425)', () => {
  it.each([
    'https://example.com',
    'http://example.com/path?q=1',
    'HTTPS://EXAMPLE.COM',
    '#section',
    '/relative/path',
    './file',
    'page.html',
    'page',
    '/path/with:colon',
    '?q=a:b',
  ])('allows %s', uri => {
    expect(D2_SAFE_URI_REGEXP.test(uri)).toBe(true);
  });

  it.each([
    'javascript:alert(document.domain)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'vbscript:msgbox(1)',
    'mailto:a@b.c',
    'file:///etc/passwd',
    'blob:https://x/uuid',
    'x-custom+scheme.v1:payload',
    'web+app2:payload',
  ])('rejects %s', uri => {
    expect(D2_SAFE_URI_REGEXP.test(uri)).toBe(false);
  });
});
