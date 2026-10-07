jest.mock('@/utils/ssrfGuard', () => ({ assertHostIsExternal: jest.fn() }));
jest.mock('@/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { parseXPostUrl, extractPostTextFromOEmbedHtml } from './xPostPreviewService';

describe('parseXPostUrl', () => {
  it.each([
    ['https://x.com/elonmusk/status/1234567890', 'elonmusk', '1234567890'],
    ['https://twitter.com/jack/status/20', 'jack', '20'],
    ['https://www.twitter.com/jack/status/20?s=20&t=abc', 'jack', '20'],
    ['https://mobile.x.com/some_user/status/99/photo/1', 'some_user', '99'],
    ['http://x.com/a/statuses/5', 'a', '5'],
  ])('accepts %s', (url, handle, postId) => {
    expect(parseXPostUrl(url)).toEqual({ url: `https://x.com/${handle}/status/${postId}`, handle, postId });
  });

  it.each([
    'https://x.com/elonmusk',
    'https://x.com/search?q=status',
    'https://x.com/a/status/notanumber',
    'https://evilx.com/a/status/1',
    'https://x.com.evil.io/a/status/1',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', url => {
    expect(parseXPostUrl(url)).toBeNull();
  });
});

describe('extractPostTextFromOEmbedHtml', () => {
  it('keeps the post body, drops attribution, decodes entities and line breaks', () => {
    const html =
      '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Shipping &amp; testing<br>second line ' +
      '<a href="https://t.co/x">pic.twitter.com/x</a></p>&mdash; Jack (@jack) <a href="https://twitter.com/jack/status/20">March 21, 2006</a></blockquote>';
    expect(extractPostTextFromOEmbedHtml(html)).toBe('Shipping & testing\nsecond line pic.twitter.com/x');
  });

  it('does not keep markup from the post', () => {
    const html = '<blockquote><p>&lt;img src=x onerror=alert(1)&gt; hi</p></blockquote>';
    // Decoded to literal text; the dashboard renders it as a text node, never as HTML.
    expect(extractPostTextFromOEmbedHtml(html)).toBe('<img src=x onerror=alert(1)> hi');
  });
});
