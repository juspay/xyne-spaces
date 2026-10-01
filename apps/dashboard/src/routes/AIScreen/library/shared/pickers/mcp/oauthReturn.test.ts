import { describe, expect, it } from 'vitest';
import { oauthReturnMessage, readOAuthReturn } from './oauthReturn';

describe('readOAuthReturn', () => {
  it('reads a finished sign-in and leaves the draft alone', () => {
    const params = new URLSearchParams('draft=d1&github_connected=true');
    expect(readOAuthReturn(params)).toEqual({ type: 'github', keys: ['github_connected'], ok: true });
  });

  it('reads a failed one with its reason', () => {
    const params = new URLSearchParams('twitter_error=access_denied&draft=d1');
    expect(readOAuthReturn(params)).toMatchObject({ type: 'twitter', ok: false, reason: 'access_denied' });
  });

  it('ignores a page that no sign-in sent back', () => {
    expect(readOAuthReturn(new URLSearchParams('draft=d1'))).toBeNull();
    expect(readOAuthReturn(new URLSearchParams('github_connected=false'))).toBeNull();
  });
});

describe('oauthReturnMessage', () => {
  it('names the connector and says what happened', () => {
    expect(oauthReturnMessage({ type: 'github', keys: [], ok: true }, 'GitHub')).toBe('GitHub connected');
    expect(
      oauthReturnMessage({ type: 'github', keys: [], ok: false, reason: 'access_denied' }, 'GitHub'),
    ).toMatch(/cancelled/);
    expect(
      oauthReturnMessage({ type: 'github', keys: [], ok: false, reason: 'token_exchange_failed' }, 'GitHub'),
    ).toBe("Couldn't connect GitHub. Try again.");
  });
});
