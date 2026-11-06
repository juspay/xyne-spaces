import { redactSensitiveUrl } from './redact';

describe('redactSensitiveUrl', () => {
  it('redacts credential query values and keeps the rest', () => {
    expect(redactSensitiveUrl('/api/auth/callback?code=abc&state=xyz&scope=email')).toBe(
      '/api/auth/callback?code=[REDACTED]&state=[REDACTED]&scope=email',
    );
    expect(redactSensitiveUrl('/api/csat/t1?token=hmac&user_code=UC&limit=5')).toBe(
      '/api/csat/t1?token=[REDACTED]&user_code=[REDACTED]&limit=5',
    );
    expect(redactSensitiveUrl('/x?Access_Token=a&x-goog-signature=b')).toBe(
      '/x?Access_Token=[REDACTED]&x-goog-signature=[REDACTED]',
    );
  });

  it('redacts secrets carried in the path', () => {
    expect(redactSensitiveUrl('/api/automation-webhooks/series/secret?x=1')).toBe(
      '/api/automation-webhooks/series/[REDACTED]?x=1',
    );
    expect(redactSensitiveUrl('/api/invitations/abcd/accept')).toBe('/api/invitations/[REDACTED]/accept');
    expect(redactSensitiveUrl('/api/apps/webhooks/ws1/app1/secret')).toBe('/api/apps/webhooks/ws1/app1/[REDACTED]');
  });

  it('drops the fragment of absolute URLs', () => {
    expect(redactSensitiveUrl('https://app.example/launch?code=c&state=s#frag')).toBe(
      'https://app.example/launch?code=[REDACTED]&state=[REDACTED]',
    );
  });

  it('leaves plain URLs and empty input unchanged', () => {
    expect(redactSensitiveUrl('/api/health')).toBe('/api/health');
    expect(redactSensitiveUrl(undefined)).toBe('');
  });
});
