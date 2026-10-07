import { parseXPostUrl, syndicationToken } from './xPostUrl';

describe('parseXPostUrl', () => {
  it.each([
    ['https://x.com/jack/status/20', '20', 'jack'],
    ['https://twitter.com/jack/status/20?s=46&t=abc', '20', 'jack'],
    ['https://www.twitter.com/jack/statuses/20', '20', 'jack'],
    ['https://mobile.x.com/jack/status/20/photo/1', '20', 'jack'],
    ['http://X.COM/jack/status/20#frag', '20', 'jack'],
  ])('recognises %s', (url, postId, handle) => {
    expect(parseXPostUrl(url)).toEqual({ url: `https://x.com/${handle}/status/${postId}`, postId, handle });
  });

  it('accepts handle-less /i/status links', () => {
    expect(parseXPostUrl('https://x.com/i/status/1234')).toEqual({ url: 'https://x.com/i/status/1234', postId: '1234' });
    expect(parseXPostUrl('https://x.com/i/web/status/1234')?.postId).toBe('1234');
  });

  it.each([
    'https://x.com/jack',
    'https://x.com/search?q=status',
    'https://x.com/jack/status/abc',
    'https://x.com.evil.example/jack/status/20',
    'https://evil.example/x.com/jack/status/20',
    'https://nitter.net/jack/status/20',
    'javascript:alert(1)//x.com/jack/status/20',
    'not a url',
  ])('rejects %s', url => {
    expect(parseXPostUrl(url)).toBeNull();
  });
});

describe('syndicationToken', () => {
  it('matches the embed widget derivation', () => {
    // Reference value computed with react-tweet's getToken().
    const id = '1683920951807971329';
    const expected = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    expect(syndicationToken(id)).toBe(expected);
    expect(syndicationToken(id)).toMatch(/^[0-9a-z]+$/);
  });
});
